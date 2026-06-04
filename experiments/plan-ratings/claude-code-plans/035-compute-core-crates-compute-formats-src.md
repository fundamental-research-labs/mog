# 035 — Improve `mog/compute/core/crates/compute-formats/src` (number / date / locale format engine)

## Source folder and scope

- **Folder:** `mog/compute/core/crates/compute-formats/src`
- **Crate:** `compute-formats` (`description = "Excel-compatible number format engine with locale, color, and currency pattern support"`), `publish = false`.
- **Role:** parses Excel number-format codes and applies them to `f64` / `CellValue` to produce display strings. Powers cell display rendering, column autofit measurement, and the `TEXT()`/`DOLLAR()`/`FIXED()` spreadsheet functions.
- **Size:** ~12,300 lines across `src` (counting inline `#[cfg(test)]` modules), plus a ~2,700-line external `tests/` suite. Largest files: `constants/presets.rs` (704), `parser.rs` (549), `locale/data.rs` (530), `detection.rs` (517), `number.rs` (485), `input.rs` (476), `builder.rs` (405).
- **Modules in scope:**
  - Pipeline core: `lib.rs` (facade docs + re-exports), `api.rs` (public `format_*` entry points), `parser.rs` (tokenizer / section splitter / m-ambiguity resolution), `types.rs` (`Token`, `FormatSection`, `FormatCode`), `number.rs` (numeric + scientific), `datetime.rs`, `fraction.rs`, `general.rs`, `convenience.rs` (`format_dollar`/`format_fixed`), `currency.rs`, `color.rs`, `format_result.rs`.
  - Classification & inputs: `detection.rs`, `normalize.rs`, `input.rs`.
  - Data tables: `constants/**` (builtins, categories, currency symbols, negative formats, presets), `locale/**` (registry, data, calendar, types, arrays).
- **Out of scope (named only for coupling, not edit targets):**
  - `value-types` crate (`value_types::precision::excel_round_to_decimal_places`, `value_types::date_serial::{serial_to_ymd, serial_to_date, date_to_serial, ymd_to_serial}`, `CellValue`) — `compute-formats` depends on it; any rounding/serial change belongs there.
  - Consumers reached through the public API: `mog/compute/core/src/storage/engine/**` (viewport `render_cells.rs`, `materialized_cells.rs`, `format_io.rs`, `services/autofit.rs`, `formatting/display_text.rs`, `formatting/displayed.rs`, `services/queries/ranges.rs`), and `compute-functions` `text/conversion/{text_format,number_format}.rs` (`TEXT`, `DOLLAR`, `FIXED`).
  - The crate's own `tests/` directory (we add tests there, but the production-path fixes live under `src`).

## Current role of this folder in Mog

This crate is the single Rust authority for "given a value and an Excel format code, what string does the cell show." Every display path funnels through `api::format_value` → `format_number_internal`:

1. `parse_format_code(code)` splits on unquoted `;`, tokenizes each section, resolves `m` month/minute ambiguity, and computes per-section metadata (`int_placeholders`, `dec_placeholders`, `scale_divisors`, `has_thousands`, `has_percent`, `has_exponent`, `is_datetime`, `is_text_section`, `color`).
2. `number::select_section` picks the section by sign / zero / `[condition]`.
3. A dispatcher in `api.rs` routes to `apply_text_section`, `format_datetime`, `format_general`, `emit_literals`, `format_fraction`, or `format_numeric`.

It is on the hottest display path in the product: `format_value` is called **per cell** in viewport rendering (`render_cells.rs`, `materialized_cells.rs`), per cell in autofit width/height measurement (`services/autofit.rs`), and per cell in batch (`format_io.rs` → `format_values_batch`). It is also the semantics-of-record for `TEXT()` in `compute-functions`. Because output strings flow into snapshot/golden tests, pixel-width autofit, and user-visible cells, changes are **behavior-visible and high-blast-radius**: improvements must be Excel-faithful, allocation-conscious, and panic-free.

## Evidence (observed in the current tree)

Confirmed by reading the source, not inferred:

