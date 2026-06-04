Rating: 8/10

# Review of Plan 041 — Harden `mog/canvas/grid-renderer/src`

## Summary judgment

This is a strong, evidence-grounded hardening plan. It demonstrates genuine source-level understanding of the grid renderer rather than generic refactor boilerplate: nearly every claim cites a real file and line number, and spot-checking those citations against the actual source confirms them. The plan correctly identifies the load-bearing invariants of this package (purity, the `CanvasLayer` wire contract, binary-buffer-as-truth with skip-when-absent, `'once'`-layer paint containment, `withRegionBandClip`'s try/finally) and frames its work explicitly as *preserve these / strengthen these* rather than rewrite. The scope is well-bounded to the folder plus co-located `__tests__`, with cross-folder edits (canvas-engine, contracts) consciously deferred and flagged as coordination points. Sequencing is sensible (diagnostics sink lands first; characterization tests precede the alignment refactor they protect). The main weaknesses are an overstated test-coverage gap and a fairly large work surface (10 items) for a single plan.

I verified the following claims directly against source and found them accurate:
- `imageCache` is an unbounded `Map` with only `.get`/`.set`, no eviction (`layers/cells.ts:235,984-996`). ✔
- Array-based LRU with `indexOf`/`splice`/`shift` in the measurement hot path (`services/text-measurement-service.ts:187-205`). ✔
- Reader-absent early return with no diagnostic (`cells.ts:371-373`), `moveTo`-miss silent skip (`cells.ts:410`). ✔
- Per-frame `dirtyRectsDoc = ...map(canvasToDoc)`, per-cell `{ row, col }` coord, `visitedMerges` Set per call (`cells.ts:378,385`; `layout/for-each-visible-cell.ts:91`). ✔
- Raw `console.warn` for linked-viewport contract violations (`viewports/scroll.ts:67,72`). ✔
- Un-guarded data-source calls in the cell loop (`cells.ts:447,449,450`). ✔
- Six alignment renderers sharing the same prologue, with only `renderAlignedLine` (`alignment.ts:616`) factored out. ✔
- The `OnceLayerWithChrome` "original bug dressed up as a fix" author note (`base-layer.ts:41-48`) and the containment test (`__tests__/once-layer-region-paint-containment.test.ts`). ✔
- The outline TODO and its `viewportLayout`/`OutlineRenderContext` dependency (`features/outline-renderer.ts:166`). ✔

## Major strengths

1. **Contract literacy.** The plan reads the package charter from `index.ts` and treats z-indices/`renderMode`s in `factory.ts` as a compositor wire contract that must not change. It explicitly forbids adding a fallback data path, recognizing that binary-buffer-as-truth's skip-when-absent is a deliberate divergence-avoidance design, not a bug. This is the kind of distinction that separates a safe hardening plan from a destructive one.

2. **Correctly-scoped, low-regression changes.** Every objective is either a bounded internal optimization (cache bound, O(1) LRU, allocation pooling), an observability add (diagnostics sink, no-op by default), an internal refactor protected by characterization tests, or pure test backfill. None alters public exports, contracts, or visible behavior.

3. **Allocation-pooling done with the right caution.** The plan explicitly distinguishes structures safe to pool (the container array, the dirty-rect conversion array, non-escaping scratch coords) from the per-cell `CellRenderInfo` objects that Pass 2 reads in the same frame and must stay distinct. This aliasing hazard is the single easiest way to corrupt a two-pass renderer, and the plan calls it out as a named risk with a mitigation.

4. **Tests-before-refactor discipline.** The alignment characterization suite (step 9) is written against current behavior and gates the step-7 extraction; the LRU parity test locks exact eviction-victim order before swapping the data structure. These are the two changes most likely to silently regress, and both are protected.

5. **Honest about what it does not run.** Given the worker constraints, the plan cleanly separates the gates it *defines* from the commands a later non-restricted worker/CI must *execute*, and lists concrete manual app-eval checks (GC sawtooth, pixel-identical freeze panes, debug-flag noise).

## Major gaps or risks

1. **The test-coverage gap (problem #8) is overstated.** The plan asserts that `alignment.ts`, `fills.ts`, and "nearly all of `cells/`" have *no* co-located `__tests__`. In fact `cells/__tests__/` already contains `alignment-center-continuous.test.ts`, `text-alignment.test.ts`, `fills-dark-mode.test.ts`, `vertical-align.test.ts`, `font-family.test.ts`, and `interactive-elements.test.ts`. So alignment and fills *do* have behavioral coverage, just under topic-named rather than file-named test files. The proposed `cells/__tests__/alignment.test.ts` (step 9) risks duplicating `text-alignment.test.ts`/`alignment-center-continuous.test.ts`. The directional point still holds — `borders.ts`, `data-bars.ts`, `icon-sets.ts`, `indicators.ts`, `text-overflow.ts`, `rotated-text.ts`, `shrink-to-fit.ts`, and the 1275-LOC `coordinate-system.ts` genuinely lack dedicated tests — but the plan should audit existing coverage first and target the real holes, not re-cover what exists.

2. **Breadth over depth.** Ten work items spanning caches, LRU internals, allocation pooling, a new diagnostics subsystem, fault isolation, an alignment refactor, a dev-assertion, and five+ new test files is a lot for one plan. Several are independently shippable (image-cache bound, measurement LRU, alignment refactor). The parallelization section acknowledges this, but the plan would be stronger split into a "memory/perf" plan and a "observability/robustness" plan, each landable and reviewable on its own. As written, a reviewer must approve all of it at once.

3. **Diagnostics-sink design is under-specified at the seam that matters most.** The plan wisely defines a *local* `RendererDiagnostics` interface to avoid cross-package churn, but threading it through `GridLayersConfig` vs. eventually living in canvas-engine's `FrameContext` is left as a "coordinate later" decision. If it lands in `GridLayersConfig` now and later moves to the engine, every layer's call site churns twice. Picking the long-term home up front (even if the local interface is a temporary shim) would de-risk this.

4. **The `'once'`-containment dev-assertion (step 8) is the vaguest item.** "Validate at runtime that paints fall inside the band/chrome" is non-trivial — it implies intercepting `ctx` draw calls or tracking a bounding box, which is exactly the kind of per-frame instrumentation the allocation-pooling objective is trying to *reduce*. The plan notes it's behind a debug flag and no-op when off, but doesn't sketch *how* containment is measured, which is the hard part. This item carries the most design uncertainty and the least concrete spec.

5. **Minor internal inconsistency.** Problem #7 heading says "seven alignment renderers" but then lists and operates on six (confirmed: six exported `render*` functions in `alignment.ts`). Cosmetic, but in a plan whose credibility rests on precise counts it slightly undercuts trust.

## Contract and verification assessment

The contract section is the best part of the plan. The Preserve/Strengthen split is concrete and tied to specific files and tests, not aspirational. "Bounded memory," "O(1) LRU," "one bad cell ≠ blank grid," and "observable skips" are each turned into a named, testable invariant with a corresponding gate. The regression gate enumerates the actual existing invariant suites by filename (once-layer containment, text-clipping, shimmer, overflow-index, dirty-rect-animations, integration), which I confirmed exist. The five new gates map one-to-one onto the new behaviors and include a parity gate (LRU victim order) and a complexity guard (flat eviction cost) — appropriately defensive for the two riskiest changes.

Two caveats: (a) the "complexity guard" / "flat eviction cost as size grows" microbenchmark-style test is notoriously flaky in CI (timing-sensitive); the plan should specify it as an operation-count assertion (e.g., count `Map` ops, not wall-clock) to be deterministic. (b) The fault-isolation gate is well-specified, but the plan should also assert that the diagnostics counter throttling does not itself allocate per frame — it names this as a risk but does not give it a gate.

## Concrete changes that would raise the rating

1. **Re-audit existing `cells/__tests__` coverage** and rewrite problem #8 to reflect what already exists; target backfill at the genuinely untested primitives (`borders`, `data-bars`, `icon-sets`, `indicators`, `text-overflow`, `rotated-text`, `shrink-to-fit`) and `coordinate-system.ts`, and drop or merge the proposed `alignment.test.ts` to avoid duplicating `text-alignment.test.ts`.
2. **Split into two landable plans** (memory+perf; observability+robustness+tests), or at minimum mark which items are independently mergeable so review and rollout can be staged.
3. **Commit to the diagnostics-sink home now** (local interface as explicit temporary shim with a documented migration path to `FrameContext`), so call sites don't churn twice.
4. **Spec the `'once'`-containment assertion mechanism** (how a paint's bounds are captured and compared) or downgrade it to a clearly-labeled stretch goal; it is the least-defined and highest-uncertainty item.
5. **Make the LRU complexity guard deterministic** (assert operation counts, not timing) and **add a gate** that the throttling wrapper is allocation-free per frame.
6. **Fix the "seven vs six" alignment-renderer count** for internal consistency.

Overall: a well-researched, contract-aware, appropriately conservative plan whose biggest issues are a slightly inaccurate coverage claim and over-broad scope rather than anything architecturally unsound. Tightening those would push it to a 9.
