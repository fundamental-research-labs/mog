# Kernel Undo Service Invariant Plan

## Source folder and scope

Public source folder: `/Users/guangyuyang/Code/mog-all/mog/kernel/src/services/undo`

Primary files in scope:

- `kernel/src/services/undo/undo-service.ts`
- `kernel/src/services/undo/types.ts`
- `kernel/src/services/undo/index.ts`
- `kernel/src/services/undo/__tests__/undo-service.test.ts`

Production paths that must be considered while improving this folder:

- `kernel/src/bridges/compute/compute-core.ts`, where forward mutations call `notifyForwardMutation()` after the unified mutation pipeline and undo/redo use `computeBridge.undo()` / `computeBridge.redo()` without re-entering the forward mutation path.
- `kernel/src/bridges/mutation-result-handler.ts`, where `MutationResult.undoDescription` is forwarded into the undo service before `notifyForwardMutation()` refreshes Rust stack depth.
- `kernel/src/api/workbook/history.ts` and `kernel/src/domain/undo.ts`, which expose public history state, listing, and go-to-index behavior.
- `kernel/src/services/checkpoint/checkpoint-manager.ts`, which restores checkpoints by replaying to an undo depth.
- `compute/core/src/storage/engine/undo_bridge.rs` and `compute/core/src/storage/engine/services/undo.rs`, where Rust compute owns the real undo and redo stacks.

The plan is not to add JS-side domain undo handlers. The production path must remain Rust compute history plus the existing unified `MutationResult` fan-out for cells, formatting, ranges, tables, pivots, sheets, drawing objects, and other domains.

## Current role of this folder in Mog

`UndoService` is a per-document kernel service created by `kernel-context.ts`. It implements the canonical `IUndoService` contract re-exported from `@mog-sdk/contracts/services`.

The service is currently a TypeScript observable wrapper around Rust compute history:

- Rust compute is authoritative for `canUndo`, `canRedo`, `undoDepth`, and `redoDepth`.
- `UndoService` caches the last `UndoState` from `ComputeBridge.getUndoState()` so public `canUndo()` and `canRedo()` can stay synchronous.
- `undo()` and `redo()` call `ComputeBridge.undo()` / `ComputeBridge.redo()`, wrap replay with pivot `historyReplay` update options, refresh cached Rust state, and emit a single state change event.
- Forward mutations call `notifyForwardMutation()` from `ComputeCore.mutate()` after `mutateCore()` has applied patches and emitted domain events.
- The service maintains local `descriptions` and `redoDescriptions` arrays for UI labels and `history.list()`. Rust does not currently expose undo entry metadata.

That division is correct at a high level, but the local metadata and event contract are weaker than the Rust stack contract. Description arrays can drift from Rust depths, concurrent commands can interleave, stale cached state can reject real operations or allow no-op commands, `undoToIndex()` silently clamps invalid indexes, and `clear()` only clears TypeScript metadata even though the public service implies history clearing.

## Improvement objectives

1. Make Rust undo depth the single source of truth for stack availability and command preconditions.
2. Replace ad hoc description arrays with a depth-reconciled metadata ledger whose lengths always match Rust `undoDepth` and `redoDepth`.
3. Serialize undo, redo, history replay, forward-mutation notification, and history clearing so cached state, metadata, and emitted events change atomically.
4. Preserve the existing production replay pipeline: Rust compute performs undo/redo, `MutationResultHandler.applyAndNotify()` applies all domain changes, then `UndoService` refreshes state and emits the history event.
5. Make `history.list()` and `goToIndex()` deterministic and contract-safe: stable entries, valid indexes only, no silent clamp to a different target state.
6. Fix or remove misleading public clear semantics. If `clear()` remains exposed, it must clear Rust compute history as well as local metadata.
7. Strengthen tests around service-level invariants and public SDK behavior instead of only checking pivot replay metadata.

## Production-path contracts and invariants to preserve or strengthen

