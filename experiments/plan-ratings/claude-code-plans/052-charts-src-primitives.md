# 052 — Improvement Plan: `mog/charts/src/primitives`

## Title
Harden and correct the chart rendering primitives: render-path fidelity, scale math, hit-test geometry, and a real test/verification gate for a near-untested 6.3k-line subsystem.

## Source folder and scope
- **Public source folder:** `mog/charts/src/primitives`
- **Files in scope (22 source files, ~6,329 LoC):**
  - Top level: `index.ts`, `types.ts` (re-exports the `ChartMark` IR from `@mog-sdk/contracts/bridges`), `font.ts`.
  - `marks/`: `rect.ts` (owns `applyStyle`/paint-to-canvas/shadow), `path.ts`, `arc.ts`, `text.ts`, `symbol.ts`, `index.ts` (dispatch `renderMark`/`renderMarks` + clip).
  - `scales/`: `linear.ts`, `log.ts`, `time.ts`, `ordinal.ts` (band/point), `color.ts` (764 LoC of schemes/interpolators), `types.ts`, `index.ts`.
  - `renderer/`: `canvas-renderer.ts` (style-batched Canvas2D), `webgl-renderer.ts` (GL_POINTS for circles + 2D fallback canvas), `hit-tester.ts` (`@mog/spatial` grid + narrow-phase geometry), `mark-renderer.ts` (re-export shim), `index.ts`.
  - `__tests__/`: only `font.test.ts` exists.
- **Out of scope (touched only as consumers / contracts, not edited under this plan):** `mog/charts/src/{components,grammar,core,dom,interaction,algebra}` (40+ consumer files), `@mog-sdk/contracts` (the `ChartMark` IR + `BoundingBox` geometry), `@mog/spatial`, and `../utils/colors` (`interpolateOklab`).

## Current role of this folder in Mog
`primitives` is the lowest rendering layer of the charts package — the bridge between the declarative chart IR and pixels. It provides:
1. **Mark IR typing** (`types.ts`) — narrows the canonical `ChartMark` union (rect/path/arc/text/symbol) shared by browser rendering, kernel caches, and Node image export. The contract is owned by `@mog-sdk/contracts/bridges`; primitives only re-exports/extracts.
2. **Pure mark renderers + geometry** (`marks/*`) — `render*`, `hitTest*`, `getTextBounds`, bounds, and paint resolution (`applyStyle`, gradients, shadows, effects). These are framework-free Canvas2D operations.
3. **Scales** (`scales/*`) — D3-style fluent `scaleLinear/Log/Time/Band/Point/Ordinal/Sequential/Diverging`, tick generation, and the loosely-typed `ChartScale` facade the grammar compiler/encoding-resolver use to avoid `as any`.
4. **Renderers** (`renderer/*`) — `CanvasRenderer` (retina scaling + consecutive-style batching preserving painter z-order), `WebGLRenderer` (high-volume circle scatter with a separate overlaid 2D fallback canvas), and `GridHitTester` (spatial index + per-mark narrow-phase).

It is consumed broadly: `dom/chart-engine.ts` and `core/chart-engine.ts` drive `CanvasRenderer`/hit-testing; `components/*` (axis, legend, statistical plots) and `grammar/*` build marks and use scales; `interaction/*` (brush, pick, tooltip) use the hit-tester. Defects here surface as visible rendering glitches, mis-picked points, or wrong axis ticks across every chart type.

## Improvement objectives
1. **Close render-path correctness gaps** that silently degrade output (gradient paints collapsing to solid on symbol/path/text marks; dead/unreachable rotation branch in the batched text path; shadow/effects key vs. apply divergence).
2. **Fix scale math bugs** (descending-domain `niceLinear` branch uses a dimensionally wrong formula) and pin down tick/`nice`/`invert` invariants for all scale types.
3. **Unify duplicated geometry** so hit-test bounds, paint bounds, and text measurement use one source of truth rather than three diverging approximations.
4. **Make the WebGL path production-robust**: handle context loss/restore, clamp `gl_PointSize` to the implementation limit (with explicit fallback), broaden `parseColor` to the color syntaxes the theme layer actually emits, and document the GL/2D z-order layering limitation.
5. **Stand up a real test + verification gate.** A 6.3k-LoC rendering/scale/geometry subsystem currently has exactly one test file (`font.test.ts`). This is the single largest production risk in the folder.
6. **Tighten public types** (`ChartScale`, scale builder casts) to remove `as`-driven structural looseness without breaking the consumer surface.

