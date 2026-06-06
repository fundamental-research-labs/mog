Rating: 8/10

Summary judgment

This is a high-quality plan for `mog/kernel/src/services/undo`. It correctly identifies that Rust compute is the production source of truth and that the TypeScript undo service should be a synchronous-readable, async-reconciled metadata and event wrapper rather than a second undo implementation. The plan is especially strong on current-state diagnosis: local description arrays can drift from Rust stack depths, command preconditions rely on stale cached state, `undoToIndex()` silently clamps invalid input, `history.list()` fabricates unstable IDs and timestamps, and `clear()` currently lies by clearing only TypeScript state.

The rating is not higher because several contracts need to be made sharper before implementation. The most important missing pieces are how the proposed serialization queue composes with the full forward mutation critical section, how grouped undo labels are finalized without explicit begin/end group integration, and how a Rust-backed clear will clear Rust-side history-adjacent sidecars beyond `UndoRedoManager::clear()`.

Major strengths

- The plan preserves the correct architecture: undo/redo stay in Rust compute through `ComputeBridge.undo()` and `ComputeBridge.redo()`, with `MutationResultHandler.applyAndNotify()` remaining the production fan-out for cells, formatting, ranges, tables, pivots, sheets, objects, and related domains.
- It names the right cross-folder production paths: `compute-core.ts`, `mutation-result-handler.ts`, `api/workbook/history.ts`, `domain/undo.ts`, checkpoint restore, and Rust `undo_bridge.rs` / `services/undo.rs`.
- The proposed ledger is the right abstraction. Depth-reconciled `undoEntries` and `redoEntries` with stable IDs and timestamps is a much better contract than parallel string arrays that silently diverge from Rust.
- Command semantics are much clearer than the current code: refresh before async command preconditions, verify post-depth transitions, avoid success-like events after failed Rust operations, and reconcile metadata from observed Rust state instead of assumptions.
- The plan is explicit that `clear()` must either become Rust-backed and awaitable or leave the write-capable public surface. That is the correct production contract.
- Verification coverage is substantially stronger than the current service tests, which only assert pivot history replay options.

Major gaps or risks

- The operation queue is scoped too narrowly as written. Queuing `notifyForwardMutation()` serializes metadata reconciliation after a forward mutation has already run, but it does not serialize the full Rust write performed by `ComputeCore.mutate()`. If undo/redo can start while a forward mutation is in flight but before its notification has reconciled the ledger, the service can still observe stale cached state or move metadata in the wrong order. The plan should either require the history queue to wrap the full forward mutation pipeline or identify an existing compute/write serialization guarantee that makes this safe.
- Grouped mutation label handling is specified at a policy level but not wired to a concrete lifecycle. `WorkbookImpl.batch(label, ...)` calls `setNextDescription()` before `beginUndoGroup()`, while generated `MutationResult.undoDescription` callbacks occur during each mutation. If subsequent mutations in the same Rust undo group do not change depth, a generated label can remain pending and leak unless the service is explicitly told about group begin/end or Rust exposes enough group-finalization state. The plan should add that integration point.
- The Rust clear slice is under-specified. Lower-level `UndoRedoManager::clear()` exists, but `YrsComputeEngine` also has sidecar history state such as `SheetLifecycleHistory` keyed by undo/redo depths. A production clear bridge must clear or reconcile those sidecars too, otherwise sheet lifecycle replay hints can survive after history is gone.
- The plan calls for stable listing entries but does not state the durability boundary. Because Rust does not expose undo metadata, backfilled IDs and timestamps can only be stable for the local service lifetime unless metadata is persisted or Rust starts carrying it. The public contract should say whether `history.list()` stability is per service instance, per document session, or persisted across reload/import/collaboration bootstrap.
- The `clear()` contract migration needs a more complete call-site inventory. The plan names capability gates and mocks, but it should explicitly include `types/api/src/services/index.ts`, app-facing partial `IUndoService` surfaces, document/app kernel APIs, SDK conformance fixtures, and any generated public API docs affected by changing `clear(): void`.

Contract and verification assessment

The contract direction is sound. The strongest proposed invariants are that `UndoService.getState()` depths must match fresh Rust depths after every awaited history-changing path, `canUndo()` and `canRedo()` remain synchronous cached reads, async commands refresh before deciding, and `undoToIndex()` rejects invalid indexes instead of clamping to a different state. The trigger contract is also good: `push` only for forward mutations, `undo` and `redo` only for replay, and `clear` only for real history clearing.

Verification gates are broad and mostly production-relevant. The service unit tests, SDK conformance tests, checkpoint tests, Rust compute tests, bridge generation, kernel typecheck, repo typecheck, and UI smoke check together cover the right blast radius. The plan should add explicit tests for concurrent forward mutation versus undo/redo ordering, grouped batch label finalization across multiple mutations, clearing sheet lifecycle history sidecars, and the stated stability boundary for `history.list()` entries.

Concrete changes that would raise the rating

- Define the exact serialization boundary: either a shared history/write queue used by `ComputeCore.mutate()` before the Rust call and by undo/redo/replay/clear, or a documented existing write serialization layer that guarantees no command can interleave between forward mutation application and undo metadata reconciliation.
- Add a concrete undo-group metadata protocol, such as `beginCaptureGroup(label?)` / `endCaptureGroup()` on the undo service or an equivalent callback from `WorkbookImpl.runUndoGroup`, so explicit labels and generated labels cannot leak or be consumed at the wrong depth.
- Specify the Rust clear implementation as clearing `UndoRedoManager`, sheet lifecycle history sidecars, and any future undo-depth-keyed sidecars, then refreshing TypeScript metadata from the returned Rust state before emitting `clear`.
- State the durability contract for ledger IDs and timestamps, especially after initialization, import, collaboration bootstrap, reload, and arbitrary external Rust depth reconciliation.
- Expand the implementation checklist for the async `clear()` contract migration to enumerate all public and capability-gated surfaces that compile against `IUndoService.clear()`.
- Add acceptance criteria that each public operation has a precise result shape and failure behavior, including whether `nothing-to-undo`, invalid index, target-depth out of range, refresh failure, Rust no-transition, and disposal race are all represented by distinct `UndoError` variants or by typed `rust-failed` reasons.
