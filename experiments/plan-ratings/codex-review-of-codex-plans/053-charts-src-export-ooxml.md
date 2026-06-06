Rating: 8/10

Summary judgment

This is a strong, production-relevant plan for `charts/src/export/ooxml`. It correctly identifies the folder as the native chart XML boundary, and it is well grounded in the current source: `compileResult` is typed and documented but unused, source ranges are synthesized independently by emitters, boxplot support decisions disagree across APIs, chart-family emitters still assemble large XML strings directly, and the existing tests are mostly fragment assertions plus lightweight well-formedness checks.

The rating is not higher because the plan is still short of an executable contract for the biggest abstractions it proposes. The direction is right, but the support table, `ChartOOXMLExportModel`, `ChartDataReferencePlan`, helper-table ownership, ChartEx policy, and serializer validation rules need exact shapes and acceptance criteria before parallel implementation can proceed without drift.

Major strengths

- The plan targets the production export path rather than benchmark-only or mock surfaces. It starts from `toOOXML`, chart-family emitters, support decision APIs, and downstream XLSX package integration.
- The source diagnosis is accurate. The current emitters derive formulas from hardcoded column conventions, `ExportOptions.compileResult` is not consumed by the implementation, `canExportToOOXML` can return true for paths that `toOOXML` rejects, and the current XML tests do not prove workbook/package validity.
- The architectural direction is sound: one shared support matrix, one typed export model, one source-reference plan, and chart-family emitters consuming model projections instead of reinterpreting `ChartSpec` locally.
- The contract section names the right invariants for OOXML fidelity: formula references, cache counts and point indexes, finite numeric serialization, sheet-name quoting, axis cross-references, namespace choice, support decision agreement, and package graph integrity.
- The chart-family coverage is systematic rather than one-off. Category/value, XY/bubble, pie/doughnut, stock, radar, combo/secondary axes, and ChartEx-only families are all considered.
- The verification plan is meaningfully broader than the current tests. It calls for model tests, parser-backed XML validation, golden fixtures, full `ChartConfig -> configToSpec -> compile -> toOOXML` coverage, XLSX package checks, and openability-style gates.
- The parallelization notes are practical once the shared contracts are agreed. The proposed slices have mostly disjoint responsibilities: support matrix, source-reference model, serializer/common mappings, family emitters, and XLSX integration.

Major gaps or risks

- The new type contracts are described by intent but not by shape. The plan should sketch the concrete TypeScript interfaces for `ChartOOXMLExportModel`, `ChartOOXMLExportContext`, `ChartDataReferencePlan`, series descriptors, axis descriptors, cache values, and fallback decisions.
- The support matrix needs a precise runtime owner. It should define the table structure, its relationship to the public `ChartType` union and mark/layer reductions, and compile-time exhaustiveness checks so `canExportToOOXML`, `getOOXMLChartElement`, and `toOOXML` cannot diverge again.
- The helper data-table contract is under-specified. The plan says generated ranges must exist, but does not define where helper sheets/tables live, how names avoid collisions with user sheets, whether helper ranges are hidden, how they update, or how caller-provided workbook ranges and generated ranges coexist.
- `compileResult` use needs guardrails. The plan should say whether a provided compile result is trusted, validated against `spec`/`data`, or ignored when incompatible, and which compiler fields are authoritative for export versus render-only geometry.
- ChartEx scope remains a major risk. The plan correctly says not to fake ChartEx as classic chart XML, but it does not define the minimum package pieces for a real ChartEx implementation or the exact fallback/blocking criteria for each ChartEx-only family.
- The XML serializer objective needs a source of truth for element order and schema tolerance. "Schema/order-valid enough for Excel consumers" should be converted into explicit ordering tables, normalized golden XML expectations, or a validator/corpus contract.
- The plan touches `file-io/xlsx/parser` but does not include the required Rust clippy gate if Rust code changes. It lists `cargo test -p xlsx-parser charts`, but the repo instructions require `cargo clippy -p xlsx-parser` for Rust implementation work as well.
- Public API migration risk is not fully handled. Updating `OOXMLExportResult` to carry a data reference plan is likely a public `@mog/charts/export` contract change and bridge type change, so the plan should name declaration/output and consumer compatibility gates.

Contract and verification assessment

The contract coverage is above average. The plan focuses on verifiable OOXML facts rather than vague visual fidelity: every `<c:f>` must point at materialized workbook cells, caches must match logical point counts, blank points keep indexes, axes cross-reference correctly, support decisions agree, and image fallback reasons are deterministic. Those are the right contracts for this folder.

The verification strategy is also strong, but it needs sharper pass/fail definitions. XML parser-backed tests are better than fragment assertions, but parser well-formedness is not enough for Excel chart semantics. The plan should require validation that formulas map to the actual generated worksheet cells, that chart part relationships and content types are present in a complete XLSX archive, and that representative generated workbooks pass a real package integrity/openability gate. If Rust package integration is changed, `cargo test -p xlsx-parser` should be paired with `cargo clippy -p xlsx-parser`.

Concrete changes that would raise the rating

- Add concrete TypeScript interface sketches for the export context, export model, reference plan, support decision records, series/cache descriptors, and fallback reason enum.
- Define the support matrix owner and require exhaustive coverage against public chart config/type inputs, including tests proving `canExportToOOXML`, `getOOXMLChartElement`, and `toOOXML` agree.
- Specify helper-table placement, naming, hiding, collision handling, lifecycle, and interaction with caller-provided source ranges.
- Define `compileResult` compatibility semantics and the exact compiler fields that export may consume.
- Add explicit ChartEx implementation requirements or fallback criteria per ChartEx-only family.
- Turn XML ordering into a concrete serializer contract with ordering tables, normalized golden fixtures, or a named validator/corpus.
- Add public contract verification for `@mog/charts/export` result changes, generated bridge/declaration consumers, and no private/internal dependencies.
- Add the missing Rust clippy gate whenever the implementation changes `file-io/xlsx/parser`.
