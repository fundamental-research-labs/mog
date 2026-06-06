Rating: 8/10

Summary judgment

This is a strong, production-relevant plan. It correctly identifies `charts/src/core` as the pure chart compilation and extraction boundary, keeps workbook state and DOM concerns out of `@mog/charts`, and anchors the work in real existing seams: `configToSpec`, row builders, `chart-ir/fields.ts`, imported/range extraction, owner-key fallback, axis normalization, family-specific layers, grammar consumers, and OOXML export consumers. The plan is appropriately ambitious for a folder that already acts as an internal contract layer.

The rating is not higher because the plan is so broad that several workstreams still lack crisp acceptance contracts. It names the right refactors and test suites, but it does not always define the exact compatibility baseline, fixture source, public/private export boundary, or migration stopping points needed to keep a multi-agent implementation from producing a large behavior-preserving refactor that is difficult to prove.

Major strengths

- The architectural boundaries are mostly right: pure `ChartConfig + ChartData -> ChartSpec`, no DOM/workbook access in core, no dependency on `mog-internal`, and no public chart contract churn unless deliberately coordinated.
- The chart-family registry objective is well matched to the current implementation, where `MARK_TYPE_MAP`, preserved-only ChartEx handling, pie/surface/combo helpers, and bridge mappings are scattered across several modules.
- The IR schema proposal addresses a real contract gap. Field constants are shared by config conversion, grammar, traces, and OOXML export, but today they are mostly untyped string constants and locally duplicated literals.
- The style-owner-key section is grounded in current code. Resolver fallback regexes and raw owner-key strings are real risk points for imported OOXML style fidelity.
- The verification gates are relevant: `@mog/charts` tests, `@mog/charts` typecheck, cross-package typecheck, existing core/style tests, and grammar/export consumer coverage.
- The parallelization notes are practical and identify reasonable slice boundaries: family registry, row schema, style keys, extraction plans, axis bundle, and fixture expansion.

Major gaps or risks

- The plan needs a sharper compatibility baseline before refactoring. It says output should be stable, but it does not require capturing representative pre-refactor `configToSpec` and compiled mark snapshots before moving orchestration behind new phases and family builders.
- The runtime source of the complete chart-type matrix is underspecified. `ChartType` is a type-only union in `types/data/src/data/charts.ts`; an exhaustive registry can use `satisfies Record<ChartType, ...>`, but tests such as `all-chart-types-smoke.test.ts` need an owned runtime list or generated fixture source.
- The row-schema scope is too narrow as written. `chart-ir/fields.ts` is not the only source of `__mog*` fields; there are fields in `config-to-spec/constants.ts`, layer-local constants such as Pareto/contour fields, and grammar internal fields. The plan should explicitly classify those as chart IR, grammar-only IR, or family-local fields before asserting "no unknown `__mog*` fields."
- The plan introduces `ChartSpecBuildResult`, style authority objects, extraction diagnostics, and normalized bundles, but does not say which are internal-only, which are exported from `charts/src/core/index.ts`, and which must remain file-local. That matters because `core/index.ts` already exposes many helpers.
- The family registry contract lists many dimensions but does not define the minimal required fields, allowed optional fields, or invariants between fields. Without a concrete `ChartFamilyContract` shape, different agents could encode render support, export policy, and axis topology inconsistently.
- Sequencing is directionally good but still too coarse for the highest-risk migrations. Owner-key fallback, data extraction, and axis normalization need explicit "behavior-preserving first" fixtures before any cleanup of duplicate logic.
- The plan does not specify failure behavior for unsupported invalid input. It distinguishes rendered, approximation, preservation-only, and unsupported, but does not define whether unsupported means throw, empty spec, diagnostic-only, or type-level rejection.

Contract and verification assessment

The contract coverage is substantially above average. The plan names important invariants for hidden cells, blanks, imported cache vs live ranges, category levels, stock role projection, bubble triplets, source series identity, row order, render order, style fallback, theme colors, preserved-only ChartEx families, and bridge exhaustiveness. Those are the right contracts for this folder.

The verification section is also strong, but it should be made more measurable. The plan should require targeted equivalence tests for the existing production path before and after each major migration, not only final smoke tests. It should also require fixture ownership for every canonical chart type, a runtime chart-type list checked against the type-level registry, and consumer tests that prove grammar/export imports still compile after any field-schema movement.

Concrete changes that would raise the rating

- Add a concrete `ChartFamilyContract` interface sketch with required fields, enum values for render/export policies, and invariants that tests will assert.
- Define or add a canonical runtime `ALL_CHART_TYPES` list and require a compile-time check that it remains aligned with the `ChartType` union.
- Add a pre-refactor equivalence gate: selected `configToSpec` outputs, compiled marks, and OOXML/export-relevant IR rows must match before and after each behavior-preserving slice.
- Expand the row-schema section to classify all `__mog*` fields across `chart-ir`, `config-to-spec/constants`, layer-local fields, and grammar-only internal fields.
- State exactly which new modules/types stay internal and which, if any, are exported through `charts/src/core/index.ts`.
- Define unsupported-family behavior precisely: throw, empty preserved spec, diagnostic-only, or compile-time unreachable.
- Break the implementation sequence into acceptance milestones per agent, each with its own required tests and merge contract before final integration.
