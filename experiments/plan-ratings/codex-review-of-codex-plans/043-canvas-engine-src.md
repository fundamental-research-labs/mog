Rating: 8/10

Summary judgment

This is a strong, source-grounded plan for `canvas/engine/src`. It identifies real contract mismatches in the production code, especially input coordinate semantics, render-loop cache duck typing, visibility cache invalidation, scheduler/render stats conflation, hardcoded spreadsheet layer IDs, and single-canvas proxying. It also treats the engine as a generic public package and correctly includes downstream production consumers such as `@mog/grid-canvas`, `@mog/grid-renderer`, drawing, overlay, contracts/types mirrors, sheet view, and the spreadsheet app.

The main reason this is not a 9 or 10 is that it reads more like a full engine stabilization program than an executable implementation plan. The work is architecturally appropriate, but the plan needs tighter milestone boundaries, explicit public API migration contracts, and named acceptance tests for the breaking contract changes before multiple implementation agents could safely execute it in parallel.

Major strengths

- The plan is accurately calibrated to the production path. The inspected code supports the core findings: `CanvasInputEventBase.worldPosition` is documented as document-space while `InputCapture` emits raw offset coordinates, `RenderLoop` duck-types `getOrCreateCache` and `clearCache`, `createCanvasEngine` proxies layers with `Object.create` in single-canvas mode, `LayerRegistry.setVisibility()` does not dirty sorted caches, and engine stats are derived from scheduler processing stats.
- It protects the package boundary. The repeated insistence that `@mog/canvas-engine` stay domain-free is important, and replacing hardcoded `background`/`cells`/`selection` critical IDs with layer-owned policy is the right architectural direction.
- It correctly treats coordinate-space helpers as a central contract. The plan recognizes that frozen-pane correctness depends on the canonical `viewportOrigin + scrollOffset` formula and proposes both documentation cleanup and enforcement against reintroducing inline transform math.
- The dirty-rect section is thoughtful. It calls out clipping against region visible extents, clamping to canvas bounds, full-promotion reasons, cache compositing, fractional zoom/DPR, and frozen-pane coverage instead of only optimizing the obvious one-rect case.
- Verification expectations are production-relevant. The plan requires real browser-backed canvas and UI input checks, not just mocked Jest rendering, and it explicitly preserves the "E2E uses real input paths" rule.

Major gaps or risks

- The sequencing is too broad for a single implementation pass. Steps 2, 5, 6, 8, and 9 each change public contracts or core render behavior; the plan should split them into independently shippable milestones with dependency order, owner packages, and rollback criteria.
- The public API migration story is under-specified. Changing input event payloads, `EngineStats`, cache capability interfaces, error policy, and possible scheduler exposure can break downstream TypeScript consumers. The plan says to update consumers, but it does not define the exact new shapes, deprecated fields, compatibility window, or how contract mirrors in `contracts/src/rendering` and `types/rendering` should evolve.
- The scheduler wake contract remains ambiguous. The plan asks whether `PriorityScheduler.schedule()` should wake the loop or whether an engine wrapper should do it, but it should make a concrete recommendation because direct access to `CanvasEngineInstance.scheduler` is already public-ish through the extended engine instance.
- The dirty mapper needs sharper acceptance criteria. "Preserve multiple dirty rects below a threshold" and "promote when unsupported layer mix makes partial repaint worse" are right ideas, but the plan should specify threshold inputs, deterministic promotion reasons, and how mixed cached/non-cached layers affect per-canvas repaint safety.
- Hardware policy adaptation is directionally correct but could become a large subsystem without success criteria. The plan should define what data is available synchronously, how many canvas/cache allocations are counted, when a mode transition is allowed, and whether live multi-to-single transitions are in scope or a separate follow-up.
- The static coordinate-formula audit gate is useful but vague. It needs a concrete target, such as a package-local structural test or lint script with allowed helper files and allowed test fixtures, otherwise implementation agents may produce inconsistent enforcement.

Contract and verification assessment

The contract assessment is the plan's strongest part. It identifies mismatches between comments, exported types, and runtime behavior, and it frames fixes as executable contracts rather than cleanup. The most important contracts are covered: layer render coordinate semantics, input coordinates, cache capability, layer error policy, scheduler wake semantics, visibility repaint behavior, stats ownership, dirty rect mapping, canvas routing, and DOM lifecycle.

The verification plan is also strong but not yet fully actionable. The package gates are plausible and correctly include downstream packages that consume engine contracts. Browser and UI verification are called out, including real pointer/wheel input and pixel/screenshot assertions. What is missing is a named set of required new tests per milestone, with a clear distinction between unit tests, browser-backed engine tests, and spreadsheet Playwright scenarios. Without that, an implementation could run many checks while still missing the specific contract regressions this plan is trying to prevent.

Concrete changes that would raise the rating

- Break the work into 4-6 ordered milestones, for example: contract documentation/type inventory, explicit layer capabilities/error policy, registry/single-canvas routing fixes, dirty mapper, input coordinate payload, stats/scheduler/hardware policy. For each milestone, list touched packages and acceptance tests.
- Specify the exact new TypeScript contracts for `CacheableCanvasLayer`, dirty-capable layers, layer error policy, input coordinate payload, render-loop stats, scheduler summaries, and hardware policy before implementation starts.
- Define a migration policy for breaking input and stats changes: whether old fields are removed immediately, renamed, or temporarily retained with clear semantics.
- Make scheduler wake semantics a decision, not an open question, and state whether direct scheduler access remains part of `CanvasEngineInstance`.
- Add explicit dirty mapper invariants: clipping math, canvas-bound clamping, multi-rect thresholds, full-promotion reasons, and behavior for mixed cached/non-cached layers.
- Name the browser-backed tests or test harness location that must prove real canvas allocation/compositing, DPR/resize behavior, pointer/wheel input, freeze-pane hit testing, and stale-pixel prevention.
