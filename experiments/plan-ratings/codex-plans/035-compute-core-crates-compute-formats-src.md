# Plan 035: compute-formats Production Format Contract

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/compute/core/crates/compute-formats/src`

Queue item: number 35, `mog/compute/core/crates/compute-formats/src`, described as number, date, and locale format parsing/rendering.

This plan covers the public Rust crate implementation under `compute-formats/src`:

- Public facade: `api.rs`, `lib.rs`, `format_result.rs`, `convenience.rs`.
- Format-code model and parsing: `types.rs`, `parser.rs`, `detection.rs`, `normalize.rs`, `builder.rs`.
- Rendering engines: `number.rs`, `datetime.rs`, `fraction.rs`, `general.rs`, `currency.rs`, `color.rs`.
- Input helpers: `input.rs`.
- Built-in metadata: `constants/*`.
- Locale registry and calendar data: `locale/*`.

The plan also includes production callers that must be verified when this folder changes: compute-core storage display formatting, storage input parsing, bridge APIs, formula `TEXT`/`DOLLAR`/`FIXED`, autofit/range display text, and workbook culture settings. It does not propose edits outside this crate unless they are necessary to make `compute-formats` the single production contract rather than one of several competing implementations.

## Current role of this folder in Mog

`compute-formats` is Mog's Rust format engine for spreadsheet display text and format metadata. It parses Excel-like number format codes, selects a positive/negative/zero/text section, formats `CellValue` values, returns display text plus color metadata, and exposes helper APIs for batch formatting, date/time preparation, date input parsing, format category detection, and UI format-code construction.

The production display path reaches this crate through `YrsComputeEngine::format_value_at_cell`, which resolves effective cell formatting and calls `compute_formats::format_value(value, format_code, &settings.locale)`. The same crate is used by `format_values_batch` for display measurement and range queries, by `TEXT()` for user-visible formula results, by `DOLLAR()` and `FIXED()` convenience functions, and by generated bridge functions such as `compute_prepare_date_value`, `compute_prepare_time_value`, `compute_detect_format_type`, `compute_parse_date_input`, and `compute_format_values`.

The crate already has substantial first-principles tests and proptests under `compute/core/crates/compute-formats/tests`, including numeric rendering, date/time boundaries, parser/datetime coverage, detection, metadata, input values, and panic-safety. It also contains crate-local unit tests for builder, parser, input, currency, locale, constants, color, general, fraction, and format result behavior.

The main architectural weakness is that some production parsing logic still exists outside this crate. `compute/core/src/storage/cells/values/parsing.rs` calls `compute_formats::parse_date_input` but then falls back to local date parsing and owns formatted-number, simple-fraction, time, currency, and culture-sensitive input parsing. That creates divergent contracts between display rendering, user input, formula coercion, and bridge APIs.

## Improvement objectives

1. Make `compute-formats` the single production contract for spreadsheet number/date/time/currency/percent/fraction format parsing and rendering. Storage, formula, bridge, and display code should call into this crate instead of keeping parallel parsers or category-specific heuristics.

2. Replace heuristic format-code handling with a complete, typed Excel format intermediate representation. The parser should preserve section boundaries, color directives, conditions, locale/currency brackets, elapsed time brackets, literals, escapes, skip-width, repeat-fill, percent/per-mille, exponent sections, digit placeholders, text placeholders, and malformed-but-displayable fragments without conflating unrelated cases.

3. Strengthen locale correctness at render time and parse time. Locale must control decimal separators, group separators, date order, date separator, time separator, month/day names, AM/PM designators, currency symbols, currency placement, currency decimal digits, percent symbols, list separators where relevant, and workbook culture changes.

4. Tighten Excel serial date semantics. Preserve the 1900 date system, serial 0 "January 0, 1900" display behavior, serial 60 fake 1900-02-29 behavior, time fractions, elapsed time, date1904 conversion at the storage boundary, 2-digit year rules, and invalid-date rejection.

5. Build systematic category coverage instead of isolated regression coverage. Every supported format category should have a table of accepted format codes, parsed representation assertions, render examples, input examples, locale variants, and production-path bridge/display checks.

6. Keep performance appropriate for the production render path. Cell display formatting, viewport rendering, range queries, and autofit can format many cells. Repeated parsing of identical format codes should not dominate render time.

## Production-path contracts and invariants to preserve or strengthen

- `format_value` is the canonical display-text contract for compute-core storage, viewport/render queries, range queries, and autofit.
- `format_values_batch(entries, locale)` must return the same strings as individual `format_value` calls for every entry and must preserve order and length exactly.
- `format_number_result` must return identical text to `format_number_with_locale` and must additionally carry color metadata when the selected section contains a supported color directive.
- Format sections must follow Excel selection rules: one section for all numbers, two sections for positive/zero and negative, three sections for positive/negative/zero, four sections with a text section, and condition sections selected in order with an unconditional fallback.
- Negative signs must only be synthesized when Excel would synthesize them. Explicit negative sections, parentheses, color sections, and zero-after-rounding cases must not double-sign.
- General formatting must preserve the shared `value-types` 15-significant-digit expectation and never emit `NaN` or infinities for finite inputs.
- Date/time rendering must use `value_types::date_serial` semantics consistently, including 1900 serial boundaries and date1904 offset handling at the caller boundary rather than inside raw serial rendering.
- Time formatting must preserve `m`/`mm` ambiguity resolution: month in date contexts, minute after hour or before second, and elapsed time for `[h]`, `[m]`, `[s]`.
- Locale data must be complete `CultureInfo`, not partial culture overrides. Unknown culture tags currently fall back to `en-US`; any change to this behavior needs an explicit bridge contract and tests.
- Format-code detection must align with `FormatType` consumers in storage input parsing, Format Cells UI generation, text-to-columns detection, mutation result enrichment, and bridge APIs.
- Text values must use the fourth section or a single-section `@` format only; non-text formats must not accidentally rewrite text.
- Booleans, errors, nulls, arrays, controls, and images must keep the current display semantics unless a separate value-type contract changes them.
- Currency and accounting formats must preserve literal format codes while applying locale placement only where the public contract says locale owns placement.
- Public API types exported from `compute-formats` must remain serializable/deserializable for WASM, N-API, PyO3, and TS bridge generation.

## Concrete implementation plan

1. Define the contract matrix before editing code.
   - Create a crate-local contract table in tests or fixtures that enumerates every supported format category: General, Number, Currency, Accounting, Date, Time, Percentage, Fraction, Scientific, Text, Special, and Custom.
   - For each category, include representative format codes, expected `FormatType`, parser shape, render examples for positive/negative/zero/text, locale variants, and input examples.
   - Include built-in Excel numFmt IDs 0-49, current presets, and user-built format codes from `build_format_code`.

2. Promote the parser output from loose metadata to a complete typed format IR.
   - Keep `Token` private if possible, but introduce explicit section-level structures for colors, conditions, locale overrides, currency directives, text placeholders, numeric pattern groups, date/time pattern groups, fraction patterns, literals, fill behavior, and malformed bracket content.
   - Parse bracket directives by category instead of by string heuristics: color, indexed color, condition, elapsed time, currency/locale bracket, calendar/locale marker, and unknown bracket literal.
   - Store conditions as parsed operators and thresholds so runtime selection does not reparsing strings on every render.
   - Preserve unknown and unsupported tokens as literals when Excel displays them rather than rejecting the full code.

3. Centralize format-code detection on the parser.
   - Replace `detection.rs` string stripping heuristics with detection derived from the typed IR.
   - Ensure escaped characters, quoted literals, brackets, locale IDs, colors, conditions, and text sections cannot create false date/time/currency classifications.
   - Add detection tests for every preset and built-in code, plus adversarial cases such as quoted `days`, escaped `d`, lone `e`, unknown brackets, text-only sections, and special formats.

4. Rework numeric rendering around a format plan.
   - Compile each numeric section into integer, decimal, exponent, percent/per-mille, scale-divisor, grouping, literal, color, condition, and sign-handling components.
   - Preserve Excel rounding semantics via `value_types::precision::excel_round_to_decimal_places`.
   - Cover rounding carry across integer/decimal boundaries, all-`#` zero suppression, `?` spacing, explicit zero sections, scaled thousands, multi-section negatives, conditions, scientific exponent width/sign, and very large finite numbers.
   - Add a parsed-format cache at the production call boundary if measurement shows repeated parse cost is significant. The cache should be keyed by exact format code and scoped so workbook locale changes do not invalidate culture-agnostic parse results.

5. Rework date/time rendering around explicit date/time tokens.
   - Keep serial conversion in one place and define how negative serials, serial 0, serial 60, serial values beyond supported date range, and fractional carry to 24:00 are handled.
   - Add explicit handling for date separators and time separators when a format code requests locale-sensitive separators, while preserving literal separators in explicit custom codes.
   - Verify all `m`/`mm` ambiguity cases: standalone month, date month, hour-minute, minute-second, elapsed hour/minute/second, quoted/literal separators between tokens, AM/PM and A/P forms.
   - Add locale matrix tests for month/day names and AM/PM in the 10 currently supported cultures.

6. Move user input parsing contracts into `compute-formats`.
   - Add public parse APIs for date/time, formatted number, percent, currency, scientific notation, and simple/mixed fractions with a single `CultureInfo` and explicit parse options.
   - Include policy outputs that let storage preserve date-like, time-like, fraction-like, leading-zero, long-digit, percent-suffix, currency-symbol, formatted-number, and scientific-notation text without duplicating parsers.
   - Migrate `compute/core/src/storage/cells/values/parsing.rs` to call this contract and delete its local date and formatted-number parsers after equivalent tests pass.
   - Keep date1904 conversion in storage or workbook context because it depends on workbook settings, not on the culture-agnostic serial parser.

7. Make locale data and culture behavior explicit.
   - Audit all 10 supported cultures for separator, date order, first day of week, month/day names, AM/PM, currency symbol/code, currency decimal digits, currency placement, percent patterns, and list separator.
   - Decide whether culture tag lookup remains exact-case and fallback-to-en-US or becomes case-insensitive IETF normalization. Whichever contract is chosen must be tested through Rust and TS bridge surfaces.
   - Add a culture metadata invariant test that `get_all_cultures()` order and tags stay stable unless a public contract change is made.

8. Align builders, presets, and built-ins with the renderer.
   - For every `FormatType`, assert that `build_format_code(default options)` renders correctly, detects back to the same category, and is present or intentionally absent from presets.
   - Ensure built-in format IDs 0-49, presets, negative format options, currency symbols, and accounting strings round-trip through detection and rendering without special-case drift.
   - Clarify how `Special` codes such as ZIP, phone, and SSN render and parse; if the renderer does not support them yet, implement that category rather than leaving detection-only behavior.

9. Strengthen public bridge and formula integration.
   - Add compute-core tests that exercise `TEXT`, `DOLLAR`, `FIXED`, display formatting through `format_value_at_cell`, `format_values_batch`, `compute_detect_format_type`, `compute_parse_date_input`, and workbook `set_culture`.
   - Verify that locale changes update display text and parsing behavior on the production engine path, not only direct crate functions.
   - Keep bridge DTO names and serialized fields stable unless bridge generation and SDK docs are updated in the same workstream.

10. Add performance and memory guardrails after correctness is locked.
    - Measure production display formatting through existing compute-core rendering/autofit/range-query paths, not synthetic parser-only loops.
    - If parse caching is needed, implement it in the production display/query path and prove that batch formatting and repeated viewport display reuse parsed format codes without changing locale-dependent output.
    - Add bounded-cache behavior or explicit cache ownership so large workbooks with many custom format codes do not grow unbounded memory.

## Tests and verification gates

Required Rust gates for implementation work:

- `cargo test -p compute-formats`
- `cargo clippy -p compute-formats`
- `cargo test -p compute-core --test formula_accuracy_text_format`
- `cargo test -p compute-core storage::cells::values` or the smallest available compute-core test filter that covers storage input parsing after migration
- `cargo test -p compute-core` before declaring the full production-path change done

Additional targeted gates when touched:

- `cargo test -p compute-functions` if `TEXT`, `DOLLAR`, `FIXED`, or `NUMBERVALUE` behavior changes.
- WASM/N-API/PyO3 bridge generation or bridge contract tests if public DTOs, bridge function signatures, or serialized field names change.
- UI or browser-driven spreadsheet checks if Format Cells, cell editing, workbook culture selection, or rendered viewport display changes.

Test coverage to add or expand:

- Parser IR golden tests for every built-in format ID, preset, builder output, and representative custom code.
- Render matrix tests for number, date, time, datetime, elapsed time, currency, accounting, percentage, fraction, scientific, text, special, custom, conditions, colors, quoted literals, escaped literals, skip-width, repeat-fill, and unknown brackets.
- Locale matrix tests across all supported cultures for number separators, date order, month/day names, AM/PM, currency placement, currency decimal digits, and percent symbols.
- Input parsing matrix tests for ISO dates, slash dates by locale, month-name dates, 2-digit years, invalid dates, 1900 leap bug, time strings, localized AM/PM, percent suffixes, currency symbols, group separators, decimal separators, scientific notation, leading zeros, long digits, simple fractions, mixed fractions, and policy-preserved text.
- End-to-end compute-core tests that set workbook culture, type user-like values through storage parsing, store resulting values/formats, and read display text through `format_value_at_cell`.
- Proptests that assert formatting never panics, parsed format IR is deterministic, batch equals individual formatting, finite numeric inputs produce stable finite display text, and format normalization is idempotent.

## Risks, edge cases, and non-goals

Risks and edge cases:

- Excel format syntax is permissive. Rejecting or over-normalizing malformed custom formats would break user workbooks; unsupported fragments should usually render as literals.
- Locale-sensitive parsing is ambiguous. Examples like `1/2/24`, `1,234`, and `1.234` must be resolved by an explicit culture/date-order/parse-policy contract, not by incidental parser order.
- Date serial behavior is easy to regress around serial 0, serial 60, negative serials, fractional rounding to the next day, and date1904 offsets.
- `m`/`mm` ambiguity can regress when parser IR gets stricter. Date and time tokens need context-aware resolution, not simple lexical classification.
- Currency symbols can be literal format-code tokens or locale-owned display patterns. The implementation must not blindly replace explicit custom-code symbols with workbook symbols unless the contract says so.
- Parse caching can be incorrect if it captures locale-dependent output instead of culture-agnostic parsed format structure.
- Generated bridge artifacts and SDK surfaces may be sensitive to public type shape. DTO changes need bridge-aware verification.

Non-goals:

- Do not build a test-only parser or formatter path.
- Do not keep compatibility shims around duplicate storage parsers once `compute-formats` exposes the right production contract.
- Do not expand to CLDR-scale locale coverage in this workstream unless the product contract changes; first make the 10 supported cultures complete and verified.
- Do not optimize parser microbenchmarks unless production display, autofit, range query, or viewport rendering shows the same bottleneck.
- Do not change workbook culture persistence, date1904 storage semantics, or UI Format Cells behavior except where required to consume the corrected compute-format contract.

## Parallelization notes and dependencies on other folders, if any

This work is highly parallelizable after the contract matrix is defined:

- Worker A: parser IR and detection contracts in `compute-formats/src/parser.rs`, `types.rs`, and `detection.rs`.
- Worker B: numeric, fraction, scientific, percent, currency, accounting, and special rendering in `number.rs`, `fraction.rs`, `currency.rs`, and constants.
- Worker C: date/time rendering and date input parsing in `datetime.rs`, `input.rs`, and `locale/*`.
- Worker D: storage input migration in `compute/core/src/storage/cells/values/parsing.rs` after Worker C exposes the parse contract.
- Worker E: production integration tests across compute-core display formatting, formulas, bridges, workbook culture, and batch formatting.
- Worker F: production-path performance measurement and parsed-format cache, after correctness and integration tests are green.

Dependencies:

- `value-types` owns finite numeric representation, date serial conversion, and Excel rounding helpers. Any serial or precision contract change must be coordinated there.
- `compute-core/src/storage/cells/values` owns workbook-aware input policy and date1904 conversion; it should delegate parsing categories to `compute-formats` but keep workbook policy decisions.
- `compute-core/src/storage/engine/formatting`, range queries, and autofit own production display use of `format_value`.
- `compute-functions` owns formula wrappers around `TEXT`, `DOLLAR`, `FIXED`, and `NUMBERVALUE`.
- WASM/N-API/PyO3 and generated TS bridges depend on public DTOs and bridge method signatures.
- Format Cells UI and public SDK contracts depend on `FormatType`, presets, built-ins, and `CultureInfo` stability.
