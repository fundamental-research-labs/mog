Rating: 8/10

# Review of Plan 035: compute-formats Production Format Contract

## Summary judgment

This is a strong, unusually well-grounded plan. I verified its central factual claims directly against the source and they are accurate, not hand-waved:

- The public facade in `api.rs` matches the plan exactly: `format_value`, `format_number_result`, `format_number_with_locale`, `format_values_batch`, the value-type dispatch in `format_value` (Number/Text/Boolean/Error/Null/Array/Control/Image), and the text-section rules in `format_text`.
- The "loose metadata" parser claim is real: `types.rs` exposes a flat `Token` enum where `Condition(String)` carries an unparsed string, and `number.rs::evaluate_condition` re-parses that string (`strip_prefix(">=")`, etc.) on every render — exactly the "reparsing strings on every render" weakness the plan targets (objective 2, step 2).
- `detection.rs` is genuinely heuristic: `strip_escapes_quotes_brackets` followed by `cleaned.contains('%')`, `.contains('d')`, `.contains('h')` — the false-classification surface the plan wants to move onto the typed IR (step 3) is accurately described.
- The duplicate-parser problem is real: `compute/core/src/storage/cells/values/parsing.rs:538` calls `compute_formats::parse_date_input` and then owns its own ordered parsing pipeline (date/formatted-number/fraction/boolean), and `format_inference.rs` even documents that storage parsing is *stricter* than `parse_date_input`. This is the strongest part of the plan's diagnosis.
- The production display path (`format_value_at_cell` in `storage/engine/formatting/display_text.rs`), the ~10-culture registry (`locale/data.rs`), and the named verification gates (`compute/core/tests/formula_accuracy_text_format.rs`, `compute-formats/tests/{numeric,date_time,detection}_first_principles.rs`, proptests) all exist as cited.

That level of evidence-grounding is what separates this from a generic refactor wishlist. The contract/invariants section is the best part of the document and would survive into implementation almost verbatim.

The main reason this is an 8 and not a 9–10: the plan is closer to a *program charter* than a single landable implementation plan. It is broad, defers several key contract decisions, and proposes no concrete type signatures or golden values, so a downstream worker still has substantial design work before writing code.

## Major strengths

1. **Accurate problem diagnosis with named entry points.** The plan names the exact production callers (`format_value_at_cell`, `format_values_batch`, `TEXT`/`DOLLAR`/`FIXED`, the `compute_prepare_*`/`compute_detect_format_type`/`compute_parse_date_input` bridges) and the precise divergence site (`storage/cells/values/parsing.rs`). All verified present.

2. **Excellent invariant catalogue.** The "Production-path contracts and invariants" section is precise and testable: batch == individual formatting (order and length), `format_number_result` text-equality with `format_number_with_locale` plus color metadata, Excel section-selection rules (1/2/3/4 sections + conditions with fallback), no double-signing of negatives, serial 0 / serial 60 / date1904-at-the-boundary, and `m`/`mm` context resolution. These map cleanly to the code as it exists.

3. **Honest scope discipline on non-goals.** Explicitly refuses CLDR-scale locale expansion, test-only parsers, microbenchmark optimization without production evidence, and changes to date1904 storage semantics. This keeps the blast radius defensible.

4. **Risk awareness is real, not boilerplate.** It correctly flags the two highest-risk traps: parse caching that accidentally captures locale-dependent *output* instead of culture-agnostic parsed structure, and `m`/`mm` regression when the IR gets stricter. Both are exactly where this kind of refactor breaks.

5. **Verification gates point at real targets.** The cited cargo test targets and the first-principles/proptest suites exist, so the gates are runnable rather than aspirational.

## Major gaps or risks

1. **Charter-scale scope presented as one plan.** Objectives 1–10 each represent multiple PRs (full parser IR rewrite, detection rewrite, numeric render rework, datetime rework, storage parser migration + deletion, locale audit, builder alignment, perf cache). The parallelization section helps, but there is no minimal first slice or "land order" beyond "contract matrix first." A reviewer cannot tell what the smallest shippable unit is.

