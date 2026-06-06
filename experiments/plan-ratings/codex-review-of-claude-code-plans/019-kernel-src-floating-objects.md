Rating: 7/10

Summary judgment

This is a strong plan for the local `kernel/src/floating-objects` folder: it identifies real correctness bugs, names concrete files, preserves the read/write projection architecture, sequences fixes sensibly, and proposes useful unit/eval coverage. The sentinel-anchor issue, serial anchor-resolution waterfalls, projection delete notification scoping, full-object `updateTextEffect` payload, and module-global object ID generation are all grounded in the current code.

The main reason it is not higher is that it overstates the folder as the single production write path. Public worksheet object operations call `ctx.computeBridge` directly, `WorksheetObjectsImpl.clear()` and `deleteManyFloatingObjects()` loop serially outside this manager, Rust already owns `computeAllObjectBounds()` and structural bounds recomputation, and equation/diagram/drawing/chart paths outside the folder still mint default anchors or IDs. The plan is architecturally aligned inside the folder, but its contracts are not yet complete enough to solve the whole object anchoring category once.

Major strengths

- Correctly prioritizes sentinel-anchor persistence as data corruption, not polish. The `__placeholder__` and `cell-0-0` defaults in `cell-anchor-resolver.ts`, picture/textbox/OLE managers, and manager creation paths are real hazards.
- Respects important architectural boundaries: Rust remains persistent source of truth, the projection remains a derived sync read mirror, and cell-grid math remains concentrated in `spreadsheet/cell-anchor-resolver.ts`.
- Good phased sequencing: correctness before performance, projection notification scoping before hot-path caching, and public-contract cleanup called out as cross-folder work.
- Verification section is materially useful: it names existing projection tests, adds targeted unit tests, and asks for app evals around row/column deletion and multi-object delete/undo.
- The projection scoping diagnosis is precise: pure deletes currently lose sheet attribution after removal, and cross-sheet moves notify only the new sheet unless old-sheet ownership is captured before upsert.

Major gaps or risks

- The plan's production-path model is incomplete. `kernel/src/api/worksheet/objects.ts` documents that generic floating-object operations call `ctx.computeBridge` directly, and `floating-object-operations.ts` has its own serial delete-many path. Fixing only `SpreadsheetObjectManager.deleteObjects()` would leave public `ws.objects.removeMany()` and `clear()` behavior unchanged.
- The plan claims `setupFloatingObjectsProjection` subscribes to `dimension:*` events, but the setup code subscribes only to `floatingObject:created|updated|deleted`. Structural bounds updates appear to be Rust-emitted bounds-only `floatingObject:updated` changes. Phase 3 should align with that existing event path instead of inventing a dimension-driven projection path without specifying the bridge contract.
- Orphaned-anchor behavior is under-specified across TS and Rust. TS `computeObjectBounds()` returns `null` when `getCellPosition()` misses, while Rust `compute_object_pixel_bounds()` falls back to raw row/col values if a cell ID does not resolve. A deterministic policy must define which layer owns re-anchoring, whether stored anchor metadata mutates, and how undo/redo, import, and `computeAllObjectBounds()` behave.
- The "remove `hitTest`/`resolvePosition` from `IFloatingObjectManager`" item is partly inaccurate: the current exported `IFloatingObjectManager` in `types/objects` does not include those methods. They are extra methods on `SpreadsheetObjectManager`, so the plan should first identify real callers or state that this is class cleanup only.
- The anchor/default audit is too narrow. `SpreadsheetObjectManager.createEquation()` and `createDiagram()` delegate into `domain/` managers that still default to `cell-0-0`; drawing and chart conversion paths also use placeholder/default anchor IDs. The plan marks `domain/` out of scope but still routes production creation through it.
- Picture and OLE creation use fire-and-forget `setFloatingObject()` and a transient staging map. That violates the plan's own "writes flow async through store/mutator to Rust" model and must be addressed if create failures are supposed to reject through the API layer.
- The batch-delete phase does not specify group cleanup, event ordering, undo coalescing, or whether a new bridge method returns one `MutationResult` or many. Those details matter more than the loop optimization.

Contract and verification assessment

The plan has a good start on contracts, especially "no persisted sentinel anchor", "sync reads never touch IPC", and "delete/cross-sheet notifications are sheet-scoped". The weakest contract is orphan resolution: "nearest surviving cell + retained pixel offset, or convert to absolute" is presented as a choice, not a verifiable invariant. Implementers need exact behavior for deleted `from`, deleted `to`, deleted whole row/column bands, hidden dimensions, absolute anchors, two-cell anchors with negative extents, and imported legacy objects with both raw row/col and cell IDs.

Verification is solid for local unit coverage but should be expanded. Add tests for the public worksheet API paths that bypass `SpreadsheetObjectManager`, Rust `computeAllObjectBounds()`/structural recompute parity, projection bounds-only `floatingObject:updated` handling, group-membership cleanup after batch delete, and create-path rejection for picture/textbox/equation/diagram defaults. The gates should include the relevant Rust compute crate tests if orphan or batch-delete behavior changes in compute-core, not just kernel TypeScript tests.

Concrete changes that would raise the rating

- Rewrite the production-path section to map every object write path: `SpreadsheetObjectManager`, worksheet `objects` API, shape/drawing/equation/text-effect/diagram/chart operations, and Rust mutation result emission. Mark which paths this plan will change and which require sibling plans.
- Replace the vague orphan-anchor option with one normative cross-layer contract, including storage mutation policy, `computeObjectBounds()` result, `computeAllObjectBounds()` result, projection event shape, undo/redo behavior, and import compatibility.
- Correct the projection event contract: use the existing bounds-only `floatingObject:updated` pipeline unless there is a deliberate reason to add `dimension:*` subscriptions.
- Expand Phase 1 beyond this folder or explicitly add dependencies for equation, diagram, drawing, chart conversion, and worksheet API creation paths that can persist default anchors.
- Specify the batch-delete bridge/API contract: input grouping by sheet, one mutation result versus multiple, deleted count semantics, group cleanup, event coalescing, undo atomicity, and public `ws.objects.removeMany()`/`clear()` coverage.
- Adjust the dead-surface item to match the actual contract: remove class-only stubs or prove callers still use them and make them real; do not plan a contract removal that is already absent.
- Add verification gates for the public API/eval path and compute-core bounds path, not only the local projection and resolver tests.
