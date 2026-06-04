Rating: 8/10

# Review of 038 — Compute Security Source Improvement Plan

Reviewer: Codex review worker 38 of 100
Plan under review: `mog-internal/plans/active/experiments/plan-ratings/codex-plans/038-compute-core-crates-compute-security-src.md`
Target folder: `mog/compute/core/crates/compute-security/src` (public)

## Summary judgment

This is one of the strongest plans I have reviewed in this batch. It is grounded in the actual code, not a plausible-sounding hallucination: every load-bearing claim I spot-checked against the source is correct, and the security gaps it identifies are real and consequential. The plan correctly understands that `compute-security` is a pure domain crate whose value comes from the contracts it exports to the bridge/storage layers, so it targets the production enforcement path rather than padding unit-test counts. The architectural fit is excellent — it explicitly preserves the crate's purity boundary, the `AccessLevel` ordering, fail-closed defaults, owner-lockout floor, and the `PrincipalIdentity` interning invariant.

The reasons it is not a 9–10 are scope and a handful of deferred contract decisions, not accuracy. As written this is a multi-agent, multi-week program (12 work items, 6 parallel agents across 5+ crates) packaged as a single plan, and its two highest-risk items — screenshot/render redaction strategy and making non-fallible workbook reads deny correctly — are flagged but left undecided. Those are exactly the decisions that should be nailed down before implementation starts, because they drive public signature changes and SDK churn.

## Verification of claims against source

I confirmed the plan's central factual assertions:

- `filters.rs` — `filter_range_values<T: RedactMaybe>` is genuinely generic over the read return type, and `Vec<u8>` is silently covered by the generic `Vec<T>` impl via the numeric `u8` impl (`filters.rs:176`, `190`). The "one element = one cell, row-major" assumption is real and is not a security contract for `Vec<Vec<CellValue>>` or byte buffers.
- `bridge-delegate/macros/src/expand/gated.rs:62,74` — the macro literally selects the range filter with `is_vec_any = return_ty_str.starts_with("Vec<")` and routes any `Vec<...>` range read through `filter_range_values`. The plan's critique of this dispatch is precisely correct.
- `principal.rs` — `Principal::from_tags` does **not** sort/dedup (`principal.rs:144`), whereas `PrincipalPool::intern`/`SortedTagList::from_unsorted` do (`principal.rs:47`, `239`). The canonicalization-divergence claim is accurate.
- `templates.rs:141-154` — `standalone_current_millis()` returns `0` on `wasm32`, so `Template::generate()` on browser paths stamps `createdAt = 0`. The host-owned-context concern is real, and `generate_with_context` already exists, making this a low-risk migration.
- `filters.rs:265` — `domain_types::Comment` is a `redact_noop`, so user-authored comment text is not redacted at this layer. Correctly flagged for product classification.
- `coverage_audit.rs:426` — unclassified cell-scope reads are emitted as `eprintln!("... manual review — not a hard fail")`, confirming the audit is advisory, not a gate. The plan's "fail on unclassified surface area" demand is well-founded.
- `engine.rs:154` — column policies whose `ColId` no longer resolves are silently skipped, matching the stale-target diagnostic gap in step 7. Note this is fail-closed (correct), so the item is a diagnostics improvement, not a security fix.

This level of fidelity is rare and materially raises my confidence in the plan.

## Major strengths

- **Real security findings, not cosmetics.** The generic-range-filter shape confusion is the standout: applying per-cell scalar redaction to `Vec<u8>` PNG/screenshot/viewport buffers can both corrupt output and fail to deny correctly. This is a genuine correctness-and-leakage issue on the production bridge path.
- **Invariant-preservation discipline.** The "contracts and invariants to preserve or strengthen" section is explicit about what must NOT change (level ordering, fail-closed defaults, disabled policies never match, target/tag/priority resolution order, owner-lockout floor, non-spoofable `mog:non-owner`). It repeatedly insists on differential tests before replacing the scan-based resolver — exactly right for a security core.
- **Compile-time-enforced classification.** Extending the existing "no blanket `RedactMaybe` impl" philosophy to a `RedactRangePayload` trait plus a hard audit gate is the correct direction and is consistent with how the crate already prevents silent passthrough.
- **Sequencing and parallelization.** Agents A–F with stated dependencies (validation/normalization first, indexed resolver and bridge changes after) is coherent and respects the real cross-crate fan-out (`security_state.rs`, `engine/security.rs`, `security_ops.rs`, `bridge_service.rs`, `bridge-delegate`, `compute-wire`, `security_store.rs`).
- **Verification gates are concrete and per-crate.** `cargo test`/`clippy` across `compute-security`, `compute-api`, `compute-core`, `bridge-delegate`, `compute-wire`, plus a demand for E2E that calls real `ComputeService`/bridge methods rather than test-only helpers.
- **Thoughtful risk and non-goals sections** that anticipate the most likely failure modes (legacy policy rejection, explanation-ordering churn breaking SDK snapshots, over-broad diagnostics leaking policy structure).