- Rust compute remains authoritative for stack depths. `UndoService.getState().undoStackSize` and `.redoStackSize` must equal `ComputeBridge.getUndoState().undoDepth` and `.redoDepth` after every awaited mutation, undo, redo, replay, checkpoint restore, and clear.
- `canUndo()` and `canRedo()` remain synchronous public reads from the last known Rust state, but async commands must refresh before deciding that nothing can be undone or redone.
- Undo and redo must call `ComputeBridge.undo()` / `ComputeBridge.redo()` and must not route through the forward `mutate()` path or call `notifyForwardMutation()`.
- Forward mutations are the only source of `trigger: 'push'`. Undo replay emits `trigger: 'undo'`, redo replay emits `trigger: 'redo'`, and history clearing emits `trigger: 'clear'`.
- State events emit after the domain mutation result has already been applied, so subscribers that react to history changes see post-mutation workbook, sheet, viewport, pivot, table, range, and selection state.
- Pivot replay must continue to run under `{ reason: 'historyReplay', refreshPolicy: 'refreshAndMaterialize' }`.
- A new forward undoable mutation after an undo must clear redo metadata exactly when Rust redo depth is invalidated.
- Failed Rust undo/redo operations must not move metadata stacks, update cached state incorrectly, or emit success-like events.
- `replayToUndoDepth()` must stop at the requested Rust depth or return an error. It must not partially report success.
- `undoToIndex()` must reject negative, non-integer, and out-of-range indexes. It must not clamp an invalid index to "undo all".
- `clear()` must either be backed by a Rust bridge operation or be removed from the write-capable public surface. A TS-only clear violates the public contract because `ComputeBridge.getUndoState()` would still report undoable history.
- Service disposal must still clean up subscriptions through `Subscribable` and must not leave pending async operations that emit after disposal.

## Concrete implementation plan

1. Introduce an internal metadata ledger in `undo-service.ts` or a small sibling file under `services/undo`.

   Define an internal `UndoHistoryMetadata` shape with `id`, `description`, `timestamp`, and the Rust depth slot it represents. Maintain two arrays:

   - `undoEntries`, oldest to newest, length equal to Rust `undoDepth`.
   - `redoEntries`, oldest to newest or bottom to top, with an explicit helper for "next redo" so the order is unambiguous and length equals Rust `redoDepth`.

   `getNextUndoDescription()`, `getNextRedoDescription()`, and `listDescriptions()` should derive from this ledger. Add an internal `listEntries()` method if public history listing needs stable IDs and timestamps; keep `listDescriptions()` only as a compatibility wrapper if the service contract still requires it.

2. Split description capture by source and priority.

   Current `setNextDescription()` is used both by public callers and by `MutationResultHandler` through the compute-core callback. Add a kernel-internal description sink so generated mutation descriptions do not accidentally overwrite explicit batch labels. The capture policy should be:

   - Explicit caller labels from `WorkbookHistory.setNextDescription()`, `WorkbookImpl.batch(label, ...)`, and toolbar actions win for the next undo entry or enclosing undo group.
   - Generated `MutationResult.undoDescription` labels fill the entry only when no explicit label exists.
   - Empty or whitespace labels normalize to the fallback `"Undo"`.
   - Pending labels are consumed only when a fresh Rust state shows a new undo depth. They must not leak from no-op or failed mutations into the next unrelated operation.

   If grouped mutations can produce multiple generated labels but only one Rust undo depth, keep the explicit group label if present; otherwise use the last generated label for the group because it describes the final visible operation. Document this as the service contract.

3. Add a serialized operation queue.

   Add a private `runExclusive()` helper around a promise chain and use it for public mutating methods: `undo()`, `redo()`, `replayToUndoDepth()`, `undoToIndex()`, `notifyForwardMutation()`, and the corrected `clear()` path. Implement private unqueued helpers like `undoOnceAfterRefresh()` and `redoOnceAfterRefresh()` so replay loops do not deadlock by entering the queue recursively.

   The queue prevents double Ctrl-Z, redo-after-undo races, checkpoint replay, and forward mutation notifications from interleaving metadata moves and cached state refreshes.

4. Make refresh semantics explicit.

   Replace the current catch-and-ignore `refreshState()` with two modes:

   - Best-effort initialization refresh used by the constructor, which may remain silent while the bridge is still starting.
   - Required refresh used by commands and forward notifications, which returns or throws a typed failure so command methods can return `{ type: 'rust-failed', reason }`.

   `undo()` and `redo()` should refresh before checking availability, then refresh again after the bridge operation. The post-state must satisfy the expected depth transition:

   - Undo: undo depth decreases by one and redo depth increases by one.
   - Redo: redo depth decreases by one and undo depth increases by one.

   If Rust reports no transition despite the pre-state saying the command was available, reconcile metadata to the actual Rust state and return a `rust-failed` error. Do not emit an undo/redo event for a failed postcondition.

