Rating: 8/10

# Review of Plan 038 — Harden `compute-security/src`

## Summary judgment

This is a strong, unusually evidence-grounded plan. Nearly every problem it raises was checkable against the actual source, and every one I checked is real and accurately located:

- `tag_match.rs:30-36` — only `"*"` → `Wildcard`, `ends_with('*')` → `PrefixGlob`, everything else → `Exact`. So `agent:*:reader`, `*:admin`, `a*b`, and `""` all become literal `Exact` matchers that match nothing. Confirmed; the fail-open security framing is correct.
- `filters.rs::filter_range_values` — `len = values.len().min(expected)` then `.take(len)`; trailing `values.len() - expected` elements are never visited and pass through un-redacted. Confirmed.
- `engine.rs:143-175` — the per-column loop calls `filter_candidates` (full O(P) scan) and `resolve` (`to_vec` + `sort_by`) for each touched column. Confirmed O(k·P·log P).
- `principal.rs:183-188` — `identity()` is `Arc::as_ptr(...) as usize` with the documented Weak-ref address-reuse window and `tags_arc()` pin. Confirmed.
- `filters.rs` — `impl<T: RedactMaybe, E> RedactMaybe for Result<T, E>` redacts only `Ok`. Confirmed (note: the bound is `E` unconstrained, not `E: RedactMaybe` as the plan's Step 3 implies the current code requires — minor).
- `engine.rs:191-228` — `explain` re-sorts (`sorted_refs`) and re-runs `resolve`, then re-derives the `NoTags` reason that `evaluate` never applies. Confirmed.
- `Cargo.toml` has `arc-swap = "1"`; `rg` in `src/` finds only doc-comment mentions. Confirmed dead dependency.
- `matrix.rs:65` `get(_row, col)` ignores `row`; `templates.rs:20-27` define the bands but nothing in `policy.rs`/`engine.rs` validates `priority` against provenance. Confirmed.

The plan also correctly identifies the load-bearing contracts (camelCase wire keys, `AccessLevel` `#[repr(u8)]` discriminants, SG-1/2/3 + §4.1 step-5 semantics, non-`Serialize` `Principal`, the no-blanket-`RedactMaybe` compile-time guarantee, the `ColumnIndex` boundary) and ties each to the test/bench/e2e asset that pins it. The verification section is genuinely rigorous: a differential property test gating the perf rewrite, a resolution-equivalence test for explain↔evaluate, wire-shape regressions held green, and the `security_e2e` adversarial suite as the semantic net. This is the kind of plan that an engineer could execute without re-discovering the problem space.

## Major strengths

- **Accuracy and traceability.** Claims carry file:line citations that hold up. The fail-open bugs (#1, #2, #6) are the highest-value findings — they are silent security regressions, not loud failures, exactly as characterized.
- **Contract discipline.** "Additive only," wire shapes preserved exactly, validation applied at the *mutation* boundary rather than the *load* path (so existing bad documents don't hard-fail) — this is the correct migration posture and is called out explicitly under Risks.
- **Verification gates are real gates, not aspirations.** The Step-4 differential test ("byte-identical `SheetAccessMatrix`") and the explain-equivalence test are the right shape, and the plan says "do not ship without it."
- **Honest scoping.** Non-goals (row/cell overrides, bitpacking, lattice changes, regex matcher) are explicit, and the cross-crate enforcement wiring is flagged as out-of-scope follow-up rather than silently assumed.

## Major gaps or risks

1. **Step 4's algorithm sketch is subtly under-specified and risks a semantics regression.** `filter_candidates` for a `Column` query includes *broader-scope* policies — `target_applies` returns true for `Workbook` and same-sheet `Sheet` policies against a column target (`engine.rs:250-267`). The plan's Step 4(b) describes grouping "column-targeted, tag-matching, enabled policies by resolved position" and resolving over each group. As written, that group would **drop the inherited workbook/sheet policies** that currently participate in each column's resolution, changing results. The differential test would catch this, but the plan presents the grouping as the fix without naming the inheritance subtlety — an implementer following the prose literally could ship the regression and only discover it via the gate. The step should explicitly state that each column's candidate set is `{column policies at this position} ∪ {applicable sheet/workbook policies}` and that the optimization is "compute the broader-scope candidates once, then extend per touched column," not "group only column-targeted policies."

2. **Step 5's stated invariant is not achievable as written.** "`PrincipalIdentity` equality implies tag-set equality" cannot be guaranteed by a 64-bit content hash — a hash makes aliasing astronomically unlikely but still *probabilistic*, whereas the current pointer is exact-within-lifetime. To make equality *imply* tag-set equality you must either keep the `Arc` (compare slabs) or fall back to a tag comparison on hash match. The plan should either weaken the claim to "collision-resistant" or specify the tie-break-on-collision so the invariant is sound rather than overstated.

3. **Step 1's contract is internally muddled.** The paragraph redefining `parse` is tangled ("fall back to a definitively non-matching but loud classification is *not* acceptable") and asks `parse` to "emit a one-time structured warning (via a returned diagnostic, not a log)" — but `parse(&str) -> Self` returns `Self`, so there is no channel for a diagnostic without a signature change the plan doesn't specify. As written the observability mechanism for already-persisted interior-`*` policies is unspecified. This needs a concrete shape (e.g. `parse` stays `-> Self` and a separate `TagMatcher::diagnose(&str) -> Option<TagPatternError>` is what the store/load audit calls).

4. **The headline security fixes don't ship enforced within this plan's scope.** Steps 1 and 6 add validating *constructors* but the actual enforcement lives at the `compute-document` mutation boundary, deferred to Step 9 "by their owners" with no sequencing commitment. So the tag-pattern and priority-band hardening land as dormant API until unscheduled neighbour-crate work adopts them. The plan is honest about this, but the practical consequence — the fail-open footguns #1 and #5 remain exploitable until follow-up lands — deserves to be stated as a risk, not just a coordination note.

5. **Performance claims are asserted, not measured.** "Can blow that budget" / "realistic enterprise configuration" is plausible but unquantified; the current bench is 100 policies < 50 µs and there's no datapoint showing today's code exceeds budget at higher column counts. Adding the 500-column bench point (the plan does this) is the right move, but the plan should frame Step 4 as "verify the regime exists, then fix" rather than presupposing it.

## Contract and verification assessment

Contracts are the plan's strongest dimension. The preserve/strengthen split is precise and the new invariants are each paired with a test. Gaps: (a) the differential test asserts "byte-identical" matrices but doesn't call out the broader-scope-inheritance equivalence class that risk #1 threatens — it should explicitly seed corpora with workbook/sheet policies that shadow columns; (b) Step 3's `Result` audit ("audit existing engine return types that are `Result<_, E>`") should name the concrete `E` types discovered, otherwise the completeness guarantee is asserted rather than demonstrated — the plan currently leaves "may not exercise this" open; (c) the new `SecurityError` variants (Step 7) crossing the bridge get a serde round-trip test, which is correct, but the SDK re-hydration mapping in `compute/api/src/error.rs` is the part most likely to silently drop a variant and is only mentioned, not gated.

## Concrete changes that would raise the rating

1. **Step 4:** state the per-column candidate set explicitly as column-position policies *unioned with* applicable workbook/sheet policies; describe the optimization as "hoist broader-scope candidates once, extend per touched column," and have the differential test deliberately include shadowing workbook/sheet policies.
2. **Step 5:** make the identity invariant sound — either "hash + slab compare on collision" or downgrade the claim to collision-resistant and document the residual probability; spell out what `__test_from_raw` forges for the discriminator.
3. **Step 1:** replace the tangled `parse` paragraph with a concrete two-function contract (`parse -> Self` for the load path; a separate fallible/diagnostic function for the mutation/audit path) so the observability path for legacy bad policies is defined.
4. **Sequencing:** commit Step 9 to a follow-up plan ID (or fold the enforcement wiring into scope) and state plainly that #1/#5 remain unenforced until it lands.
5. **Step 3:** enumerate the actual `E` error types in the gated-read corpus and assign each a `redact`/`redact_noop!` impl, turning the audit from prose into a checklist the compiler verifies.
6. **Benches:** add the "current code at 500 column policies vs. §12 budget" measurement as the *justification* datapoint, not only the post-fix target.
