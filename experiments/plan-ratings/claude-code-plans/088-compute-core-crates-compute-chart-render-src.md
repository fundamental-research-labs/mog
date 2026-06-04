# Plan 088 — Harden and modernize the native chart rendering engine (`compute-chart-render/src`)

## Source folder and scope

- **Folder:** `mog/compute/core/crates/compute-chart-render/src`
- **Contents:** a single `lib.rs` (~1,730 lines) implementing the entire `compute-chart-render` crate. There are no submodules.
- **Crate role (from `Cargo.toml`):** `"Headless chart mark rasterizer for Node SDK chart image export"`, `publish = false`. Depends on `compute-text-measurement` (sibling crate, for `FontDb`), `tiny-skia` (rasterizer), `rustybuzz` + `ttf-parser` (text shaping/outlines), `png`, `image` (JPEG), `serde`/`serde_json`, `thiserror`.
- **In-scope for this plan:** everything reachable from `lib.rs` — the public entry points `render_chart_marks_image_from_json` / `render_chart_marks_image`, the request/mark deserialization model (`RenderChartMarksRequest`, `RawMark`, `RawStyle`, `RawClip`), option normalization, the per-mark renderers (`rect`, `path`, `line`, `area`, `arc`, `symbol`, `text`), the SVG path tokenizer/parser, the symbol-shape geometry, color parsing, text shaping/outline drawing, and PNG/JPEG encoding.
- **Out of scope (adjacent, referenced for contract only, not edited here):** the N-API binding `mog/compute/napi/src/chart_render.rs`; the TS producer/serializer `mog/runtime/sdk/src/chart-export/node-chart-image-exporter.ts`; the `ChartMark` IR in `@mog-sdk/contracts/bridges`; the `FontDb`/`shaper`/`wrap` API in `compute-text-measurement`.

## Current role of this folder in Mog

This crate is the **headless rasterization backend for chart image export**. The data flow is:

1. TypeScript chart bridge (`IChartBridge.getMarksAtSize`) compiles a chart at a target size into a typed `ChartMark[]` IR (rect / path / arc / symbol / text marks with style and clip).
2. `node-chart-image-exporter.ts` serializes those marks into a versioned JSON request (`version: 1`, `marks`, `options{format,width,height,pixelRatio,backgroundColor,quality}`) and calls the native addon.
3. The N-API shim `render_chart_marks_image(request_json: String)` forwards the JSON to `compute_chart_render::render_chart_marks_image_from_json`.
4. This crate deserializes, validates, rasterizes onto a `tiny-skia` `Pixmap` at `width*pixelRatio × height*pixelRatio`, encodes to PNG/JPEG bytes, and returns `{bytes, format, width, height}`.

The design intent (per the N-API doc comment) is deliberate: **chart semantics stay in TypeScript; this crate is a pure, stateless "mark IR → pixels" renderer.** It is the only Rust code path that produces chart images for the Node SDK, so its correctness directly determines exported chart fidelity (parity with the browser canvas renderer), and its robustness determines whether export can fail or be abused.

## Improvement objectives

Ordered by production impact:

1. **Text fidelity / international correctness (highest).** Two concrete divergences from the IR contract and from the browser canvas path:
   - `maxWidth` and `lineHeight` are part of the serialized text-mark contract (`SerializableTextMark` in the exporter sends them), but `RawMark` has no `max_width` / `line_height` fields, so they are **silently dropped**. Native text is never wrapped or width-constrained, so long axis/legend/title labels overflow or differ from the canvas renderer. The sibling crate already exposes `wrap::wrap_text` and `shaper::measure_line_height` for exactly this.
   - **No per-glyph font fallback.** `render_text` resolves one styled face (requested family → `Carlito`) and shapes the whole string against it. Glyphs absent from that face (CJK, Cyrillic-beyond-Latin, emoji, symbols) produce `outline_glyph == None` and are **silently skipped** — chart labels with non-Latin data render with missing characters. `FontDb` already has `needs_cjk()` and `load_cjk()` infrastructure that this crate never uses.
