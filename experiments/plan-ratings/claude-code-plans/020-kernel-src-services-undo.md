# 020 — Kernel Undo Service: Authoritative-State Alignment and Cross-Domain Replay Invariants

## Source folder and scope

- **Folder:** `mog/kernel/src/services/undo`
- **Files in scope:**
  - `undo-service.ts` — `UndoService` class + `createUndoService` factory + `IUndoReplayService` extension (≈308 lines, the substance).
  - `types.ts` — re-exports of `IUndoService` / `UndoError` / `UndoServiceState` / `UndoStateChangeEvent` from `@mog-sdk/contracts/services`, plus a kernel-internal `UndoStackItem`.
  - `index.ts` — public barrel.
  - `__tests__/undo-service.test.ts` — covers only the pivot `historyReplay` wrapping for undo/redo.
- **Adjacent production-path collaborators referenced by this plan (read-only context, not edited here unless explicitly called out):**
  - `mog/kernel/src/bridges/compute/compute-bridge.ts` (`undo`/`redo`/`getUndoState`/`getMutationHandler`) and `compute-core.ts` (`mutateAndNotify` → `notifyForwardMutation`, `setPendingUndoDescription` plumbing).
  - `mog/kernel/src/bridges/compute/compute-types.gen.ts` (`UndoState { canUndo, canRedo, undoDepth, redoDepth }`).
  - `mog/kernel/src/domain/undo.ts` (`getUndoHistory`, `undoToIndex`) and `mog/kernel/src/api/workbook/history.ts` (`WorkbookHistoryImpl`).
  - `mog/kernel/src/services/checkpoint/checkpoint-manager.ts` (replay consumer).
  - `mog/contracts/src/api/types.ts` (`UndoHistoryEntry`) and `@mog-sdk/contracts/services` (`IUndoService`).

**Scope boundary:** this is a *planning* document only. The implementation it describes touches the kernel undo service plus a small, named set of collaborator surfaces (contracts, compute-core history APIs). No code is changed by this file.

## Current role of this folder in Mog

`UndoService` is the single cross-app undo/redo facade. The Rust compute engine (compute-core) owns the **authoritative** undo/redo history; `Y.UndoManager` was eliminated. The service is a thin JS layer that:

1. Delegates the actual undo/redo to `ComputeBridge.undo()` / `.redo()`, which route through `mutateCore` (not `mutate`) so they do **not** recursively re-notify the undo service.
2. Caches the authoritative `UndoState` (`canUndo`, `canRedo`, `undoDepth`, `redoDepth`) from `ComputeBridge.getUndoState()` after every operation, and exposes it via `getState()` / `canUndo()` / `canRedo()`.
3. Maintains **JS-side shadow stacks of human-readable descriptions** (`descriptions`, `redoDescriptions`, `pendingDescription`) for UI labels (`getNextUndoDescription`, `listDescriptions`), since Rust's `getUndoState()` returns only depths, not labels.
4. Wraps undo/redo in `historyReplay` pivot-update options (`reason: 'historyReplay', refreshPolicy: 'refreshAndMaterialize'`) via the mutation handler so pivot tables refresh/materialize correctly during replay.
5. Is a `Subscribable<UndoStateChangeEvent>` so the ribbon/UI react to state changes, tagged with a `trigger` (`undo` / `redo` / `push` / `clear` / `external`).
6. Exposes a replay extension (`IUndoReplayService`: `replayToUndoDepth`, `undoToIndex`) consumed by `domain/undo.ts` (go-to-history-index) and the checkpoint manager (snapshot replay).

Forward mutations notify the service via `compute-core.mutateAndNotify → ctx.services.undo.notifyForwardMutation()`, and descriptions are seeded via `setNextDescription()` (e.g. workbook batch labels, `undoGroup`).

## Improvement objectives

The dominant structural risk is a **dual source of truth**: Rust owns the authoritative history depths, but the JS layer reconstructs a parallel description stack with heuristics that are not invariant-enforced against those depths. Every objective below reduces or eliminates that divergence and hardens the cross-domain replay contract.

