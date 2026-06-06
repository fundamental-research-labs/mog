Rating: 8/10

# Review — 020 Kernel Undo Service


## Summary judgment

This is a strong, evidence-grounded plan that correctly diagnoses the central
structural weakness of `mog/kernel/src/services/undo`: Rust (compute-core) owns the
authoritative undo/redo depths, while the JS layer maintains a parallel,
heuristically-reconciled stack of human-readable descriptions with no enforced
invariant tying the two together. Nearly every factual claim I spot-checked is
accurate against the live source, and the plan translates the diagnosis into a set
of named, testable invariants (INV-1…INV-6) and a phased implementation sequence
that is honest about its cross-team dependencies and explicitly defers running any
build/test gates per task constraints.

It loses points mainly on Phase 6 (cross-domain replay parity), which is the most
ambitious and least evidence-backed section, and on a couple of hand-waved
mechanism details (re-entrant queue design) that are flagged as risks but not
resolved.

## Verification against source

The plan's description of the current code is unusually faithful. I confirmed:

- `undo-service.ts` is ~308 lines and matches the described shape: cached `UndoState`,
  JS shadow stacks `descriptions`/`redoDescriptions`/`pendingDescription`, the
  `HISTORY_REPLAY_PIVOT_UPDATE` constant wrapping undo/redo, and `IUndoReplayService`
  extension (`undo-service.ts:23-26`, `40-67`).
- `refreshState()` swallows *all* errors with an empty `catch {}` (`undo-service.ts:280-287`)
  — Objective 3 / INV-3 is real.
- `replayToUndoDepth` has no progress guard and loops purely on `cachedState.undoDepth`
  comparisons (`undo-service.ts:173-187`) — INV-4 is real; a no-op `undo()` would spin.
- `clear()` zeroes JS state and never touches Rust (`undo-service.ts:198-203`) — the
  "resurrection on next refresh" failure mode in Objective 4 is plausible and real.
- The single-`'Undo'`-push fallback in `notifyForwardMutation` (`undo-service.ts:257-263`)
  cannot reconcile depth jumps of N>1, exactly as INV-1 claims.
- `domain/undo.getUndoHistory` stamps every entry with one shared `Date.now()` and a
  positional `id: \`undo-${index}\`` (`domain/undo.ts:40-48`) — Objective 7 is real.
- The `setPendingUndoDescription`/`getPendingUndoDescription`/`clearPendingUndoDescription`
  plumbing the plan leans on for choice (A) exists on the bridge surface (present across
  bridge test mocks; `setNextDescription` is wired through `initMutationHandler` in
  `compute-core.ts`).
- The dormant `UndoStackItem { description, timestamp }` in `types.ts:25-30` is indeed
  unused, supporting Phase 7's "use or delete" framing.

This level of grounding is the plan's biggest asset and the primary reason for the
high score.

## Major strengths

- **Correct root-cause framing.** "Dual source of truth" is the right lens, and every
  objective is tied back to reducing divergence rather than chasing symptoms.
- **Testable invariants.** INV-1…INV-6 are concrete and falsifiable, and each maps to a
  named unit test in the verification section (depth jumps of 1 and >1, interleaved
  ops, rejecting `getUndoState`, no-progress replay, revert atomicity).
- **Honest A/B fork.** Phase 0 explicitly defers the Rust-owned-vs-JS-owned description
  decision to compute-core owners, and structures Phases 1–3 to deliver value under
  *either* choice. The "land the self-contained correctness wins first" guidance
  (Phase 1/2/3/4B) is exactly the right risk posture given the cross-team blocker.
- **Preserve/strengthen split is precise.** The "must not regress" list (mutateCore
  routing, single forward-mutation funnel, Subscribable semantics, the one pinned pivot
  test) shows the author understands the existing contract, not just the diff they want.
- **Concurrency hazard is named, not just the symptom.** INV-2 correctly identifies that
  every public method awaits mid-flight and can interleave at `await` points, and the
  fix (promise-chain queue with synchronous reads against last settled state) is sound.

## Major gaps or risks

