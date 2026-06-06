Rating: 8/10

Summary judgment

This is a strong plan for `mog/canvas/grid-renderer/src`. It identifies the real production path instead of optimizing isolated helpers, correctly includes `grid-canvas`, `canvas-engine`, viewport contracts, and sheet-view wiring as adjacent constraints, and it names concrete defects that are visible in the current code: the registered `GridHitTest` still uses fixed header dimensions, `GridRendererImpl.hitTest()` still falls back to `CoordinateSystemImpl.classifyPoint()`, `CellsLayer` clears frame-level maps inside each per-region render, optional dependency updates cannot reliably clear stale readers/providers, in-cell image loads mark the whole cells layer dirty, and legacy viewport helpers still carry linear scans and scrollbar approximations.

The main weakness is that the plan is closer to a multi-quarter architectural program than a crisp implementation contract. It has the right direction, but several central abstractions are named without enough API shape, ownership, lifecycle, compatibility, or acceptance criteria for parallel agents to compose safely. It would rate higher if it split the work into phase-level contracts with precise type signatures and "done means" checks for each production path.

Major strengths

- The plan is grounded in the actual renderer composition path. It does not treat `grid-renderer` as an isolated package; it explicitly accounts for `grid-canvas` layout construction, `canvas-engine` transforms and hit-test priority, public contracts, binary viewport buffers, and sheet-view wiring.
- The geometry unification objective is architecturally correct. Current code already has layout-aware helpers in `viewports/hit-testing.ts`, but `GridHitTest`, `CoordinateSystemImpl`, visual handle helpers, and `GridRendererImpl.hitTest()` can still disagree. Making `ViewportLayout` the canonical input is the right direction.
- It preserves important package boundaries: `grid-renderer` remains UI-framework independent, must not import `grid-canvas`, and should consume public contracts and engine transforms rather than app internals.
- It recognizes hot-path constraints. The plan keeps `ViewportPositionIndex`, `ViewportMergeIndex`, and the binary reader as source-of-truth pieces, and it warns against falling back to dimension providers or duplicate `CellDataSource` reads.
- Verification is production-path oriented. The required tests span `grid-renderer` and `grid-canvas`, and the browser verification calls out real pointer and keyboard paths after scroll, zoom, frozen panes, split panes, hidden headers, hidden rows/columns, and overlays.
- Parallelization notes are useful. The proposed agent split mostly follows real dependency boundaries: geometry first, then hit testing and coordinate compatibility, frame lifecycle before `CellsLayer` frame state, optional clearing independent, metadata migration as a separate stream.

Major gaps or risks

- The canonical `RendererGeometry` / `GridGeometryContext` is not specified enough. The plan lists data it should carry, but not the exact methods, mutability model, update path, ownership, or type provenance. Parallel agents need to know whether this is a passive data object, a service with `pointToCell` / `rangeToRects` methods, a snapshot per frame, or a mutable renderer singleton.
- The update contract between `grid-canvas` and `grid-renderer` is vague. "Make grid-canvas update this context" needs an explicit API, such as `gridLayers.updateGeometry(snapshot)` or a hit-test provider config update. Without that, different agents may invent conflicting bridges.
- The hidden row/column behavior is called out as important, but the plan does not define the rule. Current paths sometimes skip to the next visible cell; resize and hidden-boundary affordances may need different answers. The plan should specify target semantics before implementation.
- The canvas-engine lifecycle hook is under-specified. "Extend the contract, or add a duck-typed optional hook" is too loose for a foundational engine change. It should define whether `beginFrame` and `endFrame` run once per dirty layer, once per canvas, before cache rendering, after cache compositing, on error, on no-region frames, and for once-mode layers.
- The `CellsLayer` refactor objective is correct but too broad. Splitting painters, introducing frame plans, changing key types, preserving binary source-of-truth behavior, and reducing allocations can each alter rendering. The plan needs a staged acceptance order and golden behavior checks before and after the refactor.
- Metadata migration is dependent on contracts and producers outside this folder, but the plan only says to inventory and choose destinations. It should name the expected categories, the payload or side-table contract for each, and the fallback metrics that determine when the migration is complete.
- Public export cleanup is risky. The plan says to remove or quarantine legacy viewport helpers, but it does not specify compatibility expectations for public package consumers, deprecation strategy, or type-test coverage for removed barrel exports.
- Performance goals are observational but not bounded. Recording frame time, visible-cell count, metadata fallback calls, allocations, and dirty rect counts is good, but the plan should define baseline scenarios and acceptable regressions for hit-test correctness work versus `CellsLayer` allocation work.

Contract and verification assessment

The plan is strongest on contract intent: canonical geometry, public dependency direction, binary reader source-of-truth, document-space dirty rects, and real UI input paths are all explicitly stated. That is the right level of seriousness for this folder.

The missing piece is executable contract clarity. For geometry, the plan should include a concrete API surface, for example methods for canvas point to viewport hit, canvas point to cell, cell/range to per-region canvas rects, header/gutter bounds, divider spans, and handle bounds. It should also say which existing helpers become wrappers and which become the only formula sites.

For optional updates, the plan correctly identifies that `Partial<CellsLayerConfig>` makes `undefined` mean both "leave unchanged" and "clear". It should define a specific `SetOrClear<T>` shape, where `null` clears and `undefined` is not accepted on fields that are present, then apply the same contract consistently through `factory.ts`, `CellsLayer.updateDataSources`, and the `grid-canvas` render-context handlers.

For verification, the command list is good for package-level checks, and the targeted contract tests are relevant. The browser verification is also rightly production-path focused. To be fully actionable, the plan should add exact automated E2E or app-eval scenarios for the highest-risk hit-test paths, plus before/after perf fixture names and metrics thresholds for the `CellsLayer` hot path.

Concrete changes that would raise the rating

- Add a concrete `RendererGeometryContext` API proposal with type imports, snapshot/update semantics, and a list of old helpers that must delegate to it.
- Define hidden row/column hit semantics in a truth table covering cell hits, resize hits, hidden-boundary hits, header hits, merged cells, and frozen/split panes.
- Replace the engine lifecycle bullet with an exact `CanvasLayer` extension contract: method names, invocation order, error behavior, cache behavior, and tests in `canvas-engine`.
- Break the implementation into smaller phases with mergeable acceptance criteria: geometry contract, layout-aware grid provider, coordinate facade, frame lifecycle, explicit nullable updates, dirty image invalidation, `CellsLayer` decomposition, metadata migration, legacy export cleanup.
- Specify public API compatibility for retiring viewport helpers: keep/deprecate/remove decisions, affected consumers, and type tests.
- Add measurable perf gates for the cells refactor, including named scenarios and acceptable deltas for frame time, allocations, metadata fallback calls, dirty rect count, and skipped reader cells.
- Expand the verification section with exact production browser scenarios or app-eval specs for overlay pass-through, frozen/split hit testing, formula handles, fill handles, table resize, header resizing, hidden headers, hidden rows/columns, and high-DPR fractional zoom.
