Rating: 7/10

Summary judgment

This is a strong problem analysis and a useful architectural direction for `kernel/src/services/undo`. It correctly centers Rust as the authoritative undo source and identifies real production risks in the JS description stacks, async interleavings, silent state-refresh failures, `clear()` semantics, replay loops, and history metadata. As an implementation plan, though, it is not yet a fully verifiable contract: the core description-ownership decision is deferred, several public/generated contract changes are underspecified, and the broad cross-domain replay goal needs concrete domain APIs and existing-coverage analysis before implementers can compose the work safely.

Major strengths

- The plan is grounded in the actual production path: `UndoService` delegates undo/redo through `ComputeBridge`, caches `getUndoState()`, maintains JS-only labels, wraps pivot replay metadata, and feeds `domain/undo` plus checkpoint replay.
- The proposed invariants are the right class of invariants. Depth-to-description alignment, serialized mutation of cached state, replay progress, failure atomicity, and state-read integrity all map to plausible bugs in the current code.
- It preserves key behavior that must not regress, especially undo/redo avoiding forward `notifyForwardMutation()` recursion and the existing pivot `historyReplay` behavior.
- The verification section is much better than a smoke-test list. It names failure cases for depth jumps, redo invalidation, bridge rejections, no-progress replay, and notification coalescing.

Major gaps or risks

- Phase 0 defers the central architecture choice between Rust-owned history and JS-owned reconciliation. That makes Phase 4 non-executable as written; the plan should either choose the production target or provide exact decision criteria, owner, deadline, and fallback.
- The Rust-owned-description path lacks concrete API shape. The generated compute `UndoState` currently has only `canUndo`, `canRedo`, `undoDepth`, and `redoDepth`; the public workbook API adds next descriptions separately. A migration needs exact bridge methods, generated type changes, contract changes, and rebuild order.
- The plan appears to overstate existing pending-description plumbing. The current production label path is primarily `MutationResultHandler` calling `UndoService.setNextDescription`; the context-level `setPendingUndoDescription/getPendingUndoDescription/clearPendingUndoDescription` path looks separate and partly dead. That needs an explicit audit before claiming Rust labels are close.
- The queue design is under-specified for nested operations. `replayToUndoDepth()` cannot enqueue public `undo()`/`redo()` calls while already holding the same queue; the plan notes this risk but should prescribe private non-enqueued step methods and exact notification suppression semantics.
- The "unknown/uninitialized" state goal conflicts with the current `UndoServiceState` shape, which has no status field. Returning disabled values plus telemetry does not let UI distinguish a real empty history from an unreadable one unless the contract changes or a separate observable error channel is defined.
- `clear()` is a major contract gap. `IUndoService.clear()` is synchronous today, while a real Rust history clear would be async. The plan should decide whether to change the service contract, add a separate async clear, or explicitly narrow `clear()` to local display state and document its safe callers.
- Cross-domain replay parity is directionally right but too broad. Compute-core already force-refreshes viewports for several derived-state cases during undo/redo, while pivot still needs special event metadata. The plan should enumerate the exact missing replay hooks per domain instead of listing charts, filters, CF, named ranges, shapes, and tables as one undifferentiated phase.
- `undoToIndex()` bounds and ordering need stronger acceptance criteria. Current high out-of-range indexes collapse to depth 0; the plan mentions table tests but does not define whether that is valid, clamped, or an error.
- The replay extension is runtime-only today: `createUndoService()` returns `IUndoService`, while checkpoint/domain code casts to `IUndoReplayService`. The plan should decide whether replay remains an internal kernel extension or becomes a typed service contract.

Contract and verification assessment

The contract section preserves the right current obligations, but the strengthened contracts need sharper type-level expression. In particular, description ordering, depth alignment after coalesced edits, behavior when `getUndoState()` fails, replay notification coalescing, and `clear()` semantics should be written as explicit preconditions/postconditions with named observable outputs.

The test plan is solid for the undo-service unit surface, but it should name precise package gates and generated-contract gates. Any compute bridge or contract type change needs generated binding freshness checks and a contracts build before kernel typecheck. Cross-domain replay tests should be domain-specific and prove the actual production event/refresh path, not just that a generic replay flag was set.

Concrete changes that would raise the rating

- Choose the implementation architecture for descriptions now, or split the plan into an immediate JS-reconciliation fix and a separate Rust-history migration with exact APIs.
- Specify the new history/label wire contract: method names, entry shape, id/timestamp semantics, ordering, generated files, public API mapping, and rebuild order.
- Replace the generic queue note with a concrete design using one `enqueue()` wrapper plus private `undoStep`/`redoStep` methods that are safe inside replay and notification suppression.
- Define `clear()` precisely despite the synchronous current interface.
- Audit the context pending-description path and correct the plan's assumptions about how labels reach Rust or JS today.
- For cross-domain replay, produce a table of domains, current undo/redo behavior, missing replay hook, expected event/refresh behavior, and exact tests.
- Add explicit acceptance criteria for `undoToIndex()` out-of-range indexes and `listDescriptions()` ordering.
