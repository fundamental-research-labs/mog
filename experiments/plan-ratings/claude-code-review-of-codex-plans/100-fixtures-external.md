Rating: 8/10

# Review: Plan 100 — External Fixture Boundary Improvements

## Summary judgment

This is a strong, evidence-grounded plan for `mog/fixtures/external`. It correctly understands that this folder is not a unit-test fixture set but Mog's packed-public-artifact consumer gate, and its observed-gap list maps cleanly onto what the source actually does. I verified the central claims against the source and they hold:

- `assertTypecheckFails` (utils.mjs:315) and `assertImportFails` (utils.mjs:337) both pass on *any* nonzero exit and discard stdout/stderr — exactly the "too broad" failure the plan targets.
- Exactly two negative fixtures, `host-bindings-from-kernel-source` and `kernel-host-internal-import`, lack a `tsconfig.json` and carry `@ts-nocheck`; every other negative fixture has a tsconfig. The plan names both precisely.
- Grouped negative smokes are real: `workspace-internal-import` and `types-star-import` each contain 8 imports in one file, `contracts-import`/`deep-import`/`sheet-view-deep-import` each 6 — so a first unresolved import can mask a later one that resolves.
- The gate wiring is described accurately: `check:external-fixtures` runs `orchestrate.mjs`, `check:public-package-manifests` is the `--manifest-only` fast path, and `check:publish-readiness`, `check:publish-readiness:sdk`, and `validate:all-boundaries` all invoke `check:external-fixtures -- --skip-build` after `build:public-artifacts`.
- `tools/package-inventory.jsonc`, `package-export-dispositions.mjs`, `public-package-manifest.mjs`, and `check-binary-wrapper-surfaces.mjs` all exist; `fixtures/external/README.md` does not (objective 13 is genuinely net-new).

The diagnosis quality is the plan's strongest asset. The weaknesses are scope discipline and one disposition blind spot, not correctness.

## Major strengths

- **Accurate, falsifiable observations.** Nearly every "important gap" is checkable in the source and checks out. This is rare and makes the plan trustable.
- **Correct production-path framing.** It repeatedly insists fixtures prove npm-installed tarball behavior, not workspace resolution, and that real leaks must be fixed in the owning package's manifest/rollup/exports — not by relaxing fixtures (objectives 6, risks section). This is the right ownership boundary.
- **Inventory-as-source-of-truth.** Anchoring a coverage manifest to `package-inventory.jsonc` dispositions (objective 1, step 1) is the correct architectural spine. Fail-on-uncovered-export and fail-on-unexplained-skip are exactly the invariants that prevent silent coverage erosion — the most valuable single idea here.
- **Atomic negative cases + precise diagnostics** (steps 2–3). Requiring the expected specifier/symbol and a TS diagnostic code (not full-message snapshots) is the right call and the risks section reinforces it against compiler-version drift.
- **Packed-artifact content scanning** (step 7) closes a real hole: current manifest validation checks export *targets* and dependency fields but never scans `.d.ts`/`.js`/`.cjs` contents for forbidden specifiers or stray `src/`.
- **Thoughtful parallelization and integration order.** The A–F agent split has clean ownership seams, and "land harness precision first because false-positive negatives undermine every later coverage claim" is the correct sequencing instinct.

## Major gaps or risks

