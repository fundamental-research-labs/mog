# Plan 100 — Harden the consumer-boundary harness in `mog/fixtures/external`

## Source folder and scope

- **Folder:** `mog/fixtures/external` — the out-of-monorepo consumer-package boundary harness.
- **In scope:**
  - `orchestrate.mjs` (858 lines) — the gate runner behind `check:external-fixtures`, `check:public-package-manifests`. Builds ship-public/binary-wrapper packages, packs tarballs, validates packed manifests, then installs each fixture in an isolated temp dir with **npm** (not pnpm) and asserts typecheck/runtime behavior.
  - `shared/utils.mjs` — pack/install/typecheck/runtime/cleanup helpers (`packPackage`, `createFixtureEnv`, `assertTypecheck`, `assertRuntime`, `assertPackageScript`, `assertTypecheckFails`, `assertImportFails`, `FixtureInstallError`).
  - `shared/contracts-runtime-inventory.mjs` — generates the `contracts-runtime-values` positive fixture's smoke files from a discovered runtime inventory.
  - `positive/*` — 9 fixtures that **must** typecheck/run when installed from packed tarballs: `contracts`, `contracts-runtime-values`, `embed-react`, `embed-web-component`, `kernel`, `node-sdk`, `sheet-view`, `spreadsheet-app-runtime-lifecycle`, `wasm`.
  - `negative/*` — 19 fixtures that **must** fail to typecheck (and optionally fail at runtime import): deep imports, `@mog/types-*` / `@mog-sdk/types-*` star imports, internal-symbol imports through `@mog-sdk/spreadsheet-app`, host-internal imports, legacy sheet-view paths, etc.
- **Out of scope (referenced, not edited by this plan):** `mog/tools/package-inventory.jsonc`, `mog/tools/package-export-dispositions.mjs`, `mog/tools/public-package-manifest.mjs`, `mog/tools/verify-sdk-publish.mjs` (imports `packPackage` from `shared/utils.mjs`), `mog/package.json` script wiring, and the public packages themselves. Changes that *those* files require to support a strengthened gate are called out as cross-folder dependencies, not edited here.

## Current role of this folder in Mog

This folder is the **last line of defense against public-API leakage and broken published packages**. Unit/integration tests run inside the pnpm workspace, where TypeScript path mappings, workspace symlinks, and source `.ts` files paper over what an external consumer would actually experience. This harness deliberately leaves the monorepo: it `npm pack`s each ship-public package, installs the tarball into a throwaway temp directory with plain `npm install`, and then:

- **Positive fixtures** prove the published export map, rolled-up `.d.ts`, and runtime entry points actually work for a real consumer (`import { createWorkbook } from '@mog-sdk/kernel'`, subpath imports like `@mog-sdk/kernel/security`, browser bundling via esbuild for `sheet-view`, runtime-valued contract exports for `contracts-runtime-values`).
- **Negative fixtures** prove that forbidden surfaces are *unreachable* from outside: deep imports past the `exports` map, `@mog/types-*` internal packages, private implementation symbols leaked through public `.d.ts`, host-internal bindings.
- **Manifest validation** (`validatePackedManifest`) proves packed `package.json`s carry no `workspace:`/`link:`/`file:` references, no forbidden internal dependencies (`@mog/*`, `@mog-sdk/types-*`, `@rust-bridge/*`), exact lock-step versions for `@mog-sdk/*` deps, no `development` export conditions, and that every `exports`/`files` target is actually inside the tarball.

It is wired into `check:publish-readiness`, `check:publish-readiness:sdk`, and `validate:all-boundaries` (all with `--skip-build`), documented in `docs/development/ci-gates.md`, and its `packPackage` helper is reused by `tools/verify-sdk-publish.mjs`. A regression here means leakage or a broken publish ships undetected.

## Improvement objectives

