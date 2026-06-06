Rating: 8/10

# Review: 020-kernel-src-services-undo


## Summary judgment

This is a strong, evidence-grounded plan. Every diagnostic claim it makes about
the current code checks out against the actual source, and the proposed direction
is architecturally correct: keep Rust compute authoritative for stack depth, treat
the TypeScript service as a serialized, depth-reconciled metadata/observable wrapper,
and stop pretending a TS-only `clear()` mutates real history. The contracts it wants
to preserve are the right ones, the verification gates are concrete and runnable, and
the non-goals correctly fence off the temptation to reintroduce JS-side domain undo
handlers. The main reasons it is not a 9–10 are residual scope risk, a couple of
speculative Rust naming choices, and an under-integrated treatment of the existing
undo-grouping mechanism.

## Verification of the plan's premises against source

I confirmed the plan's factual basis (read-only):

- `undo-service.ts` keeps `descriptions` / `redoDescriptions` string arrays and a
  `pendingDescription`, mutates them ahead of the Rust call, and reverts on throw
  (lines 47–48, 117–171). The plan's "description arrays can drift from Rust depths"
  and "no serialized queue" claims are accurate — there is no operation queue, so
  concurrent `undo()` / `notifyForwardMutation()` genuinely can interleave.
- `clear()` (lines 198–203) only resets TS arrays + cached state and emits `'clear'`;
  it never touches Rust. The plan's central correctness point holds.
- `undoToIndex()` (lines 189–196) rejects negative / non-integer but then computes
  `Math.max(0, undoDepth - targetIndex - 1)`, so an out-of-range `targetIndex` silently
  becomes "undo all." The plan's "silent clamp" claim is exactly right.
- `getUndoHistory()` in `domain/undo.ts` (lines 40–48) rebuilds `undo-${index}` IDs and
  `Date.now()` timestamps on every call — confirming the "unstable IDs/timestamps" gap.
- `IUndoService` in `types/api/src/services/index.ts:171` declares `clear(): void`,
  matching the contract-change risk the plan flags. Note the canonical interface lives
  in `types/api`, re-exported through contracts — and the plan's step 8 correctly points
  at `types/api/src/services/index.ts`, so it understands the real source of truth.
- Rust `undo_bridge.rs` exposes `undo/redo/can_undo/can_redo/get_undo_state/
  begin_undo_group/end_undo_group` but **no** `clear`. This confirms the plan's premise
  that a Rust clear bridge must be added rather than wired up.

A plan whose every premise survives source inspection is rare and is the strongest
thing this document has going for it.

## Major strengths

- **Correct authority model.** "Rust depth is the single source of truth; TS holds only
  reconcilable metadata" is the right invariant, and the plan states the postconditions
  precisely (undo: undoDepth−1 / redoDepth+1; redo: the mirror). Reconciling metadata
  *from* observed Rust state rather than from optimistic assumptions (step 5) is the key
  design improvement over today's pop-then-revert approach.
- **Honest treatment of `clear()`.** It refuses to paper over the semantic bug and
  accepts the contract churn (sync→async, capability gates, mocks, generated docs) as the
  price of correctness. The "no fire-and-forget Rust clear behind a sync method" line is
  the right call.
- **Serialization.** Adding `runExclusive()` with private unqueued helpers
  (`undoOnceAfterRefresh`) to avoid re-entrant deadlock in replay loops shows the author
  thought through the failure mode that a naive queue would introduce.
- **Verification gates are specific and aligned to the change.** Named test files
  (`sdk-transactions.test.ts`, checkpoint tests), `pnpm generate:bridge`, `cargo test -p
  compute-core undo`, and a cross-package `pnpm typecheck` because a contract change leaks
  beyond kernel. This matches the actual repo workflow.
- **Disciplined boundaries and non-goals.** "Do not import app/shell/domain into
  services/undo," and "no JS domain undo handlers," keep the service a primitive and
  prevent the most likely architectural regression.

## Major gaps or risks

