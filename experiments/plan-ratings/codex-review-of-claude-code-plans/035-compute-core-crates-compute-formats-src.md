Rating: 8/10

Summary judgment

This is a strong, source-grounded plan for `compute-formats`. It identifies real production-path behavior in the public crate, ties most findings to concrete files and code paths, preserves the existing public API as the default contract, and orders low-risk correctness work before the additive compiled-format path and the larger currency decision. The plan is much better than a generic improvement list: it names exact defects, affected consumers, invariants, and targeted regression tests.

The rating is not higher because a few behavior contracts are still asserted rather than proven, especially repeat-fill semantics and locale currency placement. The compiled-format performance work also lacks an explicit measurement gate, and the currency/FIXED/DOLLAR portion crosses into consumer semantics while mostly treating those consumer changes as follow-ups. Those gaps are fixable, but they matter for a high-blast-radius display engine.

Major strengths

- The plan correctly treats `compute-formats` as a production display authority. The cited paths through `format_value`, viewport rendering, autofit, `format_values_batch`, and `TEXT()` are consistent with the source.
- The evidence quality is high. The claims around `Token::RepeatFill`, `format_number_internal` reparsing, `format_values_batch` mapping over `format_value`, `datetime.rs` byte slicing for `A/P`, scientific mantissa rounding, and US-hardcoded `format_dollar`/`format_fixed` all check out from the current tree.
- Sequencing is sensible. Scientific carry, AM/PM panic safety, decimal carry hardening, and sign-rule centralization are small and reviewable before the more invasive cached-format and currency work.
- The plan explicitly preserves bridge-sensitive contracts such as `CultureInfo` serde shape, `DateValueResult`/`ParsedDateInput`, and existing public formatting function signatures.
- Verification is serious for a Rust crate with `#![warn(missing_docs)]` and `clippy::pedantic`: crate tests, doc tests, clippy, fmt, golden/first-principles tests, and property tests are all called out.

Major gaps or risks

- The currency step is still a decision disguised as an implementation plan. It recommends wiring `apply_currency_pattern` into numeric formatting, but does not specify exactly how to distinguish a literal currency symbol from a locale-currency token after parsing, how to avoid double-emitting symbols already embedded in the format code, or how imported Excel formats with explicit symbol placement should behave.
- `DOLLAR()` and `FIXED()` locale-awareness is not actually production-complete inside this folder alone. The current `compute-functions` callers invoke `format_dollar(number, decimals)` and `format_fixed(number, decimals, no_commas)` without workbook locale. Additive locale-aware variants in this crate would not affect spreadsheet-function behavior until the function execution context can provide locale.
- The repeat-fill contract needs reference evidence. The plan asserts width-less `TEXT()` should emit zero fill chars, which may be right, but this should be verified against Excel/LibreOffice or an import fixture before becoming the crate contract.
- The compiled-format work has no perf acceptance criterion. A cached parse path is directionally correct, but the plan should require a production-shaped microbenchmark or Criterion-style gate over repeated shared format codes, plus allocation counts if available.
- Fractional seconds are under-specified relative to Excel edge cases. The plan should state behavior for elapsed seconds (`[s].000`), carry into the next second/minute at `.9995`, and whether date serial rounding should preserve existing whole-second behavior for formats without subsecond placeholders.
- The plan mentions auditing byte slices but only concretely targets locale-derived strings. The source also has safe-looking byte slicing in ASCII-normalized contexts; the audit should define which slices are acceptable and why, so the implementation does not churn unrelated parser code.

Contract and verification assessment

The public API contract is mostly clear: existing `format_*` functions remain, `CompiledFormat` is additive, and existing string-path and compiled-path outputs must match. That is the right compatibility posture.

The verification plan is good for correctness and panic safety, but incomplete for the performance objective. Step 6 should require a before/after benchmark for `format_values_batch` with many repeated format codes and representative `CellValue` mixes, because otherwise the most important performance claim is only inferred from code structure. The currency step also needs explicit golden cases for literal `$#,##0.00`, bracketed `[$€-407]#,##0.00`, accounting presets, and negative sections so reviewers can tell whether the change is intentional Excel fidelity or an accidental behavior shift.

Concrete changes that would raise the rating

- Split Step 7 into a separate plan or make its contract precise: token provenance for currency symbols, literal-vs-locale behavior, negative-section interaction, and required consumer changes for `DOLLAR()`/`FIXED()`.
- Add reference-backed examples for repeat-fill, fractional seconds, and currency placement, preferably from Excel fixtures or a documented oracle.
- Add a compiled-format benchmark gate with a target such as "same outputs as string path, parse count reduced to distinct format-code count, and measurable speedup on repeated-code batches."
- Specify the full `CompiledFormat` public surface, including docs required by `missing_docs`, `Send`/`Sync` expectations, whether compile can fail, and whether it owns the original format string for diagnostics.
- Expand fractional-second tests to cover elapsed-time formats and rounding carry across second/minute/hour boundaries.