2. **Clip consistency.** `render_text` never reads `mark.clip`; every other mark type honors it via `mark_clip`. A text mark carrying a `clip` rectangle is rendered unclipped — an inconsistency with the IR contract and with `rect`/`path`/`arc`/`symbol`.
3. **Robustness / resource safety.** `physical_dimension` accepts any rounded value up to `u32::MAX`, so a request for e.g. `50000×50000@2x` attempts a multi-GB `Pixmap` allocation. `Pixmap::new` failure is handled gracefully (returns `InvalidRequest`), but there is no explicit dimension/total-pixel cap, leaving a memory-pressure / DoS surface. Add an explicit, documented maximum.
4. **Graceful degradation of color parsing.** Only ~14 named colors are recognized and `hsl()`/`hsla()`/4-digit `#rgba` are unsupported. A single unrecognized color string anywhere aborts the **entire** chart image (`ChartRenderError::InvalidColor`). Broaden the supported palette/syntax to the set the chart theme layer can actually emit, so legitimate themes never hard-fail.
5. **Performance for batch export.** `RenderSurface::new` calls `FontDb::with_defaults()` (loads ~8 embedded TTFs) on **every** render call, and `render_text` re-parses both a `rustybuzz::Face` and a `ttf_parser::Face` for **every text mark**. A chart with many labels re-parses the same font repeatedly. Cache face parsing within a render (and ideally reuse a process-level `FontDb`).
6. **Maintainability.** Split the 1,730-line `lib.rs` into focused modules (`request`/`options`, `color`, `path` (SVG tokenizer+parser+arc math), `symbol`, `text`, `encode`) without changing the public surface. This also reduces contract-drift risk.
7. **Contract-drift protection.** The Rust `RawMark`/`RawStyle`/`RawClip`/options model and the TS `SerializableMark`/`SerializableStyle` model are maintained by hand with no shared schema or parity test. Add a fixture-based parity gate so a field added on one side cannot be silently ignored on the other (this is exactly how `maxWidth`/`lineHeight` drifted out of sync).

## Production-path contracts and invariants to preserve or strengthen

These must hold before and after the change:

- **Stateless, pure function.** `render_chart_marks_image(_from_json)` must remain free of global mutable state and side effects (any font caching must be internal/thread-safe, not observable).
- **Request version gate.** `version != 1 → UnsupportedVersion`. Any new optional fields (`maxWidth`, `lineHeight`) must remain **backward compatible within version 1**: older requests that omit them, and the current TS serializer, must keep working unchanged. Do not bump the version for purely additive, optional fields.
- **Output dimensions equal `round(width*pixelRatio) × round(height*pixelRatio)`**, and the returned `format` matches the request. The TS exporter asserts `rendered.{format,width,height}` against `normalized.{format,physicalWidth,physicalHeight}` and throws on mismatch — these must keep matching exactly.
- **Validation strictness for malformed numeric input stays strict.** Non-finite coordinates, out-of-range opacity, negative stroke width, malformed paths, unknown mark/symbol/format must still error (these are programmer/contract errors from the serializer). *Color* parsing is the one area to loosen toward more accepted inputs, not fewer.
- **Empty/zero-area no-op semantics preserved.** `width<=0 || height<=0` rect, zero-span arc, empty/`"none"`/`transparent` fills, empty text → render nothing (return `Ok`), not an error.
- **Area-based symbol sizing is intentional.** In `symbol_path`, `size * dpr * dpr` is correct: `size` is area in CSS px², physical area scales by `dpr²`, so linear dimensions scale by `dpr`. Preserve this (and add a comment) — do not "fix" it to a single `dpr`.
- **Premultiplied-alpha → straight-alpha encoding invariant.** `tiny-skia` stores premultiplied RGBA; PNG/JPEG expect straight alpha. Today this is masked because `backgroundColor` is always parsed opaque (`parse_required_color(bg, 1.0)`) and fills the whole pixmap, so every output pixel ends fully opaque (premultiplied == straight). **This invariant must be made explicit and preserved**: if any future change allows a transparent background or partial coverage, encoding must unpremultiply first. Document and assert it; do not silently depend on it.
- **DPR scaling convention.** All geometry multiplies logical coordinates by `dpr` at path-build time, with `Transform::identity()` at draw time. Keep this single convention; do not mix in a global transform that would double-scale.