1. **Close the negative-fixture false-positive hole.** `assertTypecheckFails` reports success when `tsc --noEmit` fails for *any* reason — including a missing `tsconfig.json`, an unrelated syntax error, a missing `typescript` devDependency, or an `npm install` failure. A negative fixture can therefore "pass" while the boundary it claims to police is wide open. The gate must assert the failure is *specifically the intended boundary violation* (module-not-found / no-exported-member on the forbidden specifier), not just non-zero exit.
2. **Remove the `@ts-nocheck` self-defeat.** `negative/host-bindings-from-kernel-source/smoke.ts` begins with `// @ts-nocheck` and the fixture ships a bare `package.json` (no `typescript`, no `tsconfig.json`, no deps). With `@ts-nocheck`, type errors are suppressed; the "typecheck failure" this fixture produces is an *environment* failure (no tsconfig/compiler), not the boundary failure it advertises. This fixture currently provides **zero** real coverage and must be rebuilt to fail for the right reason.
3. **Make the harness hermetic and deterministic.** Every fixture runs `npm install` against the public npm registry, pulling `typescript`, `ts-node`, `esbuild`, `@types/node` via caret ranges with **no lockfile**. This makes the gate network-dependent and non-reproducible: a registry hiccup is a CI failure, and a new `typescript` minor can flip a negative fixture's diagnostics. Pin and locally cache the toolchain so the gate is offline-reproducible and version-stable.
4. **Enforce coverage from the inventory, not a hardcoded list.** Required-non-stub coverage is hardcoded to exactly `kernel` + `sheet-view` (orchestrate.mjs Step 6). New ship-public packages or new public export subpaths can appear with no positive fixture and no negative deep-import guard, and the gate stays green. Coverage must be **derived** from `package-inventory.jsonc` so adding a public package forces adding a fixture.
5. **Eliminate the duplicated, fragile JSONC parser.** Both `orchestrate.mjs` (`loadJsonc`) and `shared/contracts-runtime-inventory.mjs` (`parseJsonc`) strip comments with regex (`/\/\/.*$/gm`), which corrupts any `//` or `/* */` occurring inside a JSON string value (e.g. a URL). Consolidate on one robust parser.
6. **Tighten the runtime-inventory heuristic.** `isRetainedRuntimeEntry` treats any entry whose serialized fields merely *contain the substring* `"value"` as a runtime export, and the generator silently falls back to a single hardcoded `BASELINE_RUNTIME_VALUES` entry when no inventory is found — so `contracts-runtime-values` can "pass" while exercising almost nothing. Make the inventory source authoritative and fail loudly when it is absent or empty.
7. **Modularize and unit-test the validators.** `orchestrate.mjs` is a single 858-line script mixing build orchestration, packing, manifest validation, fixture execution, and reporting. The pure validators (`validatePackedManifest`, `collectExportTargets`, `isForbiddenInternalPackage`, `isWorkspaceReference`, dev-condition detection, topological build ordering) are the security-critical core and currently have no direct unit tests — they are only exercised end-to-end through a multi-minute build+pack run.

## Production-path contracts and invariants to preserve or strengthen

**Must preserve:**

- The two public gate entry points and their semantics: `node fixtures/external/orchestrate.mjs` (exit 0 iff all required builds, packs, manifests, and fixtures pass) and `--manifest-only` / `--skip-build` / `--skip-pack` flags used by the publish-readiness scripts.
- `packPackage(packageDir)` signature and return (absolute tarball path) — `tools/verify-sdk-publish.mjs` imports it; do not break that contract.
- Manifest invariants enforced by `validatePackedManifest` + `assertPublicPackedManifestHasNoPrivateFriendExports`: no `workspace:`/`link:`/`file:` specs, no `@mog/*` / `@mog-sdk/types-*` / `@mog/types-*` / `@rust-bridge/*` / `@mog-sdk/spreadsheet-contracts` deps, no private native `@mog/compute-core-napi` in published `devDependencies`, exact lock-step `@mog-sdk/*` versions, no `development` export conditions, every `exports`/`files` target present in the tarball.
- Host-platform native-package selection (`isHostNativePlatform`, `nativePlatformFromPackageName`, current-platform binary filtering) and the optional/required pack-target split — these keep the gate runnable on a single dev/CI platform.
- The ship-public build ordering via `orderedRequiredPackTargetEntries` (topological over `workspace:` deps; throws on cycle).