5. Reconcile metadata from Rust state, not from assumptions.

   Add ledger methods for:

   - `reconcileExternalState(nextState)`: truncate or backfill local metadata to match Rust depths after initialization, import, collaboration bootstrap, or any future external history reset.
   - `recordForwardMutation(prevState, nextState, pendingLabels)`: append exactly the number of new undo entries Rust created; clear redo entries if Rust redo depth dropped; truncate or backfill if the bridge reports unexpected but valid depth changes.
   - `recordUndo(prevState, nextState)`: move exactly one top undo entry to redo when Rust confirms an undo.
   - `recordRedo(prevState, nextState)`: move exactly one top redo entry to undo when Rust confirms a redo.
   - `recordClear(nextState)`: clear all metadata only after Rust confirms depths are zero.

   Backfilled entries should use stable generated IDs, a timestamp captured once, and fallback description `"Undo"` so history listing remains deterministic.

6. Correct `undoToIndex()` and replay semantics.

   `undoToIndex(targetIndex)` should refresh state, read the current undo history length, and reject `targetIndex >= undoDepth`. The target depth for index `0` remains `undoDepth - 1`; the target depth for the oldest entry is `0`.

   `replayToUndoDepth(targetUndoDepth)` should validate that the target is an integer in `[0, undoDepth + redoDepth]` from a fresh state. It should then run private undo/redo steps until the exact target is reached, using the same postcondition checks and event emission as user-triggered undo/redo.

7. Make `clear()` production-correct.

   Add a Rust compute bridge method that calls `UndoRedoManager::clear()` and returns an empty mutation result or a dedicated read/write response. Regenerate bridge artifacts with the existing root `pnpm generate:bridge` workflow so `compute-bridge.gen.ts`, `compute-types.gen.ts` if needed, and `manifest.gen.ts` stay authoritative.

   Then update the service contract from sync `clear(): void` to an async result-returning operation, for example `clear(): Promise<Result<void, UndoError>>`, or replace it with `clearHistory()` if the public API should distinguish service cleanup from history clearing. Update capability-gated undo APIs so `undo:write` callers await the result. Do not leave a fire-and-forget Rust clear behind a sync method.

8. Strengthen public history listing.

   Update `domain/undo.getUndoHistory()` to use service metadata entries rather than recreating timestamps and unstable `undo-${index}` IDs on every call. If adding a public `listEntries()` method would create an unwanted services-to-api dependency, define the service entry type in `types/api/src/services/index.ts` and map it to `UndoHistoryEntry` in `domain/undo.ts`.

   The listed order should remain "most recent first" because `goToIndex(0)` currently means the next undo operation.

9. Keep service boundaries clean.

   Do not import app, shell, or domain modules into `services/undo`. The service may depend on `ComputeBridge`, contracts, and service primitives only. Workbook history, app capability gates, checkpoint restore, and selection coordination should adapt to the strengthened service API from their own layers.

## Tests and verification gates

Add focused unit tests in `kernel/src/services/undo/__tests__/undo-service.test.ts` for:

- Constructor best-effort refresh and command-time required refresh.
- `undo()` and `redo()` depth postconditions, metadata moves, event triggers, and failure rollback.
- Forward mutation reconciliation for single depth growth, multi-depth growth, no-op mutation, grouped mutation label precedence, and redo invalidation after a new forward mutation.
- No pending description leakage after a no-op or failed mutation.
- `replayToUndoDepth()` exact target behavior in both directions.
- `undoToIndex()` rejecting negative, non-integer, and out-of-range indexes.
- Serialized operation behavior using controlled bridge promises.
- Pivot `historyReplay` options still wrapping undo and redo.
- Correct Rust-backed clear behavior once the clear bridge exists.

Add or update public-path tests for:

- `kernel/src/api/document/__tests__/sdk-conformance/sdk-transactions.test.ts`: labels from `batch(label, fn)`, stable `history.list()` entries, `goToIndex()` behavior, redo invalidation after new edits, and subscription trigger order.
- `kernel/src/services/checkpoint` tests: checkpoint restore reaches exact undo depth and preserves metadata/event invariants during multi-step replay.
- Capability-gated app undo tests: write-capable scoped undo clear awaits the Rust-backed result or no longer exposes clear if the contract is removed.

