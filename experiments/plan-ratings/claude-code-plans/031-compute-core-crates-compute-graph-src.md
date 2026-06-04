# Plan 031 — Harden dependency-graph mutation & query correctness (`mog/compute/core/crates/compute-graph/src`)

## Source folder and scope

- **Folder:** `mog/compute/core/crates/compute-graph/src` (Rust, `compute-graph` crate; ~12.7k LOC counting the in-tree `tests/` tree, ~2.0k LOC of non-test source).
- **Crate role:** a `CellId`-keyed directed dependency graph for the spreadsheet compute engine. It is `#![forbid(unsafe_code)]`, asserts `Send + Sync` (`lib.rs:302-306`), and is consumed almost exclusively by `compute-core`'s scheduler (`compute/core/src/scheduler/{mod,cycles,init,recalc/*,dep_extract/*}`). Plan 025 (scheduler) is the primary consumer; this plan covers the data-structure layer beneath it.
- **Primary source files in scope:**
  - `lib.rs` (307 lines) — `DependencyGraph` struct, the 11 internal indices/counters it maintains, `DepTarget`/`RangeAccess` enums, `RANGE_EXPANSION_THRESHOLD = 256`, capacity constructors.
  - `mutations.rs` (704 lines) — `set_precedents` / `apply_precedents` / `remove_old_edges` / `remove_cell` / `bulk_remove_cells` / `cleanup_sheet_ranges` / `clear`; `BatchMutations` RAII guard and `GraphBuilder` (incl. `bulk_set_precedents`); external-ref edges; volatile marking.
  - `queries.rs` (702 lines) — lookups (`get_precedents`, `get_dependents`, `has_dependent`, `has_cell`), statistics (`edge_count`, `dep_edge_stats`, `formula_cell_count`, `range_dep_count`), selective-dep query family (`selective_dep_cells`, `selective_dep_cells_with_formula_ranges`, `selective_dep_cells_with_changed_ranges`), range-containment queries (`find_by_range_containment*`, `get_range_dependents_at`).
  - `topo.rs` (434 lines) — `max_depth` (iterative memoized depth), shared `dfs_cycle_walk`, `tarjan_scc`, `kahn_sort`, `formula_and_dep_cells` / `all_graph_cells` seed builders.
  - `recalc/` — position-aware analysis: `dirty_set.rs` (`affected_cells*`, `collect_dirty_set`), `barrier_graph.rs` (compact u32 barrier-graph topo sort), `topo_order.rs` (`evaluation_levels*`, `subset_levels*`), `cycles.rs` (`detect_cycles`, `would_create_cycle`), `range_helpers.rs` (`resolve_range_targets`, `cells_reaching`, `reachable_forward`, `resolve_sort_key`), `mod.rs` (`TopoResult`, position-index builders, `merge_completeness`).
  - `positions.rs` (267 lines) — `PositionResolver` trait, `CellPosition`, `WithOverrides`, `TrackedResolver`, `AnalysisCompleteness`, `Analyzed<T>`.
  - `range_index.rs` (84 lines) + `interval_tree.rs` (re-export of `cell-types::interval_tree`) — per-sheet spatial index lifecycle.
  - `error.rs` (25 lines) — `GraphError::CycleDetected`.
- **Adjacent code touched only as dependency (not edited here):** `cell-types` (`CellId`, `RangePos`, `SheetId`, `IntervalTree`), `workbook-types` (`ExternalRefKey`), and the `compute-core` scheduler consumers listed above. The selective-dep correctness work below changes behavior observed by `scheduler/recalc/selective_fixup.rs`; that consumer is analyzed but not modified by this plan.

This is a **production-path** plan. It fixes two confirmed correctness/leak bugs in incremental-mutation bookkeeping, closes a statistics-contract gap, and adds the missing invariant-verification harness that would have caught both bugs. It is not a test-only, reduced-scope, or shim plan.

## Current role of this folder in Mog

The graph is the single source of truth for *what depends on what*. The scheduler feeds it `DepTarget`s extracted from formula ASTs (`scheduler/dep_extract`), then drives recalc by asking it three questions:

