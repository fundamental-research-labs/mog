Rating: 8/10

Summary judgment

This is a strong hardening plan: it is grounded in the real `@mog-sdk/sheet-view` production package, identifies several live contract risks, and mostly respects the package's capability-facade architecture instead of proposing a redesign. The emphasis on type ownership, API reporting, downstream consumers, and lifecycle semantics is exactly the right level for this folder.

The rating is not higher because a few important specifications are either inaccurate against the current implementation or still too open-ended for reliable implementation. The biggest issue is Phase 2's `positionIndex` / `mergeIndex` story: the current code constructs those objects once and repopulates them through `ViewportWiring`, so the plan's "identity may change" premise and getter-only dev guard do not match the actual hazard. Phase 6 also needs a tighter consumer-use inventory; the current spreadsheet app appears to have migrated most coordinate/snap paths to public geometry/viewport capabilities, while the remaining raw-renderer need is more specifically object hit-region detail and viewport-to-document conversion.

Major strengths

- The plan correctly treats `views/sheet-view/src` as a public SDK boundary, not just an internal implementation detail. It preserves factory signatures and the `SheetViewHandle` capability shape.
- The evidence for the skin validation gap is real: `validationErrors` is always `[]`, `_status` never reaches `'error'`, and the error event is declared but not emitted.
- The public API lock is well motivated. `apiReport.enabled` is currently false even though the package publishes a large owned type surface and is consumed by the embed package and spreadsheet app.
- The plan is production-path relevant. It targets `sheet-view.ts`, capability implementations, public types, viewport wiring, and packaging checks rather than test harnesses or mocks.
- The verification section is much better than a generic "run tests" note: it calls out skin, lifecycle, API report, package tests, and downstream consumers.

Major gaps or risks

- The `positionIndex` / `mergeIndex` contract is misstated. In current `sheet-view.ts`, the indices are instantiated once in the constructor and passed into `ViewportWiring`; switch/fetch events repopulate the same objects. If the real invariant is "stable object identity with volatile per-sheet contents," the plan should say that and guard generation-sensitive method use, not getter access. A cached reference will not hit the getter again.
- Phase 6 overstates the remaining internal access problem. `createSheetView()` returns a capability-only handle with a hidden `__mogInternalGridRenderer` property, and current app usage shows public geometry/viewport methods already covering snap and scroll paths. The remaining raw renderer use should be enumerated as concrete methods and payload gaps, especially floating-object hit region/isGroup detail and `getCoordinateSystem().viewportToDocument()`.
- The "complete set of dead skin surface" is broader than validation errors. `SheetViewResolvedSkin.status` also includes `'loading'`, and `SheetViewSkinEvent` includes `asset-load` / `asset-error`; the plan should decide whether those are future asset lifecycle contracts or dead surface too.
- Phase 1 leaves a product fork to the implementer. For a public SDK surface, the plan should choose implement-vs-remove up front, including whether invalid skins produce diagnostics only, whether status is `'ready'` with warnings or `'error'` while still rendering, and what the exact validation schema covers.
- The constructor rollback and dispose-order phases are directionally good but underspecified. The plan needs a concrete transactional construction shape and a way to force constructor failure in tests without depending on artificial production code hooks.

Contract and verification assessment

The contract intent is strong: preserve owned public types, avoid leaking `@mog/*` types, keep existing factory and handle signatures, and add only additive replacements for internal escape hatches. The plan also correctly names downstream type/eval coverage as part of the compatibility contract.

The verification gates need more mechanical precision before implementation. They should name the exact package-level commands for `@mog-sdk/sheet-view`, the exact API report artifact path and CI script, and the exact downstream gates for `mog/apps/spreadsheet` and `mog-sdk__embed`. The foreign-type check should be specified as a robust declaration/API-report check, not just a broad text search that could false-positive on comments or module names.

Concrete changes that would raise the rating

- Decide Phase 1's skin direction in the plan, and cover all currently unproduced skin statuses/events, not only validation errors.
- Rewrite Phase 2 around the actual index lifetime: either document stable identities with per-sheet mutable contents, or introduce a generation-stamped facade/proxy that can catch cached-reference method calls after a sheet switch.
- Add a small consumer-usage table for every current internal renderer access, with replacement method, owned public return type, migration owner, and acceptance test.
- Specify the API report baseline path, package scripts, and CI failure mode, plus a precise no-foreign-types check over the generated declarations.
- Add implementation-ready lifecycle acceptance criteria: constructor rollback order, partial-construction cleanup targets, how tests inject failure, and how late async dispose callbacks are rejected.
