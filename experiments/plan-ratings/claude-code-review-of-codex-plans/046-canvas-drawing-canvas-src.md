Rating: 8/10

# Review of Plan 046 — Drawing Canvas Production Contract Improvement


## Summary judgment

This is a strong, well-researched plan that demonstrates genuine familiarity with the
`@mog/drawing-canvas` codebase rather than generic improvement boilerplate. Nearly every
factual claim it makes about the current production path is verifiable in source:

- `SceneGraph` exposes only per-object `add`/`remove`/`update`/`clear` with no batch or
  transaction primitive, and `clear()` followed by N `add()`s is the real full-sync path
  (`scene/scene-graph.ts`).
- `HitMap` carries a single `scrollOffset` / `zoom` / `regionOrigin` triple that is
  overwritten once per region in `DrawingLayer.render()`, and the overlay adapter reads it
  back via `getScrollOffset()` / `getZoom()` / `getRegionOrigin()`
  (`hit-testing/hit-map.ts:142`, `layer/drawing-layer.ts:112`,
  `grid-canvas/src/renderer/grid-renderer.ts:820-822`). The "last rendered region wins"
  hazard the plan calls out is real.
- `HitMap.clear()` (Path2D wipe) is invoked per-region, not per-frame
  (`drawing-layer.ts:112`), exactly as the plan asserts.
- The chart renderer silently `break`s when no bridge is bound
  (`renderers/dispatcher.ts:80`), matching the "silently hide persisted user objects" risk.
- `ImageCache` fires a single argument-less `onLoad` callback with no source→object mapping
  (`renderers/image-cache.ts:21,42`), so the plan's "always full layer dirty" critique is accurate.
- The dispatcher wraps each render in one try/catch placeholder
  (`dispatcher.ts:105`); `grid-canvas` integration points `applySceneGraphPatches` /
  `syncSceneGraph` exist as named (`grid-renderer.ts:1807,1955`).

Because the diagnosis is grounded, the resulting objectives (batch mutation contract,
region-aware transform store, per-frame Path2D lifecycle, visual-bounds dirty hints,
type-by-type renderer fidelity, bridge invalidation) are the right problems to attack. The
invariants section is the strongest part of the document and would survive as a durable
contract artifact on its own.

## Major strengths

- **Production-path accuracy.** The "Current role" and "contracts/invariants" sections read
  like they were written against the files, including z-index 500 / canvas 0 / per-region
  render mode, ascending `getByZOrder`, flat `groupId` grouping, and document-space CSS-pixel
  bounds. This is verifiable and correct.
- **Invariant-first framing.** It lists the properties that must be *preserved* (region
  clipping owned by canvas-engine, topmost-hit-first, stable IDs dirtying old+new bounds,
  isolation of renderer failures) before proposing change. That guards against regressions
  during a large refactor.
- **Real verification gates.** Package and integration `pnpm test` / `pnpm typecheck`
  commands point at the correct workspace paths, and the focused-test list maps onto the
  actual failure modes (multi-region pointer conversion, render-order independence,
  rotated/flipped/connector hits, Path2D/OffscreenCanvas fallback).
- **Honest UI gate.** Insists on real input paths (select/move/resize/scroll/zoom/freeze
  panes) instead of direct state mutation — appropriate for a hit-testing/overlay change
  where the bug class is precisely coordinate-conversion drift.
- **Good risk register.** Calls out async-callback-after-disposal (generation validation),
  rotated-object dirty/spatial under-coverage, and full-sync dirty-ID loss — all genuine.

## Major gaps or risks

- **Scope is a package re-architecture, not an "improvement."** Ten implementation steps
  across five parallel workers touching scene, hit-testing, every renderer, bridges, and
  `grid-canvas` integration is effectively a rewrite of the package surface. There is no
  minimal-viable slice or staged landing strategy that delivers value if only the first 2–3
  steps land. The integration-order section helps but does not define independently
  shippable milestones.