1. **Mutation** — "cell X's formula changed to depend on {…}" (`set_precedents`), "cell X was deleted" (`remove_cell` / `bulk_remove_cells`), "sheet S was deleted" (`cleanup_sheet_ranges`), or "load this whole workbook" (`GraphBuilder::bulk_set_precedents` → `build`).
2. **Invalidation** — "cells {…} changed value; what is the dirty set?" (`affected_cells*` / `collect_dirty_set`), backed by reverse `dependents` edges plus a per-sheet interval-tree range index.
3. **Ordering & cycles** — "give me topological evaluation levels" (`evaluation_levels*`, `subset_levels*`), "is the graph / would this edit be cyclic?" (`detect_cycles`, `would_create_cycle`), all routed through the compact **barrier graph** that models range aggregation with virtual barrier nodes.

Two design decisions dominate correctness:

- **Range-access taxonomy.** Ranges ≥ 256 cells are stored coarsely in `range_deps: RangePos → {CellId}` plus a spatial `range_index`; smaller ranges are expanded to cell edges by the caller. `RangeAccess::Aggregate` (SUM-like) gets real barrier edges in topo sort; `RangeAccess::Selective` (INDEX/VLOOKUP-like) deliberately gets **no** barriers (`barrier_graph.rs:5-8`) and is corrected post-hoc by the scheduler's selective-fixup pass, which queries `selective_dep_cells_with_changed_ranges`. The graph maintains a dedicated `selective_dep_cells_idx: CellId → Vec<RangePos>` so the fixup pass never has to scan all ~2.6M precedent entries.
- **Incrementally maintained side-indices.** To keep hot queries O(1), the struct maintains eleven derived structures (`lib.rs:163-204`): `dependents`, `range_deps`, `range_index`, `sheets_with_range_deps`, `range_count_per_sheet`, `sheet_ranges`, `formula_cells`, `selective_dep_cells_idx`, `total_edges`, `max_deps_per_cell`, plus external-ref mirrors. Every one of these must be updated in lockstep by **seven** mutation entry points. There is currently **no** runtime check that they stay consistent with the authoritative `precedents` map.

The code is mature, heavily documented, and panic-averse on hot paths. The improvement opportunities are concentrated in **incremental-index drift** (where two paths already drift today), **statistics-contract ambiguity**, **a known O(cells×(V+E)) regression on the cycle paths**, and the **absence of an invariant oracle** that would make the whole incremental-bookkeeping scheme self-checking.

## Improvement objectives

1. **Fix `selective_dep_cells_idx` drift on precedent replacement.** Guarantee the selective index is consistent after *any* `set_precedents` that removes or changes a cell's selective range deps — not only when the new deps happen to be selective.
2. **Fix `selective_dep_cells_idx` (and any other per-sheet index) leak on `cleanup_sheet_ranges`.** Sheet deletion must purge dangling selective entries pointing at the deleted sheet.
3. **Define and enforce the edge-count contract.** Make `total_edges` (incremental) and `edge_count()` (recomputed) provably equal, correct the `edge_count` doc/impl mismatch, and decide whether range edges are in or out of "edge count" consistently across `Display`, `summary`, and `EdgeStats`.
4. **Give `max_deps_per_cell` honest, bounded semantics** (it is currently a monotonically non-decreasing over-estimate that never shrinks after churn).
5. **Add an `debug_assert`-grade invariant oracle** (`recompute-from-precedents and compare`) exercised by debug builds and proptests, so future index/counter drift is caught at the source rather than as a downstream recalc bug.
6. **Remove the per-cell `cells_reaching` recomputation on the cycle paths**, restoring the single-pass reachability the barrier refactor intended (`barrier_graph.rs:5-8`) but which `detect_cycles` / `would_create_cycle` / `resolve_range_targets` still violate.
7. **Tighten / document two query contracts** that are currently silent: the `collect_dirty_set` full-range-sweep over-invalidation, and `has_cell`'s exclusion of range-only data targets.

