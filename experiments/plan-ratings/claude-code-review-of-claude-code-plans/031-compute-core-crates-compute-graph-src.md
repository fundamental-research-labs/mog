Rating: 9/10

# Review of Plan 031 — Harden dependency-graph mutation & query correctness (`mog/compute/core/crates/compute-graph/src`)


## Summary judgment

This is an unusually strong, evidence-dense plan that reflects genuine, line-accurate engagement with the target crate rather than plausible-sounding generalities. I independently verified the two headline correctness claims and they are exactly right:

- **§1 — selective-index drift on replace.** `apply_precedents` (`mutations.rs:389-391`) inserts into `selective_dep_cells_idx` only when `!selective_ranges.is_empty()` and *never removes*; `remove_old_edges` (`mutations.rs:534-576`) updates `dependents`, `range_deps`, and the per-sheet counters but **never touches `selective_dep_cells_idx`**. A `=INDEX(A:A,k)` → `=SUM(A:A)` edit therefore leaves a stale `RangePos` list behind. Confirmed.
- **§2 — selective-index leak on sheet delete.** `cleanup_sheet_ranges` (`mutations.rs:682-702`) purges `range_deps`, `range_index`, the three per-sheet structures, and the in-vec `DepTarget::Range` entries, but does **not** prune `selective_dep_cells_idx`. Dangling cross-sheet entries persist. Confirmed.
- **§3 — `edge_count` doc/impl mismatch.** Doc says "cell-to-cell only; range deps counted separately" (`queries.rs:295`) while the body returns `cell_edges + range_edges` (`queries.rs:315-327`). Confirmed.
- **§6 — reachability recompute on cycle paths.** `resolve_range_targets` computes `cells_reaching(formula_cell, …)` once per call (`range_helpers.rs:31-32`), and `detect_cycles` calls it inside a per-precedent-key loop (`cycles.rs:42`), so it is recomputed per selective formula cell. Confirmed; the quadratic-on-selective-heavy-workbooks claim is well-founded.

Line references throughout are accurate to within one or two lines, the consumer mapping to `scheduler/recalc/selective_fixup.rs` is correct, and the test-tree references (`test_proptest.rs` ~24.5 KB, `test_mutations/`, `test_resolved_view/oracle*.rs`) all exist (under `src/tests/`, which the plan loosely writes as `tests/`). The standout architectural move — an `assert_invariants` oracle wired into both debug-build mutations and the proptest sequence generator — is the correct *durable* fix: it converts "trust the seven update sites" into a self-checking scheme and is exactly what would have caught §1 and §2 mechanically.

The objectives are well-prioritized (two real bugs first, oracle alongside, then contract/perf cleanups), the cycle-tolerance and conservative-completeness invariants are stated precisely and marked must-not-regress, and the non-goals are disciplined.

## Major strengths

- **Verifiable, specific bug claims with reproduction-grade evidence.** Each fix cites the offending lines and the production consequence (extra/incorrect fixup candidacy, unbounded leak across add/delete cycles). Both bugs are real.
- **The oracle is the right center of gravity.** Recompute-from-`precedents` and compare, gated `#[cfg(any(test, debug_assertions))]`, reusing `rebuild_range_index`'s reconstruction for C4 so the oracle and production cannot diverge. Excellent.
- **Contracts C1–C6 are explicit, directional, and tied to code.** C6 (formula membership survives edge churn) correctly preserves the load-bearing `#REF!` behavior at `mutations.rs:691-695`; C5 is honestly flagged as intentionally relaxed today.
- **Disciplined scope and sequencing.** Disjoint seams (mutations vs. cycles), additive-only public-surface changes, downstream Plan 025 coordination flagged not silently assumed, and the `has_cell` cross-folder concern surfaced rather than hand-waved.
- **Performance fixes are framed as behavior-preserving and guarded by existing oracle suites**, with an explicit memoized-vs-non-memoized proptest.

## Major gaps or risks

- **The §3/C5 "`total_edges == edge_count()` by construction" claim has a real hole — in exactly the edge case the plan itself names.** I verified that a cell with both `Range(r, Aggregate)` and `Range(r, Selective)` for the same `r` survives dedup as two precedent entries (`total_edges += 2` at `mutations.rs:394-395`), but `range_deps[r].insert(cell)` collapses to a single membership (`mutations.rs:403-415`), so `edge_count()` counts 1. **`total_edges` and `edge_count()` diverge by one today in this case**, and an oracle that asserts C5 equality would false-positive on a legitimate graph. The plan flags this dual-access case in Risks but only discusses its barrier-graph/C3 implications — it never connects it to the C5 equality it claims is provable. This needs an explicit reconciliation (define the count over distinct `DepTarget`s, or over `range_deps` memberships, and make `total_edges` accounting match) before the oracle can encode equality. This is the single most important correction.
- **§4 (`max_deps_per_cell`) lands on documentation + an opt-in recompute (option A) — i.e. the value stays a stale high-water mark.** That is defensible given no consumer needs exactness, but "honest, bounded semantics" is mostly a doc change; the field remains misleading to any future heuristic. Acceptable, but the objective slightly oversells what A delivers.
- **§6's payoff is asserted, not bounded.** The cross-call memo is sound, but the plan offers no estimate of how often `detect_cycles`/`would_create_cycle` actually run on selective-heavy graphs in production, nor a target speedup — and it explicitly forbids running the Criterion bench here. The risk is investing refactor effort on a path that may be cold relative to recalc. Worth a sentence scoping when these are hot.
- **§7b is acknowledged-probable-no-op** (all-or-nothing `resolve` today). Fine that it defaults to documentation, but it adds reviewer load for little expected yield.

## Contract and verification assessment

The contract section is the plan's best feature: authoritative-vs-derived state is named, six invariants are stated bidirectionally, and the analysis contracts (cycle-tolerance matrix, conservative completeness, determinism via `resolve_sort_key`, `Send+Sync`/`forbid(unsafe_code)`) are preserved explicitly. The verification gates are concrete and correctly layered: per-fix regression tests that fail-before/pass-after, the oracle in the proptest loop, edge-count agreement across `Display`/`summary`/`dep_edge_stats`, upper-bound assertions for `max_deps_per_cell`, memoized-equivalence proptests, and a `compute-core` cross-consumer smoke. The one defect is the C5 equality gap above — the verification scheme's correctness hinges on a contract that is not actually true as written, so the oracle spec must be corrected in lockstep with §3. The plan also respects the "do not run build/test" constraint while still specifying the gates, which is the right posture for a planning artifact.

## Concrete changes that would raise the rating

1. **Reconcile C5 with the dual-access case (blocking for a 10).** State whether "edges" are counted over distinct `DepTarget`s or over `range_deps` memberships, fix `total_edges` accounting so the chosen definition holds for `Range(r,Aggregate)+Range(r,Selective)`, and make the oracle assert *that* equality. As written, the oracle would fire on valid graphs.
2. **Scope §6's hotness.** Add one line on when `detect_cycles`/`would_create_cycle` run in production (full vs. incremental recalc) and a rough expected speedup, so the refactor's value is justified before the bench confirms it.
3. **Make §4 a real decision, not a deferral.** Either commit to the histogram (option B) with a stated trigger, or explicitly mark `max_deps_per_cell` as diagnostics-only and assert downstream non-reliance, so "honest semantics" is more than a doc edit.
4. **Drop or down-rank §7b** to a one-line "confirmed no-op against `CellMirror`; document only," to reduce reviewer surface.
5. **Fix the minor path label** (`tests/test_proptest.rs` is `src/tests/test_proptest.rs`) so an implementer doesn't look in the wrong directory.
