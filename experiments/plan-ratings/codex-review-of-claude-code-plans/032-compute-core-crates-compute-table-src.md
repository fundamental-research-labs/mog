Rating: 8/10

Summary judgment

This is a strong, production-path-aware plan. It correctly treats `compute-table` as a pure table/filter kernel, traces the storage and bridge callers, and names real correctness gaps: icon filters are a no-op, date dynamic filters default week starts, dynamic date resolution can panic, formula criteria are unsupported, color filters have an all-pass fallback, and hot filter paths allocate per row. The objectives are ranked, mostly testable, and avoid test-only work. The rating is held back because several high-impact items are still decision gates rather than implementable contracts, and because the proposed edge-value conformance gate relies on a doc that appears to contradict the current `FiniteF64` value boundary.

Major strengths

- The plan is well anchored in the actual source and production callers: `filter.rs`, `filter_resolve.rs`, `advanced_filter.rs`, `compare.rs`, `storage/sheet/filters/evaluation.rs`, and `bridge_pure.rs`.
- The architecture direction is right: keep `compute-table` pure and pass resolved row context for document/format/CF concerns instead of teaching the crate about Yjs, workbook storage, or UI state.
- It correctly identifies silent all-visible fallbacks for `Icon` and missing `Color` formats as dangerous product bugs rather than harmless placeholders.
- Verification is broad and relevant: in-crate Rust tests, app/api evals, XLSX round-trip, TS contract generation, and allocation benchmarks are all named.
- Sequencing is sensible overall, with small safety fixes separated from bridge-coupled work and a performance refactor guarded by differential/conformance tests.

Major gaps or risks

- The error contract is under-specified. `evaluate_column_filter` returns `Vec<u8>` today, but O3 and O7 alternate between typed errors and deterministic match-nothing behavior without choosing exact signatures, FFI mappings, or pure-bridge compatibility behavior.
- O5 needs a reconciliation step before it can be authoritative. `EDGE_VALUE_SEMANTICS.md` says NaN and infinities are numeric table values with `__NUM__` keys, but current `CellValue::Number` is backed by `FiniteF64`; `CellValue::number(NaN)` and `Infinity` map to `Error(Num)`, and existing compare/slicer tests document that behavior.
- O1 leaves too much of the icon-filter contract to Phase 0. Passing per-row icon refs is plausible, but the plan should specify whether the source is the existing CF evaluation cache, how priority/multiple rules/custom icons/reverse order/no-icon rows behave, and which icon-set threshold cases must be tested.
- O4 is not yet a full spec for Excel Advanced Filter formula criteria. The current criteria model carries only value plus `is_formula`; the plan does not define how formula text or identity formula, criteria-cell coordinates, relative reference rebinding, blank criteria headers, error coercion, volatile formulas, or evaluator cycles are represented.
- O2 says to read the workbook week-start setting, but the inspected settings surface appears to expose culture/locale rather than an explicit week-start field. The plan needs to identify whether week start is stored, culture-derived, or a new workbook setting.

Contract and verification assessment

The verification bar is strong and aligned with the repo's expectations. The plan emphasizes production entry points, real app/api behavior, FFI contract generation, and round-trip safety, which is exactly the right shape for this folder.

The weakest contract area is public API/result shape. Several objectives require adding context and possibly changing infallible APIs to `Result`, but the plan does not name the final Rust types, serde additions, bridge behavior, or WASM/NAPI/PyO3 mapping. The conformance gate is also risky until the edge-value doc and actual `FiniteF64` boundary agree. For O6, the benchmark target should explicitly include the production `storage/sheet/filters/evaluation.rs` path and pure bridge path, not only isolated crate helpers.

Concrete changes that would raise the rating

- Add a Phase 0 output artifact with exact proposed signatures: `FilterEvalContext`, `FilterEvalError`, missing-format behavior, missing-now behavior, and how every bridge/FFI surface maps failures.
- Reconcile `EDGE_VALUE_SEMANTICS.md` with the current non-finite value boundary before writing O5 fixtures. Either update the doc to say non-finite numbers cannot be represented as `Number` and become `#NUM!`, or explicitly justify changing the value model.
- Specify the icon-filter contract around existing CF evaluation results: source cache/function, per-row `IconResult` shape, priority handling, custom icon semantics, reverse order, no-icon rows, and threshold-type fixtures.
- Specify Advanced Filter formula criteria semantics with formula payload, criteria cell address, candidate row binding rules, value coercion, error handling, and no-evaluator behavior.
- Identify the week-start source concretely, including default behavior for existing workbooks and pure bridge calls.
- Land the edge-value conformance suite before the allocation refactor if feasible, since O6 is the most likely phase to introduce subtle semantic drift.