Non-objective: changing the range-expansion threshold, the barrier-graph algorithm, or the selective-deferral design. Those are correct as designed; this plan makes the bookkeeping around them reliable.

## Production-path contracts and invariants to preserve or strengthen

**Authoritative state vs. derived state.** `precedents: CellId → Vec<DepTarget>` and `external_precedents` are authoritative. Everything else is derived and must satisfy, for any graph reachable via the public API:

- **C1 (dependents mirror):** `b ∈ dependents[a]` ⇔ `DepTarget::Cell(a) ∈ precedents[b]`. (Already verified for `remove_cell` via the debug loop at `mutations.rs:458-464`; generalize it.)
- **C2 (range_deps mirror):** `c ∈ range_deps[r]` ⇔ `∃ access. DepTarget::Range(r, access) ∈ precedents[c]`.
- **C3 (selective index):** `selective_dep_cells_idx[c] == [r | DepTarget::Range(r, Selective) ∈ precedents[c]]` (set-equal), and `c ∉ selective_dep_cells_idx` when that list is empty. **Violated today** on the replace and sheet-cleanup paths (see Implementation §1–2).
- **C4 (per-sheet range indices):** `sheets_with_range_deps`, `range_count_per_sheet`, `sheet_ranges`, and `range_index` are all exact functions of `range_deps.keys()` grouped by sheet (this is precisely what `rebuild_range_index` reconstructs from scratch — `range_index.rs:61-82`).
- **C5 (edge counters):** `total_edges == edge_count()` and `max_deps_per_cell == max(0, max over cells of count of Cell+Range deps)` — the second is **intentionally relaxed today** to an upper bound (Objective 4).
- **C6 (formula membership survives edge churn):** a cell registered via `set_precedents` stays in `formula_cells` even if its precedent list becomes empty (`cleanup_sheet_ranges` comment, `mutations.rs:691-695`) — preserve this; it is load-bearing for `#REF!` evaluation.

**Analysis contracts (must not regress):**
- **Cycle-tolerance matrix** (`recalc/mod.rs:14-24`): `affected_cells*` / `subset_levels` / `would_create_cycle` never error on cycles; `evaluation_levels` returns `Err(CycleDetected)`; `detect_cycles` enumerates. Preserve exactly.
- **Conservative completeness** (`positions.rs:174-181`): an unresolved position must yield `Incomplete` and may *over*-invalidate but must never *under*-invalidate or fabricate edges. The `TrackedResolver` miss-tracking and the `collect_dirty_set` full-sweep fallback are the two mechanisms; keep both monotone-conservative.
- **Determinism:** `subset_levels` / `affected_cells_levels` sort within levels by `(sheet, row, col)` via `resolve_sort_key` (`range_helpers.rs:151-161`), unresolved → `(MAX,MAX,MAX)`. Preserve stable ordering so recalc output is reproducible.
- **Send+Sync and `forbid(unsafe_code)`** (`lib.rs:3`, `302-306`) — no fix may introduce interior mutability that breaks `Sync` (note `TrackedResolver` already uses `Cell<bool>` and is *not* shared across threads — keep it that way).

## Concrete implementation plan

### 1. Fix selective-index drift on precedent replacement (Objective 1, C3) — **correctness bug**

**Evidence.** `set_precedents` (`mutations.rs:326-329`) calls `remove_old_edges` then `apply_precedents`. `remove_old_edges` (`mutations.rs:534-576`) updates `dependents`, `range_deps`, and the per-sheet range counters, **but never touches `selective_dep_cells_idx`**. `apply_precedents` (`mutations.rs:389-391`) only *inserts* into the index, and only when the new deps contain ≥1 selective range:
```
if !selective_ranges.is_empty() {
    self.selective_dep_cells_idx.insert(*cell, selective_ranges);
}
```
Therefore, when a cell transitions from "has selective deps" to "no selective deps" (e.g. a formula edited from `=INDEX(A:A,k)` to `=SUM(A:A)`, or to a constant), its stale `selective_dep_cells_idx` entry **persists with the old `RangePos` list**. `remove_cell`/`bulk_remove_cells` correctly call `.remove(cell)` (`mutations.rs:438`, `626`), so the bug is specific to the *replace* path — the most common edit path in production.

