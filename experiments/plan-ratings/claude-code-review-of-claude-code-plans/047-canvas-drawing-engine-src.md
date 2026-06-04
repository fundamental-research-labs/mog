Rating: 9/10

# Review of Plan 047 — Harden `mog/canvas/drawing/engine/src`

## Summary judgment

This is an excellent, evidence-grounded plan. Nearly every diagnostic claim is backed by a file:line citation that holds up under inspection, and the improvement objectives map cleanly onto the findings. I independently verified the core claims against the live source and found them accurate:

- **Purity contract is false for the renderer subtree.** `src/index.ts:10` does say *"Pure computation: no DOM, no Canvas, no React, no Yjs"*, yet `renderer/hit-test.ts:23,72,81` constructs `new DOMMatrix(...)`/`new DOMPoint(...)`/`new Path2D(...)`, and `renderer/canvas.ts:43` takes a `CanvasRenderingContext2D`. Confirmed.
- **Spatial scan + per-call sort.** `spatial/spatial-query.ts:69` does `[...objects].sort(...)` on every `hitTest` call. Confirmed; no index structure exists.
- **Renderer fidelity gaps are real coded fallbacks**, not hypotheticals: `renderer/canvas.ts:120` leaves text commented out; `:116` defers reflection; `fills.ts` patterns fall back to foreground color (`:105`), image fills are a bare `break` (`:112`); and in `strokes.ts`, `thickThin` (`:43-47`) and `thinThick` (`:48-52`) are **byte-identical** (`totalWidth * 0.6`, single stroke). Confirmed exactly as described.
- **`insertAtZIndex` (`z-order-manager.ts:169`) does not normalize** while `removeFromZOrder` does, and `diagnostics/validators.ts:84` emits `DRAWING_ZORDER_GAP` for precisely the gapped state `insertAtZIndex` can produce. Confirmed — a genuine self-contradiction within the module.
- **Anchor grid limits are inline literals** (`anchor-resolver.ts:90,104` = `16384`/`1048576`) with silent negative clamps (`:85-86`). Confirmed.
- **`computePathBounds` is a control-point hull** (`path.ts:96-102`, comment admits "conservative"). Confirmed.
- **Bridge and direct consumers exist** at the cited paths (`spatial-operations.ts`, `drawing-canvas/.../shape.ts`, `pdf/graphics/.../drawing-renderer.ts`), and the `exports` map serves `dist/*.js` for `import` / `src/*` for `development`. Confirmed.

The LOC/file count (4,024 / 26), package metadata, subpath exports, and `__tests__/` layout all match reality. This degree of fidelity between plan and codebase is rare and is the plan's defining strength.

## Major strengths

1. **Diagnosis precedes prescription, and the diagnosis is verifiable.** Twelve findings, each anchored to specific lines, each reproducible. The reviewer can trust the plan without re-deriving the problem space.
2. **The central architectural insight is correct and well-framed.** Identifying the false purity charter as "the central contract this plan must reconcile" is the right framing — it's the root cause behind the runtime `ReferenceError` hazard in PDF/worker/SSR paths, and Phase 1 addresses it structurally (export-map split + typed `DrawingRendererUnavailableError`) before any behavior changes.
3. **Backward-compatibility discipline.** The plan explicitly enumerates the bridge surface and renderer entry points as frozen signatures, designs the spatial index as additive overloads (linear path retained as the reference oracle), and keeps `pathToPath2D` as the uncached primitive while caching above it. The kernel bridge is correctly identified as needing no change.
4. **Honest non-goals.** Text layout and reflection compositing are deferred but made *explicit and diagnosable* (typed `unsupportedFeature` diagnostic) rather than left as silent blanks — a meaningfully better contract than the status quo.
5. **Sequencing and parallelization are sound.** Phase 1 lands first (mechanical, low-risk, referenced by later phases); invariant/anchor/snap work is correctly identified as touching disjoint files and parallelizable with renderer work.

## Major gaps or risks

