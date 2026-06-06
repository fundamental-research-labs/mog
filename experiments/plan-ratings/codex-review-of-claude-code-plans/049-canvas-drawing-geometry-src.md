Rating: 8/10

Summary judgment

This is a strong, evidence-backed hardening plan for `@mog/geometry`. It correctly treats the folder as a low-level production math kernel rather than an isolated utility package, and it identifies real defects in SVG arc handling, path metrics cost, cache semantics, tolerance drift, routing contracts, serialization exhaustiveness, and undocumented edge semantics. The plan is especially good at preserving the zero-dependency contract, naming concrete source files, tying issues to consumers, and sequencing low-risk foundation work before larger behavioral changes.

The rating is not higher because a few proposed contract changes are under-specified or internally inconsistent. Most importantly, the plan says public call signatures must stay backward-compatible while also proposing to change `routeConnector` from `Point2D[]` to a discriminated return type. The performance work also needs a clearer production API for reusable path metrics, not just an implementation idea, and the arc-sharing work needs a sharper package-ownership boundary.

Major strengths

- The problem discovery is concrete and mostly verified against the source: `parseSvgPath` currently tokenizes `A/a` but emits line segments, `pointAtLength` re-integrates curves during each query, `BoundedCache.get` only bumps recency when the stored value is not `undefined`, and connector routing exposes untagged point arrays with style-dependent semantics.
- The plan respects the architectural role of `@mog/geometry`: pure TypeScript, contracts-only dependency, shared by hit-testing, drawing, shapes, text effects, exports, and kernel computations.
- The objectives are systematic rather than whack-a-mole. Centralized tolerances, total serialization, shared arc conversion, route result typing, boundary semantics, and invariant tests are the right categories of fixes.
- Sequencing is sensible: start with tolerances, cache semantics, and serialization guards, then move to arc conversion and path metrics, with connector routing and consumer coordination called out separately.
- Verification coverage is much better than average. The plan names package tests, typecheck, targeted invariant tests, snapshot review, consumer regression families, and deterministic/no-mutation checks.

Major gaps or risks

- `routeConnector` has a contract contradiction. Changing its return type to `{ kind: ... }` is not backward-compatible with the current `Point2D[]` API exported from `@mog/geometry` and `./connector-routing`. The plan should either introduce a new API such as `routeConnectorDetailed`, keep `routeConnector` returning arrays, or explicitly declare a breaking contract change with all consumers and declaration output updated.
- The path-metrics performance objective does not define the production contract for reuse. "Flatten once, reuse" requires a concrete shape: a `PathMetrics` object, caller-managed prepared path, weak cache keyed by path identity, or explicit LUT parameter. Without that, the implementation could add hidden global caching that violates purity expectations or rebuild tables per call and miss the hot-path goal.
- Arc conversion ownership needs more precision. The existing OOXML arc conversion lives in `shapes`, which already depends on `@mog/geometry`; `@mog/geometry` cannot depend back on `shapes`. The plan gestures at sharing but should state that the canonical arc helper moves into geometry and shapes imports it, with no new reverse dependency.
- Arc parsing is still broad enough to be risky. Packed flag handling is called out, but the plan should specify a small conformance corpus for repeated arc segments, omitted separators, signs-as-separators, exponent notation, zero radii, coincident endpoints, large-arc/sweep combinations, radii normalization, and rotated ellipses.
- Benchmarks are directionally right but not yet a verifiable gate. The plan says "micro-benchmark file gated in CI" and "non-blocking informational gate first" without naming the harness, command, threshold strategy, sample data, or what regression budget is acceptable for this package.
- The consumer regression list is good but not executable enough. It names families such as charts, drawing engine, text effects, shapes, and PDF export, but the implementing plan would be stronger with exact package filters or commands for the relevant test suites.

Contract and verification assessment

The plan is strong on existing contracts: it preserves contract-owned geometry types, the zero-dependency charter, matrix layout, transform composition order, chart angle convention, diagnostics codes, and the current package export shape. It also correctly identifies contract-level improvements: shared singular threshold, serialization exhaustiveness, value-agnostic cache membership, self-describing connector routing, and documented hit-test edge semantics.

The main contract issue is that "strengthen the connector-routing contract" currently conflicts with "existing named exports keep their names and call signatures." The route result change should be made additive or explicitly breaking. Similarly, the `pointAtLength`/`distanceToPath` optimization needs a public or internal contract for metric-table lifetime, mutability assumptions, and accuracy knobs.

The verification plan is credible and appropriately production-path focused. It extends existing per-file Jest suites, adds invariant tests for parse/serialize and compose/decompose, tests arc endpoint/tangent continuity, reviews snapshots rather than blindly accepting them, and calls for dependent consumer suites. It should be tightened by making perf and cross-consumer gates concrete commands, and by adding declaration/build verification if any exported type is added or changed.

Concrete changes that would raise the rating

- Resolve the `routeConnector` compatibility story: add a new discriminated API while preserving the old one, or mark the change as intentionally breaking and list every consumer and export declaration that must move.
- Define a `PathMetrics` or `flattenPath` contract for reusable arc-length/distance tables, including cache ownership, immutability assumptions, sample/tolerance defaults, and error bounds.
- State the arc-helper ownership explicitly: move shared conversion into `@mog/geometry`, update `shapes/src/custom-geometry.ts` to consume it, and keep geometry independent of shapes.
- Add an SVG arc conformance fixture matrix covering tokenizer and geometric edge cases, not only packed flags and endpoint/tangent checks.
- Replace broad consumer regression categories with exact commands or package filters, and name the benchmark harness plus initial non-blocking perf metrics.
- Add a declaration/type-surface gate for any exported route-result or metrics types, even if the implementation avoids changing contract-owned `PathSegment`.