- **Phase 6 (INV-5) asserts a negative it never verifies.** The plan repeatedly states
  the `historyReplay` signal is "wired only for pivots" and proposes extending it to
  charts/filters/CF/named-ranges/floating objects/tables. But it presents no evidence
  that those domains *lack* a replay hook today, nor that they actually misbehave under
  undo/redo. This is the one place the plan reasons from assumption rather than from
  grep results, and it is also the largest scope expansion (six+ domains, kernel-level
  tests each). It risks being either over-built (domains already handle replay) or
  under-specified (no concrete per-domain refresh contract). A short discovery step —
  grep each domain's mutation-reaction path for whether it already reads
  `PivotUpdateOptions.reason`/refresh mode — should gate Phase 6 before committing to it.
- **Re-entrancy design is hand-waved.** The plan correctly flags that queuing all ops
  can deadlock because `replayToUndoDepth` internally calls `undo()`/`redo()` (which it
  wants queued), and says to "use a re-entrant-safe internal path that bypasses the
  public queue." That is the crux of the queue design and it's left as a TODO. Without a
  concrete split (e.g. private `undoInternal()` that the queue wraps, replay calling the
  internal form), Phase 1 could regress into deadlock. Worth one paragraph of mechanism.
- **Blocking dependency concentrates the highest-value work.** Phase 0/4A/6/7 (the parts
  that *structurally* eliminate drift and fix history metadata) all depend on compute-core
  owners exposing per-entry descriptions and a generalized replay context. The plan
  mitigates this with 4B, but a reader should note that if the Rust side stalls, the
  delivered result is "hardened heuristics" rather than "eliminated dual source of
  truth" — i.e. the headline objective is the most at-risk.
- **Severity of the description-drift bug is asserted, not demonstrated.** The plan would
  be stronger with one concrete user-visible repro (e.g. a batch edit of N>1 leaving the
  undo menu label permanently off-by-N, or `clear()` followed by a refresh resurrecting
  undo with blank labels). It lists these as failure modes but never confirms one is
  observable today, which slightly weakens the prioritization argument.

## Contract and verification assessment

- The "preserve `IUndoService` shape" claim of "all 13 members" is approximately correct
  (the public contract enumerates getState/canUndo/canRedo/getNext{Undo,Redo}Description/
  undo/redo/setNextDescription/stopCapturing/clear/listDescriptions/notifyForwardMutation
  plus Subscribable's subscribe/getSnapshot/dispose). Minor: the exact count depends on
  whether Subscribable members are counted, so "13" is a soft number — not a defect.
- The trigger-union risk (adding a `'replay'` variant could break exhaustive `switch`
  consumers) is a genuinely sharp observation and the proposed fallback (reuse
  `'external'`) is correct.
- Verification gates are appropriate and correctly scoped: preserve the two pinned pivot
  assertions verbatim, expand unit tests per invariant, add cross-domain tests mirroring
  the pivot test, and exercise the `domain/undo` + `checkpoint-manager` integration paths.
  The contracts-rebuild gate (`pnpm --filter @mog-sdk/contracts build` before kernel
  typecheck) matches known repo behavior. The plan correctly does not run them itself.
- Gap: the cross-domain test bullet ("exactly once" refresh per domain) inherits the
  Phase 6 evidence gap — it specifies the assertion shape without establishing the
  baseline behavior it's asserting against.

## Concrete changes that would raise the rating

1. **Gate Phase 6 on a discovery step.** Before proposing replay hooks for six domains,
   grep each domain's mutation-reaction code for existing `reason`/refresh-mode handling
   and state which actually lack it. Cut domains that already handle replay; only then
   commit to the parity work. (Biggest single improvement.)
2. **Specify the re-entrant queue mechanism.** Add the concrete split — public
   `undo()`/`redo()` enqueue; an internal `undoInternal()`/`redoInternal()` runs the body;
   `replayToUndoDepth` calls the internal form so it never re-enters the public queue.
3. **Add one demonstrated repro** of description drift or `clear()` resurrection to
   justify severity and to seed a regression test.
4. **Tighten the `undoToIndex` index math.** The plan says to "re-derive with explicit
   documentation"; it should include the corrected formula and the most-recent-first
   ordering contract inline, since `undo-service.ts:195`
   (`undoDepth - targetIndex - 1`) is the kind of off-by-one that silently survives.
5. **State the fallback outcome explicitly.** Add a sentence: "If compute-core cannot
   expose per-entry descriptions this cycle, we ship 1/2/3/4B and Objective 7 is
   deferred" — so reviewers understand what the minimum delivered scope guarantees.