**Consequence on the production path.** `selective_dep_cells_with_changed_ranges` (`queries.rs:501-534`) iterates `selective_dep_cells_idx` and tests each stored `RangePos` against the changed-position index. A stale entry can falsely match a changed position and pull a cell into the scheduler's fixup scope (`scheduler/recalc/selective_fixup.rs`) that no longer has any selective dependency. The `ast_cache.contains_key(c)` filter in the fixup pass masks the case where the cell was *deleted*, but **not** the case where the cell is still a live formula whose dependencies merely changed — that cell is re-evaluated unnecessarily, and worse, against a range it no longer reads.

**Fix.** Make selective-index maintenance symmetric with `dependents`/`range_deps`: remove the old entry in `remove_old_edges` (or, equivalently, unconditionally overwrite/clear in `apply_precedents`). Preferred: handle it in `apply_precedents` so all three index-update sites stay co-located and the `BatchMutations`/`GraphBuilder` fresh path (which skips `remove_old_edges`) is also correct:
```rust
// apply_precedents, replacing lines 389-391:
if selective_ranges.is_empty() {
    self.selective_dep_cells_idx.remove(cell);   // clears any stale prior entry
} else {
    self.selective_dep_cells_idx.insert(*cell, selective_ranges);
}
```
This is safe for the fresh paths (`GraphBuilder::set_precedents`, `set_precedents_fresh`) because removing an absent key is a no-op. Note `bulk_set_precedents` (`mutations.rs:241-272`) operates on a guaranteed-fresh graph and only inserts; it needs no change, but the invariant oracle (§5) will confirm it.

### 2. Fix selective-index (and document full-index) leak on `cleanup_sheet_ranges` (Objective 2, C3/C4) — **correctness + memory leak**

**Evidence.** `cleanup_sheet_ranges` (`mutations.rs:682-702`) purges `range_deps`, `range_index`, `sheets_with_range_deps`, `range_count_per_sheet`, `sheet_ranges`, the stale `DepTarget::Range` entries inside `precedents` vecs, and decrements `total_edges`. It does **not** remove the deleted sheet's ranges from `selective_dep_cells_idx`. After a sheet delete, every cell that read a selective range on that sheet keeps a dangling `RangePos` (whose `sheet()` no longer exists) in the selective index forever — an unbounded memory leak across repeated sheet add/delete cycles, plus permanent (wasted) fixup candidacy.

**Fix.** Mirror the existing precedent cleanup for the selective index, dropping entries that become empty:
```rust
// in cleanup_sheet_ranges, after the precedents.values_mut() retain:
self.selective_dep_cells_idx.retain(|_cell, ranges| {
    ranges.retain(|r| r.sheet() != *sheet_id);
    !ranges.is_empty()
});
```
This restores C3 after sheet deletion and bounds memory. (C4 is already satisfied by this method; the oracle in §5 will lock it in.)

### 3. Define and enforce the edge-count contract (Objective 3, C5)

**Evidence of ambiguity.** `edge_count()` doc says *"cell-to-cell only; range deps counted separately"* (`queries.rs:295`) but the body sums `cell_edges + range_edges` (`queries.rs:315-327`). `Display` uses `edge_count()` (`lib.rs:293`); `summary()` uses the incremental `total_edges` (`queries.rs:562-572`); `EdgeStats.total_edges` doc says *"Total number of dependency edges across all formula cells"* (`queries.rs:11-12`). These three reporting surfaces must agree.

**Fix.**
- Correct the `edge_count` doc to state it returns cell+range edges and is the O(P) recomputed counterpart of the O(1) `total_edges`.
- Confirm by construction that `total_edges == edge_count()`: `total_edges` is incremented by the *deduplicated* `deps.len()` (cell+range) in `apply_precedents`/`bulk_set_precedents`, and `edge_count()` counts cell entries in precedent vecs + Σ`|range_deps[r]|`; each `Range` entry in a precedent vec is exactly one `(r, cell)` membership in `range_deps`, so the two are equal whenever the indices are consistent. Encode this equality as part of the invariant oracle (§5) rather than leaving it as folklore.
- Leave external-ref edges out of both counts (current behavior), and say so in the `EdgeStats` doc.