**To strengthen (new/stronger invariants):**

- **Negative = specific failure.** A negative fixture passes only when `tsc` (and, where present, the runtime import) fails with a diagnostic attributable to the forbidden specifier — not a generic compile failure. Encode the expected failure (e.g. expected error codes `TS2307` "cannot find module" / `TS2305` "has no exported member", or an `expect.txt`/manifest field per fixture) and assert the emitted diagnostics match it.
- **No suppression in negatives.** Negative fixtures may not contain `@ts-nocheck`, `// @ts-ignore`, or `// @ts-expect-error` on the forbidden import line; the harness should reject such fixtures.
- **Coverage completeness.** Every `ship-public` and `binary-wrapper` package in the inventory has at least one non-stub positive fixture, and every publicly documented forbidden subpath has a negative fixture — both derived from the inventory, not a hardcoded array.
- **Hermetic toolchain.** The compiler/runtime toolchain version is pinned and resolvable offline; a clean run produces identical pass/fail given identical inputs.

## Concrete implementation plan

> The harness is dev/CI tooling under a public source path. It is not shipped to consumers, but it *is* part of the public Mog tree, so keep all internal planning rationale in mog-internal only. Edits below are real production-path improvements to the gate, not test-only shims.

**Phase 0 — Investigation (read-only, no commands beyond rg/sed/jq).**
- Confirm the exact published `exports` maps of all ship-public packages by reading each package's `package.json#exports` (and binary-wrapper `@mog-sdk/wasm`), to build the authoritative list of (a) public subpaths that positive fixtures should cover and (b) sibling non-exported subpaths that negative deep-import fixtures should target.
- Read `tools/package-export-dispositions.mjs` and `tools/public-package-manifest.mjs` to confirm whether a shared, robust JSONC reader already exists that the harness can import instead of its two regex parsers.
- Inventory each negative fixture's current failure mode (does it have `typescript` + `tsconfig.json`? does `tsc` fail for the boundary reason or an environment reason?) to size Phase 2.

**Phase 1 — Specific-failure negative assertions (highest value, closes objective 1 & 2).**
- Add a per-fixture *expectation* to negative fixtures: a small `expected-failure.json` (e.g. `{ "specifier": "@mog/types-core", "codes": ["TS2307"] }`) or an `// @boundary-expect` annotation parsed by the harness.
- Rework `assertTypecheckFails` to capture `tsc` stdout, parse the emitted diagnostics, and pass **only** when at least one diagnostic matches the expected specifier/code and there are no *unexpected* diagnostic classes (e.g. config/parse errors). Fail with a clear message if `tsc` exits zero, if it fails for an unexpected reason, or if `npm install` failed (install failures must surface as fixture failures, never as silent negative "passes").
- Apply the same principle to `assertImportFails`: require the runtime error to be a module-resolution / export error for the forbidden specifier, not any throw.
- Reject negative fixtures containing `@ts-nocheck` / `@ts-ignore` / `@ts-expect-error` on or above the forbidden import.

**Phase 2 — Rebuild `host-bindings-from-kernel-source` and audit the negative set.**
- Give `negative/host-bindings-from-kernel-source` a real `package.json` (with pinned `typescript`), a `tsconfig.json`, remove `@ts-nocheck`, and make it import the forbidden `@mog/kernel-host-internal` such that `tsc` fails with module-not-found against the packed/published surface — matching the pattern of the other negative fixtures.
- Sweep all 19 negative fixtures for the same class of self-defeat (bare manifests, `@ts-nocheck`, missing tsconfig) and normalize them onto the strengthened harness.

