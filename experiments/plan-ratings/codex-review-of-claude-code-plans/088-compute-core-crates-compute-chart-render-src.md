Rating: 7/10

Summary judgment

This is a strong, production-relevant plan that correctly identifies the native chart renderer as the Node SDK chart image rasterization path and focuses on real fidelity and robustness issues in `compute-chart-render/src/lib.rs`. The highest-value findings are well chosen: Rust currently drops serialized `maxWidth` and `lineHeight`, text does not honor mark clips, image allocation is uncapped, color parsing is narrow, and text/font work is repeated per render or per mark.

The rating is held back by several important contract inaccuracies. The plan assumes `compute_text_measurement::wrap::wrap_text` is exposed and can produce break points, but `wrap` is `pub(crate)` and `wrap_text` returns only a line count. It also treats transparent or partially transparent backgrounds as a future concern, even though the current color parser accepts `transparent`, 8-digit hex, and `rgba()` for `backgroundColor`. The CJK and caching phases are directionally right but underspecified around available APIs, Rust lifetimes, font data ownership, and exact browser parity.

Major strengths

- The plan is grounded in the real production path: TS chart bridge marks -> Node SDK serializer -> N-API shim -> `render_chart_marks_image_from_json` -> PNG/JPEG bytes.
- It preserves the right architectural boundary: chart semantics stay in TypeScript, while Rust remains a pure mark-IR-to-pixels renderer.
- It identifies concrete existing drift: `SerializableTextMark` sends `maxWidth` and `lineHeight`, while `RawMark` does not deserialize them; browser text rendering wraps positive `maxWidth` and applies `lineHeight`; native text currently renders one unwrapped line.
- It correctly calls out text clip parity: browser `renderMark` applies `clip` before dispatching all mark types, while native text bypasses `mark_clip`.
- It includes useful invariants for versioning, DPR scaling, output dimensions, strict numeric validation, area-based symbol sizing, and N-API surface stability.
- The verification section is much better than a compile-only plan: it asks for unit tests, golden-style geometry checks, contract parity, and downstream SDK serializer tests.

Major gaps or risks

- Phase 1 is not implementable as written. `compute-text-measurement/src/lib.rs` declares `pub(crate) mod wrap`, so `compute-chart-render` cannot call `compute_text_measurement::wrap::wrap_text`. Even if exposed, the function returns `usize` line count, not wrapped line slices. The plan needs either a public line-breaking API that returns lines/ranges, or an explicit native implementation matching `charts/src/primitives/marks/text.ts`.
- Browser parity is more specific than the plan states. The browser renderer splits on newlines, wraps plain text by whitespace, breaks long words character by character, uses `fontSize * 1.2` as the default line height, and anchors multiline blocks with `firstLineY`. The plan should codify those rules instead of leaving "verify wrapping vs ellipsis" as an open-ended step.
- The premultiplied-alpha invariant is partly wrong. Native `backgroundColor` is not guaranteed opaque because current parsing accepts transparent/alpha colors. Encoding should add unpremultiplication or explicitly reject non-opaque backgrounds now; documenting a future invariant is not enough.
- The font fallback phase does not specify enough API work. `FontDb` exposes `needs_cjk` and `load_cjk`, but it does not expose an iterator over default faces or a glyph-coverage lookup. The plan's "walk bundled defaults" option would require new public APIs or a different ownership model.
- The face-caching phase understates Rust lifetime constraints. Caching `rustybuzz::Face` and `ttf_parser::Face` inside `RenderSurface` while they borrow data owned by `FontDb` risks a self-referential struct design. The plan should choose a concrete design, such as process-level owned font bytes plus per-call parsed faces, cached font IDs plus parse-on-use, or an owned/leaked immutable font registry.
- The contract parity gate is too vague about Serde behavior. By default, unknown JSON fields are silently ignored, so a "fixtures deserialize cleanly" test will not prove all fields are consumed. The plan needs `deny_unknown_fields`, `serde_ignored`, round-trip assertions, or an explicit JSON-field coverage check.
- Resource caps are specified only as "sane export ceiling." The cap should be tied to product limits and memory budget, with exact constants and examples.
- The color phase says to support the set emitted by the theme layer but does not enumerate that set. It should audit the serializer and theme/color utilities and list exact accepted syntaxes. It should also decide whether out-of-range RGB/HSL channels clamp or error.
- The clippy command is slightly wrong: it should be `cargo clippy -p compute-chart-render -- -D warnings` if warning-deny clippy is required.

Contract and verification assessment

The contract framing is mostly good: version 1 remains additive, output dimensions must match the TS exporter's normalized physical dimensions, malformed numeric input remains strict, and the N-API result shape is unchanged. The plan also correctly treats the Rust crate as the native JSON subset of the broader `ChartMark` IR rather than moving chart layout or mark generation into Rust.

The missing contract is the exact text layout algorithm. Because the browser renderer is the fidelity source, the plan should name the native text contract in terms of the existing `charts/src/primitives/marks/text.ts` behavior: line splitting, wrapping, long-word breaking, default line height, baseline anchoring, alignment per line, rotation, and clipping order. That contract should drive tests before implementation.

Verification gates are broadly appropriate: `cargo test -p compute-chart-render`, focused new unit tests, downstream SDK serializer tests, and browser renderer parity tests. The strongest missing gates are: a transparent-background or semi-transparent-output encoding test, a serializer/native unknown-field detection test, and a TS browser-renderer fixture paired with the native fixture for multiline text.

Concrete changes that would raise the rating

- Replace Phase 1 with a precise browser-parity text-layout contract and a concrete implementation path: either expose a new `compute-text-measurement` line-wrap API returning ranges/strings, or implement the browser wrapping rules directly in `compute-chart-render`.
- Add a pre-phase for alpha encoding: decide whether `backgroundColor` may be transparent; then either reject non-opaque backgrounds or unpremultiply before PNG/JPEG encoding, with tests.
- Specify the font fallback design in terms of actual APIs and data ownership: how CJK bytes enter the renderer, how fallback faces are enumerated, and what happens for emoji/color glyphs that cannot outline.
- Define a cache architecture that avoids self-referential borrowing, including whether `FontDb` becomes a shared immutable registry and what is cached per render.
- Make the contract parity gate mechanically enforce consumed fields, not just successful deserialization.
- Enumerate exact resource-cap constants and accepted color syntaxes from the producer side.
- Correct the verification command syntax and add a downstream gate for `runtime/sdk/__tests__/node-chart-image-exporter.test.ts` covering `maxWidth`, `lineHeight`, clips, and style projection.