### 4. Honest `max_deps_per_cell` semantics (Objective 4, C5)

**Evidence.** `max_deps_per_cell` is bumped up in `apply_precedents`/`bulk_set_precedents` but **never decremented** (`remove_old_edges` comment, `mutations.rs:539-541`): after a high-degree formula is deleted or simplified, the reported max stays inflated indefinitely. It feeds `dep_edge_stats` / `summary` and any downstream heuristic.

**Fix (choose one; recommend A):**
- **A — keep O(1) writes, make the relaxation explicit and testable.** Rename the field's *contract* (not the field) to "high-water mark of dependencies per cell since last `clear`," update `EdgeStats.max_deps_per_cell` doc (already hints "may over-report"), and add an opt-in exact recompute `fn recompute_max_deps_per_cell(&mut self)` callers can invoke after bulk teardown (e.g. the scheduler after `bulk_remove_cells`). The oracle (§5) asserts `max_deps_per_cell >= true_max` (upper-bound invariant), never equality.
- **B — exact maintenance.** Track a per-degree histogram (`FxHashMap<u64 /*degree*/, u64 /*count*/>`) so removals can decrement and the max can fall. Costs one extra map; gives C5 equality. Heavier; defer unless a consumer needs exactness.

Default to **A**: no consumer in `scheduler/` currently requires an exact max, and A preserves the O(1) hot-path writes.

### 5. Invariant oracle + proptest wiring (Objective 5) — **the durable fix**

Add a `#[cfg(any(test, debug_assertions))]` method that recomputes every derived index from `precedents`/`external_precedents` and asserts equality with the live state:
```rust
#[cfg(any(test, debug_assertions))]
pub(crate) fn assert_invariants(&self) {
    // C1: dependents mirror precedents (generalize the remove_cell debug loop)
    // C2: range_deps mirror precedents
    // C3: selective_dep_cells_idx == selective ranges per precedents (set-equal, no empty entries)
    // C4: rebuild a scratch (sheets_with_range_deps, range_count_per_sheet, sheet_ranges)
    //     from range_deps.keys() and compare; range_index sheet-key set matches
    // C5: total_edges == edge_count(); max_deps_per_cell >= true max
    // C6: formula_cells ⊇ {cells with any precedent entry} ∪ {cells with external precedents}
}
```
Wire it in two places: (a) a `debug_assert!`-style call at the tail of each public mutation in debug builds (cheap relative to the mutation for small edits; gate the O(P) parts behind `debug_assertions` only); (b) the existing proptest harness (`tests/test_proptest.rs`, 24.5 KB) — extend its mutation-sequence generator to call `assert_invariants()` after every step. This converts the entire incremental-bookkeeping scheme from "trust the seven update sites" to "self-checking," and is what would have caught §1 and §2 mechanically. Reuse `rebuild_range_index`'s reconstruction logic (`range_index.rs:61-82`) as the C4 oracle so the two cannot diverge.

### 6. Single-pass reachability on the cycle paths (Objective 6) — **scalability correctness**

**Evidence.** `resolve_range_targets` recomputes `self.cells_reaching(formula_cell, …)` — a full O(V+E) reverse BFS — for *every* selective formula cell it resolves (`range_helpers.rs:29-33`). Both `detect_cycles` (`cycles.rs:35-54`, via `get_cell_deps` over all precedent keys) and the `would_create_cycle` DFS (`cycles.rs:199-206`) invoke it once per visited cell carrying a selective range. That reintroduces exactly the O(cells × (V+E)) blow-up the barrier refactor removed from the recalc path (`barrier_graph.rs:5-8`), now living on the cycle-analysis path. On selective-heavy workbooks (`INDEX`/`XLOOKUP` columns), `detect_cycles` becomes quadratic.

