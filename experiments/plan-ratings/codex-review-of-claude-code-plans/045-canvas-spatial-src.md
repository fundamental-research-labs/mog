Rating: 8/10

Summary judgment

This is a strong, production-path plan. It identifies real issues in `mog/canvas/spatial/src`: 16-bit cell-key aliasing, the `MAX_QUERY_CELLS` / `MAX_CELLS` mismatch, equal-z hit-test nondeterminism, invalid numeric input, and allocation pressure in the grid traversal path. The plan is scoped to the right package, keeps the public method surface stable, and proposes meaningful package plus consumer verification gates.

The main reason it is not a 9 or 10 is that some proposed contracts are still underspecified or semantically risky. In particular, "latest inserted wins" as an equal-z tiebreaker is not clearly the same as visual topmost order in drawing-canvas or charts, especially when dirty objects are removed and reinserted during sync. The invalid-input policy also mixes dev-only throwing with production fallback, which would create two behaviors unless the plan defines an explicit environment contract.

Major strengths

- The evidence section is concrete and checks out against the current source: `packCellKey` masks to 16 bits, `query()` can full-scan for 1001-10000 cells because `getCellsForBounds()` still uses the insert cap, and `hitTestPipeline()` sorts only by descending z-index.
- The plan preserves the core architecture: `@mog/spatial` remains a pure hardware-layer package with no DOM/React/Yjs coupling except the existing explicit Canvas wrapper helpers.
- The implementation steps are mostly systematic rather than one-off fixes: key domain, query threshold, ordering, input validation, allocation, observability, and docs are treated as related contracts.
- Verification is stronger than many plans in this experiment: package tests, typecheck, declaration/composite build concerns, focused regression tests, and consumer typechecks are all named.

Major gaps or risks

- The equal-z tiebreak contract needs redesign. Adding `seq` to `SpatialEntry` leaks index mutation history into hit-test semantics, and the plan does not prove mutation history equals paint order. In drawing-canvas, dirty-object sync removes and reinserts objects, so a metadata or bounds update could accidentally change tie order. A better contract would let callers provide an explicit secondary ordering key, such as render order, scene-graph order, mark array index, or object creation order.
- `hitTestPipeline()` accepts any `SpatialIndex<T>`, not only `GridSpatialIndex<T>`. An optional `seq` on `SpatialEntry` cannot guarantee a total comparator for custom or future index implementations unless the pipeline API also accepts a fallback tiebreaker or the contract requires all index implementations to populate it.
- The invalid-bounds behavior is not a clear contract. "Throw in dev, route to oversized in production" is hard to verify and can hide bugs in shipped code. The plan should choose one deterministic policy for `cellSize`, non-finite bounds, negative dimensions, and out-of-range cell coordinates.
- The out-of-range coordinate behavior is underspecified for queries. Routing out-of-range inserted items to `oversized` avoids aliasing, but `queryPoint()` and `query()` that cross or exceed the key domain also need a defined no-alias path, probably scan/fallback behavior, with tests.
- The plan contains a factual consumer error: `canvas/drawing/ink/src/spatial-index.ts` re-exports `@mog/spatial`, but `kernel/src/domain/drawing/spatial-index.ts` is still its own string-keyed grid implementation, not a re-export. That matters for consumer scope and for claims about canonicalization.
- The observability proposal is useful but thin. If `stats()` stays off `SpatialIndex<T>`, tests and diagnostics must deliberately construct or narrow to `GridSpatialIndex`; if it is intended for consumers, the contract should say whether it belongs on the interface.

Contract and verification assessment

The result-set correctness contracts are good: `query()` remains exact intersection, `queryPoint()` remains exact containment, oversized entries are always checked, and the grid remains an acceleration structure only. The plan also correctly names idempotent re-indexing, purity, dependency boundaries, and no public method signature changes.

The verification gates need a little tightening. `pnpm --filter @mog/spatial test` and `pnpm --filter @mog/spatial check-types` are appropriate, but the composite/declaration gate should be expressed as an exact command. For TypeScript changes with consumer impact, the plan should also either require repo-wide `pnpm typecheck` or explicitly justify the narrower consumer typecheck matrix as the intended type gate. Since several objectives are performance-related, at least one production-path performance or instrumentation gate should be added beyond asserting `lastQueryFullScan`.

Concrete changes that would raise the rating

- Replace `seq` as the primary tie solution with an explicit, caller-owned secondary comparator or `getOrder(entry)` callback for `hitTestPipeline()` and `findNearby()` ties; then update drawing-canvas and charts tests to prove parity with their visual/render order.
- Define one invalid-input policy for all builds: throw, normalize, or reject-and-not-index, with exact behavior for non-finite fields, negative width/height, zero size, and out-of-range cell coordinates.
- Specify out-of-range query behavior separately from out-of-range insert behavior, and add tests for `queryPoint()` and rectangle queries outside the arithmetic key domain.
- Correct the consumer inventory for `kernel/src/domain/drawing/spatial-index.ts`, and decide whether that duplicate implementation is intentionally out of scope or should receive a separate follow-up plan.
- Make the verification commands exact, including the declaration/composite build command and the final TypeScript gate, and add a small production-path performance/degeneracy check for mid-size rectangle selection or pointer-hit queries.
