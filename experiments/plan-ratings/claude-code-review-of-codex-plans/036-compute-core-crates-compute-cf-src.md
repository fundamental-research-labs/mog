Rating: 7/10

# Review of 036 — `compute-cf` Conditional Formatting Evaluation and Rule Coverage

## Summary judgment

This is a strong, codebase-grounded plan. I verified its central factual claims against the live tree and they hold up: the `filter_map(|w| CFRule::try_from(w).ok())` silent-drop site exists at `mog/compute/core/src/storage/engine/delegations/compute_sheets_named.rs:263`; `CfValue` is a real enum (`types/value.rs:39`); `CascadeEvaluator`/`evaluate_rules` exist in `evaluator.rs`; `CFIconSetName::SERDE_NAMES` exists (`types/enums.rs:113`); the production scheduler path `scheduler/cf_eval.rs` and `storage/engine/cf_cache.rs` exist; `scheduler::cf_formula_tests` is a real module; and the TS contract drift it cites is accurate (`contracts/src/data/conditional-format.ts` types `CFColorPoint.value` and `CFIconThreshold.value` as `number | string`, plus `gte`, `customIcon`, `matchPositiveFillColor`). The plan correctly preserves the architectural invariant that matters most here — `compute-cf` stays pure and formula evaluation stays in the scheduler — and it names real, runnable verification gates.

The plan's principal weakness is that it reads more like a multi-quarter roadmap than a single executable unit of work, and its one genuinely architectural change (diagnostics replacing silent drops) is under-specified relative to its importance as the cross-worker dependency.

## Major strengths

- **Accurate problem identification.** The silent invalid-rule drop is a real production-path defect, not a hypothetical. Pointing at the exact `filter_map(...ok())` call and asking for an observable diagnostics path is the most valuable concrete improvement in the plan.
- **Correct scoping of purity.** Sections 5/8 and the Risks section explicitly keep formula evaluation, clock, storage, and range materialization in compute core, and call out that moving formula eval into `compute-cf` would invert the dependency direction. This is the right call and is consistent with the actual `cf_eval.rs` ↔ `compute_cf::evaluator` split.
- **Contracts/invariants section is high quality.** The per-rule-stats vs `evaluate_rules` convenience distinction, independent style/visual `stop_if_true` categories, ascending priority, and the `fill_percent` 0..100 (JSON) vs 0..1 (render) unit boundary are precise, testable invariants that match the code's structure.
- **Real verification gates.** `cargo test -p compute-cf`, `cargo clippy -p compute-cf`, targeted `scheduler::cf_formula_tests`, the TS typecheck/codegen gate, and render-binary serialization tests are all named and appropriate. The instruction "do not rely on `compute-cf` unit tests alone when changing scheduler/cache/bridge/render" is exactly right given the crate boundary.
- **Honest about existing coverage.** It acknowledges tests are "already broad and colocated" (true — `cell_value_tests.rs` is 904 lines, `stats_tests.rs` 31KB, plus a full `evaluator_tests/` and `types_tests/` tree), and frames the work as converting comments/implicit behavior into explicit contracts.

## Major gaps or risks

- **Scope is enormous and the plan does not bound it.** Nine implementation sections, six parallel workers, and a near-exhaustive edge-case enumeration. Much of sections 1, 4, 5, 6, 7 is "add more table-driven tests" over an area the plan itself says is already broadly tested. The plan never identifies *which specific contracts are currently untested* versus already covered — so a large fraction of the proposed work risks duplicating existing tests. A gap analysis (read current `*_tests` modules, list what's missing) should precede the test-expansion sections.
- **The one architectural decision is left vague.** Section 2 says "return a typed error or diagnostics-bearing response if the API contract can be changed; if the bridge must continue returning `CellCFResult[]`, add a parallel diagnostics channel." That fork — does the bridge contract change or not? — is the riskiest decision in the plan and is also declared the gating dependency for Workers D and E. Leaving it as "e.g. valid rules plus diagnostics keyed by index/id" defers the hard part to implementation time. This should be resolved in the plan, with the concrete diagnostics struct and the chosen bridge shape specified.
- **No acceptance criteria or prioritization.** Everything is qualitative ("strengthen," "harden," "close edge cases"). There is no statement of what "done" means, no minimum viable slice, and no ranking of the production-relevant change (diagnostics, TS alignment) above the largely-additive test work. If a reviewer had to cut this to a one-week task, the plan gives no guidance on what to keep.
- **Import/export fixture parity (section 9) assumes infrastructure not evidenced.** It references "existing OOXML parser fixtures" and "small XLSX/domain fixtures" but does not confirm such fixtures or a harness exist for asserting `CellCFResult`/render output from an imported file. This is the section most likely to expand unexpectedly.
- **Cross-worker dependency ordering is asserted but thin.** The Parallelization section says A's diagnostics shape must precede D/E and E's operand schema must precede fixtures — correct — but does not convert this into a phased sequence (Phase 0: settle diagnostics + operand schema; Phase 1: per-worker fanout). As written, six workers starting concurrently would race on undefined contracts.

## Contract and verification assessment

Contract clarity is mixed. The *invariants to preserve* are excellent and testable. The *new contracts to introduce* (diagnostics type, generated-vs-handwritten TS boundary, `CfValue` as the canonical operand schema) are named but not pinned to concrete shapes, which is the difference between a 7 and a 9 here. The "generate or contract-test the TypeScript declarations" wording hedges between codegen and assertion without committing — the plan should pick one, because generated types and hand-written contract tests have very different maintenance and review implications.

Verification gates are the plan's strongest dimension: real package/test filters, the correct insistence on exercising `ComputeCore::eval_cf` rather than evaluator shortcuts, and conditional gates (render tests only if render conversion changes, kernel API tests only if domain conversion changes). The dense-column-path-vs-normal-path equivalence test (section 7) is a genuinely good production-correctness gate, not just coverage padding.

## Concrete changes that would raise the rating

1. **Resolve the diagnostics fork in the plan.** Specify the concrete diagnostics struct (fields, how source rule is keyed, where it surfaces — log/telemetry/test assertion) and decide definitively whether the bridge return type changes. This is the gating contract; it should not be deferred. (+1)
2. **Add a gap analysis step before the test-expansion sections.** Require the implementer to first inventory existing `rules/*_tests.rs`, `visual/*_tests.rs`, `stats_tests.rs`, `evaluator_tests/`, and `types_tests/` and produce a list of *missing* contracts, so sections 1/4/5/6/7 target real gaps rather than re-asserting covered behavior. (+1)
3. **Define a phased sequence and a minimum viable slice.** Phase 0: settle diagnostics shape + `CfValue`/TS operand schema + visual unit conventions. Phase 1: parallel fanout. State the smallest shippable increment (likely: diagnostics on the cache path + TS operand alignment + their gates).
4. **Confirm or stand up the import/export fixture harness** before committing to section 9, or mark it explicitly contingent.
5. **Add acceptance criteria** — even coarse ones (e.g. "no `*.ok()` silent drop remains in the two named conversion sites," "TS `CFRuleWire` operands match Rust serde via a roundtrip/codegen check") — so completion is verifiable rather than aspirational.

## Verification note

Confirmed only the review file `036-compute-core-crates-compute-cf-src.md` in `claude-code-review-of-codex-plans/` was created; no source, plan, or other files were modified. Inspection used read-only `ls`/`rg` only.
