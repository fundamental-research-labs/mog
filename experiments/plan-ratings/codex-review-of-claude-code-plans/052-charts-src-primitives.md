Rating: 8/10

Summary judgment

This is a strong, source-grounded hardening plan for `mog/charts/src/primitives`. It correctly treats the folder as a production rendering layer rather than an isolated utility bundle, and its main findings match the code: non-rect/arc paint bounds collapse to 1x1 in `CanvasRenderer`, standalone symbol/path/text renderers call `applyStyle` without mark bounds, `drawText` has an unreachable rotation branch, `styleKey` and `applyStyle` resolve effects/shadows differently, `niceLinear` has the descending-domain formula bug, hit-testing owns better bounds than the renderer but uses a heuristic text path, and `WebGLRenderer` lacks context-loss handling and point-size clamping.

The rating is not higher because a few parts are still too loose to hand to implementation agents as a complete contract. The plan names many correct fixes, but some acceptance criteria are not mechanically defined, the test runner is misstated, the WebGL layering contract conflicts with backend interchangeability unless backend selection is specified, and the expanded color parsing scope is not fully tied to current color producers.

Major strengths

- The scope is accurate. The file inventory matches the folder, and the plan correctly keeps `ChartMark` IR ownership in `@mog-sdk/contracts/bridges` instead of forking mark types in primitives.
- The plan targets the production render, scale, and interaction paths. It focuses on `CanvasRenderer`, `WebGLRenderer`, `GridHitTester`, mark renderers, and scale implementations used by chart engines and grammar consumers, not on test-only helpers.
- The defect list is concrete and credible. The current renderer has simplified 1x1 bounds for symbols, paths, and text; text measurement is split between real-canvas and heuristic paths; path picking is bbox-only; WebGL parses a limited color subset and sends unclamped `gl_PointSize`; and descending `niceLinear` uses `start * step` instead of the positive branch's dimensional form.
- The preserved-contract section is unusually useful. Painter order, backend interchangeability, scale copy/getter semantics, tick niceness, fill/stroke gating, purity boundaries, and graceful paint fallback are the right invariants for this subsystem.
- Sequencing is mostly sound: establish tests, fix render correctness, unify geometry, repair scales, harden WebGL, then tighten types. The parallelization notes are also realistic because scale math, WebGL, and test harness work touch mostly disjoint files.
- Risks are candid. The plan calls out visible gradient changes, batching key performance, precise path picking cost, DPR/SSR/empty arrays, and the GL/2D dual-canvas limitation.

Major gaps or risks

- The test runner is wrong in the plan text. It asks for "Vitest" tests, but `@mog/charts` currently has `test: jest`, `jest.config.cjs`, `ts-jest`, and existing `__tests__/**/*.test.ts` Jest tests. The implementation plan should either use Jest or explicitly include a Vitest migration contract.
- Phase 0 says it will lock current intended behavior before edits, but several current behaviors are known-bad. Regression tests for gradient bounds and descending `niceLinear` should be red-first bug tests or written with the corrected expected behavior, not characterization tests that freeze the existing collapse/bug.
- Backend interchangeability is underspecified. The plan says Canvas and WebGL output should be visually equivalent, but it also acknowledges that the WebGL canvas renders circles below an overlaid 2D fallback canvas, making true interleaved z-order impossible. The plan should specify the production rule: detect mixed/interleaved mark streams and choose all-Canvas, or accept the layering limitation with explicit engine-level selection criteria.
- Visual acceptance criteria are too vague for rendering changes. Canvas-call recorder tests are useful, but they do not prove pixel fidelity, antialias tolerance, gradient geometry, text positioning, or WebGL/Canvas parity. The app-eval visual smoke should name scenarios, oracle type, and tolerance.
- The broadened `parseColor` objective is partly unproven. Current chart style resolver evidence mostly points to hex colors and comma `rgba(...)` strings. If modern `rgb(r g b / a)`, `hsl()`, or `currentColor` are real producer outputs, the plan should cite the producer path or add a producer fixture; otherwise this is speculative scope.
- Geometry unification needs a sharper API decision. Promoting hit-tester bounds or extracting `marks/bounds.ts` is directionally right, but the plan should define whether bounds are conservative paint bounds, exact geometry bounds, stroke-inclusive bounds, or interaction bounds. Text and path bounds need especially clear semantics.
- Type tightening is plausible but not yet a contract. "Replace casts with a typed-overload helper" leaves implementers to discover the helper shape and declaration behavior. This is lower risk than rendering, but public-scale fluent APIs deserve exact before/after type expectations.

Contract and verification assessment

The existing-contract assessment is strong. It preserves contract-owned IR, painter's algorithm ordering, getter/setter copy semantics, `copy()` independence, degenerate-domain behavior, tick niceness, and the fill/stroke renderability predicates. Those are the right load-bearing contracts.

The new contracts need more precision. Bounds unification should declare one bounds taxonomy and which consumers use each category: paint bounds for gradients, spatial-index bounds for candidate retrieval, exact hit geometry for narrow phase, and text measurement bounds when a canvas context exists. The WebGL contract should define when the renderer is allowed to split marks by backend and when the chart engine must fall back to Canvas to preserve z-order. `parseColor` should define supported syntaxes as a producer-backed table, not an open-ended CSS subset.

Verification is directionally good but should be made executable. The package gates should be `pnpm --filter @mog/charts test` and `pnpm --filter @mog/charts typecheck`; contract changes should add the appropriate `@mog-sdk/contracts` build/type gate before charts typecheck. The plan should remove the Vitest wording unless the package is migrated. For rendering, add deterministic recorder tests plus at least one production-path visual/pixel gate for gradients, text, and mixed Canvas/WebGL behavior. For hit-testing, include exact interaction-path tests that exercise `interaction/pick.ts` or the engine path that constructs the hit tester, not only isolated geometry helpers.

Concrete changes that would raise the rating

1. Replace "Vitest" with the actual Jest test harness, or add an explicit runner migration plan with package/config changes and verification commands.
2. Split Phase 0 into characterization tests for intended existing behavior and red-first regression tests for known bugs such as gradient bounds and descending `niceLinear`.
3. Define a canonical bounds contract: paint vs. spatial candidate vs. exact hit-test bounds, stroke inclusion, text measurement authority, and fallback behavior when no measuring context exists.
4. Resolve the WebGL z-order contract by specifying engine/backend selection for mixed mark streams where GL/2D layering would change painter order.
5. Add concrete visual verification: named chart fixtures/scenarios, pixel or screenshot tolerance, and coverage for gradient-filled symbols/paths/text plus mixed scatter/non-scatter layering.
6. Tie `parseColor` expansion to actual producer outputs from style resolver/theme/algebra paths, or reduce it to syntaxes currently emitted plus a documented future extension.
7. Specify the type-tightening helper and compile-time assertions in enough detail that the fluent scale API and `ChartScale` facade can be verified without implementer invention.
8. Name the exact follow-up gates: charts Jest tests, charts typecheck, contracts declaration/build only if contracts are touched, and targeted production chart-render app-eval or browser checks for UI-visible rendering changes.