- **New API surfaces are proposed as alternatives, not decided contracts.** Step 1 offers
  "`SceneObjectUpdate` *or* transaction API"; Step 2 offers "`transaction(fn)` *or*
  `replaceAll`/`applyBatch`/`updateObject`"; Step 3 offers "per-frame/per-region transform
  registry keyed by region ID" without a concrete type signature, key derivation, or how an
  ambiguous pointer (overlapping regions) is resolved beyond "bounds contain the pointer."
  For a plan whose whole thesis is "make mutation/hit a first-class contract," the new
  contracts themselves are under-specified. The reviewer/implementer is left to design the
  signatures.
- **Acceptance criteria are mostly "tests exist," not measurable behavior.** Several
  objectives ("renderer fidelity contracts for every type," "consistent text rendering") lack
  a definition of done — what specific output or invariant proves fidelity? Without
  per-step exit criteria, "done" is subjective.
- **A couple of slightly stale / over-stated observations.** The plan says to "remove
  inconsistent double error-boundary behavior (dispatcher-level *and* `withRenderContext`)",
  but the dispatcher shows a single try/catch and I did not find a second `withRenderContext`
  boundary still wired in — the claim of duplication may be outdated. Similarly, Step 8 asks
  to "replace the hardcoded fallback union" in `shape-rendering-info.ts`, but that file
  already imports `getRegisteredShapeTypes` from `@mog/shape-engine` and explicitly documents
  `HARDCODED_SHAPE_TYPES` as a transitional fallback; the derivation is partly done. These
  don't undermine the plan but suggest spot-checks rather than exhaustive verification.
- **No performance/regression budget for the per-frame Path2D accumulation change.**
  Accumulating Path2D registrations across all regions instead of clearing per region changes
  memory/lifecycle behavior; the plan doesn't state how it bounds growth or proves no
  per-frame regression.

## Contract and verification assessment

Contract clarity is strong at the *invariant* level and weak at the *new-API* level. The
preserved contracts (document-space bounds, `layerId: "drawing"`, `ObjectHitResult` shape
with `objectId`/`groupId`/region, dirtying old+new bounds, graceful Path2D/OffscreenCanvas
fallback) are precise and testable. The new contracts (batch transaction API, region
transform registry, `docToScreen`/`screenToDoc` helpers, diagnostics hook) are named and
motivated but not pinned to signatures, ownership, or edge-case resolution — that is the
plan's main contract gap.

Verification gates are above average: correct command paths, a focused test list aligned to
real failure modes, and a credible UI-behavior gate using real input. The plan correctly
notes it did not run commands per task constraints. What's missing is a mapping from each
implementation step to the specific test that gates it (so a partial landing can be verified
in isolation) and any regression/perf gate for the lifecycle changes.

## Concrete changes that would raise the rating

1. **Commit to one set of API signatures.** Replace the "X or Y" alternatives in Steps 1–3
   with decided TypeScript signatures: the chosen `SceneGraph` batch API, the transform-store
   type (region key, stored fields, lookup/disambiguation rule for overlapping regions), and
   the `docToScreen`/`screenToDoc` shapes. This is the single biggest lever.
2. **Define a minimal shippable slice and milestones.** E.g. Milestone 1 = batch mutation +
   single-dirty-callback (Worker A) with its tests, landable alone; Milestone 2 = region
   transform store + overlay adapter migration; later milestones per renderer. State what
   value each milestone delivers independently.
3. **Add per-step exit criteria.** For each renderer/bridge step, state the observable
   behavior that proves done (e.g. "connector hit succeeds within stroke-width of the
   centerline and fails outside it," "chart with no bridge renders a visible placeholder and
   logs a structured diagnostic with objectId/type").
4. **Re-verify the two stale claims.** Confirm whether a second error boundary still exists
   before mandating its removal, and reframe Step 8 as "finish/verify the shape-engine
   derivation and delete the transitional `HARDCODED_SHAPE_TYPES`" rather than implying it is
   still fully hardcoded.
5. **Add a lifecycle/perf gate.** State how cross-region Path2D accumulation is bounded and
   add a test asserting registrations reset once per frame (not per region) and do not grow
   across frames.
6. **Map tests to steps.** Annotate each focused test with the implementation step it gates,
   so partial landings are independently verifiable.