**Fix.** Thread a per-call memo `FxHashMap<CellId, Rc<FxHashSet<CellId>>>` (or a `&mut` cache) for `cells_reaching` results through `detect_cycles` and `would_create_cycle` so the reaching set for a given target is computed at most once per analysis invocation. `cells_reaching` is a pure function of `(target, graph, positions)` within one call, so memoization is sound. Keep `resolve_range_targets`' public signature; add a variant that accepts the shared cache, with the existing method delegating to a fresh cache for one-shot callers. This is a behavior-preserving performance fix; the oracle and existing oracle-comparison tests (`tests/test_resolved_view/oracle*.rs`) guard correctness.

### 7. Document/tighten two silent query contracts (Objective 7)

- **`collect_dirty_set` full-range-sweep** (`dirty_set.rs:157-172`): when a cell has no resolvable position, *all* `range_deps` dependents are added (once, `did_full_range_sweep`), marking `Incomplete`. This is correct-conservative but can massively over-invalidate. Two changes: (a) document the over-invalidation explicitly on `affected_cells`'s contract; (b) *optional* tightening — if the unresolved cell's `SheetId` is known but row/col are not, sweep only that sheet's ranges (`sheet_ranges[sheet]`) instead of the global set. Only pursue (b) if `PositionResolver` can ever return sheet-without-coordinates; today `resolve` is all-or-nothing (`CellPosition` has all three fields), so (b) is likely a no-op — confirm against `CellMirror`'s impl in `compute-core` before implementing, and otherwise just document.
- **`has_cell`** (`queries.rs:252-259`): returns `false` for a pure data cell that is only the target of a `DepTarget::Range` (never a `Cell` dep), because such a cell appears in no checked set. State this in the doc ("a cell that participates *only* as a member of a coarse range dependency is not reported as present") and verify no scheduler consumer relies on `has_cell` for range-target liveness. If one does, that is a separate cross-folder fix surfaced for Plan 025.

### Sequencing

§1 and §2 are independent, isolated, low-risk bug fixes — land first. §5 (oracle) should land alongside them so the proptest immediately exercises the fixes. §3 and §4 are doc/contract + small additive API. §6 is a self-contained performance refactor gated by the oracle/oracle-tests. §7 is documentation plus one conditional optimization. No change alters the public type surface except the additive `recompute_max_deps_per_cell` (§4-A) and the cache-accepting variant in §6.

## Tests and verification gates

Existing coverage is strong and should be extended, not replaced (per constraints, this plan does not itself edit tests destructively — it specifies the gates):

- **Regression tests for §1/§2** under `tests/test_mutations/`: (a) `set_precedents` selective→non-selective transition leaves `selective_dep_cells()` empty for the cell (place near `replace_precedents.rs`); (b) `cleanup_sheet_ranges` removes the sheet's `RangePos` from the selective index and leaves no dangling cross-sheet entries (extend `sheet_range_cleanup.rs`). Both should fail before the fix, pass after.
- **Invariant oracle (§5):** extend `tests/test_proptest.rs` to call `assert_invariants()` after every generated mutation, across sequences mixing `set_precedents`, `remove_cell`, `bulk_remove_cells`, `bulk_set_precedents`, `cleanup_sheet_ranges`, selective/aggregate ranges, and external refs. Add a targeted unit test that a randomized mutation sequence ends with `total_edges == edge_count()` and `selective_dep_cells_idx` set-equal to a from-precedents recompute.
- **Edge-count contract (§3):** unit assertions that `Display`, `summary`, and `dep_edge_stats().total_edges` all agree with `edge_count()` for graphs containing cell + aggregate + selective + duplicate-target deps.
- **`max_deps_per_cell` (§4):** test that it is a valid upper bound after churn, and that `recompute_max_deps_per_cell()` (if added) restores exactness.
- **Cycle-path equivalence (§6):** the memoized `detect_cycles`/`would_create_cycle` must produce identical results to the current implementation on the existing oracle suites (`tests/test_resolved_view/oracle.rs`, `oracle_comparisons.rs`, `tests/test_topo/{cell_cycles,range_cycles,cycle_reporting}.rs`). Add a proptest comparing memoized vs. non-memoized output on random selective-heavy graphs.
- **Cross-consumer smoke:** the scheduler's selective-fixup path (`scheduler/recalc/selective_fixup.rs`) and incremental recalc (`scheduler/recalc/incremental.rs`) should be exercised by the existing `compute-core` integration tests to confirm the tighter fixup scope produces unchanged recalc values.

