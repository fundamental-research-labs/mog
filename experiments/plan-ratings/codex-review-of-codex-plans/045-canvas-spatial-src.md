Rating: 8/10

Summary judgment

This is a strong, production-aware plan. It correctly identifies the central correctness risk in `@mog/spatial`: the 16-bit packed cell key can collide outside a limited coordinate range, and the current implementation leaves important geometry, oversized-entry, query, and hit-priority behavior as implicit implementation behavior. The plan is also well calibrated to package boundaries: it treats `@mog/spatial` as a public canvas-facing package, recognizes direct consumers in drawing-canvas, charts, overlay, and ink, and explicitly warns against importing canvas-layer spatial code into kernel by convenience.

The rating is not higher because several proposed public contracts are still described as options rather than settled specifications. The plan says to introduce options, possible `upsert`/`update` APIs, possible geometry imports, possible diagnostics, and possible comparator support, but it does not give the exact final TypeScript shapes or migration rules. For a source folder that exports a shared package API, those details are part of the contract, not implementation color. It also misses `canvas/drawing/engine/src/spatial/spatial-query.ts`, which is a production duplicate of hit testing, rectangle selection, and proximity search and should be explicitly included in the duplication/consolidation story.

Major strengths

- The current-code audit is accurate. The plan correctly calls out `packCellKey()` truncation, strict bounds validation gaps, inclusive point and edge semantics, oversized item handling, the query threshold problem where `getCellsForBounds()` still uses the entry threshold, unstable equal-z sorting, and `canvas-hit-test.ts` restore-on-throw risk.
- The objectives are systematic rather than instance-by-instance. They cover the complete category of coordinate correctness, bounds validity, oversized entries and queries, duplicate IDs, update semantics, deterministic ordering, canvas context safety, and oracle-style differential tests.
- The plan keeps production paths in scope. It names real consumers and calls for drawing-canvas, charts, overlay, and ink verification rather than only strengthening isolated package tests.
- The geometry discussion is directionally sound. `@mog/geometry` already exports inclusive `pointInRect`, `rectIntersects`, `rectContains`, and `distanceToRect`, while `Rect.overlaps()` has non-empty-intersection semantics. The plan correctly separates those semantics and avoids blindly replacing spatial behavior with `Rect.overlaps()`.
- The kernel boundary note is important and correct. `kernel/src/domain/drawing/spatial-index.ts` is a separate implementation with a different min/max contract, so consolidation needs an explicit lower-level extraction or parity tests rather than a casual dependency from kernel into canvas.
- The verification matrix is broad and relevant: package tests, package typecheck, consumer package tests, repo typecheck, and real pointer-input UI exercise for UI-affecting hit-test changes.

Major gaps or risks

- The public API changes are not specified tightly enough. If `GridSpatialIndexOptions`, `upsert`, `update`, `has`, `get`, comparator support, and insertion sequence become part of `@mog/spatial`, the plan should provide exact interfaces, overloads, defaults, compatibility behavior for `createSpatialIndex(cellSize)`, and deprecation or removal rules for `updateBounds`.
- Query result determinism is underspecified. The plan says to use insertion sequence "if callers rely" on stable ordering, but a shared spatial index should define this unconditionally if deterministic output is a goal. It should state the order for `all()`, `query()`, `queryPoint()`, oversized entries interleaved with normal entries, replacement of an existing ID, and equal-distance `findNearby()` ties.
- The plan omits `canvas/drawing/engine/src/spatial/spatial-query.ts`, which already delegates to `@mog/geometry` and duplicates hit-test, selection, and proximity behavior. If the goal is to reduce canvas-facing duplication through `@mog/spatial`, this package needs an explicit keep/migrate/parity decision.
- Bounds validation needs a caller audit before becoming fail-fast. The plan notes that strict rejection may surface caller bugs, but it does not enumerate which producers can emit negative drag rectangles, non-finite values, or zero-size marks. That audit should precede the contract change so failures become intentional fixes, not surprise breakages.
- Error semantics are missing. `assertValidBounds`, `assertValidPoint`, invalid `cellSize`, invalid query bounds, missing IDs on update, and invalid `findNearby()` radius should have defined behavior and tests. Without explicit error types or messages, consumers will get a less verifiable contract.
- The Canvas2D helper additions need sharper scope. `fillRule` forwarding is concrete, but stroke options are vague. The plan should decide whether the helper accepts no style mutations and requires caller-configured stroke state, or defines a typed callback/options contract that saves and restores style changes.
- The diagnostics step is plausible but speculative. It should either name a concrete consumer and contract for snapshots, or be moved behind a later observability task so the correctness work does not grow another public surface by accident.

Contract and verification assessment

The plan is strongest where it states semantic contracts: finite bounds, non-negative dimensions, negative coordinates allowed, zero-size boxes allowed, inclusive point and edge behavior, duplicate ID replacement, oversized entry queryability, separate entry/query thresholds, context restoration through `finally`, and deterministic topmost hit selection. Those are the right contracts for this folder.

The weak point is that some contracts stop one level short of being directly implementable. A follow-up implementation worker would still need to invent exact API shapes, tie-break rules, invalid-input errors, and migration behavior. For a shared package, that is real specification debt.

The verification gates are mostly appropriate and production-path relevant. The plan correctly avoids relying only on typecheck and requires consumer tests plus real UI pointer exercise for drawing selection and chart picking. If `@mog/spatial` starts importing or changing `@mog/geometry`, the verification list should also include `cd /Users/guangyuyang/Code/mog-all/mog/canvas/drawing/geometry && pnpm test && pnpm typecheck`, or explicitly state that geometry is only consumed unchanged.

Concrete changes that would raise the rating

- Add exact TypeScript declarations for `GridSpatialIndexOptions`, `createSpatialIndex` overloads, replacement/update APIs, comparator or tie-break options, and any diagnostics snapshot type.
- Specify deterministic ordering completely for all index-returning methods, oversized entries, duplicate ID replacement, and `findNearby()` equal-distance ties.
- Add `canvas/drawing/engine/src/spatial/spatial-query.ts` to the consumer/duplication section with a concrete decision: migrate to `@mog/spatial`, keep as a linear geometry helper with parity tests, or extract a lower-level pure spatial core.
- Define invalid-input behavior precisely, including `cellSize`, non-finite points, invalid query bounds, negative radius, and missing update IDs.
- Replace optional wording around geometry reuse with a clear rule: use `@mog/geometry` primitive helpers for inclusive semantics if dependency direction is accepted; never use `Rect.overlaps()` for `@mog/spatial` intersection semantics.
- Tighten the Canvas2D helper contract so fill rule, stroke state, exception propagation, and context restoration are all directly testable.
- Add a small caller-bound audit checklist before fail-fast validation lands, especially for drawing drag rectangles, chart mark bounds, dirty sync, and ink diagnostics.