If the Rust clear bridge is added, add compute tests around `YrsComputeEngine::clear_undo_history()` or the chosen bridge method:

- Clearing after forward mutations sets `canUndo = false`, `canRedo = false`, `undoDepth = 0`, and `redoDepth = 0`.
- Clearing after undo also clears redo.
- New edits after clear create fresh undo entries.

Verification commands for the implementation workstream:

- `cd mog && pnpm generate:bridge` if a Rust bridge method is added.
- `cd mog/kernel && pnpm test -- src/services/undo/__tests__/undo-service.test.ts`
- `cd mog/kernel && pnpm test -- src/api/document/__tests__/sdk-conformance/sdk-transactions.test.ts`
- `cd mog/kernel && pnpm test -- src/services/checkpoint`
- `cd mog/kernel && pnpm typecheck`
- `cd mog && pnpm typecheck` because service contract and generated bridge changes can affect packages outside kernel.
- `cd mog && cargo test -p compute-core undo`
- `cd mog && cargo test -p compute-core`
- `cd mog && cargo clippy -p compute-core`

For any UI-facing history or toolbar change, run the dev server and exercise real keyboard and toolbar undo/redo paths in the spreadsheet UI.

## Risks, edge cases, and non-goals

- Risk: changing `IUndoService.clear()` from sync to async touches contracts, capability gates, mocks, and generated SDK docs. This is still the right fix if clear remains public, because sync TS-only clear is semantically wrong.
- Risk: grouped mutations can produce several `MutationResult.undoDescription` values for one Rust undo entry. The implementation must define deterministic label priority rather than depending on whichever callback fires last by accident.
- Risk: collaboration or import/bootstrap paths may change Rust history without a normal forward mutation notification. The ledger must be able to reconcile to arbitrary fresh Rust depths without corrupting future undo/redo.
- Risk: event timing is user-visible. Selection restoration relies on `push`, `undo`, `redo`, and `clear` triggers. Emit after state and metadata are updated, and preserve the current production ordering where workbook state has already been applied.
- Risk: replay loops can emit multiple events. That is acceptable if each real undo/redo emits one event, but callers that need a coalesced replay event should be handled by an explicit future contract, not by hiding intermediate state changes.
- Edge cases to cover: empty history, stale initial cache, bridge `getUndoState()` failure, undo/redo failure after metadata preconditions pass, no-op mutations, nested undo groups, new mutation after redo stack exists, checkpoint restore to current depth, checkpoint restore beyond reachable depth, and disposed service during pending operations.
- Non-goal: implement domain-specific JS undo handlers for cells, formatting, tables, pivots, ranges, sheets, comments, or floating objects. Those domains must continue to replay through Rust `MutationResult` and the existing kernel fan-out.
- Non-goal: optimize benchmark or test-only undo paths. All behavior must target the production `ComputeBridge` and workbook history path.
- Non-goal: add compatibility shims that preserve a known-wrong contract. With no external users, update the contract and the call sites directly.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable once the contracts are written down:

- Worker A: implement the undo service queue, required refresh, metadata ledger, and service unit tests in `kernel/src/services/undo`.
- Worker B: update public API contracts and workbook history listing/go-to-index behavior in `types/api`, `contracts`, and `kernel/src/api/workbook` / `kernel/src/domain/undo`.
- Worker C: add the Rust clear-history bridge in `compute/core`, regenerate bridge artifacts, and add compute tests.
- Worker D: update checkpoint, capability-gated app undo, mocks, and SDK conformance tests to the strengthened contract.
- Worker E: run UI smoke verification for real keyboard and toolbar undo/redo paths after the production changes land.

Dependencies:

- The service ledger can be implemented before the Rust clear bridge if `clear()` is temporarily left untouched during that slice, but final completion requires resolving clear semantics.
- Public history listing depends on the metadata entry shape chosen in the service contract.
- Checkpoint replay depends on the serialized replay helpers to avoid interleaving with user-triggered undo/redo.
- Bridge regeneration depends on the Rust method signature and must be integrated before TypeScript typecheck can be considered meaningful.