1. **`Token::RepeatFill` is produced but never consumed — the `*` fill is silently dropped.** `parser.rs:172-178` emits `Token::RepeatFill(c)` for `*x`, and `types.rs:29` defines it, but `rg "RepeatFill"` finds **only those two sites**. No emitter in `number.rs` (`format_numeric`/`emit_literals`), `datetime.rs`, or `fraction.rs` handles it, so both the `*` and the char it repeats vanish from output. This silently corrupts accounting/aligned formats (e.g. `_($* #,##0.00_)`, present in `ACCOUNTING_PRESETS`): the repeat-fill that pads between symbol and number is dropped, while the adjacent `_)` skip-width *is* emitted as a space — producing inconsistent partial fidelity.
2. **Scientific mantissa is not re-normalized after rounding in `number.rs::format_scientific`.** `general.rs::format_scientific` guards `if rounded_mantissa >= 10.0 { … exp + 1 }` (general.rs:120), but the format-code scientific path (`number.rs:459-484`) rounds the mantissa with `excel_round_to_decimal_places(mantissa.abs(), dec_places)` and emits it directly. A value like `9.999e5` under `0.0E+00` rounds the mantissa to `10.0`, yielding `10.0E+05` instead of Excel's `1.0E+06`. The exponent is computed from the pre-rounding `value.log10().floor()` and never re-checked.
3. **AM/PM `A/P` slices the designator by byte, not char — panic risk for non-ASCII locales.** `datetime.rs:190-192`: `result.push_str(&ampm_str[..1])`. `get_am_pm_designator` returns the locale's `am_designator`/`pm_designator` (`locale/types.rs`), which are `String` and locale-overridable. A locale whose AM designator begins with a multi-byte char (e.g. a CJK designator) makes `[..1]` land mid-codepoint and **panics** in any `A/P` time format.
4. **Fractional seconds are unsupported.** `datetime.rs::serial_to_datetime_parts` rounds to whole seconds (`(time_frac * 86400.0).round()`), and `parser::analyze_section` rewrites `DecimalPoint` to a literal `.` inside datetime sections (`parser.rs:438-446`). So `mm:ss.0` / `h:mm:ss.000` (stopwatch / lap-time formats Excel supports) cannot render sub-second digits.
5. **The parsed `FormatCode` is recomputed for every value — no compiled-format reuse.** `format_number_internal` (`api.rs:77`) calls `parse_format_code` on every call, and `format_values_batch` (`api.rs:229`) maps `format_value` over each entry with no caching. Tokenization allocates a `Vec<char>` and per-token `String`s every time. In viewport/autofit a whole column typically shares one format code, so the same string is re-tokenized thousands of times per frame. There is no public "compiled format" handle a caller can cache.
6. **Locale currency patterns are dead relative to the main path.** `currency.rs` exports `apply_currency_pattern` / `apply_positive_currency_pattern` / `apply_negative_currency_pattern` (driven by `currency_positive_pattern` / `currency_negative_pattern` on `CultureInfo`), but `rg` shows **no production caller** — `format_numeric` derives the currency symbol only from literal `[$…]`/`$` tokens and never repositions per locale. So `format_value` does not produce locale-correct currency placement (e.g. German `1.234,50 €`) automatically; it depends entirely on the literal symbol position baked into the format code.
7. **`convenience.rs` `format_dollar`/`format_fixed` are hard-coded to `$` and US separators.** `format_dollar` pushes a literal `'$'` and `add_thousands` uses `,`/`.`; there is no `CultureInfo` parameter. `DOLLAR()`/`FIXED()` therefore ignore workbook locale.
8. **Carry-propagation hazard in `format_numeric`'s decimal split.** `number.rs:169-178` computes `frac_val = ((val - val.trunc()) * factor).round() as u64` after a separate `excel_round_to_decimal_places`. Double-rounding plus float residue can make `frac_val == factor` (an extra digit), and the integer part is computed independently from `val.trunc()`, so a fractional carry is **not** propagated into the integer. The prior Excel-round normally prevents the boundary, but the two rounding steps are not provably consistent and there is no invariant test pinning `frac_val < factor`.
9. **Section-count negative-sign rule is coupled to `<= 1`.** `format_numeric` sets `needs_minus = is_negative && val != 0.0 && section_count <= 1` (number.rs:193); `format_fraction` mirrors it (fraction.rs:118). This matches Excel (2+ section codes carry their own sign via the negative section) but the rule is duplicated as a magic literal in two files rather than centralized.
10. **`detection`/`is_date_format` use broad substring scans.** `is_date_format` returns `true` if the cleaned code merely `contains('d')` etc. (detection.rs:107-132). Combined with `should_format_as_date`'s serial-range gate this is defensive, but the seconds heuristic (`'s'` not preceded by `#`/`0`) is a hand-rolled approximation that can misclassify exotic literal-bearing codes.