## Concrete implementation plan

### Phase 0 — Modularize (no behavior change)
Split `lib.rs` into a module tree under `src/`:
- `lib.rs` — public types (`ChartRenderError`, `ChartImageFormat`, `RenderedChartImage`, `Result`), the two public entry points, and `RenderSurface` orchestration.
- `request.rs` — `RenderChartMarksRequest`, `RawMark`, `RawStyle`, `RawClip`, `MarkStyle`, `MarkClip`, `mark_style`, `mark_clip`, the `required_f32`/`optional_f32`/`invalid_mark` helpers.
- `options.rs` — `NormalizedRenderOptions`, `finite_positive`, `physical_dimension`.
- `color.rs` — `parse_required_color`/`parse_optional_color`/hex/rgb/named/`apply_opacity`.
- `path.rs` — SVG tokenizer + parser + `svg_arc_*` + `rect_path`/`rounded_rect_path`/`arc_path`.
- `symbol.rs` — `symbol_path`, `symbol_style`, `is_open_line_symbol`.
- `text.rs` — `TextMetrics`/`font_metrics`/`measure_text_advance`/`OutlineAdapter`/`glyph_outline_to_path`/`TextDraw`/`draw_text_run`/font-weight/style helpers.
- `encode.rs` — `encode_png`/`encode_jpeg`.
Move existing inline `#[cfg(test)] mod tests` into the modules or a `tests.rs`. Keep all currently-`pub` items `pub`; make internals `pub(crate)`. **No logic edits in this phase** so the diff is reviewable as a pure move.

### Phase 1 — Text wrapping + line height (objective 1a)
- Add optional `max_width: Option<f64>` and `line_height: Option<f64>` to `RawMark` (camelCase `maxWidth`/`lineHeight`) — matching the already-sent serializer fields.
- In `render_text`, when `max_width` is `Some(w > 0)`, use `compute_text_measurement::wrap::wrap_text` (reusing the same `rustybuzz::Face`) to compute break points; render each resulting line. Advance the baseline by `line_height` when provided, else by `shaper::measure_line_height(face, font_size)`. Apply `textAlign` per line and `textBaseline` to the line block (top/middle/bottom relative to total block height) so multi-line blocks anchor like the canvas renderer.
- Replace the crate-local `measure_text_advance` with `compute_text_measurement::shaper::measure_text_width` to converge on one measurement implementation (eliminating drift between measured width here and wrap decisions there).
- Match browser-canvas semantics precisely: confirm against the canvas chart renderer whether `maxWidth` means wrap vs. ellipsis-truncate, and implement the same. (If the canvas path truncates with ellipsis rather than wrapping, implement truncation; `lineHeight` presence in the IR strongly implies wrapping — verify before committing the behavior.)

### Phase 2 — Per-glyph font fallback + CJK (objective 1b)
- After resolving the primary styled face, detect runs/glyphs the primary face cannot render (`face.glyph_index(ch).is_none()` / `outline_glyph` returns `None`) and fall back to a secondary face. Use `FontDb::needs_cjk(text)` to opt into the CJK face when CJK is present.
- This requires CJK glyph data to be available to the renderer. Two options — pick per repo direction:
  - **(a)** Have `RenderSurface` load CJK bytes when the export path supplies them (thread the bundled CJK font into the crate the same way `compute-text-measurement` expects via `load_cjk`).
  - **(b)** Bundle the same default fallback faces `FontDb::with_defaults` loads and walk them per-glyph.