2. **No concrete contract surfaces.** Objective 6 says "Add public parse APIs for date/time, formatted number, percent, currency, scientific, fractions with a single `CultureInfo` and explicit parse options" but gives no signatures, no `ParseOptions` shape, and no return type for the "policy outputs" that storage needs. Likewise objective 2 proposes a "complete typed IR" with no struct sketch. Given the plan's own emphasis on contract stability for WASM/N-API/PyO3, the absence of proposed type shapes is the biggest contract-clarity gap.

3. **Deferred decisions masquerading as plan steps.** Several steps say "decide whether" rather than deciding: culture-tag lookup staying exact-case+en-US fallback vs. case-insensitive IETF normalization (step 7), whether `Special` (ZIP/phone/SSN) is implemented or left detection-only (step 8). These are real contract forks the plan should resolve, because each changes the bridge surface and test matrix.

4. **Migration safety is under-specified at the riskiest step.** Step 6 says migrate `parsing.rs` and "delete its local date and formatted-number parsers after equivalent tests pass," but never defines the equivalence baseline. Since `format_inference.rs` documents that storage parsing is deliberately *stricter* than `parse_date_input`, a naive migration will regress. The plan should require characterization/snapshot tests capturing the *current* storage parser behavior before any deletion, and should call out the known strictness gap as an explicit reconciliation item rather than an afterthought.

5. **Acceptance criteria are templates, not values.** "render examples for positive/negative/zero/text" and "locale variants" describe the *shape* of the matrix but commit to zero concrete expected strings. For a format engine this is the cheapest place to add rigor (e.g., `format_number(-1234.0, "#,##0;[Red](#,##0)") == "(1,234)"` with `color == Red`, which the crate already asserts in its doctest). Without anchor values the "contract matrix" is a promise, not a spec.

## Contract and verification assessment

- **Contract clarity (public API):** Mixed. The *behavioral* contract (selection rules, signing, serial semantics, batch equality) is excellent. The *type* contract for the new parse APIs and the new IR is missing, which matters more here than usual because the plan explicitly commits to keeping DTOs serializable across four bridge backends. A worker cannot implement step 6 without inventing the signatures the plan should have pinned.
- **Verification gates:** Strong and real. The named cargo targets and proptest/first-principles suites exist. The gate ladder (crate → text-format accuracy → storage filter → full compute-core, plus bridge/UI gates "when touched") is appropriately staged. One weakness: the gates verify *no panics / determinism / batch-equals-individual* well, but there is no gate that pins the pre-migration storage-parser behavior, which is precisely where regressions will hide.
- **Sequencing:** Reasonable but coarse. "Contract matrix first, then parallelize" is correct in spirit, but the destructive step (delete storage parsers) has no explicit dependency gate beyond "tests pass," and the perf cache is correctly deferred to last.

## Concrete changes that would raise the rating

1. **Pin the new public surfaces.** Add proposed signatures and `serde`-stable type sketches for the parse APIs (date/time, formatted-number, percent, currency, scientific, fraction) and the new typed IR sections (color/condition/currency/text/numeric/datetime groups). Even rough Rust signatures would convert step 6 from a goal into a contract. (+1)

2. **Define a minimal first slice and explicit land order.** e.g. "Slice 1: parsed-condition IR + detection-from-IR behind unchanged public API, no storage migration." This makes the plan landable incrementally instead of as a multi-month program. (helps scope)

3. **Resolve the deferred forks.** State the chosen culture-lookup policy and whether `Special` rendering is in scope, with the resulting bridge/test implications, rather than leaving "decide whether." (+0.5)

4. **Make the migration safe by contract.** Require a characterization-test baseline of the *current* `parsing.rs` behavior (including its deliberate extra strictness over `parse_date_input`) as a precondition for deleting any local parser, and add a gate that diffs old-vs-new parse outcomes across the input matrix. (+0.5)

5. **Anchor the matrix with real expected values.** Replace "render examples" with a seed table of concrete `(value, code, locale) -> string [+color]` assertions, reusing the existing doctest/first-principles values as the starting set. (+0.5)

With concrete API/IR signatures and a defined migration baseline, this is a 9. As written, the diagnosis and invariants are excellent but a downstream implementer still owns the hardest contract decisions, which keeps it at 8.