- **The dominant disposition is unaddressed.** The inventory has 145 `public-experimental` packages (plus `dev-eval`, `generated-asset`, `monorepo-root`), yet objective 1 enumerates only `ship-public`, `binary-wrapper`, `workspace-private-friend`, `workspace-internal`, `bundle-only`, and `reserved`. A coverage manifest that "maps every inventory disposition to an expected outcome" cannot be built without deciding what boundary expectation `public-experimental` carries — are those external-importable, deferred, or negative-asserted? This is the single most important omission and would block step 1 as written.
- **No concrete first slice despite an "out of scope for first slice" heading.** The header promises a first implementation slice but the body is a 13-objective, 6-agent program with no MVP cut and no acceptance criteria for "slice 1 done." Section 18-ish ("Tests and verification gates") lists gates but not which subset of objectives the first PR must satisfy. For a plan this large, the absence of a crisp, independently-landable first increment is a real planning gap.
- **Generated-vs-checked-in manifest tension is unresolved.** Step 1 says "checked-in or generated" `coverage.manifest.jsonc`. These have opposite failure semantics: a generated manifest can't "fail when an export has no coverage owner" (it would just regenerate to include it), while a checked-in one needs a freshness gate (which the plan does add at line 207, implying checked-in — but the body never commits). This must be decided before step 1 is actionable.
- **TypeScript dependency pinning is hand-waved.** Step 4 says "pin fixture dev dependency ranges enough to avoid unrelated latest-TypeScript breakage" but every fixture installs via `npm install` into a temp dir; without an exact pin (and likely a committed lockfile or `--no-save` exact version), negative diagnostic-code assertions (step 3) will drift across CI runs. The realism constraint (npm install, no pnpm workspace) makes determinism harder, and the plan doesn't reconcile that.
- **Cost/latency of generated positive coverage + browser tiers.** Step 5 generates an import smoke per public export subpath, and step 10 adds esbuild/Vite tiers. With 145 experimental packages this could explode install/compile time. The plan flags browser slowness (risks) but not the combinatorial cost of per-subpath generated smokes across the full surface.

## Contract and verification assessment

The contract section (lines 74–90) is the best-specified part: no `workspace:`/`link:`/`file:` specs, no forbidden package families (`@mog/*`, `@mog-sdk/spreadsheet-contracts`, `@mog-sdk/types-*`, `@rust-bridge/*`), every export target present in the tarball, no retained `development` conditions or friend subpaths, binary wrappers stay binary-only. These are precise, testable, and match the negative fixtures already present. The friend-export stripping contract (step 8) is especially good: it asserts *both* that the source package keeps the friend export internally *and* that the packed artifact strips it, and fails when a friend export exists in source but is absent from inventory (catching accidental stripping). That dual assertion is the right shape.

Verification gates are comprehensive and correctly layered: full path (`check:external-fixtures`), fast manifest-only path, and the "must stay green" boundary gates. The "new behavior gates" list (lines 207–213) is the plan's verification crown — coverage-manifest freshness, negative-case precision, negative-case independence, packed-content scanner, friend-export stripping, positive export-map coverage, skip discipline. Each is a concrete, automatable assertion.

What's missing on verification: no acceptance threshold for *how much* of the 145-package experimental surface must be covered before the gate is allowed to enforce (vs. warn), and no explicit gate that the generated negative-case runner itself is correct (a meta-risk: a buggy case generator could emit cases that pass vacuously, reintroducing the very false-positive problem being fixed). A self-check that each negative case fails for the *classified* reason category would close that loop.

## Concrete changes that would raise the rating

1. **Classify every inventory disposition, including `public-experimental` (145 pkgs), `dev-eval`, `generated-asset`, `monorepo-root`.** State the expected fixture outcome for each (importable / deferred-with-reason / negative-asserted). Without this, step 1 cannot be implemented. This alone is worth a point.
2. **Carve an explicit first slice with acceptance criteria.** e.g. Slice 1 = harden `assertTypecheckFails`/`assertImportFails` + add tsconfig/remove `@ts-nocheck` from the two non-normalized negatives + add the two new precision gates, with a stated "done when" condition. Make later objectives explicit follow-on slices.
3. **Decide checked-in vs generated coverage manifest** and state the failure semantics that follow (freshness gate for checked-in; or a separate committed "expected coverage" file the generator is diffed against).
4. **Specify TypeScript (and bundler) version pinning concretely** — exact version + how determinism is preserved under `npm install` in temp dirs — so diagnostic-code assertions don't flake.
5. **Bound the cost of generated coverage.** Cap or batch per-subpath smokes (e.g. one fixture per package compiling all subpaths but reporting per-subpath), and state expected wall-clock budget for the full gate.
6. **Add a meta-gate that each negative case fails for its classified reason category**, not merely nonzero exit, so the case generator can't reintroduce vacuous passes.
