Rating: 7/10

Summary judgment

This is a strong plan for finding real contract debt in `mog/types/bridges/src`, especially the missing barrel exports, duplicate pivot placement types, stale docs, and sync-or-async return unions. It understands the package's type-only role and mostly respects the dependency boundary between public bridge contracts and kernel/runtime implementations.

The rating is held down because the most important contract changes are not specified tightly enough to be implementation-ready. The plan says to "decide" between a new result type and the existing `Result<T,E>`, says to "apply it" without giving the exact final signatures, and claims to unify cross-bridge failures while concretely migrating only chart result unions. For a contract-source package, that leaves too much discretion in the riskiest part of the work.

Major strengths

- The plan is grounded in accurate local evidence. `index.ts` does omit many chart IR constituents and pivot placement types that are exported from their submodules, and `kernel/src/bridges/pivot-bridge.ts` does duplicate `PivotBridgePlacementSpec` / `PivotBridgePlacementPatch` structurally.
- The sequencing is sensible: additive barrel exports and documentation cleanup can land before cross-folder implementation migrations.
- It correctly preserves important invariants: no new value exports beyond `DEFAULT_RECOGNITION_THRESHOLDS`, no imports from `kernel` / `engine` / `contracts`, `IChartBridge.renderCached` must remain synchronous, and pivot `compute` vs `refresh` semantics must not be collapsed.
- It identifies production-path consumers rather than test-only surfaces. The chart result shape affects real exporters in `apps/spreadsheet` and `runtime/sdk`, diagnostics, and `kernel/src/domain/charts`.
- The async cleanup objective is well motivated. Current production implementations for diagram and schema are already async for the queried methods, so collapsing the public unions toward `Promise<T>` is likely the right direction after caller audit.

Major gaps or risks

- The shared result contract is underspecified. A plan for a type contract package should name the exact target vocabulary, for example `BridgeResult<T, E = BridgeError>` with exact discriminants, or the existing `Result<T,E>` shape. "Decide one and apply it" is not a contract.
- The scope of "unify the cross-bridge result/error model" is incomplete. The evidence calls out chart unions, equation `Result`, pivot `null`, schema out-of-band failures, and other files also expose nullable failure-ish results (`ink-recognition-bridge.ts`, `text-effect-rendering-bridge.ts`). The concrete plan only migrates chart and maybe `ChartDataResult`, leaving the category unresolved.
- Several implementation-path references are stale inside the plan itself. Current chart production code is under `kernel/src/domain/charts/chart-bridge.ts` and `kernel/src/domain/charts/bridge/chart-render-orchestrator.ts`, not `engine/src/state/bridges/chart-bridge.ts`. Diagram is under `kernel/src/domain/diagram/diagram-bridge.ts`. A plan whose purpose includes doc truth should not carry stale coordination paths forward.
- The barrel-export step should account for package exports. If a new `result.ts` is added and consumers are expected to import it by subpath, `types/bridges/package.json` must add an export. If it is intended only through the root barrel, the plan should say so explicitly.
- Removing the bottom-of-file schema re-export may be a breaking subpath API change. `@mog/types-bridges/schema-bridge` currently re-exports `ColumnSchema`, `ISchemaRegistry`, `ISchemaValidator`, and `ValidationResult`; the plan should distinguish duplicate root exposure from submodule public compatibility before deleting it.
- The plan underestimates test churn for chart result migration. `Array.isArray()` discrimination appears in production exporters and likely in tests/mocks; the plan mentions SDK consumers generally but does not enumerate the required migration list.

Contract and verification assessment

The contract direction is architecturally good: complete the canonical exports, stop structural duplication, remove ambiguous sync-or-async signatures, and replace untagged unions with discriminated results. Those are real type-surface improvements for a Tier 2 package.

The contract clarity is only partial. Step 1 is precise enough to implement. Step 5 is mostly precise. Steps 3 and 4 are not yet precise contracts because they defer the key decisions to implementation time: exact discriminant names, result type location, whether existing `ChartDataResult` is preserved or aliased, whether pivot `null` remains a domain absence state or becomes an error, and which diagram/schema methods become `Promise<T>`.

The verification section points at the right classes of gates but should be more executable. `types/bridges` has a `typecheck` script (`tsc -b .`), but the plan should list exact commands for the package and affected dependents, plus targeted kernel/runtime/app tests for the migrated call sites. For TypeScript contract changes of this blast radius, a repo-level `pnpm typecheck` or a clearly justified equivalent project-reference gate should be explicit. The public `.d.ts` rollup check is appropriate, but it should be paired with package export validation if a new module is added.

Concrete changes that would raise the rating

- Specify the final result vocabulary exactly, including type names, discriminants, generic parameters, and whether it reuses `@mog/types-objects/equation`'s `Result<T,E>` or introduces a bridge-local type.
- Enumerate every fallible bridge method in the folder and classify it as `Result`, nullable domain absence, exception-only, or event/metadata-based. Then make the plan cover the complete category or explicitly justify retained exceptions.
- Replace stale cross-folder paths with current production paths: chart under `kernel/src/domain/charts`, diagram under `kernel/src/domain/diagram`, schema/pivot under `kernel/src/bridges`, plus app and runtime SDK chart exporters.
- Provide exact target signatures for chart, diagram, and schema methods before implementation begins.
- Clarify schema subpath re-export compatibility before deleting the bottom re-export block.
- Add exact verification commands and affected tests, including `pnpm --filter @mog/types-bridges typecheck`, dependent type gates, chart exporter tests, chart bridge/orchestrator tests, diagram bridge tests, schema bridge tests, and the public declaration rollup.