**Phase 3 — Hermetic toolchain (objective 3).**
- Pin exact toolchain versions (`typescript`, `ts-node`, `esbuild`, `@types/node`) in the fixture manifests (remove caret ranges) and provide a committed offline source — either a checked-in lockfile per fixture installed with `npm ci --offline` against a shared cache, or a single pinned toolchain installed once and shared into each temp dir (avoiding 28× registry installs). Keep `--ignore-scripts` install behavior.
- Make `createFixtureEnv` install offline/reproducibly and surface a precise, actionable error if the cache is cold rather than reaching the network mid-gate.

**Phase 4 — Inventory-derived coverage (objective 4).**
- Replace the hardcoded `requiredNonStubPositiveFixtures` array with a derivation: enumerate `ship-public` + `binary-wrapper` entries from the inventory, map each to its expected positive fixture(s), and fail the gate if any public package has no non-stub fixture.
- Add an inventory-derived check that each package with subpath `exports` has at least one negative deep-import fixture targeting a *non-exported* sibling subpath, so newly added public packages cannot ship without leakage coverage.
- Replace the brittle string-match stub detector (`SKIP:`, `facade package not yet created`, `TODO: Uncomment`) with a structural check: a positive fixture is a stub if its smoke file performs no import from the package under test.

**Phase 5 — Consolidate JSONC + tighten runtime inventory (objectives 5 & 6).**
- Replace both regex JSONC parsers with a single shared reader (reuse an existing tools helper if Phase 0 finds one; otherwise a small string-aware comment stripper that ignores `//` / `/* */` inside string literals).
- In `contracts-runtime-inventory.mjs`, make the discovered inventory authoritative: if no inventory file is found, or it yields zero runtime values, **fail** the `contracts-runtime-values` fixture (it claims to prove runtime-valued contract exports survive packing — a silent baseline-only fallback defeats that). Replace the loose `text.includes('value')` heuristic with explicit recognition of the inventory's documented runtime-disposition fields.

**Phase 6 — Modularize + unit-test the validators (objective 7).**
- Extract the pure functions (`validatePackedManifest`, `collectExportTargets`/`collectExportTargetsInto`, `collectDevelopmentExportSubpaths`, `exportTargetHasDevelopmentCondition`, `isForbiddenInternalPackage`, `isWorkspaceReference`, `packedPathExists`/`packedFilesEntryExists`, `orderedRequiredPackTargetEntries`) into an importable module with no `execSync`/FS side effects.
- Add unit tests (table-driven) covering: workspace/link/file rejection, forbidden-internal-dep rejection, lock-step version mismatch, `development` export condition rejection, missing export/files target, cycle detection in build ordering, and the new specific-failure diagnostic matcher. These run in milliseconds and guard the security-critical core independent of the multi-minute build.

## Tests and verification gates

- **Existing gate must stay green:** `node fixtures/external/orchestrate.mjs --skip-build` (and `--manifest-only`) — the publish-readiness scripts depend on it. (Per task constraints this plan does not *run* these; verification is specified for the implementer.)
- **New unit tests** for the extracted validators and the diagnostic matcher (Phase 6) — fast, network-free, runnable in the workspace.
- **Mutation/adversarial checks proving the strengthened negatives actually bite:**
  - Temporarily add an unrelated syntax error to a negative fixture → gate must now **fail** (previously it would have "passed").
  - Temporarily add `@ts-nocheck` to a negative fixture → gate must reject it.
  - Temporarily widen a public package's `exports` to expose a forbidden subpath → the corresponding negative fixture must flip to failing.
  - Remove the runtime inventory file → `contracts-runtime-values` must fail, not silently fall back.
- **Coverage gate self-check:** add a stub-only positive fixture for a fake public package and confirm the inventory-derived coverage check fails.
- **Hermeticity check:** run the gate with the network disabled after a warm cache → identical result.
- Confirm `tools/verify-sdk-publish.mjs` still imports and uses `packPackage` unchanged.

