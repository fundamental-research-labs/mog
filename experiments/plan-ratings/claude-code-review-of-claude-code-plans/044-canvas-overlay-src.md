Rating: 9/10

# Review of 044 — `mog/canvas/overlay/src`


## Summary judgment

This is a specification-grade plan. Every evidence claim I spot-checked against the
tree is accurate to the line number and the literal value: the `_lastCtx`/`save →
setTransform(1,0,0,1,0,0) → restore` DPR workaround (`overlay-layer.ts:272-289`), the
render/hit-test lock-parity divergence (`overlay-layer.ts:172-173` vs
`handle-hit-testing.ts:77`), the dead `DirtyRectAccumulator` + `promoteToFull()`
constructor call, the hardcoded `#ffffff` and off-theme `rgba(66,133,244,0.08)` blue,
the float-`===` snap dedup (`connection-points.ts:69-73`), and the under-exporting
barrel (`index.ts` exports only six symbols). The cross-folder anchors also check out:
`getActiveHandle()` exists in the contract and is implemented at `grid-renderer.ts:878`,
the overlay is constructed at `:1061` and registered at `:1067`, the two partial-repaint
TODOs are at `:1360`/`:1382`, and `@mog/spatial` is a real workspace dep at
`package.json:24`. The plan correctly diagnoses the package as a state-free
pure-renderer + hit-test seam and proposes changes that harden the seam without
redesigning it. Scope is large but honestly decomposed into four phases with explicit
parallelization and dependency notes.

## Major strengths

- **Evidence is verifiable and load-bearing.** Each objective traces to a concrete,
  reproduced defect rather than a stylistic preference. The render/hit-test lock
  disagreement (invisible-but-hittable group handles on all-locked multi-select) is a
  genuine latent bug, and the plan pairs it with a parity test as a gate.
- **The pure-geometry hit-test refactor is the right call and well-argued.** Replacing
  `Path2D` + `testPointInPath` + the DPR `setTransform` dance with closed-form
  `pointInRotatedRect`/`pointInCircle`/`pointInDiamond` removes the `@mog/spatial`
  dependency, fixes the "before first render returns null" gate, and makes the path
  trivially unit-testable. The "inverse-rotate the test point" framing is geometrically
  correct.
- **Contracts and invariants are stated as preserve-or-strengthen.** Fixed `CanvasLayer`
  identity (`id='overlay'`, `zIndex=0`, `renderMode='once'`, `canvas=1`), the back-to-front
  compositing order, the CSS-pixel coordinate space, the hit-test priority order, and the
  single-source-of-truth `getHandleVisibility` thresholds are all named explicitly.
- **Verification gates are concrete.** Named existing test files, enumerated new unit
  tests (rotated-rect at 0/45/90/negative°, all-locked parity, before-first-render hit,
  dirty-rect padding/sentinel, normalizeRect), the exact `pnpm --filter` commands, and the
  contracts-build-first ordering tied to `[[mog-contracts-declaration-rollup]]`.
- **Risks are real and mitigated, not boilerplate.** The DPR=2 / fractional-zoom
  re-verification ("that reset existed for a reason"), rotated-AABB dirty rects, and
  the product confirmation for the blue→green insertion-preview change are all flagged.

## Major gaps or risks

- **Phase B carries a coordinate-space ambiguity that the plan glosses.** The engine's
  accumulator is typed `DocSpaceRect`, yet the overlay draws and the plan emits dirty
  rects in screen-space CSS pixels (objective: "dirty rects are emitted in the same
  screen-space CSS-pixel space the renderer draws in"). `DocSpaceRect` vs CSS-pixel space
  is exactly the kind of mismatch that produces clipped or mis-located partial repaints.
  The plan should state the mapping (does the engine expect doc-space rects that it then
  transforms, and if so where does the CSS→doc conversion happen?) before this lands.
  This is the single most likely source of a correctness bug and the plan's weakest spec.
- **Phase B is the largest, riskiest chunk and is partly speculative.** The two grid TODOs
  themselves say "Revisit if profiling shows overlay repaint as a bottleneck." The plan
  asserts the win for continuous gestures (ink/eraser/drag) but offers no measurement
  establishing canvas-1 full repaint is actually the bottleneck. A "measure first" gate
  would de-risk committing to the snapshot-diff machinery.
- **Active-handle id → `HandleRegion` mapping is assumed.** `getActiveHandle()` returns
  `string | null`; the plan says "reuse the existing region identifiers so no new contract
  field is needed" but does not show that the active-handle string values are in fact
  `HandleRegion` identifiers. If they aren't (e.g. they're object ids or composite keys),
  emphasis rendering needs a mapping step the plan hasn't specified.
- **`snapIndex` contract change is offered as "ideal" but the fallback is under-specified.**
  D-13 prefers a `snapIndex` (cross-folder) but falls back to epsilon compare; the epsilon
  value/units and whether array-index matching is feasible with the *current* contract
  shape (`points[]` + separate `snapTarget` coords, no shared identity) are left open. As
  written, identity-by-index isn't possible without the contract change, so the realistic
  outcome is the epsilon fallback — the plan should commit to that and pin the tolerance.

## Contract and verification assessment

Contract clarity is high. The plan distinguishes edit targets from named-for-coupling
out-of-scope files, correctly routes `OverlayDataSource` edits to contracts plans 001-003,
and notes the `mog/types/rendering` mirror must stay in sync. The barrel-completion list
is precise and addresses a genuine API gap (the `hitTest` result type `OverlayHitResult`
is not exported today). Verification is strong: existing tests named, new tests mapped
one-to-one to objectives, integration gate (grid-canvas + app-eval selection/drag/resize)
and a manual DPR=2/non-100%-zoom check called out. The one soft spot is that the partial-
repaint gate ("includes stroke/dash padding so a 2px outline is never clipped") is a unit
assertion but the harder integration property — no ghosting across a real gesture at DPR=2
— is only a manual check, not an automated gate.

## Concrete changes that would raise the rating

1. **Resolve the `DocSpaceRect` vs CSS-pixel question explicitly in Phase B.** State where
   the CSS→doc transform lives, what `computeOverlayDirtyRects` returns, and how the engine
   consumes it. This is the gap most likely to produce a real bug.
2. **Add a "measure before building" gate to Phase B.** A quick profile confirming canvas-1
   full repaint is a bottleneck during ink/drag justifies the snapshot-diff machinery; if it
   isn't, defer B and ship A/C/D (which are clean wins) first.
3. **Pin down the active-handle mapping.** Show that `getActiveHandle()` returns a
   `HandleRegion` (or specify the mapping), so Phase C step 12 is unambiguous.
4. **Commit to the connection-point dedup approach for this folder's edit.** Given the
   current contract has no shared identity, specify the epsilon and units for the fallback
   and treat `snapIndex` purely as the cross-folder follow-up, rather than leaving the
   in-folder behavior contingent on a contract change.
5. **Promote the ghosting check to an automated integration assertion** if app-eval can
   diff canvas-1 pixels after a gesture, rather than relying solely on manual confirmation.