## Major gaps or risks

- **Scope is a program, not a plan.** Twelve items spanning validation, redaction traits, macro changes, indexed resolver, diagnostics, host-owned templates, audit hardening, fuzz/property tests, and perf gates is realistically several months of work. There is no MVP / phasing-by-value carve-out (e.g. "the range-payload shape fix is P0 because it's a live leak; the property-test suite is P2"). A reader cannot tell what to ship first to close the actual vulnerability.
- **The two riskiest contract decisions are deferred.** Step 3/5 offer three alternative screenshot/render strategies (render-from-redacted vs. deny-unless-fully-readable vs. blank render) without choosing, and step 5 says non-fallible workbook reads "may require public signature changes." These are the decisions that ripple into SDK/kernel/runtime callers and should be resolved up front, ideally with a named owner and the chosen signature, not left to implementation time.
- **The classification "registry" is underspecified.** Step 4 lists categories but does not enumerate which current `redact_noop` impls are believed wrong vs. correct (it names candidates — comments, hyperlinks, chart labels, JSON metadata — but defers the call to "product/security"). It also blurs whether enforcement is type-level (trait impls) or table-driven (audit test) or both. The contract a reviewer would lock down is not yet a decision.
- **No measurable acceptance criteria on several items.** "Make diagnostics complete," "harden binary enforcement," and the perf gates (step 12 — "realistic mixed policies," "large binary viewport") lack concrete done-conditions or numeric budgets. The plan would be more executable with explicit assertions (e.g. "screenshot read at sheet-default `None` returns a blank render; E2E asserts zero non-placeholder bytes").
- **Back-compat for fallible workbook reads is hand-waved.** "SDK/kernel/runtime callers may need updates" is the only treatment of what is potentially a breaking API surface change across the public SDK. No migration/deprecation path is sketched.
- **Compile-fail test infrastructure is assumed.** Steps 3 and 10 rely on compile-fail/contract tests; the plan does not confirm a `trybuild`-style harness exists for `bridge-delegate` or specify adding one.

## Contract and verification assessment

Contract clarity is high for the *preservation* contracts (ordering, defaults, lockout, interning, disabled policies) and for the validation layer (step 1 enumerates exactly what to validate: tag grammar, reserved tags, wildcard placement, priority-band ownership, duplicate IDs, metadata bounds). It is weaker for the *new* contracts that matter most operationally: the redaction classification of each return type, the screenshot/render disposition, and the fallible-vs-safe-public split for workbook reads are described as decisions to be made rather than decisions made. Because those are the contracts that change public behavior and SDK surface, the plan's contract maturity is "excellent on what to keep, incomplete on what to introduce."

Verification gates are strong: per-crate test/clippy, differential old-vs-new resolver tests, redaction matrices across all five levels, E2E through real bridge calls, and a demand that the coverage audit become a hard gate instead of an advisory print (which I confirmed it currently is). The insistence on differential tests before swapping the resolver and on E2E that exercises real `ComputeService` methods is exactly the right rigor for a security crate. The main verification gap is the absence of concrete pass/fail assertions for the binary/screenshot and perf items.

## Concrete changes that would raise the rating

1. **Phase the work and call out the P0.** State explicitly that the `RedactRangePayload`/`Vec<u8>` shape fix (steps 3 + 5 binary path) is the live-leak fix to land first, and that validation, indexed resolver, fuzz tests, and perf gates are follow-on phases. This alone would move it toward 9.
2. **Decide the deferred contracts now.** Pick one screenshot/render strategy (recommend: fallible API that denies unless every cell in the range is readable, with a blank-render fallback only behind an explicit safe-public flag) and one disposition for non-fallible workbook reads, and write the chosen public signatures into the plan.
3. **Enumerate the classification table.** List each currently-noop return type with its proposed category and a one-line product rationale, marking which require product sign-off, so the "registry" is a concrete artifact rather than an idea.
4. **Add measurable acceptance criteria** for the binary/screenshot E2E (byte-level assertions) and numeric budgets for the updated Criterion benches.
5. **Sketch the SDK back-compat path** for any workbook read that becomes fallible (deprecation window, snapshot-update procedure, who consumes the new signature).
6. **Confirm or add the compile-fail harness** the audit gates depend on, so steps 3 and 10 are not blocked on missing infrastructure.

Overall: an accurate, architecturally sound, production-path-focused plan that correctly identifies a real redaction-shape vulnerability and respects the crate's security invariants. Held back from a higher score only by its program-sized scope and a few unresolved high-risk contract decisions that should be settled before implementation begins.
