Rating: 8/10

# Review: 054 — File IO XLSX Parser Source Improvement Plan

## Summary judgment

This is a strong, unusually well-grounded plan. I verified its central factual claims directly against the source tree and every one held up: the facade publicly reexports `parse_xlsx_full_native`, `FullParseResult`, `FullParsedSheet`, and `FullCellData` while a comment claims the native entrypoint is "now crate-private" (`src/lib.rs:98-119`); `pipeline/full_parse/implementation.rs` is genuinely monolithic at 2065 lines; the sidecar storage audit exists as prose at `tests/roundtrip_parse_output/parse_result_sidecar_storage_audit.md`; `src/bin/xlsx_gate.rs` returns `not_implemented_report` for the declared corpus gates; and `xlsx-api` validates parse options but rejects most with `UnsupportedOption` rather than enforcing them in the parser (`xlsx-api/src/options.rs`, `parse.rs:62-64`). The package graph, OPC inventory, package integrity, and preflight modules all exist as described. The gate package name (`@mog/xlsx-parser-wasm`) and script surface match `package.json`.

The plan correctly identifies the highest-leverage truth about this folder: it is not "a parser" but the trust boundary where external OOXML becomes Mog-owned domain state and back. The contracts/invariants section is the best part — it names the real failure modes (calcChain must never be exported, SST/relationship IDs are provenance not authority, position-keyed `ParseOutput`, fail-closed active content) with precision that reflects genuine domain understanding rather than generic spreadsheet boilerplate.

The reason this is an 8 and not higher: it is less an executable plan than a multi-quarter program. Thirteen implementation sections and nine parallel agent lanes, several of which (feature matrix, corpus gates, full contract fixture expansion) are each large projects on their own. The sequencing mitigates this, but a reviewer cannot tell where "improvement" ends and "rewrite the subsystem" begins, and a few verification thresholds are left unquantified.

## Major strengths

- **Evidence-based, not speculative.** The inspected-files list maps to real paths, and the diagnosis of each problem (accidental public surface, monolith, declared-but-unimplemented gates, options validated-not-enforced) is independently confirmable. This is rare and valuable.
- **Invariants are first-class.** Section "Production-path contracts and invariants" is essentially the acceptance specification. It anchors every later lane to a preservation rule, which is exactly how you keep a large refactor honest.
- **Strong sequencing discipline.** "Stage contract before options/perf/parallel; sidecar policy + feature matrix before writer currentness; package graph before new feature writers; preflight depends on graph + sidecar policy" is correct dependency ordering and explicitly stated.
- **Anti-cheat framing.** The corpus-anti-cheat gate (import→export with context vs context-stripped, compare modeled facts) and the repeated "no raw source-byte replay" rule directly target the most likely way an agent would fake roundtrip fidelity. This is the plan's sharpest insight.
- **Verification routes through production entrypoints.** Gates are required to call `parse_xlsx_to_output` / `write_xlsx_from_parse_output_with_report` / `validate_package_graph_bytes`, not parser internals — closing the usual "unit tests pass, product broken" gap.

## Major gaps or risks

