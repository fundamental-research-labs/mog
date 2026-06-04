# Plan 100: External Fixture Boundary Improvements

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/fixtures/external`

Queue item: 100

Scope this plan covers:

- `fixtures/external/orchestrate.mjs`, the publish-readiness fixture orchestrator that builds, packs, validates, installs, and executes external consumer fixtures.
- `fixtures/external/shared/utils.mjs`, including package packing, isolated npm fixture installation, positive type/runtime assertions, negative type/runtime assertions, and cleanup.
- `fixtures/external/shared/contracts-runtime-inventory.mjs`, the generated runtime-value coverage path for retained `@mog-sdk/contracts` runtime exports.
- Positive external fixtures under `fixtures/external/positive/*`, currently covering `@mog-sdk/contracts`, contracts runtime values, `@mog-sdk/embed`, `@mog-sdk/sheet-view`, `@mog-sdk/spreadsheet-app`, `@mog-sdk/node`, `@mog-sdk/kernel`, and `@mog-sdk/wasm` surfaces where active pack targets exist.
- Negative external fixtures under `fixtures/external/negative/*`, currently covering forbidden workspace-internal packages, private package names, deep imports, private friend exports, and several spreadsheet-app public type-surface regressions.
- Adjacent package-boundary source-of-truth files that the fixtures already consume or should consume more completely: `tools/package-inventory.jsonc`, `tools/package-export-dispositions.mjs`, `tools/public-package-manifest.mjs`, `tools/check-declaration-rollups.mjs`, `tools/check-api-snapshots.mjs`, `tools/check-binary-wrapper-surfaces.mjs`, public package manifests, and publish workflow gates.

Out of scope for the first implementation slice:

- Changing public API shape only to make fixtures pass. If fixtures expose a real public API leak, fix the package boundary or declaration rollup in the owning package.
- Adding compatibility shims for stale private paths, legacy package names, source imports, or workspace-only names.
- Promoting currently private or workspace-private packages, such as `@mog-sdk/kernel` or `@mog/kernel-host-internal`, without a separate package exposure decision.
- Replacing package-owned unit/API snapshot tests. External fixtures should prove installed public artifacts behave correctly outside the monorepo; lower-level ownership tests remain in each package.

## Current role of this folder in Mog

`fixtures/external` is Mog's packed-public-artifact consumer gate. It is not a normal unit-test fixture folder. The orchestrator discovers public pack targets from `tools/package-inventory.jsonc`, builds required ship-public packages, packs ship-public and binary-wrapper packages with `npm pack`, validates packed manifests and export targets, installs each fixture into an isolated temp directory with `npm install --ignore-scripts`, then runs TypeScript and runtime checks against the packed tarballs.

Observed production-path responsibilities:

- `orchestrate.mjs` treats `ship-public` packages as required build/pack targets and platform-matching `binary-wrapper` packages as required pack targets. Non-host native wrappers are optional.
- Packed manifest validation already catches several boundary failures: unpublished workspace specs, forbidden internal package dependencies, non-public `@mog-sdk/*` dependencies, missing `files` entries, missing export targets, forbidden development export conditions, private friend exports that were not stripped, and public package manifests that remain `private: true`.
- Positive fixtures prove selected public consumer entrypoints typecheck, bundle, or run after installing tarballs with npm rather than workspace resolution.
- Negative fixtures prove selected forbidden imports fail outside the monorepo: `@mog/*` packages, `@mog-sdk/spreadsheet-contracts`, `@mog/types-*`, `@mog-sdk/types-*`, `@mog-sdk/embed` private/deep paths, `@mog-sdk/node` deep/host-adapter paths, `@mog-sdk/sheet-view` deep paths, and `@mog-sdk/spreadsheet-app` implementation paths.
- `contracts-runtime-values` can generate additional runtime import checks from a contracts runtime inventory when such an inventory exists, with a baseline check for `@mog-sdk/contracts/cell-identity`.
- The root `package.json` wires `check:external-fixtures` into `check:publish-readiness`, `check:publish-readiness:sdk`, `validate:all-boundaries`, and the publish workflow.

Important gaps observed:

- Negative fixture assertions are too broad. `assertTypecheckFails` accepts any `tsc` failure, and `assertImportFails` accepts any Node import failure. A fixture can pass because TypeScript was not installed, no `tsconfig.json` exists, a dependency failed to install, a previous import failed first, or an unrelated declaration error occurred.
- Several grouped negative smoke files contain many forbidden imports in one file. The first unresolved import can hide a later leaked path that would resolve if checked independently.
- At least two negative fixtures are not normalized like true external consumers: `host-bindings-from-kernel-source` and `kernel-host-internal-import` have no `tsconfig.json`, no TypeScript dependency, and use `@ts-nocheck`, so they can pass for incidental setup reasons.
- Fixtures that depend on packages not present in the active pack-target set are skipped as deferred. That is reasonable only when the skip is explicitly expected and recorded in a coverage contract; otherwise it can silently remove coverage.
- Positive fixture coverage is mostly hand-authored and package-level. It does not systematically prove every public export subpath from the packed export map is importable, typed, and, where runtime-valued, executable.
- Packed manifest validation checks export targets and dependency fields but does not scan packed `.d.ts`, `.js`, or `.cjs` contents for forbidden internal import specifiers or private source paths.
- There is no single coverage matrix that maps every inventory package disposition and export disposition to required positive, negative, manifest, artifact-content, runtime, or skip assertions.

## Improvement objectives

1. Make `fixtures/external` an inventory-backed boundary contract.
   Every `ship-public`, `binary-wrapper`, `workspace-private-friend`, `workspace-internal`, `bundle-only`, and reserved package/export disposition should have an explicit expected fixture outcome or an intentional skip reason derived from `tools/package-inventory.jsonc`.

2. Replace broad negative pass/fail checks with exact forbidden-boundary assertions.
   Negative checks must prove the intended specifier, subpath, symbol, prop, or packed artifact is blocked. Any unrelated TypeScript or runtime failure should fail the fixture with actionable output.

3. Make positive coverage systematic across public package export maps.
   Each public export subpath in the packed manifest should have at least one external-consumer import/type assertion. Runtime-valued public exports should also have a runtime import assertion when Node or browser execution is applicable.

4. Prove packed artifact contents, not just package manifests.
   Public tarballs should be scanned for forbidden internal imports, workspace specs, private package names, raw source references, development-only conditions, unexpected source files, and stripped private-friend declarations.

5. Eliminate accidental fixture skips.
   A skipped fixture should be impossible unless the coverage manifest marks it optional/deferred with a concrete reason tied to package inventory or host platform constraints.

6. Keep package-boundary ownership explicit.
   External fixtures should catch leakage but not own public API design. When the gate fails, the fix belongs in the public package manifest, declaration rollup, artifact assembly, or owning source package.

7. Make the gate useful in parallel development.
   Fixture failures should identify the exact package, export subpath, forbidden specifier, expected diagnostic, install phase, and packed tarball so independent package owners can fix issues without reading the whole orchestrator.

8. Preserve npm-installed external-consumer realism.
   Fixtures must continue installing packed tarballs in isolated temp directories with npm, not pnpm workspace resolution or direct source imports.

## Production-path contracts and invariants to preserve or strengthen

- `tools/package-inventory.jsonc` remains the source of truth for package dispositions, public targets, private friend exports, forbidden runtime dependencies, and reserved export intent.
- Public pack targets are exactly packages with `ship-public` or `binary-wrapper` disposition, subject to host-platform optionality for native wrappers.
- Public packed manifests must not contain `workspace:`, `link:`, or `file:` dependency specs.
- Public packed manifests must not expose forbidden package families: `@mog/*`, `@mog-sdk/spreadsheet-contracts`, `@mog-sdk/types-*`, `@mog/types-*`, or `@rust-bridge/*`.
- Public packed manifests must not retain `development` export conditions or private friend export subpaths.
- Every export target in a packed manifest must exist inside the tarball, including conditional `types`, `import`, `require`, `style`, `default`, and binary-wrapper targets.
- Public declarations must not import or expose workspace-internal type packages, private implementation classes, private host contracts, private symbol names, raw source paths, or friend-only subpaths.
- Public JavaScript/CJS artifacts must not contain static imports or re-exports of workspace-internal package names or private source subpaths.
- Positive fixtures must use only public package names and public export subpaths from packed artifacts.
- Negative fixtures must run after successful install and must fail for the intended boundary reason. Setup failures, missing TypeScript, missing `tsconfig.json`, skipped dependency tarballs, or unrelated diagnostics are not acceptable negative passes.
- Browser-facing public packages must be checked through bundler/browser-compatible fixtures where the contract is browser bundling or DOM execution, not only Node typecheck.
- Node-facing packages must be checked through Node runtime fixtures where the contract includes runtime values, not only declaration importability.
- Binary wrappers must remain binary wrappers: platform packages should pack only expected native artifacts and metadata, with no public declarations, source trees, extra exports, or private dependencies.
- The gate should be deterministic across host platforms. Platform-specific native wrapper coverage may be host-required or optional, but the reporting must distinguish those states.

## Concrete implementation plan

1. Add a first-class external fixture coverage manifest.
   - Introduce a checked-in or generated manifest such as `fixtures/external/coverage.manifest.jsonc`.
   - Generate its expected package rows from `tools/package-inventory.jsonc` and workspace package manifests: package name, disposition, public target, active pack target status, public export subpaths, private friend subpaths, forbidden dependency patterns, and host-platform optionality.
   - Let hand-authored sections declare which positive/negative/browser/runtime fixture owns each row and any intentional deferred reason.
   - Make `orchestrate.mjs` fail when an active public package or export subpath has no coverage owner.
   - Make `orchestrate.mjs` fail when a fixture is skipped without an explicit manifest-approved skip reason.

2. Split negative checks into atomic cases.
   - Replace grouped negative smoke files with case metadata or generated one-import files so each forbidden specifier is compiled/imported independently.
   - Support a fixture case shape like `{ name, packageDeps, source, mode, expectedSpecifier, expectedDiagnosticPattern }`.
   - Keep hand-authored complex negative type-surface cases, such as spreadsheet-app prop rejection, but give them exact expected diagnostics or forbidden symbol assertions.
   - Report each case independently so one blocked import cannot hide another subpath that accidentally resolves.

3. Strengthen negative assertion helpers.
   - Change `assertTypecheckFails` to capture stdout/stderr, require nonzero exit, require the expected specifier or symbol to appear, and require one of the expected TypeScript diagnostic codes or message patterns.
   - Change `assertImportFails` to capture stdout/stderr, require nonzero exit, require the expected specifier or export subpath to appear, and classify the error as export-map blocked, package-not-found, module-not-found, or forbidden property/symbol.
   - Fail if `npx tsc` is unavailable, if no `tsconfig.json` exists for a TypeScript fixture, or if fixture setup caused the failure before the expected case ran.
   - Remove `@ts-nocheck` from negative fixture sources; a negative fixture should fail by resolving the forbidden boundary, not by disabling type analysis.

4. Normalize all fixture package environments.
   - Give every TypeScript fixture a minimal `package.json` with `typescript`, a `tsconfig.json`, and a known module/moduleResolution mode.
   - Centralize common fixture `tsconfig` profiles under `fixtures/external/shared` and copy or extend them so Node16, bundler, browser, and React fixtures are intentional.
   - Keep npm as the installer, but pin fixture dev dependency ranges enough to avoid unrelated latest-TypeScript breakage from changing diagnostic semantics unexpectedly.
   - Add setup validation before each fixture run: package exists, required dev tools are installed, `tsconfig` includes the expected smoke files, tarball dependencies were rewritten, and the fixture has at least one assertion.

5. Generate positive export-map import coverage.
   - For each active public package, read the packed manifest after public-package manifest rewriting.
   - Generate a TypeScript import smoke for every public export subpath:
     - value import where the subpath has known runtime exports,
     - type-only namespace import where it is declaration-only,
     - CSS/style import or package-script validation where the contract is asset resolution,
     - raw binary/import-attribute check where the contract is a wasm or native binary wrapper subpath.
   - Keep existing hand-authored positive fixtures for product-level behavior, but make generated export coverage the baseline so new public subpaths cannot be added without fixture coverage.
   - Integrate generated positive smokes into isolated npm fixture environments rather than compiling against workspace source.

6. Extend contracts runtime inventory coverage.
   - Make the contracts runtime inventory generator fail closed when an inventory file is expected but missing.
   - Distinguish runtime-valued contracts from type-only contracts with explicit inventory classifications.
   - Generate both TypeScript and Node runtime import checks for every retained runtime value exported by `@mog-sdk/contracts`.
   - Add coverage reporting that lists runtime values checked, skipped type-only entries, and removed/private entries that must not be importable.

7. Add packed artifact content scanning.
   - After `npm pack`, extract or stream the tarball file list and contents for `.d.ts`, `.d.cts`, `.js`, `.cjs`, `.mjs`, `package.json`, and asset metadata.
   - Scan for forbidden static import/export specifiers: `@mog/*`, `@mog-sdk/spreadsheet-contracts`, `@mog-sdk/types-*`, `@mog/types-*`, `@rust-bridge/*`, private friend subpaths, raw `src/` package paths, and repo-relative source paths.
   - Fail on unexpected packed source files such as `src/**`, internal declaration files, friend-only declarations, or development-only helpers unless the package manifest and inventory explicitly allow them.
   - Preserve package-specific allowlists only when they are tied to public package inventory entries and covered by positive fixtures.

8. Make private friend export stripping verifiable per subpath.
   - For every `workspace-private-friend` export disposition, assert two contracts:
     - the source package can still build/test internally with the friend export available where allowed;
     - the packed public manifest and tarball do not expose the friend export to external consumers.
   - Add negative external cases for stripped friend subpaths, including `@mog-sdk/embed/internal/views-host` and any active public package friend export.
   - Fail if a friend export is present in `package.json` source but absent from inventory, because that means stripping behavior is accidental.

9. Cover missing public package families.
   - Add generated or hand-authored positive coverage for `@mog-sdk/contracts` facade subpaths beyond the current representative sample.
   - Add negative coverage for non-exported `@mog-sdk/contracts` deep paths and legacy aliases, not only old `@mog-sdk/spreadsheet-contracts` imports.
   - Add binary-wrapper coverage for `@mog-sdk/wasm` root and `./wasm` export targets, plus negative checks that native platform wrapper packages do not expose source, declarations, extra subpaths, or internal runtime packages.
   - Keep `@mog-sdk/kernel` fixtures classified as deferred/private until a separate exposure decision makes it a public pack target; while deferred, skips must be explicit in the coverage manifest.

10. Add browser and bundler fixture tiers.
    - Keep Node fixture tiers for `@mog-sdk/node`, runtime contracts, and declaration-only checks.
    - Use esbuild or Vite fixture tiers for browser packages: `@mog-sdk/embed`, `@mog-sdk/sheet-view`, `@mog-sdk/spreadsheet-app`, and CSS/style exports.
    - For browser-facing packages, check both type importability and actual bundler resolution from packed tarballs.
    - Add a minimal DOM/browser execution tier only where the public contract includes runtime DOM behavior, such as embed registration or spreadsheet-app mount typing. Use real public package imports and host-facing APIs.

11. Improve orchestrator phase accounting and diagnostics.
    - Separate result buckets for build, pack, packed-manifest validation, packed-content validation, generated-positive export coverage, hand-authored positive fixtures, generated negative cases, hand-authored negative fixtures, and skipped/deferred rows.
    - Include tarball path, package version, package disposition, fixture path, case name, expected specifier, and diagnostic excerpt in failures.
    - Write an optional machine-readable coverage report to a temp file or artifact path for CI, while keeping normal console output concise.
    - Fail if any fixture directory is present but unreferenced by the coverage manifest, because dead fixtures create false confidence.

12. Tie external fixtures into existing public-boundary gates.
    - Keep `check:external-fixtures` as the full production gate.
    - Keep `check:public-package-manifests` as a manifest-only fast gate, but extend it to include packed content scanning where no fixture install is required.
    - Ensure `check:publish-readiness`, `check:publish-readiness:sdk`, `validate:all-boundaries`, and the publish workflow all run the strengthened production path after public artifacts have been built.
    - Add a narrower developer command only if it still runs the same packed-artifact path for selected packages and explicitly reports coverage outside the selection as not evaluated.

13. Document fixture ownership contracts in the public repo.
    - Add a short `fixtures/external/README.md` that explains fixture kinds, coverage manifest semantics, how to add a public package export, how to add a negative forbidden-path case, and why fixtures must install packed tarballs with npm.
    - Document that failing external fixtures usually require fixing package manifests, declaration rollups, export maps, artifact assembly, or inventory dispositions in the owning package.
    - Do not include private planning text or internal repo references in the public README.

## Tests and verification gates

Planning worker constraints prevented running build/test/typecheck gates during this plan creation. The implementation should verify with production-path gates after code changes.

Primary gates for this folder:

- `pnpm check:external-fixtures`
- `pnpm check:public-package-manifests`
- `pnpm check:publish-readiness:sdk`
- `pnpm validate:all-boundaries`

Package-boundary gates that should remain green:

- `pnpm check:ci:public-boundaries`
- `pnpm check:private-leaks`
- `pnpm check:release-readiness-naming`
- `pnpm check:binary-wrapper-surfaces`
- `pnpm check:contracts-declaration-identity`
- `pnpm check:declaration-rollups`
- `pnpm check:api-snapshots`

Focused implementation gates by changed area:

- `node fixtures/external/orchestrate.mjs --skip-build --manifest-only` after manifest/content validation changes.
- `node fixtures/external/orchestrate.mjs --skip-build` after fixture harness, coverage manifest, or generated fixture changes, assuming public artifacts already exist.
- `pnpm build:public-artifacts` before full external fixture verification when package manifests, declaration rollups, exports, or artifact assembly changed.
- Package-local `pnpm test` and `pnpm typecheck` for any owning public package whose API boundary is fixed because an external fixture caught a real leak.
- Repo `pnpm typecheck` after TypeScript fixture harness or public declaration changes unless a narrower explicit type gate is introduced for a specific implementation slice.

New behavior gates to add:

- Coverage-manifest freshness: package inventory and active public export maps match the external fixture coverage manifest.
- Negative-case precision: a deliberately unrelated TypeScript error in a negative fixture does not count as a pass.
- Negative-case independence: every forbidden specifier in a grouped category is checked independently.
- Packed-content scanner: public tarballs do not contain forbidden internal imports or private source files.
- Friend-export stripping: every private friend export is absent from the packed manifest and fails external import.
- Positive export-map coverage: every active public export subpath is importable or intentionally classified as an asset/binary/style case.
- Skip discipline: no required fixture or coverage row can skip without a manifest-approved deferred reason.

## Risks, edge cases, and non-goals

- Tightening negative fixture diagnostics may expose existing false-positive fixtures. Treat that as useful signal; do not relax the harness to preserve old green results.
- TypeScript diagnostic messages can shift across compiler versions. Prefer diagnostic codes and expected specifier matching over exact full-message snapshots.
- Some public exports are type-only, style-only, wasm/binary-only, or browser-only. The coverage manifest must classify these correctly instead of forcing all subpaths through one Node runtime shape.
- Browser bundler fixtures can become slow if they build full apps repeatedly. Keep generated export coverage lightweight and reserve full browser execution for public behavior that genuinely requires DOM/runtime validation.
- Cross-platform native wrapper coverage cannot require every native tarball on one host. It should require the host wrapper locally and assert optional wrappers through manifest/file-shape checks when tarballs exist, with full matrix coverage in CI/publish workflows.
- `@mog-sdk/kernel` currently appears as a private/workspace-internal package while some fixtures reference it. Do not silently promote it or silently remove it; classify its external fixtures as deferred until the package exposure plan decides the public target.
- External fixtures should not become a substitute for package API snapshots. They prove installed artifact behavior; snapshots still own exact public declaration/API text.
- Do not optimize or rewrite fixture code for speed at the cost of packed-artifact realism. The production path is external npm installation of tarballs.
- Do not add public docs, package exports, or compatibility paths for private/deep imports just because negative fixtures name those paths.

## Parallelization notes and dependencies on other folders, if any

This work naturally splits across independent agents with explicit ownership:

- Agent A: coverage manifest and inventory integration. Owns `fixtures/external/orchestrate.mjs`, package/export disposition mapping, required/deferred coverage accounting, and coverage report output. Dependencies: `tools/package-inventory.jsonc`, `tools/package-export-dispositions.mjs`, public package manifests.
- Agent B: negative fixture precision. Owns `fixtures/external/shared/utils.mjs`, generated negative case runner, normalized negative fixture profiles, and conversion of grouped negative fixtures into atomic checks. Dependencies: current `fixtures/external/negative/*` and TypeScript module-resolution diagnostics.
- Agent C: positive export-map coverage. Owns generated positive import/type/runtime smokes for public package export maps and the contracts runtime inventory expansion. Dependencies: `contracts/package.json`, `runtime/embed/package.json`, `runtime/sdk/package.json`, `runtime/spreadsheet-app/package.json`, `views/sheet-view/package.json`, `compute/wasm/npm/package.json`.
- Agent D: packed artifact scanners. Owns tarball file/content scanning, forbidden specifier detection, source-file allowlists, binary-wrapper artifact checks, and manifest-only gate expansion. Dependencies: `tools/public-package-manifest.mjs`, `tools/check-declaration-rollups.mjs`, `tools/check-binary-wrapper-surfaces.mjs`.
- Agent E: browser/bundler fixtures. Owns browser-tier fixture profiles for embed, sheet-view, spreadsheet-app, CSS/style exports, and wasm resolution. Dependencies: public package build outputs and current positive browser fixtures.
- Agent F: package owners. Fixes real leakage in owning package folders when strengthened fixtures fail, without changing fixture expectations to hide the leak.

Suggested integration order:

1. Land harness precision and setup validation first, because false-positive negatives undermine every later coverage claim.
2. Land coverage manifest accounting next, initially marking current gaps as explicit failures or deferred rows.
3. Add generated positive export-map coverage and packed-content scanning in parallel.
4. Convert existing hand-authored negatives into atomic cases and add missing contracts/wasm/native-wrapper cases.
5. Add browser/bundler tiers for packages whose public contracts require browser resolution.
6. Run the full publish-readiness path and fix any owning-package leaks surfaced by the strengthened fixture gate.
