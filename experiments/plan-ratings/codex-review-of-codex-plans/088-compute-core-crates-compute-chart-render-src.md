Rating: 8/10

Summary judgment

This is a strong plan for turning `compute-chart-render` from a reduced native raster fallback into a production-path peer of the browser Canvas2D renderer. It correctly identifies the current shape of the system: `lib.rs` is a single permissive Rust surface over `RawMark`, the Node SDK serializer drops rich `ChartMark` fields, and the public bridge contract already contains richer paint, line, shadow, clipping, and text semantics than native export currently preserves. The plan is architecturally aligned with keeping chart semantic compilation in `@mog/charts` while making Rust responsible only for rasterizing compiled marks.

The rating is not higher because the plan is still too large-grained in a few places where verifiable contracts matter most. It names the right categories, but it does not fully pin down schema versioning, unsupported paint semantics, exact memory budgets, golden fixture ownership, or the acceptance thresholds that would let parallel agents converge without interpretation.

Major strengths

- It targets the real production path: `IChartBridge.getMarksAtSize()` to the Node SDK serializer, N-API bridge, Rust renderer, and chart image export result validation. That avoids optimizing a standalone renderer path that users do not exercise.
- It preserves the correct dependency direction. The plan keeps private/internal code out of `mog`, uses `types/bridges/src/chart-bridge.ts` as the public mark contract, and explicitly avoids moving chart grammar, scale, or data extraction into Rust.
- The proposed module split is sensible for the current monolithic `lib.rs`: request validation, style/color, path/geometry/symbols, text, surface, and encoding are real seams in the existing implementation.
- It correctly enumerates the major current parity gaps: `fillPaint`, `strokePaint`, `line`, gradients, shadows/effects, line cap/join/miter, rich text, wrapping, text decorations, text clipping, complete color parsing, and JPEG alpha behavior.
- The verification plan includes the right layers: Rust crate tests, N-API bridge coverage, SDK serializer/export tests, browser/native pixel comparison, XLSX export, and robustness tests for invalid input.

Major gaps or risks

- “Promote the native request to the canonical mark contract” is ambiguous. The canonical public contract should remain `ChartMark` in `types/bridges`; the native request should mirror or version a transport schema derived from it. Otherwise implementers may accidentally make Rust schema ownership drive the public TypeScript IR.
- The plan does not specify whether the expanded request is still `version: 1` or a new version. Given the intended strict schema and full-field contract change, this needs an explicit migration rule, including unknown-field behavior and whether old request shapes are rejected or accepted during the same branch rollout.
- Unsupported browser semantics need sharper contracts. `image` paint, `pattern`, `groupInherited` with no fallback, invalid gradient stop lists, negative dimensions, zero-size geometry, and Canvas2D “non-renderable” behavior should be enumerated as render, no-op, or reject cases.
- The memory/CPU budget is directionally correct but not executable. “Max physical pixel count” and “encoded work estimate” need actual default limits, error messages, and alignment with existing SDK option normalization.
- The browser/native golden harness is important but under-specified. It needs fixture storage location, renderer driver, pixel diff metric, per-category tolerances, text exclusion or tolerance policy, update workflow, and CI gate expectations.
- The chart-family fixture list is broad enough to become unbounded. It should identify the minimum fixture matrix that covers every mark/style category, then add chart-family coverage where it exercises unique production compilation behavior.
- The N-API gate is weakly phrased as “if the package has tests.” The plan should require either a Rust-level bridge test or a Node smoke test that exercises the native addon error/result path after request changes.

Contract and verification assessment

The contract direction is good: strict typed Rust request structs, version rejection, field-path errors, exact physical dimensions, mark-order compositing, and deterministic handling of invalid fields are the right invariants. The plan also recognizes that text rasterization and gradient antialiasing cannot be byte-exact across engines.

The missing piece is an explicit contract table. For each mark type and style field, the plan should state accepted fields, defaults, rejected values, no-op cases, and browser behavior to match. That table is especially important for paint fallbacks, line styles, text layout, clipping, and geometry degeneracy. Without it, parallel implementation agents can each make plausible but incompatible choices.

The verification gates are appropriately production-oriented, but they need command precision and ownership. Rust gates should be `cargo test -p compute-chart-render` and `cargo clippy -p compute-chart-render`; TypeScript gates should include the concrete package command for `runtime/sdk` tests plus `pnpm typecheck` or the explicitly narrower type gate. The parity harness should assert dimensions and MIME metadata exactly, then pixel tolerance by fixture category.

Concrete changes that would raise the rating

- Add a request-version section: version number, rollout order across TS serializer/N-API/Rust, unknown-field policy, old-shape compatibility decision, and exact error examples.
- Add a mark/style contract matrix covering every `ChartMark` variant and every `ChartMarkStyle`, `ChartPaintSpec`, `ChartLineStyleSpec`, `ChartShadowSpec`, and text field.
- Define concrete render budgets, such as max physical pixels, max mark count, max path commands, max text length/runs, max gradient stops, and max clip mask cache entries.
- Replace the broad fixture-family list with a minimal coverage matrix plus named production charts that exercise unique compilation behavior.
- Specify the golden harness implementation shape: where fixtures live, how browser Canvas2D and native N-API renders are invoked, how images are decoded, which diff metric is used, and what tolerances apply to text, gradients, shadows, and geometry.
- Require a focused N-API/native-addon behavior test with preserved error messages, not only Rust crate tests.
- Clarify that Rust mirrors the public bridge contract and owns native validation/rasterization, while `types/bridges` remains the source of truth for the public `ChartMark` IR.