## Production-path contracts and invariants to preserve or strengthen
- **IR ownership stays in contracts.** `types.ts` must continue to derive from `@mog-sdk/contracts/bridges` `ChartMark`; do not fork a second mark shape in primitives. Any new field (e.g. clarified paint-bounds semantics) is proposed in contracts first, then re-extracted here.
- **Painter's algorithm / z-order.** `CanvasRenderer.render` batches only *consecutive* same-style marks specifically to preserve array order as paint order. Any batching change must keep: mark `i` never paints over mark `j>i`.
- **Backend interchangeability.** `WebGLRenderer` and `CanvasRenderer` both implement `Renderer`. Output for the same mark list must be visually equivalent (within AA tolerance) so the engine can swap backends by volume.
- **Scale fluent API + `copy()` semantics.** Getters return copies of domain/range arrays; setters return `this`; `copy()` produces an independent scale. `invert` is the mathematical inverse of the forward map on the unclamped path. Strengthen: assert `scale(invert(v)) ≈ v` and degenerate-domain behavior (zero-span domain → range midpoint) as tested invariants.
- **Tick niceness.** `generateTicks`/`tickStep` must keep the 1/2/5×10ⁿ guarantee; `nice()` must only widen (never narrow) the domain. This must hold for ascending **and** descending domains.
- **`hasRenderableFill`/`hasRenderableStroke` gating** is the single predicate for whether fill/stroke is emitted; both the standalone `render*` and the batched `draw*` paths must agree (they currently duplicate this logic — keep them in lockstep).
- **Pure, side-effect-free marks/scales.** Mark functions mutate only the passed `ctx`; scales hold private state only. No DOM/global access in `marks`/`scales` (renderers may touch DOM/`window`).
- **Graceful color/paint fallback.** `parseColor` and `paintToCanvasStyle` must never throw on malformed input; they degrade to a defined fallback (gray / null). Strengthen, don't remove, this guarantee.

## Concrete implementation plan
Sequenced so correctness fixes land behind tests, then unification, then WebGL robustness, then type tightening.

### Phase 0 — Establish the test harness (blocking prerequisite)
- Add a Canvas2D mock/stub (record `fillRect`, `strokeText`, `setLineDash`, gradient stop calls, `save`/`restore` balance) under `__tests__/` so mark/renderer behavior is assertable headlessly. Prefer an in-folder fake `CanvasRenderingContext2D` recorder over a heavy dependency.
- Add scale unit tests (`linear/log/time/ordinal/color`) covering forward map, `invert`, `ticks`, `nice`, degenerate domains, descending domains, and `copy()` independence.
- Add geometry tests for `hit-tester` (`getBoundingBox`, `pointInMark`, radius vs. exact queries, `save/restore` balance in renderers).
- This phase introduces **no production behavior change**; it exists to lock current intended behavior before edits.