- **Scope vs. "plan."** As written this is a program, not a single landing. There is no MVP slice or explicit "minimum to call section N done." Lanes D (feature matrix across ~30 `domain/*` features), H (full contract fixture matrix × Strict/Transitional), and G (four corpus gates) could each consume more effort than the rest combined. Without a per-lane definition-of-done, an agent cannot bound its work.
- **Unquantified performance gates.** Section 11 and the perf gates inherit budgets from `testing/budgets/perf-smoke.json` etc., but the plan states no current baseline numbers and no regression thresholds (the crate's own target is "500K cells <50ms" per `lib.rs`). "Optimize real bottlenecks" and "preserve and improve" are unmeasurable as stated.
- **Corpus availability is assumed.** The whole corpus-gate edifice depends on a curated real-file corpus existing and being licensable/checkable-in. The plan never confirms what corpus exists today or where curated fixtures live; if there is none, lanes G and I are blocked on an unscoped prerequisite.
- **Behavior-preservation claim for the monolith split is asserted, not protected.** "The first implementation can move code without changing behavior" needs a golden-output harness in place *before* the split to be credible. The plan lists this under tests but doesn't make a pre-refactor snapshot a hard gate for section 3.
- **Cross-crate blast radius is acknowledged but not bounded.** Enforcing real parse options and changing `ParseOutput` fidelity fields ripple into `xlsx-api`, `compute-core` import/export, and `domain-types`. The plan says "migrate together" but doesn't enumerate the concrete caller sites or estimate the churn, so the coordination cost is invisible.
- **`ParseOutput`/`domain-types` is treated as a fixed contract while several lanes (feature matrix "owner-scoped typed container fields", typed control/OLE owners) clearly imply new `domain-types` fields.** The plan flags the dependency but doesn't reconcile "do not allocate identity in parser" + "add typed owners" with who designs those new domain types and where.

## Contract and verification assessment

Contract clarity is the plan's strongest dimension. The data-flow diagram, the single-writer/single-parser-entrypoint rules, and the per-feature "one declared owner + invalidation rule" requirement are concrete enough to test. The sidecar policy (section 5) converting a prose audit into an executable manifest that *fails when new parser-only fields appear without a policy* is exactly the right mechanism to prevent silent stale-replay regressions.

Verification gates are comprehensive and largely correct: the required `cargo test`/`clippy` matrix across features (`cli`, `native`, `parallel`), plus `xlsx-api`, `compute-core` construction/import/export, `domain-types`, and the wasm gate scripts. The insistence that unit tests "are not sufficient on their own" and that bytes must traverse import→convert→export→graph-validate→re-import is the right bar.

Two weaknesses: (1) gates are listed but not tied to per-section exit criteria — there's no "section 4 is done when these specific option tests pass and the `UnsupportedOption` rejection is removed for X options"; (2) the perf gates lack pass/fail numbers, so they verify "it runs" not "it didn't regress." The anti-cheat gate partially compensates by making fidelity-faking detectable, which is why verification still rates well overall.

## Concrete changes that would raise the rating

1. **Add a thin first slice / DoD per section.** For each numbered lane, state the minimum landing and its exit gate (e.g., section 1: "facade tiering compiles, doctest asserts exports match docs, no caller outside tests references full-parse DTOs"). This converts a program into a sequence of verifiable plans.
2. **Quantify perf.** Capture current baseline timings for `parse_xlsx_to_output`/`write_xlsx_from_parse_output` on named fixtures and state explicit regression thresholds in the budget files referenced by the gates. Tie the existing "500K cells <50ms" target in.
3. **Confirm or scope the corpus prerequisite.** State what real-file corpus exists today, where it lives, and the licensing/check-in policy. If none exists, make "establish corpus" an explicit blocking task ahead of lanes G/I.
4. **Make a golden-output snapshot a hard precondition for the monolith split (section 3).** Require a behavior-equivalence harness to be green before and after the refactor, so "no behavior change" is enforced rather than asserted.
5. **Enumerate the `ParseOutput`/`domain-types` field additions implied by lanes D and F**, name their owner crate, and reconcile them with the "parser allocates no identity" invariant — ideally a short table of new typed owners and which crate defines them.
6. **List the concrete `xlsx-api` / `compute-core` caller sites affected by option enforcement and fidelity changes** so the "migrate together" coordination cost is sized, not just named.
7. **Trim or phase the feature-matrix and fixture-matrix lanes (D, H).** Either bound them to a prioritized feature subset for the first pass or explicitly split them into per-feature follow-up plans, so the matrix work doesn't silently dominate the effort.

## Verification note

The only file created by this review is `mog-internal/plans/active/experiments/plan-ratings/claude-code-review-of-codex-plans/054-file-io-xlsx-parser-src.md`. All source/plan inspection was read-only; no production code, tests, fixtures, configs, or the reviewed plan were modified.