1. **Eliminate description-stack drift from authoritative depth.** Make `descriptions.length` / `redoDescriptions.length` provably consistent with `undoDepth` / `redoDepth`, or replace the JS shadow stacks with descriptions sourced from Rust. Today the alignment is maintained by best-effort heuristics in `notifyForwardMutation`, `undo`, `redo`, and `stopCapturing` with no enforced invariant.
2. **Serialize all state-mutating operations.** Introduce an internal operation queue/mutex so `undo`/`redo`/`notifyForwardMutation`/`clear`/`replayToUndoDepth` cannot interleave at their `await` points and corrupt shadow stacks or cached state.
3. **Stop silently swallowing authoritative-state read failures.** `refreshState()` currently discards every error; a failed `getUndoState()` leaves `cachedState` stale and `canUndo`/`canRedo` lying to the UI. Add bounded retry + telemetry + an explicit "unknown/uninitialized" state.
4. **Make `clear()` honest about Rust.** Define and implement the real contract: either `clear()` also clears Rust's history, or it is renamed/scoped so it cannot produce a state where JS says `canUndo=false` while Rust still has history that a later `refreshState()` resurrects with no descriptions.
5. **Harden replay (`replayToUndoDepth` / `undoToIndex`) against non-progress and event thrash.** Add a progress guard (so a no-op `undo()` can't infinite-loop) and coalesce change notifications across a multi-step replay into a single emit.
6. **Strengthen cross-domain replay invariants (the queue's stated theme).** The `historyReplay` signal is wired only for pivots. Audit and extend the replay-mode signal to every domain with derived/materialized state (charts, filters/autofilter, conditional formatting, named ranges, floating objects/shapes) so undo/redo does not double-fire or mis-refresh side effects in any domain.
7. **Fix history-entry metadata.** `domain/undo.getUndoHistory` stamps every entry with the same `Date.now()` and a positional `id`. Source real per-entry timestamps/ids (the dormant `UndoStackItem { description, timestamp }` type already signals this intent) so go-to-index and history UI are stable.

## Production-path contracts and invariants to preserve or strengthen

**Preserve (must not regress):**

- **`IUndoService` shape** (`@mog-sdk/contracts/services`): all 13 members keep their signatures. `undo`/`redo` return `Result<void, UndoError>`; `UndoError` variants `nothing-to-undo` / `nothing-to-redo` / `rust-failed` remain.
- **Rust is the single source of truth for *what can be undone*.** `canUndo`/`canRedo`/depths derive from `ComputeBridge.getUndoState()`, never from JS-only bookkeeping.
- **Undo/redo route through `mutateCore`, not `mutate`** — they must never recursively trigger `notifyForwardMutation`. (`notifyForwardMutation` is documented "ONLY for forward mutations.")
- **Forward-mutation hook is the single funnel.** Every undoable forward mutation reaches the service exactly once via `notifyForwardMutation`. A new forward mutation after an undo invalidates Rust's redo stack and must clear `redoDescriptions`.
- **`Subscribable` semantics**: `subscribe()` returns an `IDisposable`; `getSnapshot()` returns current state + last trigger; listeners are cleaned up on dispose.
- **Pivot replay metadata**: undo/redo wrap their Rust call in `{ reason: 'historyReplay', refreshPolicy: 'refreshAndMaterialize' }` (the only behavior the existing test pins).

**Strengthen (new/tightened invariants):**

- **INV-1 (depth alignment):** after any settled operation, `descriptions.length === cachedState.undoDepth` and `redoDescriptions.length === cachedState.redoDepth`. Where Rust depth jumps by N>1 (batch) or stays flat on a coalesced edit, descriptions are reconciled to exactly match — no permanent off-by-N (today the fallback pushes only one `'Undo'` per notify).
- **INV-2 (serialized state):** no two state-mutating methods observe each other's intermediate state; each runs to completion (including `refreshState` + notify) before the next begins.
- **INV-3 (authoritative-read integrity):** if `getUndoState()` cannot be read, the service reports an explicit non-actionable state (undo/redo disabled, distinguishable from a real empty history) and surfaces a telemetry signal, rather than serving stale cached values forever.
- **INV-4 (replay progress):** `replayToUndoDepth` makes monotone progress toward the target each iteration or aborts with a `rust-failed` error; it never spins.
- **INV-5 (cross-domain replay parity):** undo and redo place *all* domains with derived/materialized state into replay-consistent refresh mode, not only pivots; the set of such domains is enumerated and tested.
- **INV-6 (description failure atomicity):** the existing "revert the description move on Rust failure" behavior in `undo`/`redo` is preserved and made correct under INV-1 (revert restores the exact prior stack lengths).

## Concrete implementation plan

### Phase 0 — Evidence + decision on description ownership
1. Confirm whether compute-core can expose **per-entry descriptions** (it already has `setPendingUndoDescription`/`getPendingUndoDescription`/`clearPendingUndoDescription` plumbing referenced from `compute-core.ts:1150` and bridge tests). Two viable target architectures:
   - **(A) Rust-owned descriptions (preferred long-term):** extend `getUndoState()` (or add a sibling `getUndoHistory()` bridge method) to return depth-aligned labels + stable ids + timestamps. JS shadow stacks are deleted; `getNextUndoDescription`/`listDescriptions`/`getUndoHistory` read straight from Rust. This structurally eliminates INV-1 drift.
   - **(B) JS-owned descriptions, invariant-enforced (smaller blast radius):** keep the JS stacks but enforce INV-1 with a single reconciliation routine.
2. Decide A vs B with the compute-core owners. Record the decision in this plan's PR description. The remaining phases are written so the early phases (queue, error handling, replay) are valuable under *either* choice, and the description work forks at Phase 4.

### Phase 1 — Operation serialization (INV-2)
3. Add a private promise-chain queue (`private opChain: Promise<unknown> = Promise.resolve()`) and a `private enqueue<T>(fn): Promise<T>` helper that chains every state-mutating public method (`undo`, `redo`, `clear`, `notifyForwardMutation`, `replayToUndoDepth`, `undoToIndex`) through it. Reads (`getState`, `canUndo`, `getSnapshot`, `listDescriptions`) stay synchronous against the last settled `cachedState`.
4. Ensure `refreshState()` + `notifyChange()` happen *inside* the queued critical section so subscribers only ever see settled states.

### Phase 2 — Authoritative-read integrity (INV-3)
5. Introduce an explicit cached-state status: extend the private cached model with a `ready: boolean` (or a `'uninitialized' | 'ready' | 'error'` tag). While not ready, `canUndo`/`canRedo` return `false` and `getState()` flags it (without breaking the `UndoServiceState` contract — represent "not ready" as the safe disabled state and emit telemetry).
6. Replace the empty `catch {}` in `refreshState()` with: bounded retry (e.g. small fixed retry on the initialization race), a `console.warn`/telemetry hook on persistent failure, and setting the error/uninitialized status. Keep the constructor's eager refresh but track its completion so the first real read flips `ready`.
7. Constructor currently fires `void this.refreshState()`. Either expose an awaitable `whenReady()` for consumers that need it, or keep fire-and-forget but guarantee subscribers get a `notifyChange('external')` when the first refresh settles so the UI updates from default → real.

### Phase 3 — Replay hardening (INV-4)
8. In `replayToUndoDepth`, capture `undoDepth` before each `undo()`/`redo()`; if a step does not move the depth toward the target, abort with `err({ type: 'rust-failed', reason: 'undo replay made no progress' })` instead of looping. Add a max-iteration ceiling derived from the initial depth delta as a backstop.
9. Coalesce notifications: run the replay loop with notifications suppressed and emit a single `notifyChange('external')` (or a dedicated `'replay'` trigger, if the contract's trigger union can be extended without breaking consumers) at the end. This removes per-step UI thrash for large go-to-index jumps and checkpoint replays.
10. Re-derive `undoToIndex`'s index→depth math with explicit documentation of the `listDescriptions()` ordering (most-recent-first) vs depth, and add table-driven tests (Phase 7) covering index 0, last, and out-of-range.

### Phase 4 — Description source of truth (forks on Phase 0 decision)
- **If (A):** delete `descriptions`/`redoDescriptions`/`pendingDescription` fields and the heuristic blocks in `notifyForwardMutation`/`stopCapturing`/`undo`/`redo`; back `getNextUndoDescription`/`getNextRedoDescription`/`listDescriptions` with the new Rust history read; route `setNextDescription` to `setPendingUndoDescription` so there is exactly one pending-description mechanism (today JS `pendingDescription` and Rust pending-description are parallel). Update `domain/undo.getUndoHistory` to map the Rust entries (real ids + timestamps).
- **If (B):** extract a single `reconcileDescriptions(prevState, nextState)` routine that is the *only* place the stacks are mutated in response to depth changes; it must handle depth growth by N>1 (push N fallbacks), depth shrink, and flat-depth coalesced edits, guaranteeing INV-1. Replace the ad-hoc logic in `notifyForwardMutation` (the `descriptions.length < undoDepth` single-push fallback) with this routine. Preserve INV-6 revert semantics by snapshotting lengths before the Rust call.

### Phase 5 — `clear()` contract (Objective 4)
11. Define the intended semantics with the compute-core owner. If `clear()` is meant to wipe history (e.g. on document load/close), add a `ComputeBridge.clearUndoHistory()` call and await it inside the queued `clear()`; then refresh from Rust so `cachedState` reflects the truly-empty history. If `clear()` is JS-display-only, rename it in the contract or document that it must be followed by a Rust clear, and guard against the resurrection-on-next-refresh failure mode.

### Phase 6 — Cross-domain replay parity (INV-5, the queue theme)
12. Enumerate every domain that maintains derived/materialized state reacting to mutations: pivots (already handled), charts (note existing chart-series serialization bug in repo memory — do not regress), filters/autofilter, conditional formatting, named ranges, floating objects/shapes, defined tables.
13. Generalize `HISTORY_REPLAY_PIVOT_UPDATE` into a domain-agnostic "history replay" mutation context so that during undo/redo each such domain refreshes/materializes deterministically (no double-fire of side effects, no stale derived caches). Where a domain currently lacks any replay-mode hook, add one analogous to the pivot path. Keep the pivot behavior bit-identical (the existing test must still pass unchanged).

### Phase 7 — Tests & types
14. Remove or implement the dormant `UndoStackItem` type (`types.ts`): either use it as the per-entry shape (description + real timestamp) under choice (A)/history work, or delete it if unused after Phase 4.

## Tests and verification gates

> Per task constraints this plan does **not** run any build/test commands; the gates below are what the implementation PR must satisfy.

- **Unit (`__tests__/undo-service.test.ts` expanded):**
  - Preserve the two existing pivot `historyReplay` assertions verbatim.
  - INV-1: after sequences of `setNextDescription`+`notifyForwardMutation` with depth jumps of 1 and >1, flat-depth coalesced edits, and redo-invalidation, assert `descriptions.length === undoDepth` and `redoDescriptions.length === redoDepth`.
  - INV-2: interleave `undo()` and `notifyForwardMutation()` (resolve bridge promises out of order) and assert no corrupted stacks / single settled emit per op.
  - INV-3: `getUndoState()` rejects → service stays disabled, emits telemetry, recovers on a later successful refresh.
  - INV-4: a bridge `undo()` that does not change depth aborts replay with `rust-failed`, no hang; large go-to-index jump emits exactly one change event.
  - INV-6: bridge `undo()`/`redo()` rejection restores prior stack lengths exactly.
  - `clear()`: asserts Rust clear is invoked (choice-dependent) and no resurrection on next refresh.
- **Cross-domain (INV-5):** a kernel-level test per derived domain confirming undo/redo runs that domain's replay-mode refresh exactly once (charts/filters/CF/named-ranges/floating objects), mirroring the pivot test.
- **Integration:** `domain/undo` go-to-index and `checkpoint-manager` replay paths exercised against the hardened `replayToUndoDepth` (stable ids/timestamps from `getUndoHistory`).
- **Gates:** `pnpm --filter @mog-sdk/contracts build` if contract types change (per repo memory, consumers won't typecheck otherwise); kernel typecheck; existing kernel undo + bridge undo suites green; targeted `app-eval`/`api-eval` undo scenarios (e.g. `scale-format/selected-column-alignment-undo`) green. Run by the implementer — not by this planning step.

## Risks, edge cases, and non-goals

**Risks / edge cases:**
- **Contract ripple:** sourcing descriptions/timestamps from Rust touches `UndoState`/`getUndoState` (generated `compute-types.gen.ts`) and possibly `UndoHistoryEntry`. Requires compute-core coordination and a contracts rebuild; staleness of generated bindings is a known footgun.
- **Trigger union extension:** adding a `'replay'` trigger to `UndoStateChangeEvent` could break exhaustive `switch` consumers — only do it if the union is open or all consumers are updated; otherwise reuse `'external'`.
- **Coalesced edits in Rust:** if Rust coalesces successive edits (depth unchanged) the description model must agree; choice (A) makes this automatic, choice (B) must explicitly handle flat-depth notifies.
- **Serialization vs latency:** queuing all ops must not deadlock (e.g. `replayToUndoDepth` internally calling queued `undo()`); use a re-entrant-safe internal path that bypasses the public queue for nested calls.
- **`clear()` during in-flight ops:** must run inside the queue so it can't race a pending `undo`.
- Do not regress the known chart-series-update serialization bug while generalizing the replay context.

**Non-goals:**
- Reimplementing the undo algorithm in JS (Rust remains authoritative).
- Changing the public `IUndoService` method set or `UndoError` variants.
- Reviving `Y.UndoManager` or any JS-owned authoritative history.
- Collaborative/multi-user undo semantics (out of this folder's scope).
- Performance tuning of Rust-side undo internals.

## Parallelization notes and dependencies on other folders

- **Blocking dependency:** Phase 0 decision and Phase 4(A)/Phase 6 require **compute-core** owners to expose per-entry descriptions and a generalized replay-mode context, plus a possible `clearUndoHistory` bridge method. Coordinate before implementing those phases.
- **Contracts dependency:** any `UndoState`/`UndoHistoryEntry`/trigger-union change goes through `@mog-sdk/contracts` and needs a contracts build before kernel consumers typecheck.
- **Consumer coordination:** `domain/undo.ts`, `api/workbook/history.ts`, and `services/checkpoint/checkpoint-manager.ts` consume the replay/history surface; verify in lockstep with Phases 3–4.
- **Safely parallelizable now (no external blocker):** Phase 1 (serialization), Phase 2 (error handling), Phase 3 (replay progress guard + notification coalescing), and Phase 4(B) (invariant-enforced JS reconciliation) are self-contained in this folder and can land first, independently, delivering most of the correctness win even if the Rust-owned-description migration (A) is deferred.
