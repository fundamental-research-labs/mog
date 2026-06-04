Rating: 9/10

# Review — 046 `mog/canvas/drawing-canvas/src`


## Summary judgment

This is a strong, evidence-grounded plan for hardening the floating-object render/hit-test layer. Every load-bearing claim I spot-checked against the tree is accurate, including line-level references. The plan correctly separates what this folder owns from what it merely couples to, sequences the work so the riskiest cross-folder change (hit-region contract) is isolated and explicitly required to land atomically with its consumer, and preserves the right invariants (`CanvasLayer`/`HitTestProvider` conformance, document-space bounds, exhaustive dispatch, per-object isolation). It reads like it was written by someone who actually traced the code paths rather than skimmed them. The few weaknesses are minor and do not undermine the production path.

## Major strengths

- **Evidence is real and precise.** I verified the headline findings directly:
  - `getByZOrder()` re-sorts every call with `a.zIndex - b.zIndex`, no secondary key — confirmed at `scene-graph.ts:95-96`. The non-deterministic tie-break and per-frame `O(N log N)` claims are both correct.
  - `SceneGraph.update` does `{ ...existing, ...updates } as SceneObject` with a `Partial<Omit<…,'id'|'type'>>` signature — confirmed at `scene-graph.ts:69-74`. The "partial `data` silently drops fields / cast bypasses discriminant" diagnosis is exactly right.
  - `ImageCache` `.catch(() => { this.loading.delete(src); })` records nothing on failure and `getImage` consults only `cache`/`loading` — confirmed at `image-cache.ts:29-46`. The "re-loads a broken URL every frame, no bound" claim holds.
  - Double error boundary confirmed: `withRenderContext` catches, warns, draws placeholder, does not rethrow (`render-utils.ts:298-309`), and `dispatchRender` wraps the same calls in its own `try/catch` placeholder. The dispatcher catch is indeed only reachable for bridge-acquisition throws.
  - Connector `getEndpoints` returns the bbox diagonal and ignores `startConnection`/`endConnection`; hit path registers `bounds.rect(...)` — confirmed at `connector.ts:129-136, 273-278`.
  - `HitMap.hitTest` and `hitTestLinearScan` only ever emit `region: 'body'`, while the full handle enum lives in `scene/types.ts:242-253`, and grid-renderer casts `t.region as ObjectHitRegion` — confirmed at `hit-map.ts:301/335`, `grid-renderer.ts:2536/2553`.
- **Architectural fit is excellent.** The "single visual-extent helper used by both culling and broad-phase so they never diverge" idea targets a genuine root cause rather than patching symptoms, and the recommendation to apply the inverse transform to the query point in `HitMap` (option b) instead of duplicating matrix math across renderers is the correct call given the drift risk the plan itself names.
- **Cross-folder discipline.** The plan names `@mog/grid-canvas` as the sole consumer, flags the hit-region narrowing as a breaking change requiring atomic landing, and keeps engine/shape-engine signatures fixed. The "deferred behind a fallback" treatment of connection-site routing (resolver lives in shape-engine/kernel, ship the stroke-hit path independently) is mature scoping.
- **Verification gates are specific and falsifiable** — per-concern unit tests (memoized z-order parity, deterministic tie-break, rotated-corner hit/miss, fail-once image load, single-vs-multi-run wrap parity, ctx save/restore balance), plus dual-package typecheck to prove the cast removal compiles end-to-end.

## Major gaps or risks

- **Minor inaccuracy on chart bridge fail-fast.** The plan repeatedly states the dispatcher's `getChartBridge()` throws (e.g. evidence bullet on the double error boundary, `dispatcher.ts:81`). The actual dispatcher path is guarded: `case 'chart': if (!bridges.hasChartBridge()) break; renderChart(…, bridges.getChartBridge())`. So in the dispatcher the throw is avoided when no bridge is registered; the fail-fast lives in `bridge-registry`. This doesn't change the plan's conclusion (the dispatcher catch is still effectively dead for `withRenderContext` renderers), but the cited reachability example is slightly off.
- **Phase 2 leaves the contract decision open.** It recommends "narrow here" but frames it as a decision still to be made jointly with grid-canvas. For a plan this detailed, committing to the narrowing and specifying the exact typed mapping that replaces the two casts (and whether `OverlayHitResult.region`'s `HandleRegion` becomes the canonical handle type) would remove the last bit of ambiguity from the one truly breaking change.
- **Scope is large (7 phases / 13 steps).** Parallelization notes mitigate this, but the plan does not state which phases are independently shippable as separate PRs versus what must co-land. Only Phase 2's atomicity is called out; an explicit PR-decomposition would de-risk review and rollback.
- **LRU sizing is hand-waved.** Step 9 proposes max entries / optional byte accounting via `naturalWidth*naturalHeight*4` but picks no default bound and no eviction policy interaction with the "never evict on-screen this frame" rule beyond the prose note. A concrete cap (and behavior when the working set exceeds it) would make the test in step's gate meaningful.
- **Transform-match correctness is the highest-risk item** and the plan knows it (risks section), but the mitigation ("centralize the matrix") is asserted rather than specified — it does not state that `applyRotation`/`applyFlip` must be refactored into a single exported matrix builder consumed by both `withRenderContext` and `HitMap`. Without that refactor named as a step, the centralization is aspirational.

## Contract and verification assessment

The preserved-invariants section is the plan's best part: it enumerates the conformance surface (`id/zIndex/renderMode`, dirty-rect methods, `hitTest → HitResult | null`), the document-space bounds contract, topmost-first/group semantics, the `default: never` guard, and the bridge fail-fast/placeholder split — all of which match the code. The "strengthen" annotations (single visual-extent helper, exactly one error boundary, old∪new dirty bounds) are concrete and testable. Verification gates cover the behavioral risks well; the dual-package typecheck gate is exactly the right way to prove the cast removal. The one soft spot is that app-eval coverage is correctly deferred to CI/human, but the plan doesn't assert a pre-merge manual smoke for the rotated-click fix, which is the change most likely to be subtly wrong (sub-pixel matrix mismatch passes unit tests against a stub but fails against the real `withRenderContext` matrix).

## Concrete changes that would raise the rating

1. Correct the chart-bridge reachability example (`hasChartBridge()` guards the dispatcher throw) so the evidence is precise.
2. Commit Phase 2 to narrowing and write out the exact typed mapping replacing `grid-renderer.ts:2536/2553`, including the fate of `HandleRegion`/`OverlayHitResult.region` as the new canonical handle type.
3. Add a step that refactors the rotation/flip matrix into one exported builder shared by `withRenderContext` and `HitMap`'s inverse-transform query path, and a test asserting render-matrix and hit-inverse-matrix are exact inverses.
4. Specify concrete LRU defaults (max entries and/or byte budget) and the eviction-vs-on-screen interaction, and decompose the 7 phases into an explicit PR map noting which co-land vs. ship independently.
