# Improve `mog/kernel/src/floating-objects`

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/kernel/src/floating-objects`

Scope: anchoring, projection, object persistence adapters, object transform delegation, grouping, z-order, clipboard/duplication positioning, and the spreadsheet-specific bridge between cell anchors and sheet-space pixel bounds for charts, shapes, images, text boxes, diagrams, equations, OLE objects, and related floating-object types.

This plan intentionally includes production consumers and dependencies that must change for the folder to improve correctly:

- `contracts` / `types/objects`: public object, anchor, mutator, and projection contracts.
- `compute/core`: canonical Rust/Yrs object storage, typed mutation results, layout-index bounds, and structural/dimension bounds invalidation.
- `apps/spreadsheet`: current renderer/object cache consumers that should move to the kernel-owned projection.
- `kernel/src/api/worksheet`: worksheet object APIs and mutation receipts that expose object state and bounds.

## Current role of this folder in Mog

`floating-objects` is the kernel's hosting layer for canvas-backed spreadsheet objects. It owns where objects live, how their anchors project into sheet-space pixels, how object writes reach Rust compute storage, and how a sync TS-side projection is supposed to feed renderer and React consumers.

Current architecture observed in source:

- Rust compute storage is the canonical object state. `SpreadsheetObjectMutator` routes move, resize, rotate, duplicate, delete, and z-order writes through `ComputeBridge`.
- `ComputeBridgeObjectStore` adapts Rust/Yrs storage to the generic `IObjectStore<FloatingObject>` shape and maps `containerId` to `sheetId`.
- `spreadsheet/cell-anchor-resolver.ts` contains spreadsheet-only cell anchor math, but most production writes already bypass it and delegate to Rust.
- `projection/` defines `FloatingObjectsProjection` and `setupFloatingObjectsProjection`, intended as a sync, push-notified kernel view over Rust mutation results.
- The app still has a parallel `apps/spreadsheet/src/cache/floating-object-cache.ts` and custom `SheetCoordinator` wiring, including bounds fallback logic and sheet-switch resync. That duplicates the kernel projection's intended role.
- `canvas-object-manager.ts` remains a generic sync-resolver manager, but the spreadsheet production path needs async bridge-backed anchor resolution and mostly uses `SpreadsheetObjectManager` instead.
- Picture/textbox/drawing/equation/diagram creation paths still contain placeholder default anchors such as `__placeholder__` or `cell-0-0`, and picture creation persists fire-and-forget instead of awaiting the canonical mutation result.
- Bridge geometry normalization currently derives persisted row/column positions only from positional IDs such as `cell-0-0`; opaque stable `CellId` anchors are copied but do not drive persisted anchor row/column unless separately resolved.
- Chart hosting has parallel geometry fields (`position`, chart anchor mode, width/height-in-cells style fields) that can drift unless the shared `ObjectPosition` contract is made authoritative.

## Improvement objectives

1. Make the kernel-owned floating object projection the single production read model for renderer, React hooks, object coordination, connector rerouting, and devtools-style inspection.
2. Remove placeholder anchors and local staging behavior from production object creation. Every persisted spreadsheet object should receive a real `CellId` from Rust for its anchor, or an explicit absolute anchor when that is the chosen mode.
3. Strengthen the `position`/`anchor` and `sheetId`/`containerId` contracts so objects cannot drift between duplicate representations.
4. Make bounds updates complete and sheet-scoped for create, update, delete, row/column resize, row/column insert/delete, hide/unhide, undo/redo, hydration, and remote CRDT edits.
5. Convert resize/move combinations into atomic production mutations where possible, especially for northwest/north/west/east/south resize handles that currently require app-side resize then move sequences.
6. Unify chart, shape, picture, textbox, equation, diagram, drawing, OLE, form-control, and slicer hosting behavior while keeping object content logic in domain-specific modules.
7. Remove or re-scope stale generic manager paths that imply sync anchor resolution or local object ownership that production no longer has.
8. Preserve app-agnostic hosting boundaries without leaking spreadsheet cell-grid math into core hosting operations.
9. Make storage normalization identity-aware so stable `CellId` anchors, not only row/column fallback fields, determine persisted geometry.

## Production-path contracts and invariants to preserve or strengthen

- Rust compute storage remains the single persistent source of truth for floating objects and groups.
- Renderer reads are synchronous and projection-backed; renderer code must not await object bounds during paint or sheet switch.
- All writes go through `ComputeBridge` typed mutation paths and enter TS state through `MutationResultHandler` events.
- `FloatingObjectBase.position` and `FloatingObjectBase.anchor` must reference equivalent `ObjectPosition` data. During the transition they should be written together and validated together.
- `FloatingObjectBase.sheetId` and `FloatingObjectBase.containerId` must identify the same sheet. Cross-sheet moves must update all indexes atomically.
- `oneCell` anchors move with their anchor cell and retain explicit width/height.
- `twoCell` anchors move and resize with their from/to cells; computed bounds must be non-negative and in sheet-space pixels.
- `absolute` anchors stay in sheet-space pixels and do not shift on row/column structural or dimension changes.
- Bounds snapshots are finite sheet-space CSS pixels with rotation in degrees. Objects with uncomputable bounds are omitted; consumers skip them rather than substituting zero/default rectangles.
- Deletions must notify the affected sheet, not only workbook-scoped `null`, because renderer and hooks commonly filter by sheet.
- Z-order is shared across all floating object kinds, including charts. Ordering must be deterministic even when imported files contain duplicate or sparse z-indexes.
- Group membership cleanup is canonical and persisted. Deleting objects removes them from groups, and groups that become invalid are removed or repaired through Rust-backed mutations.
- Clipboard/duplicate positioning uses resolved sheet-space pixels plus target-sheet anchoring, not unbounded direct offset addition to cell-anchor offsets.
- Hidden rows/columns, resized rows/columns, inserted/deleted rows/columns, and missing/deleted anchor cells have explicit semantics covered by tests.

## Concrete implementation plan

1. Establish executable contracts before refactoring.
   - Add focused tests around `FloatingObjectsProjection`, `setupFloatingObjectsProjection`, `SpreadsheetObjectManager`, `ComputeBridgeObjectStore`, and Rust `compute_object_pixel_bounds`.
   - Cover create/update/delete, bounds-only events, deletion sheet notifications, cross-sheet moves, sheet switch population, row/column dimension shifts, and anchor defaults.
   - Add fixture objects for every floating-object kind that uses hosting: chart, shape, connector, picture, textbox, drawing, diagram, equation, OLE object, form control, and slicer.

2. Promote `FloatingObjectsProjection` to the production read surface.
   - Wire `createFloatingObjectsProjection()` and `setupFloatingObjectsProjection()` from the kernel composition root that currently exposes `SpreadsheetObjectManager`.
   - Give app consumers an `IFloatingObjectsView` reference instead of a Zustand-only `FloatingObjectCache`.
   - Replace the duplicated `SheetCoordinator` event coalescing and sheet-switch cache population logic with the kernel projection setup.
   - Keep any React hook ergonomics as thin adapters over `IFloatingObjectsView`/`useSyncExternalStore`, not as a second source of object truth.
   - Move renderer patching/resync decisions behind projection notifications so the renderer reads one authoritative object/bounds snapshot per sheet.

3. Fix projection event completeness.
   - Extend `setupFloatingObjectsProjection` to retain sheet IDs from delete events and pass sheet-scoped delete metadata into `FloatingObjectsProjection.applyBatch`.
   - Ensure bounds-only updates from `floatingObject:updated` events with `data == null` and `bounds != null` notify the event's sheet even when the object data is not fetched.
   - Move the current app-side "missing event bounds" fallback into kernel setup, and fetch bounds for the event's `sheetId`, never the active sheet.
   - Seed empty sheets explicitly so a sheet with zero objects clears stale projection state.
   - Preserve disposal/generation guards for pending object fetches, bounds fetches, and initial seeds.

4. Remove placeholder anchoring from creation paths.
   - Introduce a production helper in the spreadsheet adapter that normalizes `Partial<ObjectPosition>` by asking Rust for the real `CellId` at the default or requested pixel location.
   - Update `floating-object-geometry-normalization.ts` so opaque `CellId` values resolve to row/column through Rust/bridge state before persisted anchor fields are derived; positional `cell-r-c` parsing can remain only as a legacy fallback.
   - Replace `__placeholder__` and `cell-0-0` default anchors in picture, textbox, OLE, equation, diagram, drawing, and related managers with real bridge-created anchors or explicit absolute anchors.
   - Make picture creation await persistence through `ComputeBridgeObjectStore` or a typed `ComputeBridge` create operation. Do not stage the object in a local map and fire-and-forget the write.
   - Ensure all created objects set `sheetId`, `containerId`, `position`, and `anchor` consistently before persistence.

5. Align transform operations with Rust's canonical anchor model.
   - Keep pixel math in `core/positioning.ts` pure and app-agnostic.
   - Route spreadsheet transforms through typed Rust mutations that resolve and persist anchors in one place.
   - Add an atomic "resize to bounds" or "resize with anchor corner" path using Rust's existing `ResizeConfig.anchor_corner` concept so app resize handles do not need separate resize and move mutations.
   - Ensure rotate and flip update both the persisted object payload and projection bounds without re-deriving anchors in stale sync TS code.
   - Deduplicate chart-specific move/resize from shape/image move/resize at the hosting layer; chart content can stay in chart domain bridges.
   - Collapse chart-specific geometry fields into derived data from `ObjectPosition`, or add invariant checks that fail before persistence when chart geometry fields disagree with shared floating-object geometry.

6. Make Rust bounds authoritative and complete.
   - Update structural/dimension bounds recomputation to read anchor mode from both nested typed anchors and legacy flat fields. `compute_object_pixel_bounds` already supports both; `recompute_floating_object_bounds` should use the same helper logic.
   - Ensure recomputed bounds events are emitted for row height/column width changes, row/column insert/delete, hide/unhide, undo/redo, hydration, and remote sync.
   - Include enough metadata in bounds-only `FloatingObjectChange` entries for TS to sheet-scope notifications without fetching object data.
   - Normalize two-cell inverted anchors deterministically: bounds snapshots should have top-left `x/y` and non-negative `width/height`.
   - Add explicit behavior for missing from/to `CellId`s: either omit bounds with diagnostics or repair anchors through a persisted mutation; do not silently render at origin.

7. Re-scope stale generic manager code.
   - Audit `canvas-object-manager.ts` and the sync `IPositionResolver` dependency. If no production app uses it, either remove it from public exports or narrow it to non-spreadsheet/mock-only usage with tests proving it cannot be pulled into spreadsheet production.
   - If Mog still wants an app-agnostic manager abstraction, update the contract to support async anchor normalization at write time and sync projection reads at render time. Do not keep a sync resolver API that contradicts the Rust-backed spreadsheet path.
   - Keep universal pure helpers in `core/` where they do not import spreadsheet or bridge code.

8. Consolidate z-order, grouping, and duplicate/clipboard behavior.
   - Move z-index normalization and step movement to Rust-backed operations for all floating object kinds, preserving a deterministic shared z-space.
   - Ensure group create/update/delete uses one persisted schema (`children`/`memberIds` mapping) and emits projection events that update group-dependent consumers.
   - Change duplicate and clipboard paste to resolve source bounds, apply pixel offsets, and convert to target-sheet anchors through Rust. This avoids anchor offsets that exceed cell dimensions or paste into the wrong sheet geometry.
   - Verify connectors reroute from projection-backed bounds after shape moves, resize, delete, and group changes.

9. Update public worksheet object API and receipts.
   - Make create/update/move/resize/delete receipts use the same mutation result data and bounds that projection uses.
   - Remove fallback zero-bounds receipts except for explicitly unrenderable imported objects with diagnostics.
   - Make `computeObjectBounds(objectId)` use the batch bounds map efficiently without becoming the renderer's normal read path.
   - Keep API object info projections separate from full domain `FloatingObject` snapshots, but derive both from the same bridge mapper.

10. Delete obsolete duplicate state after migration.
    - Once app consumers use `IFloatingObjectsView`, remove the app-owned `FloatingObjectCache` or leave only a compatibility adapter backed by the projection.
    - Remove duplicated event coalescing, active-sheet bounds fallback, and manual renderer patch construction from `SheetCoordinator`.
    - Update docs in `kernel/src/floating-objects/README.md` and renderer architecture docs to reflect the final single-projection path.

## Tests and verification gates

Unit and integration tests to add or strengthen:

- TS projection tests in `kernel/src/floating-objects/projection/__tests__` for coalescing, delete sheet notifications, bounds-only updates, missing-bounds fetch by event sheet, seed of empty sheets, cross-sheet moves, and disposal guards.
- TS manager/store tests under `kernel/__tests__/floating-objects` for awaited creation, no placeholder anchors, immutable field guards, group cleanup, z-order determinism, duplicate anchoring, and all object kinds.
- Worksheet API tests under `kernel/__tests__/api/worksheet` for receipts with non-zero authoritative bounds and no fallback object shapes on successful mutations.
- Rust compute tests for `compute_object_pixel_bounds` and structural/dimension recomputation: one-cell, two-cell, absolute, nested typed anchor, legacy flat anchor, EMU offsets, hidden rows/columns, resize, insert/delete, deleted anchors, and inverted anchors.
- Bridge normalization tests for opaque stable `CellId` anchors so persisted anchor row/column does not fall back to `(0, 0)` unless the object genuinely anchors there.
- Spreadsheet object-system tests for drag, resize handles, rotation, chart/image/shape consistency, connector rerouting, sheet switching, and clipboard paste.
- Browser/UI coverage using real mouse/keyboard/clipboard paths for create, drag, resize, duplicate, sheet switch, and row/column resize effects on rendered objects.

Verification gates for the implementation workstream:

- `cargo test -p compute-core`
- `cargo clippy -p compute-core`
- `cd kernel && pnpm test`
- `cd kernel && pnpm typecheck`
- `cd apps/spreadsheet && pnpm test`
- `cd apps/spreadsheet && pnpm typecheck`
- Root `pnpm typecheck` after cross-package contract changes.
- UI dev server exercise of the spreadsheet object workflows in a browser.

## Risks, edge cases, and non-goals

Risks and edge cases:

- App cache migration can introduce stale reads if any consumer still reads Zustand state while the renderer reads the kernel projection.
- Bounds-only updates can be lost if Rust emits `data: None` without enough sheet/object metadata for TS to notify the right subscribers.
- Imported XLSX objects may carry mixed flat and nested anchor fields; the bounds path must handle both until storage migration is complete.
- Two-cell anchors with end before start, negative offsets, hidden dimensions, or deleted anchor cells need explicit semantics instead of implicit origin/default behavior.
- Opaque stable `CellId` anchors can currently degrade to `(0, 0)` during geometry normalization if no positional ID is available; this must be fixed before relying on normalized row/column fields.
- Fire-and-forget picture persistence can currently return objects that fail to persist; fixing this changes timing and callers must await creation.
- Z-index gaps and duplicates are common in imported workbooks and concurrent edits; deterministic ordering must not depend on JavaScript map iteration.
- Group schema naming differs between TS `memberIds` and Rust `children`; mapping errors can break group cleanup or ungroup.
- Chart object content invalidation is separate from hosting bounds; the plan must not force chart recompile during pure host moves.
- Freeze panes should remain a viewport/render transform concern: object bounds stay in sheet-space pixels, and tests should verify frozen-pane rendering uses those bounds without changing anchor semantics.

Non-goals:

- Do not move chart rendering, shape geometry, equation parsing, diagram layout, or image processing into `floating-objects`.
- Do not optimize test-only caches or harnesses; performance work targets renderer/projection production paths only.
- Do not introduce compatibility shims that preserve duplicate app/kernel object truth.
- Do not make renderer paint by awaiting `computeObjectBounds`; sync projection reads are the intended contract.

## Parallelization notes and dependencies on other folders, if any

This work should split cleanly across parallel agents because the contracts are explicit:

- Agent A: Rust bounds and mutation-result work in `compute/core`, including structural/dimension recomputation and tests.
- Agent B: Kernel projection and setup work in `kernel/src/floating-objects/projection`, plus projection tests.
- Agent C: Creation/transform/store cleanup in `kernel/src/floating-objects`, `kernel/src/domain/*` object managers, and worksheet object APIs.
- Agent D: App migration from `FloatingObjectCache` to `IFloatingObjectsView` in `apps/spreadsheet`, including renderer/object-system tests.
- Agent E: Public contract/doc updates in `types/objects`, `contracts`, and architecture docs.

Dependency order:

1. Contract tests and Rust bounds fixes.
2. Kernel projection event completeness.
3. Manager creation/transform cleanup.
4. App migration to projection-backed reads.
5. Deletion of duplicate app cache and stale generic manager paths.

Cross-folder dependencies must preserve direction: public `mog` code can depend on public contracts and compute bridge APIs, but must not depend on `mog-internal`. Internal planning stays in `mog-internal` only.