- Shape per-resolved-face run (rustybuzz shaping must use the face that actually owns the glyph), then outline with the matching `ttf_parser::Face`. At minimum, never silently drop a glyph: if no face can render it, fall back to a visible `.notdef`/tofu box rather than nothing, so missing-font issues are observable instead of invisible.

### Phase 3 — Text clip parity (objective 2)
- In `render_text`, compute `mark_clip(mark, index)?` and, when present, build the clip `Mask` (reuse `RenderSurface::clip_mask`) and pass it as the `mask` argument to the glyph `fill_path`/`stroke_path` calls (currently they pass `None`). This makes text honor `clip` like every other mark.

### Phase 4 — Resource caps (objective 3)
- Add documented constants `MAX_IMAGE_DIMENSION` and `MAX_TOTAL_PIXELS` (e.g. derived from a sane export ceiling) and enforce them in `physical_dimension` / before `Pixmap::new`, returning `InvalidRequest` with a clear message. This converts an unbounded allocation into a deterministic, cheap rejection.
- Keep the existing graceful `Pixmap::new → None` handling as a backstop.

### Phase 5 — Color robustness (objective 4)
- Extend `color.rs`: add `#rgba` (4-digit) hex, `hsl()`/`hsla()`, and expand the named-color table to the full set the chart theme/palette layer can emit (audit the theme palette to enumerate exactly which names reach here). Keep returning `InvalidColor` only for genuinely unparseable input.
- Confirm `apply_opacity` interaction is unchanged for the new forms.

### Phase 6 — Font/face caching (objective 5)
- Within a single `render_chart_marks_image` call, memoize parsed `(rustybuzz::Face, ttf_parser::Face)` per `(family, bold, italic)` in `RenderSurface` so repeated text marks reuse them instead of re-parsing.
- Evaluate hoisting `FontDb` to a process-level `OnceLock`/`Lazy` (it is read-only after `with_defaults`) so the embedded TTFs are parsed once per process rather than once per export. Preserve statelessness of the public function (the cache is immutable shared data, not observable mutable state).
- (Optional follow-up) glyph-outline `Path` cache keyed by `(glyph_id, scale_quantized)` for charts with many repeated characters.

### Phase 7 — Contract parity gate (objective 7)
- Add a shared JSON fixture set (request samples covering every mark type, every style field including `maxWidth`/`lineHeight`/`strokeDash`/`cornerRadius`, clips, all symbol shapes, and color forms) that both the Rust crate test and a TS exporter test consume, so a field present in one model but ignored in the other is caught. Document the `version: 1` field list in one place referenced by both sides.

## Tests and verification gates

> Per task constraints I will not run build/test commands; this section specifies the gates the implementer must satisfy.

- **Existing tests must stay green** (`renders_conformance_mark_families_to_nonblank_png`, `styled_text_fallback_preserves_font_weight_and_style`, `rejects_empty_marks_and_unsupported_format`, `clips_marks_to_requested_rectangle`, `renders_jpeg_when_requested`).
- **New unit tests:**
  - *Text wrapping:* a text mark with small `maxWidth` produces output whose painted bounding box height ≈ `n_lines * lineHeight` and whose width ≤ `maxWidth*dpr`; without `maxWidth`, single-line behavior is unchanged (byte-for-byte if feasible).
  - *Font fallback:* a label containing CJK (or other non-Latin) glyphs produces non-blank pixels for those glyphs (today it renders nothing); a `.notdef`/tofu fallback path is exercised when no face covers a codepoint.
  - *Text clip:* a text mark with a `clip` rectangle paints inside and is blank outside the rectangle (mirror of `clips_marks_to_requested_rectangle`).
  - *Dimension cap:* an oversized request (`width*height*dpr²` beyond the cap) returns `InvalidRequest` quickly, with no large allocation.
  - *Color:* `#abcd`, `hsl(...)`, `hsla(...)`, and several added named colors render the expected RGBA; an unparseable string still errors.
