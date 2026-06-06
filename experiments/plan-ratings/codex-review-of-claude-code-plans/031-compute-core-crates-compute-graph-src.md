Rating: 8/10

Summary judgment

This is a strong, production-path plan. It is source-grounded, names the right mutation/query surfaces, correctly identifies two real selective-index drift bugs, and frames the work around invariants rather than one-off fixes. The architecture fit is good: it preserves `compute-graph` as the dependency data-structure layer, keeps scheduler changes as downstream verification only, and focuses on derived-index consistency in the public graph mutation path.

The plan falls short of a 9 or 10 because one of its central contracts, `total_edges == edge_count()`, is not fully specified for an edge case the plan itself calls out: a single formula can contain both `DepTarget::Range(r, Aggregate)` and `DepTarget::Range(r, Selective)`. Those are distinct precedent entries but collapse to one `range_deps[r]` membership, so the current "deduplicated deps.len()" total-edge story and the recomputed `edge_count()` story diverge unless the plan explicitly chooses and implements one semantic. The invariant oracle and tests also need sharper details around ordering, debug-build cost, and completeness tracking in the cycle-path memoization.

Major strengths

- The plan correctly targets the production code that the scheduler uses: `set_precedents`, `cleanup_sheet_ranges`, selective dependency queries, dirty-set expansion, and range-aware cycle checks.
- The two headline selective-index bugs are real and well evidenced. `apply_precedents` only inserts non-empty selective entries, `remove_old_edges` does not clear them, and `cleanup_sheet_ranges` does not prune deleted-sheet selective ranges.
- The invariant framing is the right architectural direction. `precedents` and `external_precedents` should drive a recompute-and-compare oracle for `dependents`, `range_deps`, per-sheet range caches, selective indexes, and counters.
- The plan respects important existing contracts: formula cells survive empty precedent lists, cycle-tolerance behavior is preserved, range/selective semantics are not redesigned, and scheduler behavior is verified but not folded into this crate.
- Verification is meaningfully tied to behavior: targeted mutation regressions, property tests, edge-stat assertions, cycle equivalence tests, compute-core smoke tests, clippy, and a benchmark gate for the cycle-path performance work.

Major gaps or risks

- The edge-count contract is incomplete for same-cell, same-`RangePos`, different-`RangeAccess` deps. `total_edges` currently counts precedent entries, while `edge_count()` counts `range_deps` memberships for ranges. The plan notes that aggregate+selective pairs can survive deduplication and collapse in `range_deps`, but it does not resolve whether stats count precedent entries or unique `(range, cell)` memberships.
- The C4 oracle must normalize unordered side indexes. `sheet_ranges` is a `Vec<RangePos>` populated either by mutation order or by hash-map iteration during rebuild, so direct vector equality can be nondeterministic. Compare sorted/set-normalized ranges per sheet, and be explicit about what can be compared for `range_index`.
- The debug invariant strategy is underspecified. Calling a full O(P+R) oracle at the tail of every public mutation in debug builds could make ordinary dev editing painful. The risk section mentions cheap per-cell checks versus full checks, but the plan should define exactly which mutation paths call which level.
- The cycle-path memoization plan should preserve completeness tracking. Current `resolve_range_targets` and `cells_reaching` calls can use a raw `positions` resolver; a memoized variant should thread the same `TrackedResolver` or otherwise prove unresolved positions are still reflected in `Analyzed::completeness`.
- `max_deps_per_cell` remains a soft contract. Recommendation A is reasonable, but the plan needs to state whether the recompute method is public, when production callers should invoke it, and whether `dep_edge_stats()` remains an O(1) high-water diagnostic.
- The cleanup-sheet selective regression test should be described through public queries, not private index access. For example, verify that `selective_dep_cells()` or `selective_dep_cells_with_changed_ranges()` no longer returns the formula after the deleted sheet's only selective range is removed.

Contract and verification assessment

The contract section is mostly excellent. C1 through C4 are the right invariants, C3 is precise enough to catch the confirmed bugs, and C6 correctly protects formula membership after range cleanup. The "authoritative state vs derived state" framing should be softened for `formula_cells`, because formula membership is partly an API/lifecycle fact and not exactly derivable from non-empty `precedents`.

The verification gates are strong and correctly scoped. `cargo test -p compute-graph`, crate clippy, compute-core downstream tests, and a benchmark for the cycle-path work are appropriate. The plan should add explicit pre-fix failing tests for selective replacement and sheet cleanup, and should include the aggregate+selective same-range stats case before enabling `total_edges == edge_count()` as an invariant. For the invariant oracle, proptest mutation sequences should include selective ranges, aggregate ranges, mixed access for the same range, duplicate deps, external refs, batch mutations, builder bulk load, removals, sheet cleanup, and `clear`.

Concrete changes that would raise the rating

- Decide the edge-count semantic for range deps: count stored precedent entries, or count unique `(RangePos, dependent cell)` memberships. Then update `total_edges`, `edge_count()`, `EdgeStats`, `Display`, `summary`, docs, and tests consistently, including the aggregate+selective same-range case.
- Specify the invariant oracle API in two tiers: a cheap touched-cell/touched-sheet check for debug mutation tails, and a full recompute oracle for tests/proptests. Define normalized comparison rules for `sheet_ranges` and range-index contents.
- Thread a shared `TrackedResolver` or equivalent completeness-aware resolver through the memoized `resolve_range_targets` cycle paths, and add tests for unresolved positions on selective-heavy graphs.
- Make the `max_deps_per_cell` contract explicit in the public docs: high-water mark versus exact max, visibility of any recompute method, and which callers should use it.
- Add public-query regression tests for stale selective entries after `set_precedents` replacement and `cleanup_sheet_ranges`, plus a property-test assertion that the selective index is set-equal to selective ranges recomputed from `precedents`.