## Risks, edge cases, and non-goals

- **Risk — over-tightening negatives causes false failures.** A too-strict diagnostic matcher could reject a legitimate boundary failure whose error code differs across TS versions. Mitigation: pin the TS version (Phase 3) and match on specifier + a small allowed code set, not exact message text.
- **Risk — toolchain pinning drifts from the rest of the repo.** The fixtures' pinned `typescript` should track the workspace's TS major to keep diagnostics representative; document the bump procedure.
- **Edge case — platform-native packages.** Hermetic/offline install must still honor the current-platform binary filtering; do not force non-host native tarballs into install.
- **Edge case — optional/deferred packages.** Coverage derivation must respect the existing required/optional split so deferred public packages don't hard-fail the gate before they exist.
- **Edge case — `@ts-expect-error` is legitimate in *positive* fixtures** (asserting a type rejection while still compiling); the suppression ban applies only to negative fixtures' forbidden-import lines.
- **Non-goals:** changing what is or isn't public (that lives in `package-inventory.jsonc` and each package's `exports`), rewriting the build/pack pipeline, adding new public packages, or converting the harness to pnpm (npm install is intentional — it reproduces the real external-consumer resolution and must stay).

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable phases:** Phase 1 (assertion logic in `shared/utils.mjs`), Phase 5 (JSONC + `contracts-runtime-inventory.mjs`), and Phase 6 (extract+test validators from `orchestrate.mjs`) touch largely disjoint files and can proceed concurrently. Phase 2 (negative fixtures) depends on Phase 1's expectation format. Phase 4 (coverage) depends on Phase 0's inventory/export enumeration.
- **Cross-folder dependencies (read-only here, may need follow-up plans):**
  - `tools/package-inventory.jsonc` — the authoritative source for coverage derivation (Phase 4). No edit required unless an undocumented public subpath is discovered.
  - `tools/package-export-dispositions.mjs`, `tools/public-package-manifest.mjs` — candidate home for a shared JSONC reader (Phase 5) and already the source of manifest-build/disposition logic; coordinate so the harness imports rather than re-implements.
  - `tools/verify-sdk-publish.mjs` — consumer of `packPackage`; the Phase 6 extraction must keep that export stable.
  - The ship-public packages' own `exports` maps are *inputs* to coverage derivation; this plan does not edit them, but discovering a leak via the strengthened negatives may spawn a fix plan in the owning package's folder.
- No dependency on the pre-existing dirty `dev/` and `plans/` paths noted at launch; this plan touches none of them.

---

### Evidence basis

- `mog/fixtures/external/orchestrate.mjs` — Steps 1–7, `validatePackedManifest`, `orderedRequiredPackTargetEntries`, hardcoded `requiredNonStubPositiveFixtures`, `loadJsonc`, stub string-match.
- `mog/fixtures/external/shared/utils.mjs` — `assertTypecheckFails`/`assertImportFails` pass-on-any-failure, `createFixtureEnv` network `npm install`, `packPackage` (reused by `verify-sdk-publish`).
- `mog/fixtures/external/shared/contracts-runtime-inventory.mjs` — regex `parseJsonc`, `isRetainedRuntimeEntry` `includes('value')`, `BASELINE_RUNTIME_VALUES` silent fallback.
- `mog/fixtures/external/negative/host-bindings-from-kernel-source/smoke.ts` — `@ts-nocheck` + bare `package.json` (no TS, no tsconfig).
- `mog/fixtures/external/positive/*`, `negative/*` — fixture inventory; caret-ranged toolchain devDeps with no lockfile.
- Wiring: `mog/package.json` (`check:external-fixtures`, `check:public-package-manifests`, publish-readiness scripts), `docs/development/ci-gates.md`, `tools/verify-sdk-publish.mjs`.
