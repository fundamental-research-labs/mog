Rating: 9/10

# Review of plan 035 — `compute-formats/src` (number / date / locale format engine)

## Summary judgment

This is a near-exemplary improvement plan. Its defining strength is evidentiary discipline: every one of the ten "Evidence (observed in the current tree)" findings was checked against the live source during this review and **all ten are accurate**, down to the cited line numbers and the "no production caller" / "only two sites" reachability claims. The plan correctly identifies the crate's role as the single hot-path authority for cell display, scopes its edits to `src`, names couplings without overreaching into them, and orders the work so behavior-visible / high-blast-radius changes land last. The contracts-to-preserve section and verification gates are concrete and enforceable. The deductions are minor: Step 7 leaves a genuine design decision unresolved (by design, but it widens "what will be built"), one evidence item has no corresponding step, and a few low-level type details and Excel-parity assertions are asserted rather than nailed down.

## Verification performed

I confirmed the load-bearing evidence directly in `mog/compute/core/crates/compute-formats/src`:

- **#1 RepeatFill dropped** — `rg "RepeatFill"` returns exactly `types.rs:29` (def) and `parser.rs:175` (emit); no consumer. ✓
- **#2 scientific mantissa not re-normalized** — `general.rs:120` has the `>= 10.0` re-normalize guard; `number.rs:459-484` (`format_scientific`) rounds via `excel_round_to_decimal_places` then formats `{rounded:.dec_places$}` with no guard. ✓
- **#3 byte slice** — `datetime.rs:191` `result.push_str(&ampm_str[..1])`, designator is a locale-overridable `String`. ✓
- **#4 fractional seconds** — `datetime.rs:14` `(time_frac * 86400.0).round() as u64`; `parser.rs:438-446` rewrites `DecimalPoint → Literal(".")` in datetime sections. ✓
- **#5 no compiled reuse** — `api.rs:82` and `:180` call `parse_format_code` per call; `format_values_batch` (`api.rs:229-234`) is a bare `.map(format_value)` with no dedupe/caching. ✓
- **#6 currency dead path** — `apply_currency_pattern` and friends appear only in `currency.rs` (def + `#[cfg(test)]`) and the `lib.rs:134` re-export; no production caller. ✓
- **#8 decimal carry** — `number.rs:170-171` derive `int_val` from `val.trunc()` and `frac_val` independently via `.round() as u64`; no carry propagation. ✓
- **#9 duplicated rule** — `number.rs:193` and `fraction.rs:118` both hard-code `section_count <= 1`. ✓
- **`unreachable!()`** in `select_section` is at `number.rs:41`, as cited. ✓

This level of corroboration is unusual and materially raises confidence that the plan is buildable as written.

## Major strengths

- **Accurate, falsifiable evidence.** Findings are stated as "confirmed by reading the source, not inferred," and they hold up. This is the single biggest quality signal.
- **Correct architectural fit.** The plan respects crate boundaries: rounding/serial math stays in `value-types`, consumer adoption of `CompiledFormat` is explicitly deferred to follow-ups, and the public re-export surface (`lib.rs:119-146`) is treated as a contract with additive-only changes.
- **Sequencing matches risk.** Low-risk localized correctness fixes (Steps 1–5, 8) first; the additive perf path (Step 6) after them so parity tests compare against corrected output; the behavior-visible currency change (Step 7) last and alone. The parallelization note (disjoint code paths for 1/2/3/4/5/8) is correct.
- **Verification gates are real.** Names the actual gates: `cargo build/test/clippy --all-targets -- -D warnings` (the crate is pedantic), `cargo fmt --check`, and crucially `cargo test --doc` (rustdoc examples are executable contract). Regression-first framing ("all passing assertions keep passing; changed assertions called out in review") is exactly right for a golden-output engine.
- **Property tests target the right invariants.** Mantissa `1 ≤ |m| < 10`, fractional digit-run length, compiled-vs-string parity, and no-panic across non-ASCII locales each pin a specific step. The parity proptest (Step 6) is the correct mechanism to guarantee the refactor is output-identical.
- **Honest about judgment calls.** The Risks section explicitly flags that repeat-fill width-less behavior, fractional-second rounding boundaries, and currency placement each "have a single Excel-correct answer that must be confirmed against reference behavior, not guessed."

