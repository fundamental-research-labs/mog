Rating: 8/10

# Review of 015 — Kernel Chart Domain Improvement Plan


## Summary judgment

This is a strong, unusually well-grounded plan. Nearly every factual claim it makes about the folder checks out against the source: `chart-store.update` really does cast `updates as ChartFloatingObject` (`chart-store.ts:48`); cell-change invalidation really is a workbook-wide scan that calls `getAllChartsInWorkbook` and re-resolves every chart's ranges per event (`chart-bridge-cell-events.ts:23-33`, `chart-reference-invalidation.ts:61-89`); `createCellAccessor` really does a nested per-cell `await getValue` loop (`chart-cell-accessor.ts:28-52`); `resolveChartRangeReferences` really mutates one shared `diagnostics` array inside `Promise.all` so diagnostic ordering is scheduling-dependent (`chart-range-references.ts:265-281`); `renderCached` really is the synchronous, fire-and-forget paint path the plan promises to preserve (`chart-bridge.ts:147-189`); and the bridge methods the batching work depends on (`getRangeValues2d`, `getResolvedFormat`) really exist and are classified `read` in the compute manifest. The ownership map (compute owns storage/identity; kernel owns projection/cache/snapshots; `@mog/charts` owns the compiler; canvas owns paint) matches how the code is actually wired. This is a reviewer who read the folder, not skimmed it.

The plan's main weakness is scope. It is closer to a managed re-architecture of the entire folder (10 implementation sections, a 7-agent parallel split) than a targeted improvement, and it layers genuine correctness fixes together with cleanliness refactors that carry regression risk against an already heavily-tested folder (26 test files). A few items are soft or hard to verify as "done."

## Major strengths

- **Accurate diagnosis.** The two highest-value items — replacing the O(charts × ranges) per-cell scan with a dependency index, and batching per-cell IPC — target real, verified inefficiencies, not invented ones.
- **The determinism fix is a real latent bug, not cosmetics.** Diagnostics pushed into a shared array from parallel `resolveA1ChartRange` calls inside `Promise.all` produce ordering that depends on promise completion, and the resolved-spec hash/snapshot is a public diagnostic contract. The plan correctly identifies this and prescribes a `{ reference, diagnostics }` return shape with a defined path order. The existing `chart-range-resolver.test.ts` asserts exact `diagnostics` array equality, so this is testable.
- **Contracts and invariants are stated as invariants.** The "preserve or strengthen" section reads like an acceptance spec: sync `renderCached`, no manual event emission, stopped-bridge commit rejection, sheet-scoped cache keys for duplicate imported chart IDs, identity-before-A1 precedence, error-to-null cell policy. These map to behaviors that exist in the code today, so they function as regression guards.
- **Disciplined non-goals.** "Do not store charts in the floating-object CRDT map," "do not make canvas await compilation," "do not bypass ComputeBridge," "do not paper over converter gaps with casts" — these correctly fence off the tempting-but-wrong moves and reflect the actual ownership split.
- **Verification gates are concrete and runnable**, ordered focused→repo-wide, conditional Rust gates only if bridge signatures change, plus a manual UI matrix (create/edit/hide/move/import-duplicate-IDs/export) that exercises the real input paths the plan claims to preserve.

## Major gaps or risks

