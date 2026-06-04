Rating: 8/10

Summary judgment
This is a strong plan with unusually good production-path awareness. It correctly identifies that `kernel/src/domain/pivots` is currently only a style-normalization helper while meaningful pivot behavior lives in `api/worksheet/pivots.ts`, `bridges/pivot-bridge.ts`, and workbook style APIs. The proposed extraction targets real state transitions, not test harnesses, and its core invariants around Rust/Yrs persistence, `compute` versus `refresh`, `setDataSource` atomicity, and public API stability are the right ones.

The plan is not a 9 or 10 because two contracts are still not settled enough for implementation: placement-ID unification during create-time conversion, and the promised "policy table is the only way to construct update options" sweep. Those are not small details; they are the main behavioral hazards in the plan.

Major strengths
- The source inventory is mostly accurate: `domain/pivots` only contains `style-normalization.ts` and a small test, while pivot behavior is spread through the API and bridge layers.
- The plan focuses on production code paths: `WorksheetPivotsImpl.setDataSource`, bridge placement creation, workbook pivot style defaults, mutation update options, and event-driven refresh/materialization.
- The state-transition invariants are explicit and valuable, especially "no TypeScript PivotStore", no side-effect movement across `compute()`/`refresh()`, and no partial mutation on `setDataSource` error paths.
- The proposed module split is coherent: style catalog, placement identity, config transforms, field detection, source-change reconciliation, and update policy are natural units.
- The verification ideas cover the risky behavior categories, especially ambiguous duplicate headers, calculated-field formula invalidation, collision-safe placement IDs, and dirty-only source changes.

Major gaps or risks
- Placement-ID unification is underspecified at the hardest point. `convertSimpleToDataConfig` currently mints placement IDs before `configWithRequiredMetadata` assigns the pivot id, while `PivotBridge.addPlacement` already has the pivot id and mints prefixed IDs. The plan says to "decide one canonical ordering" or maybe mint in the bridge. That decision needs to be made in the plan, including whether create flows generate the pivot id before conversion, omit placement IDs and let a bridge/domain pass fill them, or preserve old IDs for existing persisted configs.
- The update-policy step is incomplete relative to its own invariant. It says the policy table should be the only way to construct update options, but Step 6 only explicitly replaces literals in `pivot-bridge.ts`. There are many update-option literals in `api/worksheet/pivots.ts`, plus `slicer-pivot-bridge.ts` and undo/history paths. Either the table must cover all producers, or the invariant should be narrowed.
- The proposed `PivotMutationKind` names do not match the current closed `PivotUpdateReason` union. Current contract reasons include `aggregateFunctionChanged`, `sortOrderChanged`, `formattingOptionChanged`, `renamed`, `slicerFilterChanged`, `historyReplay`, and `uiConfigChanged`; the plan lists `aggregateChanged`, `sortChanged`, and `formattingChanged`, and omits several existing reasons. A local enum can use different names only if the mapping to public `PivotUpdateReason` is explicit and tested.
- The refresh-consumer references are slightly muddled. `pivot-event-bridge.ts` checks for `dirtyOnly`, while `pivot-bridge.ts` also has an observer that checks `refreshAndMaterialize`. A policy predicate should replace both string checks, not just the one named in the plan.
- The plan does not fully reconcile the current `domain/README.md` wording ("No business logic", "thin delegation") with the proposed richer pure domain module. Sibling table and slicer modules already contain real helper logic, so the direction is plausible, but the README update should explicitly clarify the intended boundary.
- `source-change.ts` needs a sharper input contract. A pure reconciliation function cannot derive old fields when `config.fields` is empty unless `effectivePivotFieldsForConfig` has already run, so the function should take `oldFields`, `newFields`, and calculated-field metadata explicitly. It should also specify whether duplicate invalid-reference emissions from repeated nested `resolveFieldId` checks are preserved, collapsed, or intentionally changed.

Contract and verification assessment
The contract section is the plan's strongest part. It names the persistence boundary, refresh-policy semantics, update-options requirement, placement identity purpose, schema-version authority, style canonicalization behavior, and `setDataSource` atomicity. Those are the right contracts to protect.

The verification section is good but not yet implementation-ready. It lists relevant test files and pure-module cases, but it should name exact commands for the implementing PR, including the focused kernel tests and TypeScript typecheck gate expected for TypeScript changes. It should also add compatibility tests for old unprefixed placement IDs if those can exist in persisted documents or fixtures, and a policy-table test that proves every current `PivotUpdateReason` is either generated by the policy table or is explicitly exempted.

Concrete changes that would raise the rating
- Specify the create-time placement-ID design instead of leaving it as a decision point, and include migration or compatibility rules for existing unprefixed placement IDs.
- Make `update-policy.ts` cover every current `PivotUpdateReason`, or explicitly document and test exemptions such as undo/history and slicer-driven updates.
- Use contract-exact reason strings in the plan, or define a `PivotMutationKind -> PivotUpdateReason` mapping table with exhaustive tests against `types/events/src/pivot-events.ts`.
- Replace both refresh-policy string checks with named predicates, covering `pivot-event-bridge.ts` and `pivot-bridge.ts` observers.
- Define `reconcilePivotConfigToSource` inputs and outputs precisely, including `oldFields`, duplicate invalid-reference behavior, and whether placement IDs are reminted when fields are remapped.
- Add exact verification commands and include existing workbook pivot-style tests, worksheet pivot tests, bridge tests, the pivot update invariant test, and the relevant typecheck gate.
