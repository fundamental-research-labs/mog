Rating: 8/10

Summary judgment

This is a strong, evidence-backed hardening plan. It correctly identifies the central architectural split in `@mog/drawing-engine`: compute code is advertised as pure while the package barrel also exports Canvas/Path2D/DOMMatrix renderer paths. It also finds real production-path renderer fidelity gaps, z-order invariant drift, group-bound staleness, anchor robustness issues, and missing verification coverage.

The rating is not higher because the plan misses existing shared spatial infrastructure in `@mog/spatial`, underspecifies several new public contracts, and presents a very broad multi-phase scope as if it were mostly local to `canvas/drawing/engine/src` even though important parts require package export-map, dependency, contract, and consumer coordination.

Major strengths

- The findings are grounded in the actual source: the `src/index.ts` purity header conflicts with renderer exports, `spatial-query.ts` does per-call sort/linear scans, `renderer/canvas.ts` leaves text/reflection deferred, `fills.ts` simplifies pattern/image fills, `strokes.ts` collapses compound strokes, and `insertAtZIndex` can produce non-normalized z-order values.
- The plan is production-path focused. It names known consumers such as the kernel bridge, drawing-canvas shape renderer, PDF graphics, diagram, ink, and text-effects paths instead of treating the package as isolated utility code.
- The preservation list is useful: existing function signatures, immutable return behavior, deterministic compute paths, and renderer entry points are called out explicitly.
- Verification expectations are much better than average. The plan asks for parity tests, property tests, invariant tests, Node/no-DOM import behavior, renderer fidelity tests, and package type gates rather than relying on compile-only confidence.
- Sequencing is mostly sensible: clarify compute/renderer contracts first, then tackle independent compute invariants, anchor behavior, layout snapping, renderer fidelity, and performance work.

Major gaps or risks

- The spatial-index phase duplicates architecture that already exists. `canvas/spatial/src` provides `GridSpatialIndex`, `createSpatialIndex`, `hitTestPipeline`, `selectInRect`, and `findNearby`, and `canvas/drawing-canvas/src/hit-testing/hit-map.ts` already uses it. The plan should say whether drawing-engine wraps `@mog/spatial`, depends on it, or leaves indexing to consumers; adding a new `spatial/spatial-index.ts` without that decision risks two competing spatial APIs.
- The scope boundary is inconsistent. Phase 1 requires package `exports` changes in `canvas/drawing/engine/package.json`; anchor constants should come from `@mog-sdk/contracts/core`; diagnostic codes may touch contracts; color parsing may belong in `@mog/canvas-engine`; visual/PDF rebaselines touch consumers. Those are legitimate, but the plan later says the core needs no edits outside `mog/canvas/drawing/engine/src`.
- The `Path2D` cache contract is underspecified. `DrawingObject` has no stable `id` or version field; it is a resolved rendering primitive with geometry, fill, stroke, effects, text, transform, clip, and children. A cache keyed by "object identity + geometry version" needs an owner, key derivation, invalidation policy, and memory lifetime before implementation.
- Unsupported text/reflection diagnostics are not a clear API. Existing renderers return `void` or SVG strings. The plan does not define whether diagnostics are returned, thrown, collected through an injected reporter, or exposed via a separate validation pass, so implementers could produce incompatible solutions.
- The group-bounds invariant cannot be fully solved by calling recompute from `createGroup`/`ungroup`. Member movement and resizing happen outside these functions, and `createGroup` does not receive a member-bounds map. The plan needs an explicit update contract for callers that mutate member bounds.
- The spatial-index performance benefit is deferred from the main production bridge. Adding array overloads plus an optional index may leave `kernel/src/domain/drawing/spatial-operations.ts` and any array-only consumers on the same O(n log n) hot path unless adoption is part of the plan or explicitly scoped as a follow-up.
- Some verification gates need calibration. "Per-query work does not grow linearly" is hard to assert robustly in Jest without exposing counters or using deterministic candidate counts; it should be reframed as candidate-count or operation-count tests plus a bounded benchmark only where stable.

Contract and verification assessment

The plan is strongest on naming invariants: canonical z-order should be contiguous `[0..n)`, compute code should be DOM-free, render boundaries should fail with typed errors, and broad-phase bounds should be post-transform AABBs. Those are the right contracts to make explicit.

The weaker contracts are the new ones: renderer capability errors, unsupported-feature diagnostics, image source resolution, pattern tile definitions, path-cache ownership, spatial-index ownership, and group-bound refresh semantics. Each needs a precise type-level shape and consumer migration rule before implementation starts.

The verification plan is comprehensive and relevant, but it should explicitly include updating existing tests that currently assert fallback behavior, such as pattern fill using the foreground color, image fill rendering nothing, and non-hex gradient stop opacity returning unchanged. It should also include the package-level commands an implementer must run: `pnpm --filter @mog/drawing-engine test`, `pnpm --filter @mog/drawing-engine typecheck`, and targeted consumer tests when renderer or export-map behavior changes.

Concrete changes that would raise the rating

- Replace "add `spatial/spatial-index.ts`" with a concrete decision around `@mog/spatial`: reuse it directly, wrap it with drawing-engine-specific adapters, or document why a new index is required.
- Split the plan into source-local changes and cross-package changes, with explicit file/package ownership for `package.json`, `@mog-sdk/contracts/core`, `@mog/canvas-engine`, PDF/drawing-canvas rebaselines, and any contract diagnostics.
- Define exact APIs for `DrawingRendererUnavailableError`, unsupported-feature diagnostics, image fill source maps, and `computeRenderedBounds(obj)`, including whether they are additive exports or options on existing render functions.
- Specify cache keying and lifetime for `Path2D` caching, preferably owned by a renderer/hit-test context rather than ambient module state.
- Add a group-bound update contract that covers member move/resize, not only create/ungroup.
- Convert the performance verification from vague asymptotic claims into measurable candidate-count, allocation, and benchmark thresholds tied to the real production hit-test path.
