Rating: 8/10

## Summary judgment

This is a strong plan. It correctly identifies `mog/charts/src/core` as a production-path, DOM-free conversion layer and focuses on real risk concentrations: oversized conversion files, duplicated color fallback logic, cache semantics, diagnostics, casts at type boundaries, and field-name contracts. The plan is unusually good at naming invariants before proposing refactors, and it mostly sequences behavior locking before structural work.

The rating is not higher because several important contracts are still underspecified. The largest issues are the diagnostics side channel, a likely circular dependency in the color-resolution refactor, overbroad claims about current test gaps, and insufficiently concrete verification commands/API-surface gates. Those are fixable, but they would need to be resolved before this plan is safe to hand to implementers.

## Major strengths

- The source scope is accurate and production-path relevant. The plan keeps the focus on `ChartConfig + ChartData -> ChartSpec -> compile -> render/export`, not on a mock or test-only path.
- The non-rewrite posture is appropriate. The folder is already disciplined and well tested in places; the plan aims to reduce risk without changing chart output.
- The contract list is the plan's best feature. Output stability, public export preservation, field-name string freezes, DOM-freedom, graceful degradation, geometry fidelity, and color precedence are exactly the right invariants for this folder.
- The sequencing is mostly sound: characterization before refactor, field/color/cache/type work separated, and the large file decompositions treated as behavior-preserving slices.
- The plan identifies real code facts: the four >900-line files exist, `config-to-spec/fields.ts` is a facade over `chart-ir/fields` plus additions, `series-style.ts` is an alias, and color resolution currently exists through `style-resolver/resolver.ts`, `config-to-spec/style.ts`, and `config-to-spec/color-authority.ts`.
- The risks section is candid about output drift, color fallback edge cases, cache behavior changes, hidden importers, and circular dependencies.

## Major gaps or risks

- The diagnostics objective needs a precise contract. `configToSpec` currently returns only `ChartSpec`, while `chartStyleContext.diagnostics` is an input sidecar on `ChartConfig`. If Phase 5 appends to that array, it introduces observable input mutation and weakens the plan's purity claim. If it returns diagnostics via `ChartSpec`, that is a grammar/spec contract change. The plan should choose one model explicitly and define ownership, mutability, dedupe, and caller visibility.
- The color unification has a concrete dependency-cycle hazard. `color-authority.ts` currently imports `isStrokeColoredSeries` and `variesColorsByCategory` from `./style`; Phase 2 then makes `style.ts` call `color-authority`. That creates a cycle unless those helpers/constants move to a neutral module first. The plan mentions circular-dependency risk but does not include the required extraction step.
- O6 is directionally right but too imprecise. Some grammar/export readers already import directly from `core/chart-ir/fields`, while `config-to-spec/fields.ts` also re-exports `BLANK_VALUE_FIELD` and `LINE_SEGMENT_FIELD` from `grammar/internal-fields` plus `SERIES_OPACITY_FIELD` from `config-to-spec/constants`. "Make `chart-ir/fields.ts` the single declared home of every internal field-name constant" needs an exact inventory and a decision about whether moving grammar/internal constants is in scope.
- The test-gap claims are overstated. Existing tests already exercise legend behavior, category-axis behavior, trendlines, error bars, analysis layers, imported caches, and style resolver integration in multiple places. The plan should reframe O7 as "specific missing branch/unit coverage" rather than "currently untested units."
- Phase 3 depends on Phase 5 diagnostics but is scheduled before it. Cache helpers also do not currently receive `ChartConfig` or a diagnostics sink, so "record a diagnostic" requires an API change or a deferred no-op contract.
- The output-stability oracle needs more detail. Full `ChartSpec` snapshots are useful, but the plan should define a canonical serializer, fixture ownership, and whether `compile()`/`collectMarks()` and OOXML export outputs are also locked for the high-risk geometry and field-name changes.
- The public-surface contract is too narrow. `core/index.ts` matters, but the package's public `charts/src/index.ts` also re-exports many core names. A safe plan should verify both the core barrel and the package root export/declaration surface.

## Contract and verification assessment

The stated contracts are mostly the right ones, especially C1, C3, C4, C5, C6, and C7. The weak point is that some contracts are aspirational rather than mechanically verifiable. "Public export surface unchanged" should be backed by an export-name/type snapshot or declaration/API snapshot. "Field string values frozen" should be backed by literal-value tests. "No circular dependency" should be backed by a dependency-cycle check after module splits.

The verification gate categories are good, but the plan should name actual commands. At minimum, execution should include `pnpm --filter @mog/charts test` and `pnpm --filter @mog/charts typecheck`. Because the plan moves public exports/imports and may touch contracts if diagnostics widen, it should also specify when to run root `pnpm typecheck`, `pnpm check-cycles`, and the relevant public API/declaration checks. If diagnostics require a contracts change, the plan correctly notes `pnpm --filter @mog-sdk/contracts build`, but it should prefer avoiding that unless a new diagnostic shape is truly needed.

The plan correctly avoids implementation in this document and keeps performance/testing claims pointed at production code. It also correctly treats the cache change as the one deliberate behavior delta, but that delta needs acceptance criteria: exact old behavior, exact new behavior, diagnostic content, and deterministic fallback order.

## Concrete changes that would raise the rating

- Add a dependency-graph subphase before Phase 2: move `isStrokeColoredSeries`, `variesColorsByCategory`, and shared color constants into a neutral helper module so `style.ts -> color-authority.ts -> style-resolver` does not cycle.
- Define the diagnostics contract in one paragraph of API-level precision: mutation allowed or not, where diagnostics are stored, stable diagnostic fields, dedupe key, and how callers read them after `configToSpec`.
- Replace the broad O7 test-gap list with an evidence table: existing coverage, missing branch/edge, fixture to add, and assertion type.
- Give O6 an explicit field inventory and importer strategy, including `BLANK_VALUE_FIELD`, `LINE_SEGMENT_FIELD`, and `SERIES_OPACITY_FIELD`; avoid import churn in `grammar`/`export` unless it is required by the contract.
- Reorder Phase 3/Phase 5 or add a small diagnostics-sink abstraction first, so cache inconsistency handling has somewhere well-defined to report.
- Specify exact verification commands and artifacts: charts package test/typecheck, root typecheck when contracts/public exports change, cycle check after decomposition, export-surface/declaration snapshot, and targeted compile/render/export characterization checks.
- Define the snapshot canonicalization rules for `ChartSpec` and add compile-level assertions for the highest-risk geometry and mark-order paths, not only raw `configToSpec` snapshots.