- **Scope/regression risk.** Refactoring `ChartDataResolver`, `chart-compiler`, the range resolver, the cache-key layer, and splitting `resolved-spec-snapshot` into five builders is a large simultaneous change to a folder with substantial existing coverage. Section 2 ("named pipeline contracts") is explicitly abstraction-for-testability; against a folder this well-tested it is the lowest-payoff, highest-churn item and should be the first thing cut if the slice runs long.
- **The dependency index is under-specified relative to its complexity.** Section 4 lists *when* to invalidate but not the index's data model: how ranges map to charts, how cross-sheet references are keyed (it introduces a `rangeDependencyKey` in §3 but doesn't connect it to the index structure), how entries are evicted, or how a partial/failed resolution is represented beyond "keep a conservative entry." This is a new stateful component whose own staleness failure modes the plan acknowledges as a risk but does not fully close. The "slow fallback path" hedge is sensible but means two code paths must stay behaviorally identical — itself a test burden the plan doesn't enumerate.
- **No performance baseline.** Sections 4 and 5 are justified on efficiency grounds, but there is no profiling number, no "charts × cells" cost estimate, and no target. Without a baseline it's hard to know whether the index's added complexity and staleness surface is worth it versus, say, memoizing `resolveChartRangeReferences` per event tick.
- **`getRangeValues2d` semantic-equivalence risk is real and load-bearing.** The plan flags it (verify error/formula/richtext/blank/materialized cells), which is good, but the entire batching win is gated on either equivalence or adding a new bridge method — i.e., possibly a compute-core change pulling in the Rust gates. The plan should treat the "add a production bridge method" branch as the likely path and size it, rather than the optimistic branch.
- **Soft, hard-to-verify items.** "Add a public-repo architecture note" and "add a small boundary checker or lint rule extension" (§1, §8) are valuable but vaguely scoped — is the checker an ESLint rule, a custom script, a test? "Done" is undefined. The negative import-boundary test (§8 / verification list) is the concrete, verifiable version and should subsume the hand-wave.
- **`compilerInputHash` stability is asserted as a goal but not verified against current behavior.** `chart-compiler.ts` already builds the hash via `hashJson({...})`; the plan should state whether `hashJson` already canonicalizes key order (in which case the "object key order" half of the concern is already handled and only async-completion order remains) rather than implying both are open.

## Contract and verification assessment

Contract clarity is the plan's strongest dimension. It names the public surfaces (`IChartBridge`, resolved-spec snapshots, public chart config/data types), correctly identifies `chart-type-converters.ts` as the single sanctioned wire→config narrowing boundary, and treats snapshot schema/hash changes as versioned breaking changes requiring fixture updates. The proposed internal pipeline types (`ChartSourceObject` → `ChartCompiledRenderOutput`) are coherent and match the actual data flow, though they are net-new surface rather than existing contracts.

Verification is genuinely gated, not aspirational: focused kernel chart tests first, neighbor packages, conditional `@mog/charts` and Rust gates, repo-wide typecheck, then a manual UI matrix. The new-tests list is specific and mostly maps to assertable behavior (deterministic diagnostics order, duplicate-chart-ID cache isolation, dedupe of coalesced reads, deterministic hashes). Gap: there is no explicit before/after performance assertion for the two efficiency items, and no test named for the dependency index's "conservative fallback when cold/failed" path, which is exactly where correctness regressions would hide.

## Concrete changes that would raise the rating

1. **Split into landable slices with an explicit ordering and a "minimum viable" subset.** The two correctness items (deterministic diagnostics, §3) and the converter-boundary typing (§8 `ChartFloatingObjectPatch`) are low-risk, high-value, and independently shippable — call them Phase 1 and gate the rest behind them. Demote §2 (pipeline contract types) to optional.
2. **Fully specify the dependency-index data model**: the range→chart map structure, keying for cross-sheet refs, eviction, the representation of a failed/partial resolution, and how the index and the slow-fallback path are proven equivalent (a differential test asserting identical invalidation sets for a corpus of charts).
3. **Add a performance baseline and target** for §4/§5 (e.g., invalidation cost for N charts on a single-cell edit, IPC count per resolve before/after) so the added complexity is justified by a number.
4. **Resolve `getRangeValues2d` equivalence up front** with a concrete checklist outcome, and plan for the new-bridge-method branch (including the compute-core/Rust gates) as the expected path rather than the fallback.
5. **Replace the soft §1/§8 "note / lint rule" items with a concrete deliverable**: the negative import-boundary test plus a named checker mechanism (which tool, where it runs in CI), so completion is verifiable.
6. **State the current `hashJson` key-order behavior** so the hash-stability work is scoped to only the genuinely open part (async completion order).

---

Verification note: the only file created or modified by this review is
`mog-internal/plans/active/experiments/plan-ratings/claude-code-review-of-codex-plans/015-kernel-src-domain-charts.md`.