- **Undo grouping is under-integrated.** The Rust bridge already has
  `begin_undo_group` / `end_undo_group`, which is the actual mechanism by which a batch
  collapses to one undo depth. The plan reasons about label precedence for grouped
  mutations (step 2, risk section) but never connects that to these existing bridge calls
  or to how `WorkbookImpl.batch()` drives them. The label-precedence contract is therefore
  specified in the abstract; it should be anchored to the begin/end-group lifecycle so the
  "one Rust depth, many generated labels" case is handled at the point grouping actually
  happens.
- **Inherent ledger fragility.** Because Rust exposes no per-entry metadata, the TS ledger
  is a parallel structure that can only ever be *reconciled by length*, not validated by
  content. `reconcileExternalState()` addresses count drift, but after a collaboration or
  import reset the descriptions/IDs are necessarily fabricated ("Undo" fallbacks). The plan
  acknowledges this but should state plainly that listed descriptions are best-effort and
  can be wrong after external resets — otherwise step 8's "deterministic, stable IDs"
  promise oversells what is achievable.
- **Scope breadth vs. a single folder.** The folder is `services/undo`, but the plan spans
  Rust core, bridge regeneration, contracts, `types/api`, `domain/undo`, checkpoint,
  capability gates, mocks, and SDK conformance. The parallelization section (Workers A–E)
  is good, but the cross-cutting contract change (`clear` sync→async) is a serialization
  point that gates B/C/D and isn't called out as the critical path. A reader could
  under-estimate that the "naturally parallelizable" framing hides one hard dependency
  edge.
- **Speculative Rust names.** `UndoRedoManager::clear()` and
  `YrsComputeEngine::clear_undo_history()` are presented as candidate method names but
  neither was located in source. The plan hedges ("or the chosen bridge method"), which is
  fine, but the implementer must still discover the real owning type; the plan would be
  stronger naming the actual struct that owns the undo stacks.

## Contract and verification assessment

Contract clarity is good. Error shapes (`{ type: 'rust-failed', reason }`,
`Result<void, UndoError>`) match the existing code, the depth postconditions are stated
as testable transitions, and the trigger taxonomy (`push`/`undo`/`redo`/`clear`,
emit-after-state-applied) is precise enough to test subscriber ordering. The
`replayToUndoDepth` validity range `[0, undoDepth + redoDepth]` and the corrected
`undoToIndex` rejection of `targetIndex >= undoDepth` are unambiguous and directly
address the two real defects.

Verification is above average: it names exact test files, includes the bridge-regen
step, and correctly insists on a repo-wide `pnpm typecheck` plus `cargo test`/`clippy`
because the contract change escapes the kernel package. The new Rust clear tests
(canUndo/canRedo/depths zero; clear-after-undo clears redo; new edits after clear) are
the right invariants. The one weak spot is that "subscription trigger order" and
"selection restoration relies on triggers" are asserted as risks without a named
app-eval/UI gate beyond a manual smoke step — given the memory that selection/event
timing is genuinely user-visible, an automated trigger-order assertion would close that.

## Concrete changes that would raise the rating

1. Tie the label-precedence contract to the existing `begin_undo_group` /
   `end_undo_group` bridge calls and to `WorkbookImpl.batch()`, specifying how a pending
   explicit label survives across a group and how generated labels are discarded — rather
   than describing precedence independently of the grouping mechanism.
2. Name the actual Rust struct that owns the undo/redo stacks (confirmed from
   `undo_bridge.rs` / `services/undo.rs`) and give the real clear method signature,
   instead of two speculative names.
3. Mark the `clear()` sync→async contract change explicitly as the critical-path
   dependency in the parallelization plan, with the ordering constraint that bridge regen
   (Worker C) and contract update (Worker B) must land before D/E can typecheck.
4. State the achievable guarantee for `history.list()` after external/collab resets
   (best-effort descriptions, stable-but-synthetic IDs) so step 8 doesn't over-promise.
5. Add one automated gate for event trigger ordering (push/undo/redo/clear emitted after
   state is applied) rather than relying solely on the manual UI smoke step.

## Files changed by this review

Only `mog-internal/plans/active/experiments/plan-ratings/claude-code-review-of-codex-plans/020-kernel-src-services-undo.md`.
