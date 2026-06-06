Rating: 7/10

Summary judgment

This is a strong diagnostic plan with unusually good source-level grounding for the engine internals. It correctly identifies several real production-path issues in `mog/canvas/engine/src`: `PriorityScheduler` is instantiated and processed but has no production scheduling callers, `getStats()` is sourced from scheduler processing time rather than actual render cadence, `collectDirtyUnion` projects every dirty doc rect through every region, `CRITICAL_LAYER_IDS` hardcodes spreadsheet layer IDs in the generic engine, cache access is duck-typed, and browser capability handling has SSR/deprecation gaps.

The rating is held back because the plan is not fully executable as a contract. Its highest-impact scheduler path is left as a fork between "wire it" and "excise it", and the preferred wiring path necessarily crosses into the actual grid renderer owner in `canvas/grid-canvas/src/renderer/grid-render-scheduler.ts`, which the plan does not name. The plan also claims `canvas/grid-renderer` drives the engine, but the production engine construction and `RenderScheduler` implementation live in `canvas/grid-canvas`. That missing consumer path makes the migration and verification story incomplete.

Major strengths

- The plan focuses on production code, not test-only harnesses. The listed issues map to live engine code in `engine.ts`, `render-loop.ts`, `dirty-rect-accumulator.ts`, `input-capture.ts`, `canvas-host.ts`, `memory-detection.ts`, `text-measurer.ts`, and `color-utils.ts`.
- It preserves the right architectural invariants: zero domain knowledge, a single canonical coordinate transform, branded rects, single rAF ownership, deferred resize atomicity, resume-as-full-repaint, and stability of the `RenderScheduler` interface.
- The dirty-union finding is concrete and important. `collectDirtyUnion` currently converts each dirty doc rect with `docToCanvas()` for every region, so the plan's proposed region-window intersection is a real partial-repaint containment improvement.
- The error-boundary finding is also high quality. Hardcoded `'background'`, `'cells'`, and `'selection'` IDs violate the engine's generic package boundary and should become an explicit capability or config policy.
- Verification coverage is much better than average. The plan names existing engine tests, targeted new unit tests, downstream grid-renderer integration tests, type gates, and manual UI smoke scenarios.
- The plan correctly distinguishes the live `RenderScheduler` interface from the mostly dead `PriorityScheduler` class and warns not to mutate the kernel/sheet-view contract shape.

Major gaps or risks

- The actual production consumer path is misidentified. `createCanvasEngine()` and `GridRenderScheduler` are in `canvas/grid-canvas/src/renderer/grid-renderer.ts` and `canvas/grid-canvas/src/renderer/grid-render-scheduler.ts`, while `canvas/grid-renderer` mainly provides layers. Any plan to route invalidation through `PriorityScheduler` must explicitly modify or preserve `GridRenderScheduler`, its dirty expansion dependencies, and its request-frame behavior.
- Phase A is a decision tree, not a specification. "Wire the scheduler or excise it" is acceptable as investigation framing, but implementation planning should choose one target post-state or define a crisp decision criterion and both full contract diffs. As written, workers could implement incompatible outcomes.
- The preferred scheduler wiring path is under-specified. It does not define the new engine API, how `GridRenderScheduler.markCellsDirty()` preserves cell-to-doc-rect expansion before scheduling, how dedupe keys are computed for rect batches, how `requestFrame()` is guaranteed when work is queued while the loop is idle, or what happens to the existing public `engine.scheduler` property.
- The `critical?: boolean` migration is not safely sequenced. The plan notes a follow-up for grid-renderer, but leaving all formerly critical layers non-critical even temporarily can change failure behavior. This should be a same-change migration in the actual layer owner or a config default installed by the grid-canvas renderer.
- Per-region scroll scoping needs a stronger layer contract. The plan says to promote only layers/regions affected by changed scroll, but `CanvasLayer` does not currently declare which regions it renders into or whether a `once` layer is scroll-dependent. Without an explicit capability, the implementation may rely on layer IDs or guesses, reintroducing domain coupling.
- The verification list misses the most relevant downstream owner for scheduler behavior: `canvas/grid-canvas` tests, especially `grid-render-scheduler` and scroll-dirty coverage. It lists `canvas/grid-renderer` integration suites but not the package that creates the engine, exposes `getRenderScheduler()`, and bridges kernel writes to `engine.markDirty()`.
- The plan bundles many unrelated improvements. Dirty-region correctness, scheduler architecture, input coalescing, SSR safety, text wrapping, and hex alpha semantics are all reasonable, but landing them as one folder-improvement plan increases review and regression risk. The sequencing notes partially address this, but the success contract should separate mandatory defects from opportunistic hardening.

Contract and verification assessment

The stated invariants are mostly the right ones and are expressed in implementation-relevant terms. The coordinate-space, branded-rect, render-mode, rAF ownership, resize, and lifecycle constraints are clear enough for review. The strongest contract gap is around new capabilities: `CacheableLayer` is well-scoped, but critical-layer policy, scheduler enqueueing, and scroll-dependence need exact type shapes and caller responsibilities.

The verification plan is strong for `@mog/canvas-engine` itself: it includes existing Jest suites and targeted tests for dirty union, auto-coalesce, cacheable layers, error boundary, input cancellation, and SSR/capability detection. It should be expanded to include `canvas/grid-canvas` behavior gates and type checks for the duplicated `RenderScheduler` surfaces in `@mog/canvas-engine`, `@mog-sdk/contracts/rendering`, and `types/rendering`.

The app-eval/manual smoke gate is relevant but too broad to be the only production-path proof for scheduler and scroll changes. The plan should add focused production-path tests that drive `GridRenderScheduler.markCellsDirty()` through the real renderer stack and assert that engine dirty hints, frame requests, partial repaint bounds, and frozen-pane containment still hold.

Concrete changes that would raise the rating

1. Name `canvas/grid-canvas/src/renderer/grid-renderer.ts` and `grid-render-scheduler.ts` as the production engine owner and make their migration part of the required plan, not a vague downstream follow-up.
2. Pick the scheduler post-state, or define an explicit decision table with complete API diffs and tests for both the wiring and excision paths.
3. Specify the exact new engine scheduling API, including enqueue semantics, dedupe keys, budget handling, idle-loop wakeup behavior, stats ownership, and whether `CanvasEngineInstance.scheduler` remains public.
4. Add a first-class scroll-dependence/region-affinity contract before implementing per-region scroll promotion, rather than inferring from layer IDs or render modes.
5. Land the critical-layer migration atomically with the layer/config owner so the previous critical IDs do not silently lose protection.
6. Add `canvas/grid-canvas` tests and type gates to the verification list, alongside the existing engine and `canvas/grid-renderer` suites.
7. Split Phase E into a separate low-risk cleanup plan unless those utility fixes are required by a specific engine contract.
