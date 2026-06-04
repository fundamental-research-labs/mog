Rating: 8/10

Summary judgment

This is a strong, production-aware plan. It correctly treats `@mog/grid-canvas` as the orchestration facade between canvas-engine, grid-renderer, drawing-canvas, overlay, sheet-view, and spreadsheet callers, and it is well calibrated to the current source: `grid-renderer.ts` is a 2,844-line composition file with embedded adapters, an untyped `Record<string, (value: any) => void>` update table, private-method-bound tests, scene graph sync logic, invalidation policy, lifecycle, viewport projection, and public query methods all mixed together.

The rating is not higher because the plan is too broad for one implementation slice and some of its most important contracts are still described as intentions rather than enforceable acceptance criteria. It is architecturally right, but it needs tighter sequencing and a few missing production contracts before it becomes a near-perfect implementation spec.

Major strengths

- The scope and package role are accurate. The plan preserves grid-canvas as a facade and explicitly keeps cell painting in `@mog/grid-renderer`, drawing algorithms in `@mog/drawing-canvas`, and generic dirty/layout behavior in `@mog/canvas-engine`.
- It is production-path relevant. It names the actual sheet-view and spreadsheet paths that call `createGridRenderer()`, `updateContext()`, `setViewportLayout()`, `getRenderScheduler()`, and style adapters, and it rejects test-only optimization.
- The core invariants are strong: `updateContext()` remains O(number of patch fields), data callback identity changes do not dirty cells, buffer writes are the repaint signal, scroll invalidation avoids static chrome repaint, Rust-supplied object bounds are the production render source, and stale cross-sheet drawing hits must be suppressed.
- The test strategy targets real weak points in the current package. Existing tests do bind private prototype methods with `as any`, so extracting typed helpers and keeping smaller facade integration tests is the right direction.
- Verification gates are broad and mostly appropriate across grid-canvas, sibling canvas packages, sheet-view, repo typecheck, and real UI smoke flows.

Major gaps or risks

- The plan is a very large refactor disguised as a first slice: adapters, typed router, invalidation, scene graph sync, object patch semantics, composition factory, test migration, viewport integration, lifecycle races, style parity, CSS variables, package boundaries, and caller integration. It needs phase boundaries with explicit "done" criteria for each phase.
- Handler exhaustiveness is underspecified. The plan says to create an executable inventory and typed router, but it does not define the exact TypeScript shape that makes new `keyof RenderContextConfig` fields fail at compile time, how historical no-ops are encoded, or how expected dirty layers/request-frame behavior are kept in sync with production handlers.
- The scheduler contract has a concrete current-source gap that the plan only partly covers. `GridRenderScheduler` has `setPositionIndex`, `setMergeIndex`, and `setCellExpander`, but the current grid-canvas source does not wire them. The plan discusses `invalidateCells()` and the scheduler, but should explicitly require constructor/composition wiring and tests through `getRenderScheduler()`.
- The async sheet-switch race mitigation is listed mostly as a risk. The plan should make generation tokens or active-sheet guards a required scene graph sync contract, including what happens to late `getAllObjectBounds()` results.
- Performance protection is not measurable enough. The plan says the hot path must not deep clone or rebuild data sources and suggests benchmarking only if sensitive changes land, but this package needs an explicit allocation/markDirty-count guard for common `updateContext()` patches.
- Some verification remains manual at the most important boundary. The UI smoke list is good, but the plan would be stronger if it named the minimum browser scenarios that must be automated or recorded when viewport/hit-test/object contracts change.

Contract and verification assessment

The contract coverage is above average. The plan clearly identifies public facade APIs, data-source adapters, dirty-layer semantics, viewport projection, scene graph readback, style parity, and package ownership boundaries. It also includes the right package-level checks: `cd mog/canvas/grid-canvas && pnpm test`, `pnpm typecheck`, relevant sibling package tests when contracts change, sheet-view tests, repo typecheck for cross-package changes, and real UI-path smoke verification.

The main weakness is that several contracts are not yet machine-enforced. The context router inventory, invalidation matrix, scheduler wiring, scene graph generation guard, and package-boundary rule should be expressed as compile-time shapes or direct tests, not just comments or documentation. The plan's verification section is good enough to catch regressions after implementation, but the implementation steps should define the contract artifacts that make drift hard to introduce.

Concrete changes that would raise the rating

1. Split the work into phases with acceptance gates: inventory/router, adapter extraction, invalidation extraction, scene graph sync, viewport integration, style/CSS parity, and caller/UI verification.
2. Specify the typed router shape, for example a `satisfies { [K in keyof RenderContextConfig]: RenderContextFieldHandler<K> | HistoricalNoop<K> }`-style contract plus a test that asserts expected owner, dirty layers, request-frame behavior, and identity policy for every field.
3. Add an explicit scheduler wiring requirement: the renderer composition must inject `positionIndex`, `mergeIndex`, and the cell expander into `GridRenderScheduler`, and tests must prove `getRenderScheduler().markCellsDirty()` emits precise merge-aware dirty hints in the real composition.
4. Make scene graph race protection a concrete contract: introduce a generation token or active-sheet token for `syncSceneGraph()`, discard late results, and test switch-sheet-before-bounds-resolve behavior.
5. Add a focused hot-path performance gate for representative `updateContext()` calls: callback identity updates, selection updates, theme changes, and floating object patches should assert bounded dirty calls and no data-source reconstruction.
6. Define the minimum automated or scripted browser smoke scenarios for UI-facing changes, especially freeze/split scrolling, object move/resize, stale object hit suppression after sheet switch, inline editing style parity, and theme changes.