The crate is otherwise well-factored, documented (`#![warn(missing_docs)]`), and has strong tests (proptests asserting no-panic over fuzzed codes; "first principles" suites for numeric/date/detection).

## Improvement objectives

1. **Close Excel-fidelity correctness gaps** that produce wrong or dropped output today: scientific mantissa carry (#2), repeat-fill handling (#1), fractional seconds (#4), and decimal carry propagation (#8).
2. **Eliminate the non-ASCII AM/PM panic** (#3) and audit every remaining byte-index slice for codepoint safety.
3. **Add a compiled-format fast path** (#5) so hot callers (viewport render, autofit, batch) parse each distinct format code once instead of once per cell — a pure performance/throughput win with identical output.
4. **Resolve the locale-currency ambiguity** (#6, #7): decide and implement one coherent contract — either wire `apply_currency_pattern` into `format_numeric` for `[$…]`-symbol sections and make `DOLLAR`/`FIXED` locale-aware, or formally document the caller-driven design and remove the dead-surface ambiguity. (Recommended: integrate, behind the existing locale fields, because Excel currency display *is* locale-aware.)
5. **Centralize the duplicated negative-sign / section-count rules** (#9) into one well-tested helper so the two formatters cannot drift.
6. **Strengthen invariants with property tests** so the fixes above are pinned (mantissa `1 ≤ |m| < 10`, `frac_val < factor`, round-trip serial→string stability, no-panic across all locales including non-ASCII designators).

These are production-path improvements (correctness + performance of the real format engine), not test-only or scope-reduced changes.

## Production-path contracts and invariants to preserve or strengthen

- **Output stability for already-correct cases.** The vast existing golden/first-principles suites encode current correct output. Every fix must change output *only* for the specific wrong/dropped cases identified; all passing assertions must keep passing. New behavior gets new tests.
- **Total / panic-free over all inputs.** `format_number(value, code)` must never panic for any `f64` and any `&str` code, in any locale (the existing `format_never_panics_fuzz` proptest is the floor; extend it to cover locales and non-ASCII designators).
- **`General` semantics unchanged** (`general.rs` doc rules 1-6: ≤15 sig digits, `1e-4` low / `1e15` high scientific switch, capital-`E` with signed ≥2-digit exponent, NaN/Inf → `#NUM!`).
- **Excel serial conventions preserved** (`datetime.rs`: serial 0 → "Jan 0, 1900", serial 0 weekday = Saturday, the 1900 fictional-leap-day handling in `input::validate_date`).
- **`CultureInfo` wire-compat with TypeScript** (`locale/types.rs` doc: "Matches the TypeScript `CultureInfo` interface 1:1"; `#[serde(default, rename_all = "camelCase")]`). Any new locale field must keep `serde(default)` and a TS counterpart, or it breaks the bridge.
- **`DateValueResult` / `ParsedDateInput` serde shape** (`input.rs`, `camelCase`, `skip_serializing_if` on `format_to_apply`) is a bridge contract — additive only.
- **Public re-export surface** (`lib.rs:119-146`) is consumed across the engine and bindings; the compiled-format addition must be **additive** (new type + new entry points), leaving existing `format_*` signatures intact.

## Concrete implementation plan

Ordered to land low-risk correctness fixes first, then the additive perf path, then the larger currency decision. Each step is independently reviewable and shippable.

### Step 1 — Fix scientific mantissa re-normalization (`number.rs`) [evidence #2]
Mirror the proven `general.rs` guard inside `format_scientific`: after `excel_round_to_decimal_places(mantissa.abs(), dec_places)`, if the rounded mantissa `>= 10.0`, divide by 10 and increment the exponent before formatting `mant_str` and `exp_str`. Reuse the same epsilon/branch structure as `general.rs:120-124` so the two scientific renderers converge. Add unit tests for the `9.999e5 → 1.0E+06` family and powers-of-ten boundaries.

### Step 2 — Make AM/PM `A/P` codepoint-safe (`datetime.rs`) [evidence #3]
Replace `&ampm_str[..1]` with the first **char** (`ampm_str.chars().next().map(|c| …)`), pushing the single leading character of the designator. Grep `compute-formats/src` for any other `[..n]`/byte-range slices on locale-derived `String`s and convert to char-aware operations. Add a test with a synthetic non-ASCII `am_designator`/`pm_designator` asserting no panic and correct first-char output.

### Step 3 — Pin and harden the decimal carry (`number.rs`) [evidence #8]
Introduce a single helper that, given the Excel-rounded `val` and `dec_places`, returns `(int_str, dec_str)` with the guaranteed invariant `dec_str.len() == dec_places` and no lost carry: detect `frac_val == factor`, in which case increment the integer and reset `frac_val = 0`. Replace the ad-hoc lines `number.rs:169-178`. Add a `debug_assert!` and a property test asserting the invariant across a wide value grid and `dec_places ∈ 0..=10`.

### Step 4 — Centralize the negative-sign / section-count rule (`number.rs` + `fraction.rs`) [evidence #9]
Extract `fn emit_leading_minus(is_negative: bool, magnitude_nonzero: bool, section_count: usize) -> bool` (or a small shared module function) and call it from both `format_numeric` and `format_fraction`, deleting the duplicated `section_count <= 1` literals. Pure refactor; output-identical; covered by existing negative-format tests.

### Step 5 — Handle `Token::RepeatFill` deterministically (`parser.rs` consumers) [evidence #1]
Decide the value-engine contract for `*x`: in a width-less string context Excel's `TEXT()` emits **zero** copies of the fill char, so the correct fix is to **consume and intentionally drop** the fill in `format_numeric` / `datetime` / `fraction` / `emit_literals` (with a doc comment stating the renderer owns width-fill), *and* preserve the adjacent literal correctly. Crucially, document this in the `Token::RepeatFill` rustdoc (`types.rs`) so the parsed-but-dropped behavior is explicit and not a latent surprise. If a future column-aware renderer needs the fill char, expose it via the compiled-format metadata from Step 6 rather than the value string. Add tests for `_($* #,##0.00_)` confirming the number, symbol, and trailing skip-width space are all present and the fill does not corrupt output.

### Step 6 — Additive compiled-format fast path (`api.rs`, `parser.rs`, `lib.rs`) [evidence #5]
- Make the parsed structure reusable: add a public, opaque `CompiledFormat` type (newtype wrapping `FormatCode`) with `CompiledFormat::compile(code: &str) -> CompiledFormat` and methods `format_value(&self, &CellValue, &CultureInfo) -> FormatResult` / `format_number(&self, f64, &CultureInfo) -> FormatResult`.
- Refactor `format_number_internal` so the existing string-entry functions construct a `CompiledFormat` then delegate — guaranteeing byte-identical output between the cached and uncached paths.
- Add `format_values_batch` internal optimization: group/dedupe by format code so each distinct code is compiled once per batch (or accept a pre-compiled handle). This is the single highest-throughput win for autofit and viewport.
- Re-export `CompiledFormat` from `lib.rs`. Engine consumers (out of scope here) can later cache a `CompiledFormat` per column/style; this plan only lands the crate-side capability with parity tests.

### Step 7 — Resolve locale currency (`currency.rs`, `number.rs`, `convenience.rs`) [evidence #6, #7]
Recommended direction (Excel-faithful): when a numeric section carries a currency symbol literal originating from a `[$SYM-locale]` token, route the formatted magnitude through `apply_currency_pattern` using the active `CultureInfo` patterns, so positive/negative placement follows locale. Give `convenience.rs` locale-aware variants (or thread `&CultureInfo` through `format_dollar`/`format_fixed`) so `DOLLAR()`/`FIXED()` honor workbook locale, keeping the current US behavior as the `CultureInfo::default()` result. If the team prefers caller-driven currency, the alternative is to document `currency.rs` as an explicit caller utility and annotate it so its absence from the main path is intentional. Either way the dead-surface ambiguity is closed. (This step is larger and behavior-visible; gate it behind golden-test review and treat it as the last to land.)

### Step 8 — Fractional seconds support (`parser.rs`, `datetime.rs`) [evidence #4]
In datetime sections, stop blanket-converting `DecimalPoint` to a literal when it immediately follows a seconds token and is followed by digit placeholders; instead tokenize a `SubSecond(width)` and render `time_frac` to that many fractional-second digits in `format_datetime`, with Excel rounding. Preserve the literal-`.` behavior everywhere else. This is the most contained way to add a genuinely missing capability without disturbing date rendering. Add first-principles tests for `mm:ss.0`, `h:mm:ss.000`, and rounding at the `.999` boundary.

## Tests and verification gates

- **Workspace gates (run, do not skip):** `cargo build -p compute-formats`, `cargo test -p compute-formats` (inline + `tests/`), `cargo clippy -p compute-formats --all-targets -- -D warnings` (the crate opts into `clippy::pedantic`), `cargo fmt --check`, and `cargo test --doc -p compute-formats` (the crate's rustdoc examples are executable assertions and part of the contract).
- **Regression-first:** the full existing suite (`numeric_first_principles.rs`, `date_time_first_principles.rs`, `coverage_*`, `detection_first_principles.rs`, inline module tests) must pass unchanged except where a step deliberately corrects a wrong output, in which case the changed assertion is called out in review.
- **New unit tests per step:** scientific carry (Step 1), non-ASCII AM/PM (Step 2), decimal carry invariant (Step 3), repeat-fill accounting format (Step 5), compiled-vs-string parity (Step 6), locale currency placement / locale-aware DOLLAR (Step 7), fractional seconds + rounding (Step 8).
- **Property tests (extend `tests/proptests.rs`):**
  - Extend `format_never_panics_*` to iterate over a set of locales **including one with non-ASCII AM/PM designators and non-ASCII currency symbol**.
  - New invariant: for any value/section with `dec_places`, the produced fractional digit run length equals the placeholder count and never overflows (pins Step 3).
  - New invariant: compiled-path output `==` string-path output for the proptest code/value matrix (pins Step 6 parity).
  - New invariant: scientific mantissa satisfies `1 ≤ |m| < 10` after rendering (pins Step 1).
- **Consumer smoke (read-only awareness):** confirm no signature break for `format_value` / `format_values_batch` so engine call sites (`render_cells.rs`, `materialized_cells.rs`, `autofit.rs`, `display_text.rs`, `displayed.rs`, `format_io.rs`) compile unchanged; the compiled-format type is additive.

## Risks, edge cases, and non-goals

- **Behavior-visible blast radius.** Output flows into snapshots, autofit pixel widths, and `TEXT()` results. Mitigation: regression-first ordering, golden review of any intentional output change, and landing Step 7 (currency) last and separately.
- **Excel-parity judgment calls.** Repeat-fill in a width-less context, fractional-second rounding at boundaries, and currency placement each have a single Excel-correct answer that must be confirmed against reference behavior, not guessed. Each is isolated in its own step so it can be reverted independently.
- **Double-rounding subtleties.** Step 3 must not *change* correctly-rounded values; it only guards the carry overflow. Property test is the guard.
- **`CultureInfo` wire compatibility.** Any new locale-driven currency behavior must rely on existing `currency_*` fields (already present and `serde(default)`); do **not** add fields without a matching TS contract update (cross-folder, flagged below).
- **`unreachable!()` in `select_section`** (number.rs:41) assumes ≥1 section; `parse_format_code` always yields ≥1 (final `sections.push`), so this holds — do not relax the parser invariant.
- **Non-goals:** no rewrite of the tokenizer architecture; no change to `value-types` rounding/serial math; no new format *categories* beyond fractional seconds; no removal of existing public functions; no reduced-scope shims or compatibility hacks; no edits to consumers in this plan (they are follow-ups enabled by Step 6).

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable steps:** Steps 1, 2, 3, 4, 5, and 8 touch disjoint code paths (`format_scientific`, `format_datetime` AM/PM, `format_numeric` decimal split, the shared sign helper, repeat-fill emission, fractional-second tokenization) and can be implemented and reviewed concurrently.
- **Serialized:** Step 6 (compiled-format) should refactor *after* Steps 1-5/8 land so parity tests compare against the corrected output, not the buggy one. Step 7 (currency) lands last and alone due to blast radius.
- **Cross-folder dependencies (follow-ups, not part of this file's edits):**
  - `value-types`: no change required, but Step 1/3 rely on `excel_round_to_decimal_places` semantics; if a rounding edge case is traced there, that fix belongs in `value-types`, not here.
  - Engine consumers (`mog/compute/core/src/storage/engine/**`) can adopt `CompiledFormat` caching per column/style to realize the Step 6 throughput win — a separate, additive change.
  - `compute-functions` `text/conversion/{text_format,number_format}.rs` consume `format_dollar`/`format_fixed`; the Step 7 locale-aware variants require a coordinated (additive) update there.
  - Bridge/TS `CultureInfo`: only if Step 7 introduces a new locale field (avoided by reusing existing `currency_*` fields).

## Status

Actionable. The folder exists with sufficient evidence; all findings above were confirmed by reading the current source. No blockers.
