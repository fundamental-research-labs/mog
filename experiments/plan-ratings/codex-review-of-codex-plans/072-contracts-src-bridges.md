Rating: 8/10

Summary judgment

This is a strong, production-relevant plan for the bridge contracts folder. It correctly identifies the current architecture: `@mog-sdk/contracts/bridges` is the public import path, `@mog/types-bridges` is the private canonical type shard, most bridge files are already type re-export shims, and `ink-recognition-bridge.ts` is the outlier because it duplicates interfaces and owns `DEFAULT_RECOGNITION_THRESHOLDS`. The plan is especially good at preserving public package boundaries while tying the work to declaration rollups, runtime-value inventory, API snapshots, and external fixtures. It loses points for leaving the ink runtime ownership decision conditional, relying on a shim inventory mechanism that is not currently present as a working tool, and naming at least one non-existent package in verification.

Major strengths

- The ownership model is architecturally sound: canonical bridge types in `types/bridges`, public projection and runtime value ownership in `contracts`, and no dependency from public Mog back into `mog-internal`.
- The plan protects the most important public contract: consumers continue to import from `@mog-sdk/contracts/bridges`, and private `@mog/types-bridges` imports stay out of external fixtures and published declarations.
- It treats the ink duplicate as a category issue, not a one-off cleanup, by adding drift detection for every bridge shim and by auditing aggregate exports.
- The production-path invariant list is unusually specific for a contracts plan. Chart cache semantics, pivot materialization, schema validation source, locale advisory formatting, and lifecycle cleanup are all called out in a way implementers can verify.
- The proposed verification suite covers the right classes of failure: package typechecks, contracts build, runtime import checks, declaration identity, declaration rollups, API snapshots, external fixtures, downstream consumer typechecks, and targeted kernel tests.

Major gaps or risks

- The plan should not leave the private ink runtime constant as an open decision. Current source search shows production code imports `DEFAULT_RECOGNITION_THRESHOLDS` from `@mog-sdk/contracts/bridges`, not from `@mog/types-bridges`; if that remains true during implementation, the plan should explicitly remove the private runtime export from `types/bridges/src/ink-recognition-bridge.ts` and `types/bridges/src/index.ts`. Keeping two constants plus an equality test conflicts with the objective of one public runtime owner.
- The shim inventory item is underspecified. `package.json` has an `inventory:contracts` script pointing at `tools/contracts-shim-inventory.mjs`, but that file is absent in the current checkout. The plan should say whether to restore that tool, replace it with a bridge-specific check, or add the check under an existing CI gate.
- One verification gate is wrong as written: `pnpm --filter @mog/canvas-grid-canvas typecheck` should be `pnpm --filter @mog/grid-canvas typecheck` or a path filter such as `pnpm --filter ./canvas/grid-canvas typecheck`.
- Runtime fixture guidance should be more precise. The existing `contracts-runtime-values` fixture generates an inventory-based runtime smoke file, so the plan should specify whether the threshold key assertion is a new static smoke check, an enhancement to the generated inventory smoke, or both.
- The plan says to update API snapshots after rollup, but the gates list only the check command. It should name the update/regeneration command or workflow so implementers do not hand-edit snapshots blindly.

Contract and verification assessment

The contract direction is right. The public bridge subpath remains stable, per-bridge public subpaths are avoided unless added deliberately as a complete surface, and declaration self-containment is treated as a first-class contract. The proposed `export type *` projection plus a contracts-owned `DEFAULT_RECOGNITION_THRESHOLDS` value is the correct shape, provided the private type shard becomes type-only for ink runtime values.

The verification plan is broad and mostly production-path relevant. It correctly includes public package build/declaration gates and downstream consumer typechecks instead of relying only on local compile success. The main weaknesses are exact command correctness and missing explicit coverage for the new shim-drift check. If the plan adds or repairs a shim inventory tool, that tool should be included in the final gate list, not just described as an implementation step.

Concrete changes that would raise the rating

- Make the ink runtime ownership decision explicit: remove the private `DEFAULT_RECOGNITION_THRESHOLDS` export unless a named current production consumer requires it, and document that exception if it exists.
- Replace the vague shim inventory step with a concrete tool and gate, including the exact allowed shapes for each `contracts/src/bridges/*.ts` file and the aggregate `index.ts`.
- Fix the grid canvas verification command to use the actual package name or path filter.
- Specify the external fixture edits precisely: add representative bridge type imports to `fixtures/external/positive/contracts/smoke.ts`, and add either generated or static runtime checks that verify all threshold keys on `DEFAULT_RECOGNITION_THRESHOLDS`.
- Name the API snapshot regeneration workflow before `pnpm check:api-snapshots`, so sequencing is executable rather than implied.
