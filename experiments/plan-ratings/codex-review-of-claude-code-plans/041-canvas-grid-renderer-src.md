Rating: 7/10

Summary judgment

This is a strong, production-path-oriented plan with real source evidence and good respect for the renderer's core invariants: binary viewport buffer as truth, `CanvasLayer` layering, data-source injection, and once-layer region containment. The main findings are credible: the unbounded image cache, array-based LRU hot path, raw `console.warn`, missing-reader silence, unguarded injected metadata calls, and avoidable cell-loop allocations all exist in the target folder.

The rating is capped at 7 because the plan is not yet a fully verifiable implementation contract. It overstates some coverage gaps, under-specifies the new diagnostics API and its production wiring, proposes a vague runtime containment assertion whose mechanism is not described, and lists verification goals without exact package/type gates. It is directionally right and probably useful to implement after tightening, but it would still leave implementation agents making important contract decisions.

Major strengths

- It correctly frames `@mog/grid-renderer` as a pure rendering package rather than an app/UI package, and it explicitly preserves the data-source injection boundary and binary-buffer truth model.
- The problem discovery is mostly evidence-backed and focused on the production renderer path, not test harnesses or mocks.
- The cache work is systematic rather than one-off: bound image cache, improve LRU complexity, and preserve existing text cache bounds.
- The plan recognizes load-bearing invariants such as `withRegionBandClip` and the once-layer containment test instead of casually refactoring around them.
- It includes characterization tests before risky rendering refactors in intent, especially for alignment behavior and fault isolation.
- The parallelization notes are useful: cache work, allocation pooling, alignment refactor, and test backfill are mostly separable.

Major gaps or risks

- The audit has factual misses around existing tests. `coordinates/coordinate-system.ts` is not only indirectly covered; there are already co-located coordinate tests for document/layer viewport conversion, hidden headers, click position, visibility, and index behavior. There are also existing cell tests for center-continuous alignment, fills dark mode, font family, interactive elements, text alignment, and vertical alignment. More coverage may still be needed, but the plan should distinguish actual gaps from already-covered areas.
- The diagnostics sink is under-specified and not fully wired to the production path. `viewports/scroll.ts` exports pure functions like `applyScrollBehavior`; threading diagnostics only through `GridLayersConfig` does not reach those functions unless their signatures, callers, and tests are explicitly changed. The main host caller in `canvas/grid-canvas` would also need a way to provide the sink if host telemetry is the goal.
- The runtime once-layer containment assertion is too vague. `withRegionBandClip` can apply a clip, but it cannot observe arbitrary `ctx.fillRect`, `strokeRect`, `fillText`, or path paints without a context proxy or engine/test-style instrumentation. The plan should specify the mechanism and cost model, or downgrade this to additional structural/app-eval instrumentation.
- The plan says it will solve the O(n) LRU hot path in text measurement, but `TextLayoutCache` in the same service has the same `accessOrder: string[]`, `indexOf`, `splice`, and `shift` pattern. If the category is "array LRU in text measurement service", the plan should cover both caches or explicitly explain why layout cache churn is out of scope.
- The image cache eviction semantics are ambiguous for in-flight loads. "In-flight entries are evicted only after settle" can still allow unbounded pending image entries on a sheet with thousands of unique sources. The plan needs a total bound, stale callback handling, and a policy for evicted pending loads.
- The allocation-pooling objective lacks a baseline and acceptance criteria. It names some allocations, but leaves other obvious per-frame allocations in place, including `docToRegionXY` result objects, Pass 2 spread-created `textCellInfo` objects, center-across `Set`s, and row collection sets. That may be fine, but the plan should define the measured target rather than imply complete GC pressure elimination.
- Step ordering is inconsistent: step 7 refactors alignment renderers, while step 9 says the characterization tests must be written before step 7. The sequence should make tests a prerequisite, not a later step.
- The plan mixes implementation guidance with the review worker's current constraints by saying commands are out of scope. An implementation plan should still state exact verification commands for the worker who will implement it.

Contract and verification assessment

The preserved-contract section is one of the plan's best parts. It names the right invariants: package purity, z-index and render-mode stability, binary-buffer skip semantics, `CoordinateSystem` authority, once-layer containment, and unchanged public exports.

The new contracts need more precision. `RendererDiagnostics` should specify exact methods, code names, detail payload shape, throttling scope, lifecycle, export status, and how `updateDataSources` or direct layer constructors update it. If it is part of the public `GridLayersConfig`, it should be exported through `index.ts` and tested as a public API. If `scroll.ts` gets diagnostics parameters, the plan should call out the signature changes and all callers that must be updated.

Verification is directionally good but not concrete enough. For TypeScript changes in this package, the plan should require the package test and type gates, for example `cd mog/canvas/grid-renderer && pnpm test` and `pnpm typecheck`, plus any root or filtered gate the repo expects for public API changes. The named new tests are useful, but the LRU "complexity guard" should avoid timing-flaky Jest assertions; prefer deterministic hit/evict-order tests plus an instrumented operation-count check or a dedicated perf benchmark if performance is the acceptance criterion.

Manual verification should also be less vague. If diagnostics are meant to reach the app host, add a grid-canvas/browser check that proves missing-reader and scroll-link diagnostics are observable through the host path with no console spam. If the plan remains confined to `grid-renderer`, state that the sink is a local package contract and host telemetry integration is a follow-up.

Concrete changes that would raise the rating

1. Correct the coverage audit to list existing coordinate and cell tests, then identify the remaining specific uncovered branches or invariants.
2. Define `RendererDiagnostics` as an exact contract: method signatures, payloads, code registry, throttling rules, default no-op behavior, public export, constructor/factory propagation, and update semantics.
3. Decide whether diagnostics must be wired into `canvas/grid-canvas` for production observability. If yes, include that dependency explicitly; if no, narrow the objective to package-local observability.
4. Replace all array-backed LRU structures in `text-measurement-service.ts`, including `TextLayoutCache`, or justify the exclusion with measured evidence.
5. Specify bounded image-cache behavior for pending loads, stale `onload`/`onerror` callbacks, and total entry limits.
6. Reorder the implementation so characterization tests for alignment, LRU parity, image eviction, and fault isolation are written before the refactors they protect.
7. Give the once-layer runtime assertion a concrete implementation mechanism, or move it to a follow-up plan if it requires canvas-engine instrumentation.
8. Add exact verification commands and acceptance criteria: package tests, package typecheck, public API/export checks where applicable, and a production-path browser/app check for diagnostics or rendering behavior.