1. **Image-fill change has a latent signature tension.** Phase 3 step 9 proposes that `renderFillToCanvas` "accept a pre-resolved image source map." That is a parameter addition to a frozen public entry point. The plan asserts "preserved public signatures" throughout, but adding an image-source argument is either an optional/additive param (fine, but say so) or a breaking change (not fine). The plan should explicitly state the image source is passed via an optional context/options param and confirm the existing zero-arg-context callers still compile.
2. **The performance gate is under-specified.** Test gate 3 asserts per-query work "does not grow linearly with object count past a threshold." No threshold, object count, or methodology is given. A property/perf test needs a concrete bound (e.g. queries at N=10k objects stay within Kx of N=100) or it cannot fail meaningfully. This is the weakest of the otherwise-strong verification gates.
3. **Spatial-index correctness oracle covers results but not stability of tiebreaks/ordering.** The plan says index-backed queries must return "identical results" to the linear reference. For `hitTest` (returns topmost) and `findNearby` (sorted by distance) the *ordering and tie-break* must match, not just the set. The parity test should assert order-equality, including z-tie behavior, not membership.
4. **Tight-bounds blast radius is acknowledged but not scoped.** The plan flags that shrinking AABBs could expose callers relying on the old loose box as padding and says to "audit `drawing-canvas` overlay code." Good — but it stops at "audit." Since this is a cross-package behavior change with no in-folder test that can catch a downstream overlay regression, the plan should name the specific overlay code paths and state whether the audit is a prerequisite or a follow-up.
5. **Scope is large for one plan.** Seven phases spanning a contract refactor, a new data structure, four renderer-fidelity fixes, a hit-test cache, invariant unification, anchor robustness, and a hot-loop optimization. The parallelization notes mitigate this, but the plan would be stronger with an explicit statement of which phases are independently shippable (Phase 1, 5, 6, 7 clearly are; Phase 3's pixel changes need coordinated re-baselining).

## Contract and verification assessment

**Contracts:** Strong. The "Preserve / Strengthen" split is the best section of the plan. Preserved invariants (bridge output shapes the kernel persists, immutability, compute-core purity, the injected-`idGenerator` pattern) are precisely named. Strengthened invariants are each given a concrete enforcement mechanism: the z-order `[0..n)` post-condition with `insertAtZIndex` normalization and reclassified `validateZOrder`; the `GroupInfo.bounds == computeGroupBounds(members)` invariant with a `recomputeGroupBounds` writer and a `staleBounds` check; and the transform↔AABB contract with a `computeRenderedBounds(obj)` helper to populate post-transform AABBs. Finding 7 (rotated objects mis-hit because broad-phase culls on a possibly-pre-transform AABB) is a subtle and genuinely valuable catch, and the proposed fix (document + dev-mode validator + a canonical bounds helper) is the right shape.

**Verification gates:** Mostly strong and tied to the existing `__tests__/` tree (which I confirmed exists with the claimed structure). Gates for cross-backend gradient parity, compound-stroke distinctness, gradient-stop opacity across color formats, tight bezier bounds vs. sampled extrema, and the z-order/group-bounds property tests are concrete and directly target the findings. The purity gate (import compute core in Node-without-DOM, assert renderer throws the *typed* error) is exactly right. Weaknesses are the under-specified perf threshold (risk 2) and the missing order-equality assertion (risk 3). The plan also correctly refuses to commit a refreshed `dist/`/`tsbuildinfo` and flags the stale-`dist` divergence hazard for CI — appropriate given the `import`-condition resolves to `dist`.

## Concrete changes that would raise the rating

1. **Pin the image-fill signature change.** State that image sources arrive via an optional options/context param on `renderFillToCanvas`/`fillToSVGAttributes`, and add a gate asserting existing callers (with no image source) compile and render unchanged.
2. **Make the perf gate falsifiable.** Specify object counts and a concrete sub-linearity bound (e.g. p95 query time at 10k objects ≤ K× the time at 100 objects, K named), or assert candidate-set size rather than wall-clock to avoid flakiness.
3. **Require order-equality in the spatial-index parity test**, including z-order tie-breaks and distance-sort stability, not just set membership.
4. **Name the `drawing-canvas` overlay paths** affected by tighter bounds and declare whether the audit blocks Phase 3 or is a tracked follow-up.
5. **Add a one-line "independently shippable" map** per phase, so the implementer knows Phases 1/5/6/7 can merge without the coordinated pixel re-baselining that Phase 3 requires.

None of these are architectural — they tighten an already-correct plan. The diagnosis quality, contract discipline, and verification design place this well above the median; the deductions are for the image-fill signature ambiguity, the soft perf gate, and the breadth of scope in a single plan.