- **Golden/snapshot tests:** add deterministic pixel-hash (or small-PNG-checksum) snapshots for each symbol shape, an arc (donut + pie), a dashed stroke, and an anchored multi-line text block, so geometry regressions are caught. Keep them robust to anti-alias jitter (hash a downsampled/quantized buffer or assert on coverage counts rather than exact bytes).
- **Contract parity test:** the shared fixtures deserialize cleanly into `RawMark` with no field silently dropped (assert via round-trip or an explicit "all fields consumed" check).
- **Crate-level gates (run by implementer):** `cargo test -p compute-chart-render`, `cargo clippy -p compute-chart-render -D warnings`, `cargo fmt --check`. Downstream: the TS `node-chart-image-exporter.test.ts` and `chart-renderer.test.ts` suites must still pass after any NAPI rebuild.

## Risks, edge cases, and non-goals

- **Parity risk (primary):** the wrapping/fallback behavior must match the **browser canvas** chart renderer, not just "look reasonable." If they diverge, exported PNGs won't match on-screen charts. Mitigation: derive behavior from the canvas implementation and snapshot both. This is the single biggest correctness risk and should gate the text-feature phases.
- **CJK font availability:** Phase 2 may require shipping/threading a CJK font into the export path; binary size and provenance of bundled fonts must be checked. If CJK bytes cannot be guaranteed available, ship the tofu/`.notdef` fallback (observable) as the floor.
- **Premultiplied-alpha trap:** any change touching background handling or encoding must preserve the opaque-output invariant or add unpremultiplication; otherwise semi-transparent pixels would encode wrong. Guard with a test that renders a semi-transparent fill over an opaque background and checks an interior pixel's straight-alpha value.
- **Caching vs. statelessness:** process-level font caching must remain immutable/thread-safe (NAPI may call from multiple threads). Do not introduce per-call observable state.
- **Floating-point determinism:** snapshot tests must tolerate platform AA differences; prefer coverage-count/quantized hashes over exact-byte equality.
- **Strictness regressions:** broadening color parsing must not accidentally make malformed numbers/marks pass; keep the numeric validation paths untouched.
- **Non-goals:** moving chart *semantics* (scales, layout, mark generation) into Rust — those stay in TypeScript per the established architecture; SVG/PDF output formats; introducing a full CSS color engine beyond what the theme layer emits; bumping the request `version` (changes here are additive and backward compatible within v1).

## Parallelization notes and dependencies on other folders

- **Phase 0 (modularization)** is independent and should land first to make later diffs reviewable; it blocks nothing but eases everything.
- **Phase 1 / Phase 6** depend on `compute-text-measurement` (`wrap::wrap_text`, `shaper::measure_text_width`, `measure_line_height`, `FontDb`) — read-only reuse; no edits to that crate are required, but coordinate if its API needs a small addition (e.g. exposing per-glyph coverage).
- **Phase 1 / Phase 2** require a parity reference from the **browser canvas chart renderer** (`mog/kernel/src/domain/charts/...`) and the chart bridge IR (`@mog-sdk/contracts/bridges` `ChartMark`). No edits there, but the behavior contract is owned jointly.
- **Phase 7 (parity gate)** touches a shared fixture consumed by `mog/runtime/sdk/src/chart-export/node-chart-image-exporter.ts` tests — coordinate field lists with the SDK owner; adding `maxWidth`/`lineHeight` handling here must align with what the serializer already emits (it does emit them today, so this is purely additive on the Rust side).
- **NAPI surface (`mog/compute/napi/src/chart_render.rs`)** is unaffected: all changes are additive and keep `render_chart_marks_image_from_json(&str) -> Result<RenderedChartImage>` and the result shape identical. No rebuild contract change beyond the usual NAPI rebuild after a Rust edit.
- Phases 3, 4, 5 are mutually independent and can be parallelized across implementers once Phase 0 lands.
