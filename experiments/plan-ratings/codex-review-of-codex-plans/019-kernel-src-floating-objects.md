Rating: 8/10

Summary judgment

This is a strong plan. It correctly treats `kernel/src/floating-objects` as part of a production object-hosting pipeline rather than an isolated folder cleanup, and it is grounded in real current problems: the app-owned `FloatingObjectCache` still duplicates the kernel projection, `SheetCoordinator` still owns event coalescing and active-sheet bounds fallback, picture/textbox/drawing-style creation paths still retain placeholder-anchor fallbacks, worksheet receipts still tolerate zero/default bounds, and Rust structural bounds recomputation still does not fully match `compute_object_pixel_bounds` anchor parsing.

The rating is not higher because several parts are still strategic rather than contractual. The plan identifies the right architecture, but it does not always specify the exact API surfaces, payload shapes, ownership boundaries, and phase exit criteria that would let parallel implementers compose changes without reinterpreting intent. For a cross-cutting migration across contracts, compute, kernel, renderer, hooks, worksheet APIs, and app coordinator code, those missing execution contracts are the main risk.

Major strengths

- The architectural direction is right: Rust compute remains canonical for persisted object state, TS keeps a synchronous projection for renderer and React reads, and app caches stop acting as a second object truth.
- The plan is production-path relevant. It calls out real consumers such as `SheetCoordinator`, renderer patches, connector rerouting, worksheet object APIs, chart hosting, clipboard, and browser workflows instead of optimizing tests or mocks.
- It names concrete current failure modes: pure deletes lose sheet-scoped notification information, bounds-only events can be mishandled, empty-sheet seeding can leave stale state, active-sheet fallback can fetch the wrong bounds, and opaque `CellId` anchors can degrade to `(0, 0)` during normalization.
- The invariants section is unusually useful. The `position`/`anchor`, `sheetId`/`containerId`, one-cell/two-cell/absolute anchor semantics, finite bounds, z-order determinism, grouping cleanup, and hidden/dimension-change semantics are the right contract axes.
- The sequencing is broadly sensible: establish executable contracts first, fix projection completeness, normalize creation/transform writes, then migrate app reads and delete duplicate state.
- The verification list covers unit, integration, Rust, app, and real UI input paths, which fits the blast radius of the work.
- The parallelization notes identify workable ownership slices and preserve the public/private repo boundary.

Major gaps or risks

- The projection promotion step needs a precise ownership contract. The plan says to wire `createFloatingObjectsProjection()` and `setupFloatingObjectsProjection()` from the kernel composition root and give app consumers `IFloatingObjectsView`, but it does not define where that view lives (`DocumentContext`, workbook API, worksheet API, app coordinator dependency, or a new provider), who owns disposal, how initial and later sheet seeding is requested, and how renderer dependency injection changes.
- Delete and bounds event contracts are not specific enough. The plan says to retain sheet IDs from delete events and pass sheet-scoped delete metadata into `applyBatch`, but it should define the exact payload shape. Pure deletes, cross-sheet moves, and bounds-only updates need explicit old-sheet/new-sheet notification semantics, not just "affected sheet" prose.
- The anchor-normalization work is underspecified. "Ask Rust for the real `CellId`" is the right direction, but the plan does not name the bridge/API that maps pixels or row/col to `CellId`, define behavior for missing/deleted/hidden anchors, or state how absolute anchors bypass cell lookup.
- The app migration risk is undercounted. Current app consumers include hooks, connector rerouting, workbook statistics, renderer patch construction, receipt processing, chart subscriptions, and sheet-switch resync. The plan should include a consumer inventory and a mechanical migration checklist so one reader cannot leave a stale Zustand path behind.
- Manual event emitters are not called out as a distinct cleanup class. Some worksheet/domain operations still manually emit `floatingObject:*` events even though the desired contract is MutationResultHandler as the single event writer. Leaving that ambiguous can produce duplicate events during the migration.
- "All object kinds" is directionally correct but too broad without an ownership matrix. Charts, drawings, diagrams, equations, form controls, slicers, OLE objects, and connectors do not all share the same creation API, content model, or renderability guarantees. The plan should state which fields are host-owned for each kind and which content fields remain domain-owned.
- The z-order and grouping sections are good but not contract-level. They need deterministic ordering rules for duplicate/sparse imported z-indexes and a single public group schema/mapping rule for `children` vs `memberIds`.
- The verification gates are broad but not tied to phase exits. For example, the projection phase should not require all UI workflows, while the app-cache deletion phase must. Without per-phase gates, implementers may either overrun early phases or under-verify the final integration.

Contract and verification assessment

The plan has strong invariant prose, but it should convert the most important invariants into executable contract shapes before implementation starts. In particular:

- Define the public read surface that replaces `FloatingObjectCache`: exact type, owner, construction point, lifecycle, subscription behavior, and permitted app adapters.
- Replace `applyBatch(updates, deleteIds, boundsUpdates)` with an explicit change input that can carry `objectId`, `kind`, `sheetId`, `previousSheetId` when relevant, `objectType`, optional `data`, and optional `bounds`.
- State whether uncomputable bounds are represented as absence, diagnostics, or a typed receipt variant. The current plan correctly rejects zero/default rectangles, but APIs and receipts need a concrete replacement.
- Specify the anchor normalization contract: inputs, outputs, Rust bridge method, failure modes, and validation that `position` and `anchor` are equivalent before persistence.
- Define mutation receipt behavior from the same `MutationResult` data that feeds projection, including no fallback object shapes on successful mutations and no zero-bounds success receipts.

The proposed tests and gates are mostly right. The highest-value additions are red tests for sheet-scoped pure deletes, empty-sheet seeding, bounds-only update notification by event sheet, active-sheet fallback removal, nested-anchor absolute skipping during structural recompute, opaque `CellId` normalization, picture creation awaiting persistence, no placeholder anchors in production creation paths, and no duplicate manual `floatingObject:*` event emission. The final app phase should include browser workflows using real mouse, keyboard, and clipboard input for create, drag, resize, duplicate, sheet switch, and row/column resize.

Concrete changes that would raise the rating

- Add a "Target contracts" section with exact TypeScript and Rust-facing shapes for `IFloatingObjectsView` ownership, projection change batches, delete metadata, bounds diagnostics, anchor normalization, and resize-with-anchor-corner.
- Add a consumer inventory for every current `FloatingObjectCache`, `floatingObject:*`, `computeAllObjectBounds`, and renderer patch consumer, with the intended replacement for each.
- Add phase-specific acceptance criteria, including negative checks such as no production `__placeholder__` anchors, no app-owned object truth after migration, no active-sheet bounds fallback, and no zero-bounds success receipts.
- Add an object-kind hosting matrix covering chart, shape, connector, picture, textbox, drawing, diagram, equation, OLE, form control, and slicer: host-owned fields, domain-owned fields, creation path, transform path, renderability/bounds behavior, and required tests.
- Make the event pipeline single-writer requirement explicit: MutationResultHandler emits lifecycle events, and any remaining manual emitters are either removed or documented as non-lifecycle domain events.
- Split verification gates by phase and name the concrete browser scenarios expected at the final integration gate.