### Phase 1 — Render-path correctness fixes
1. **Gradient paint bounds for all mark types.** In `canvas-renderer.ts` `boundsForMark` and the standalone `renderText`/`renderSymbol`/`renderPath` paths, gradient fills currently receive a `{x,y,1,1}` (or absent) bounding box for symbol/path/text, collapsing linear/radial/rectangular gradients to a near-solid color. Compute true bounds for these marks (reuse hit-tester's `getBoundingBox`, see Phase 2) and pass them to `applyStyle`/`paintToCanvasStyle`. Add tests asserting `createLinearGradient` is called with a non-degenerate box for a gradient-filled symbol/path/text.
2. **Remove dead rotation branch in batched `drawText`** (`canvas-renderer.ts`): the first guard already routes `mark.rotation` (and richText/underline/strikethrough/maxWidth) to `renderMark`, making the later `if (mark.rotation) {…}` block unreachable. Delete it and add a test that a rotated text mark inside a batch goes through the full renderer (transform applied once).
3. **Reconcile shadow/effects between key and apply.** `styleKey` serializes `s.shadow ?? s.effects ?? null` while `applyStyle` applies `s.shadow ?? s.effects?.outerShadow`. Make the key derive from the *same* resolved shadow spec used to paint, so batching neither over-segments (perf) nor groups marks that should paint different shadows (correctness). Add a test with two marks differing only in `effects.innerShadow` (not painted) vs `effects.outerShadow` (painted).
4. **Confirm batched/standalone parity.** Add tests that `drawRect/drawArc/drawPath/drawSymbol` produce the same fill/stroke calls as their `render*` counterparts for representative styles (corner radius, dashed stroke, no-fill, no-stroke).

### Phase 2 — Geometry unification
- Establish **one** mark-bounds function (promote hit-tester's `getBoundingBox` to the canonical source, or extract a shared `marks/bounds.ts`) and have `canvas-renderer.boundsForMark` delegate to it. Removes the renderer's simplified 1×1 boxes.
- Resolve the **two divergent text-measurement paths**: `marks/text.ts` measures with a real `ctx`; `hit-tester.getTextBounds` uses the `length * fontSize * 0.6` heuristic because it has no ctx. Either (a) let the hit-tester accept an optional measuring `ctx` (the engine already owns one) and fall back to the heuristic only when absent, or (b) factor the heuristic into a named shared helper so both call sites stay consistent. Document which is authoritative.
- **Path/area picking precision.** `pointInPathBounds` uses bounding box only — line/area marks have huge boxes and over-trigger picks. Provide an opt-in precise narrow-phase using `ctx.isPointInPath`/`isPointInStroke` against a parsed `Path2D` when a ctx is available, keeping the bbox path as the no-ctx fallback. Gate behind the existing radius/exact query flow so behavior is opt-in for `interaction/pick.ts`.

### Phase 3 — Scale math fixes
1. **`niceLinear` descending branch** (`scales/linear.ts`): the `step < 0` branch computes `Math.ceil(start * step) / step` / `Math.floor(stop * step) / step`, which is dimensionally inconsistent with the positive branch (`Math.floor(start / step) * step`). Correct it to mirror the positive branch with sign handling, and add tests for descending domains (e.g. `niceLinear(95, 3)`), asserting the niced domain *contains* the original and is a multiple of the step.
2. **Tick/format edge cases:** add coverage for `count<=0`, `start===stop`, non-finite step, and `createTickFormatter` specifier branches (`%`, exponential, fixed precision, default trailing-zero trim).
3. **Log/time/ordinal invariants:** verify `scaleLog` handles base changes and negative/zero domain guards; `scaleTime` tick intervals and `nice` boundaries; band/point `bandwidth`/`step`/`align`/`round` arithmetic and `padding` clamping to `[0,1]`.

### Phase 4 — WebGL robustness (`webgl-renderer.ts`)
1. **Context loss/restore:** register `webglcontextlost`/`webglcontextrestored` listeners; on loss, set `gl=null` and route everything through the 2D fallback; on restore, re-init shaders/buffers. Today a GPU context loss permanently breaks large scatter rendering.
2. **`gl_PointSize` clamping:** browsers cap point size (`ALIASED_POINT_SIZE_RANGE`, often 64–255 px). Query the limit; for symbols whose computed diameter exceeds it, fall back those specific symbols to the 2D path rather than silently clamping (which makes large bubbles wrong size).
3. **Broaden `parseColor`** to the syntaxes the style/theme layer emits: space-separated modern `rgb(r g b / a)` / `hsl()`, and a defined behavior for `currentColor` (resolve via passed fill or fall back to gray). Keep the never-throw guarantee; add a table-driven test.
4. **Document the GL/2D layering limitation:** circles render on the GL canvas, all other marks on an overlaid 2D canvas inserted as `nextSibling` (always on top). True interleaved z-order between circles and non-circle marks is not possible in this design. Capture this as an explicit code comment + a note for the engine on when to prefer the all-Canvas backend.

### Phase 5 — Type tightening (non-breaking)
- Replace builder-internal `as ContinuousScale['domain']` / `scale as ContinuousScale` casts with a small typed-overload helper so the fluent setters keep their narrow types without `as`.
- Audit `ChartScale` (the optional-method facade in `scales/types.ts`): keep it as the compiler-facing surface, but ensure every concrete scale provably satisfies it (add a compile-time `satisfies` check in tests) so the optionality reflects reality rather than masking gaps.

## Tests and verification gates
> Per task constraints this plan does **not** run any build/test commands; the gates below are what a follow-up implementation PR must satisfy.

- **New unit tests (Vitest, in `primitives/__tests__/` and per-subdir `__tests__/`):**
  - Scales: forward/inverse round-trip, ticks niceness, `nice()` widening (asc + desc), degenerate domains, `copy()` independence, color interpolator endpoints, scheme lengths.
  - Marks: fill/stroke gating, gradient bounds non-degeneracy for symbol/path/text, rich-text run measurement, decoration placement per baseline, `truncateText` binary search, rounded-rect radius clamping.
  - Renderer: `save`/`restore` balance per batch, consecutive-batch z-order preservation, batched vs. standalone parity, retina transform on `resize`/`clear`, destroy-then-render no-op.
  - WebGL: `parseColor` table (hex 3/6/8, rgb/rgba/hsl/space-syntax, named, transparent, invalid→gray), point-size clamp fallback selection, context-loss → fallback routing (with a fake GL).
  - Hit-tester: bbox correctness per mark type, exact vs. radius query, precise path picking when ctx present vs. bbox fallback, sort-by-distance.
- **Verification gates (run in implementation PR, not here):**
  - `pnpm --filter @mog/charts test` green, with new files covered.
  - `pnpm --filter @mog-sdk/contracts build` if any contract type is touched, then charts typecheck (`tsc --noEmit`) green (per `[[mog-contracts-declaration-rollup]]`: contracts declaration rollup must precede consumer typecheck).
  - Lint/format unchanged (no formatter run as part of planning).
  - Targeted `app-eval` chart-render scenarios (visual smoke for bars/lines/scatter/pie with gradients) to confirm no regression in real rendered output.

## Risks, edge cases, and non-goals
- **Risk — gradient-bounds change alters existing visuals.** Charts that currently render gradient-filled symbols/paths as near-solid may visibly change once gradients span true bounds. This is a *correctness* fix but is visible; gate with app-eval visual review and call it out in the PR.
- **Risk — batching key change perf.** Re-deriving the shadow component of `styleKey` must not add per-mark allocation on the 50k-mark hot path; prefer cheap string concatenation over extra `JSON.stringify`. Consider memoizing the resolved shadow.
- **Risk — precise path picking cost.** `Path2D` + `isPointInPath` per candidate is heavier than bbox; keep it opt-in and only for candidates already narrowed by the spatial grid.
- **Edge cases:** empty mark arrays; zero/negative sizes; NaN/Infinity domains; `dpr` changes mid-session; SSR/`typeof window === 'undefined'`; canvas with one context type (the GL/2D dual-canvas constraint); `text.maxWidth` smaller than a single glyph (`breakLongWord`).
- **Non-goals:** no new mark types or chart features; no rewrite of the scale API surface (keep D3-compatible shape consumers depend on); no migration of color schemes out of `color.ts`; no change to `@mog/spatial`; no compatibility shims or test-only patches in production code — all fixes land on the real render/scale/geometry paths.

## Parallelization notes and dependencies on other folders
- **Independent, parallelizable within this folder:** Phase 0 (tests), Phase 3 (scale math), and Phase 4 (WebGL) touch disjoint files and can proceed concurrently once the test harness (Phase 0) exists.
- **Serialized:** Phase 2 (geometry unification) should land before Phase 1's gradient-bounds fix consumes the shared `getBoundingBox`, or they coordinate on the shared bounds helper to avoid a merge conflict in `canvas-renderer.ts`.
- **Cross-folder dependencies:**
  - **`@mog-sdk/contracts`** — if paint-bounds semantics or any mark field needs clarifying, change contracts first and rebuild its declarations before charts typecheck (see `[[mog-contracts-declaration-rollup]]`).
  - **`interaction/pick.ts` / `interaction/brush.ts` / `interaction/tooltip.ts`** — consumers of precise path picking; coordinate on whether they pass a measuring `ctx` to the hit-tester.
  - **`dom/chart-engine.ts` & `core/chart-engine.ts`** — own backend selection (Canvas vs. WebGL) and the measuring context; the GL/2D z-order limitation note feeds their backend-choice heuristic.
  - **`core/style-resolver/*` & `algebra/color.ts`** — emit the paint/color strings `parseColor` must accept; align the broadened color-syntax support with what the resolver actually produces.
  - No dependency on the pre-existing dirty `dev/` eval scaffolding or `fixtures/` — those are untouched by this plan.

---
*Plan status: actionable. Evidence sufficient; folder present and read in full. No blockers.*
