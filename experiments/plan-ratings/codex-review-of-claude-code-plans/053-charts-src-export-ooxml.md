Rating: 8/10

Summary judgment

This is a strong plan. It correctly treats chart OOXML export as a production fidelity path rather than a string-generation cleanup, and it grounds most proposed work in concrete defects visible in `mog/charts/src/export/ooxml`: unescaped attribute values, hardcoded cache formats, string-only categories, default-only colors, duplicated legend decisions, unreachable dual-axis handling, and fragile drawing anchors. The plan also has the right architectural instinct: consolidate repeated serializer decisions, make the data-reference layout a named contract, and verify exported XML against malformed-output and visual-drift failure modes.

The rating is not higher because the plan still leaves several implementation-critical contracts underspecified. It says the workbook writer must share the data layout, but does not identify the writer integration point or define the exact shared API/test fixture that makes drift impossible. It also undercounts existing OOXML tests outside the folder, leaves `compileResult` color/domain/format consumption too vague, and keeps dual-axis support as an either/or choice rather than a crisp deliverable.

Major strengths

- Evidence quality is high. The plan points to real production-path failures: `axis-xml.ts` injects `formatCode` into an attribute without escaping; `shared-xml.ts`, pie, scatter, bubble, and stock caches hardcode `General`; category/value series are forced through `strRef`; scatter/bubble use `Number(...) || 0`; most chart types interpolate raw `srgbClr` values; and `wrapChartXMLFromSpec` is not used by the dispatcher.
- The objectives are aligned with export fidelity, not cosmetic cleanup. XML validity, number-format propagation, category type preservation, color fidelity, legend parity, data labels, fallback boundaries, and chart/image anchor correctness are all meaningful user-visible or Excel-compatibility concerns.
- The architectural fit is mostly right. Centralizing color normalization, legend resolution, blank handling, and data-reference layout would reduce duplicated serializer logic without changing the pure, synchronous shape of the chart generators.
- The plan correctly calls out cross-folder coupling instead of pretending this can be fixed entirely inside `charts/src/export/ooxml`. `export/index.ts`, `ooxml-types.ts`, compiler output, and the XLSX/package writer really are part of the contract.
- Sequencing is generally sensible: validity and normalization first, then format/category/color fidelity, then reference layout and larger feature parity.

Major gaps or risks

- The test inventory is incomplete. The plan says only `charts/src/export/ooxml/__tests__/bar-chart-xml.test.ts` and `scatter-chart-xml.test.ts` exist, but there are broader OOXML tests in `charts/__tests__/export/ooxml-export.test.ts`, `charts/__tests__/integration/full-pipeline-export.test.ts`, and related chart export tests. The plan should build on these rather than describe well-formedness as entirely new coverage.
- The data-layout contract is still a concept, not an executable contract. The plan should name the workbook writer/package owner, define the row/column model and exported helper signatures, and require both chart XML tests and workbook package tests to consume the same fixture or contract object.
- Color fidelity is underspecified for non-categorical color. Mapping `seriesNames` to `encoding.color.scale.range` works for categorical series colors, but quantitative color scales or point-level colors may require per-point `<c:dPt>` overrides or image fallback. The plan should define which cases are supported natively.
- `compileResult` is invoked as the authoritative source, but the plan does not specify exactly which fields are consumed. `CompileResult` exposes scales, marks, traces, and legend traces; the plan should say whether color comes from `scales.color.domain()/range()`, mark styles, bar geometry traces, or another stable contract.
- Category-type conversion needs more precision. Temporal categories must be converted to Excel serial date numbers with a clear date-system assumption, not just emitted as `numRef`. Quantitative x for bar/column charts may not be semantically equivalent to scatter/value-axis behavior, so chart-family acceptance criteria should be explicit.
- Dual-axis work is too open-ended. "Implement or gate" is useful as risk framing, but too loose for an implementation plan. A high-fidelity plan should choose a path, define the layer/series partition contract, and list the expected OOXML plot groups and axis IDs.
- Data-label source mapping is vague. The plan references "spec's data-label settings" and `DataLabelConfig`, but should identify the exact current chart config/spec/layer representation and how label layers should map to native OOXML labels versus image fallback.

Contract and verification assessment

The contract section is directionally good: purity, cache/reference duality, fallback boundaries, well-formedness, axis ID uniqueness, data-layout sharing, and blank semantics are the right invariants. The most important missing piece is making these contracts mechanically enforceable. The data-layout contract should be a shared exported module plus cross-package tests, not a documented convention. The color/format/category contracts should name the specific input fields, output XML elements, and fallback behavior for unsupported cases.

The verification plan is strong but needs sharper gates. It should explicitly include `pnpm --filter @mog/charts test` and `pnpm --filter @mog/charts typecheck` for TypeScript changes, plus the existing broader export and full-pipeline OOXML suites. XML parsing should use a real parser/schema-aware validator where feasible; the current repository already has lightweight well-formedness tests, so the new gate should extend them with adversarial attributes and strict parsing rather than duplicate substring checks. The round-trip/golden gate is valuable, but it needs a concrete command or eval path and a clear definition of "opens without repair" if Excel itself is not available in CI.

Concrete changes that would raise the rating

- Replace the vague workbook-writer dependency with an explicit shared `data-layout` contract: owner file, helper signatures, example table layouts for category/value, scatter, bubble, stock, and pie, and tests proving the writer and chart XML consume the same contract.
- Correct the test inventory and list the exact existing tests to extend, including `charts/__tests__/export/ooxml-export.test.ts` and `charts/__tests__/integration/full-pipeline-export.test.ts`.
- Define `compileResult` consumption precisely: source of series order, color domain/range, category order, resolved number formats, and fallback behavior when those fields are absent.
- Decide the dual-axis outcome up front. Either make native dual-axis a required phase with plot-group/axis assignment acceptance tests, or explicitly gate it to image fallback/remove dead branch for this plan.
- Add per-chart-family acceptance criteria for temporal, quantitative, nominal, and sparse grouped categories, including Excel serial date conversion and duplicate-category behavior.
- Specify native color support boundaries for categorical series colors, per-point colors, and quantitative gradients; require fallback where OOXML cannot faithfully represent the rendered chart.
- Add concrete verification commands and strict XML/schema/round-trip fixtures for the changed production path, not only unit-level string assertions.
