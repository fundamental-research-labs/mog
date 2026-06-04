Rating: 8/10

Summary judgment

This is a strong, production-aware plan. It correctly recognizes that `kernel/src/domain/pivots` is currently only a style normalization helper, while most pivot domain behavior lives in `WorksheetPivotsImpl`, `PivotBridge`, `PivotEventBridge`, public pivot contracts, and mutation/event handling. The proposed direction is architecturally sound: keep Rust/Yrs and `ComputeBridge` as the persisted source of truth, move pure TypeScript transition logic into a canonical domain module, and make update policy, placement identity, source reconciliation, event materialization, receipts, and styles explicit.

The plan earns a high rating because it is much more than a folder cleanup. It identifies real duplicated production logic and gives a broad test matrix with meaningful invariants. It does not get a 9 or 10 because several high-risk contracts are still underspecified, especially `sourceSheetId` handling, exact event materialization ownership, placement ID migration semantics, calculated-field formula parsing, and concrete verification commands.

Major strengths

- The plan accurately scopes the current folder and adjacent production paths. The style catalog duplication, local branded ID casts, placement ID duplication, repeated inline `{ reason, refreshPolicy }` objects, source reconciliation in `worksheet/pivots.ts`, ad hoc receipts, and split refresh decisions are real issues.
- The architectural boundary is mostly right: `domain/pivots` should own pure transition decisions and metadata, while callers still own async reads, sheet resolution, compute persistence, materialization, and UI session state.
- The listed invariants are valuable. In particular, preserving `PivotBridge.compute()` as a pure read path, preserving `PivotBridge.refresh()` as the materialization path, keeping `sourceRangeChanged` as `dirtyOnly`, and forbidding a TypeScript `PivotStore` resurrection are important production-path contracts.
- The plan thinks in categories rather than one-off fixes. The style catalog, placements, update policy, source reconciliation, receipts, event policy, and expansion contracts are natural clusters for systematic coverage.
- The test plan is broad and targeted. It covers immutable placement transitions, duplicate value placements, calculated-field placements, stale references, duplicate headers, policy mapping, receipt metadata, event materialization, and existing API/bridge/invariant tests.
- The parallelization notes are useful and split along reasonably independent seams once the shared contracts are fixed.

Major gaps or risks

- The proposed `source-reconciliation.ts` output omits `sourceSheetId` even though the plan states that `sourceSheetId` is authoritative. The current `setDataSource()` resolves the new sheet ID but only updates `{ sourceSheetName, sourceRange, fields, placements, filters }`; a correct refactor should explicitly decide whether this is a bug to fix and should include `sourceSheetId` in the successful reconciliation update when available.
- Placement identity needs a more exact compatibility contract. The plan says IDs are stable and not display labels, but `createStablePivotPlacementId({ pivotId, area, sourceId, position, existingPlacements })` still bakes the initial position into synthesized IDs. That can be fine if IDs are opaque and never regenerated after creation, but the plan should explicitly forbid consumers from parsing placement IDs and should define legacy fallback behavior for missing IDs, duplicate value placements, calculated-field placements, and moves.
- The event policy section says to audit duplicate refreshes and keep one owner, but it does not choose the owner or define callback behavior. Today `PivotBridge.setupObservers()` can refresh on pivot events and `PivotEventBridge` can also call `pivotBridge.refresh()` plus UI callbacks. The plan should specify exactly which path materializes, which path only invalidates/notifies, and how errors from fire-and-forget refreshes are handled.
- Field reconciliation precedence remains too implicit. The plan mentions header-name migration and duplicate-header ambiguity, but does not define the full resolution order across stable field IDs, `sourceColumn`, old header names, blank/numeric headers, calculated fields, `sortByValue.valueFieldId`, `sortByValue.valuePlacementId`, and legacy configs with incomplete field metadata.
- Calculated-field formula parsing is flagged correctly, but "aligned with the Rust calculated-field grammar" is not an implementable contract by itself. The plan should point to the Rust grammar/parser source or define the supported token grammar in the plan, including quoted field names, escaped quotes, string literals, function identifiers, case sensitivity, and field names that collide with function names.
- Receipt construction is directionally right but not concrete enough. "Prefer real revision values from compute mutation results when available" needs either a named mutation-result field contract or a single documented fallback policy. Otherwise implementers may simply centralize `0` and `Date.now()` without improving semantic correctness.
- The update-policy audit should include all pivot update producers, including `kernel/src/bridges/slicer-pivot-bridge.ts`, not just the worksheet API and `PivotBridge`.
- The module list may be slightly over-fragmented. `styles`, `ids`, `placements`, `source-reconciliation`, `config-transitions`, `receipts`, `update-policy`, `event-policy`, `expansion`, and `index` are all plausible, but the plan should mark which helpers are public domain exports versus file-local internals so the new folder does not become a broad grab bag of semi-public APIs.

Contract and verification assessment

The contract coverage is above average. The plan names the important production invariants, keeps dependency direction clean, preserves Rust persistence, and requires domain helpers to be pure. It also understands that E2E coverage must use real UI input paths.

The biggest contract weakness is that several outputs are described as loose object shapes rather than precise discriminated results. For example, source reconciliation should return a typed success object containing `sourceSheetId`, `sourceSheetName`, `sourceRange`, `fields`, `placements`, `filters`, migrated calculated-field state if any, and effect metadata, or a typed failure containing all invalid references. Placement transitions should similarly define exact success/no-op/error shapes and dense-position guarantees.

The verification plan is good but should be more explicit. For the future implementation, it should name the expected commands, such as `pnpm --filter @mog-sdk/kernel test -- ...` for the listed kernel tests, `pnpm --filter @mog/app-spreadsheet test -- ...` for app-level pivot action/component tests, and `pnpm typecheck` for TypeScript changes. For UI-facing behavior, it should name concrete browser workflows: create pivot from selected range, add duplicate value fields, reorder rows/values through the pane, change Show Values As, change source range with duplicate headers, apply a pivot filter, change style, and expand/collapse via the visible UI.

Concrete changes that would raise the rating

- Add an explicit source reconciliation contract that includes `sourceSheetId` on success and defines field-resolution precedence for IDs, source columns, names, duplicate headers, calculated fields, and legacy metadata.
- Decide the single production owner for pivot event materialization and document what the other bridge is allowed to do.
- Define placement ID opacity, legacy synthesis, collision handling, move behavior, and selector ambiguity as precise rules.
- Replace the calculated-field parser note with a concrete grammar reference or a small token grammar in the plan.
- Specify receipt revision inputs and fallback semantics in one place, including whether compute needs to expose real config/result/materialization revisions.
- Include `slicer-pivot-bridge.ts` and mutation-result/event emission paths in the update-policy and invariant audit.
- Turn the verification section into exact commands plus named UI scenarios, while keeping the existing domain/unit test matrix.