## Major gaps or risks

- **Step 7 defers a real decision.** "Either integrate `apply_currency_pattern` … or document the caller-driven design" leaves the largest, most behavior-visible step under-specified. The plan recommends integration, but a reviewer cannot fully assess scope/blast-radius until the choice is fixed. Integration also raises an unaddressed question: how is the locale `[$SYM-locale]` literal-origin detected at the point `format_numeric` has only tokens? The plan should specify the detection signal (e.g. a token/section flag set during parse) rather than leaving it implied.
- **Evidence #10 (substring date detection) has no step.** It is raised as a finding then effectively dropped ("defensive … can misclassify exotic codes"). Either fold it into scope or move it out of the evidence list into an explicit "noted, not actioned" bucket; as written it reads as an unaddressed item.
- **`CompiledFormat` type details are thin.** "newtype wrapping `FormatCode`" assumes `FormatCode` is cheaply `Clone`/owned and that `format_value(&self, &CellValue, &CultureInfo)` can be carved out of the current string-entry flow without behavioral drift. The plan asserts byte-identical output (good) but does not note whether `FormatColor`/section metadata are fully owned in `FormatCode` or whether lifetimes leak — a small but real implementation hazard worth a sentence.
- **#8 may be a non-bug.** The plan itself notes "the prior Excel-round normally prevents the boundary," so Step 3 is hardening an invariant rather than fixing an observed wrong output. That is fine and worth doing, but it should be labeled as defensive/invariant-pinning (not a live correctness fix) so reviewers don't expect a changed golden assertion.
- **Repeat-fill parity claim is uncited.** "Excel's `TEXT()` emits zero copies of the fill char" is the crux of Step 5's correctness and is stated without reference. The plan flags it as a judgment call, but since the entire fix hinges on it, a concrete reference behavior (or an explicit "confirm before landing") would de-risk it.

## Contract and verification assessment

Strong. The plan enumerates the binding contracts precisely: panic-freedom floor (`format_never_panics_fuzz`), `General` semantics, Excel serial conventions, `CultureInfo` 1:1 TS wire-compat with `serde(default, camelCase)`, `DateValueResult`/`ParsedDateInput` additive-only serde shape, and the additive public re-export surface. The "do not relax the parser ≥1-section invariant" note correctly protects `number.rs:41`'s `unreachable!()`. The cross-folder discipline is good — it commits to reusing existing `currency_*` fields and explicitly avoids adding a `CultureInfo` field that would require a coordinated TS bridge change. Verification gates are specific, runnable, and matched to the failure modes (parity proptest for the refactor, invariant proptests for the carry/mantissa fixes, locale-extended fuzz for the panic fix). The one weak spot is that Step 7's verification ("gate behind golden-test review") is necessarily vaguer than the others because the step itself is under-decided.

## Concrete changes that would raise the rating

1. **Decide Step 7 now.** Commit to integration-vs-document, and if integrating, specify the exact signal that marks a section's symbol as `[$SYM-locale]`-originating (a parse-time flag on `FormatSection`), plus the precise `convenience.rs` signature change (`&CultureInfo` param vs new `_with_locale` variants) and the coordinated `compute-functions` update shape.
2. **Resolve evidence #10 explicitly** — either add a step to tighten `is_date_format`/seconds heuristics or relocate it to a "noted, out of scope" list so the evidence/step mapping is 1:1.
3. **Label Step 3 as invariant-hardening**, not a live-output fix, and state the expected test outcome (no golden changes; only the new `frac_val < factor` proptest and `debug_assert!`).
4. **Add one sentence on `CompiledFormat` ownership** — confirm `FormatCode` is fully owned/`Clone` so the newtype carries no borrows, and note that `FormatResult` (color + text) parity is included in the Step 6 parity proptest.
5. **Anchor the two parity claims** (repeat-fill = zero copies in width-less `TEXT()`; fractional-second rounding at `.999`) to a named reference check before landing, since both Steps 5 and 8 are correctness-defining.