**Verification gates (run by reviewer/CI, not by this planning task):** `cargo test -p compute-graph` (incl. proptest), `cargo clippy -p compute-graph --all-targets` (crate is `deny(clippy::all)` + `warn(pedantic,nursery)`), the existing `graph_benchmark` Criterion bench to confirm §6 improves (and §1/§2/§5-debug-asserts do not regress) hot-path timing, and the `compute-core` test suite to confirm no behavioral change downstream. Per task constraints, **this plan does not run any build/test/format commands.**

## Risks, edge cases, and non-goals

- **Risk: debug-build invariant asserts slow the scheduler in dev.** Mitigate by gating the O(P) portions of `assert_invariants` so per-edit calls only run the cheap per-cell checks (C1/C3 for the touched cell), reserving the full recompute for proptests and an explicit `debug_assert_full_invariants()` used in tests. Avoid calling the O(P) oracle on every small edit.
- **Edge case: a cell with both `Range(r, Aggregate)` and `Range(r, Selective)` for the same `r`.** Deduplication is by full `DepTarget` (access included), so both survive in the precedent vec but collapse to one `range_deps[r]` membership; the barrier graph treats the pair as aggregate (`barrier_graph.rs:266-279`). The §1 fix must compute `selective_ranges` from the *Selective* entries only (it already does) — confirm the oracle's C3 recompute uses the same filter.
- **Edge case: §6 memoization and position overrides.** `would_create_cycle` runs under `WithOverrides`; the reaching cache must be keyed within a single call (overrides are fixed for that call) and never persisted on `&self`. Keep the cache local to the analysis invocation.
- **Risk: tightening the dirty-set sweep (§7b) could under-invalidate** if `PositionResolver` ever yields partial coordinates. Guard behind a confirmed all-or-nothing `resolve` contract; default to documentation only.
- **Non-goals:** changing `RANGE_EXPANSION_THRESHOLD`, the selective-deferral architecture, the barrier-graph algorithm, the interval-tree implementation (lives in `cell-types`), or the `Analyzed`/completeness model. No public enum/struct removal. No change to `compute-core` scheduler behavior beyond the (intended) narrowing of the selective-fixup candidate set produced by the §1/§2 bug fixes.

## Parallelization notes and dependencies on other folders

- **Self-contained within this folder.** §1, §2, §3, §4, §5, §6 touch only `compute-graph/src` (+ its in-tree `tests/`). They can proceed in parallel with three internal seams: §1/§2 (mutations.rs) and §6 (recalc/cycles.rs + range_helpers.rs) are disjoint; §5 (the oracle) depends on §3's edge-count contract being decided but can be drafted against the current contract and updated.
- **Upstream dependency:** `cell-types::IntervalTree` and `RangePos` semantics are assumed stable; no change required there. `interval_tree.rs` is a thin re-export (Plan for `cell-types` owns the tree itself).
- **Downstream coordination with Plan 025 (`scheduler`):** the §1/§2 fixes *narrow* the set returned by `selective_dep_cells_with_changed_ranges`, which is consumed by `scheduler/recalc/selective_fixup.rs`. This is strictly more correct (it stops re-evaluating cells that no longer have selective deps), but the scheduler's integration tests are the cross-folder gate. §7's `has_cell` contract clarification may surface a consumer assumption to fix in Plan 025; that is flagged, not fixed here.
- **No dependency on the `tests/test_*` reorganization** already in flight (the dirty `tests/` subdirs noted in the worker brief are unrelated app-eval/api-eval fixtures, not this crate's tests).
