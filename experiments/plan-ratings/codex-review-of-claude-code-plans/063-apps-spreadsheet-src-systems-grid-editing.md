Rating: 8/10

Summary judgment

This is a strong, source-grounded plan for a high-risk production subsystem. It correctly identifies `grid-editing` as the owner of spreadsheet editing workflows, prioritizes a real shipped bug (`subscribeToCellPropertyChanges` is a no-op while `cell-property-subscriptions.ts` exists), and frames most changes around preserving public APIs, pure machines, workbook mutation boundaries, actor ownership, and cleanup discipline. The plan is unusually concrete about files, phases, contracts, and behavioral gates.

The rating is not higher because the plan is too large to be directly executable as one implementation contract, and several details are inaccurate or underspecified enough to mislead implementation. Most notably, the cell-property subscription contract says value/format/metadata but the existing module only listens for format and metadata events; the timer cleanup critique is partly stale because comment-hover and find-replace timers are already tracked and cleared; the `named-ranges-integration.ts` deletion has a live cross-folder caller in `sheet-coordinator.ts`; and the invariant that accessors are the only `getSnapshot()` sites is false for the current production folder.

Major strengths

- The plan is evidence-driven. The no-op `GridEditingSystem.subscribeToCellPropertyChanges`, unwired `setupCellPropertySubscriptions`, paste protection N-squared promise fanout, production `as any` table/pivot casts, duplicated scroll geometry, and async validation fire-and-forget path are all real production-path findings.
- It starts with the best correctness target: wiring the cell-property subscription path before refactoring. That is the right sequencing because it fixes a user-visible bug and creates a narrow regression test.
- The architectural framing is mostly right: machines remain pure, side effects stay in coordination/orchestrator code, `IGridEditingSystem` remains stable, `systems/` does not directly import `ui-store/`, and workbook mutations stay behind `config.workbook`.
- Phase 0 characterization is a good safeguard for an order-sensitive subsystem. The plan correctly calls out drag termination, click-as-commit, sheet-switch selection guards, paste, commit-with-key, and cross-system subscriptions as behavior that must be pinned before refactors.
- The verification section is behavior-oriented, not just type-oriented. It asks for regression tests around subscriptions, drag equivalence, async validation failures, scroll geometry parity, timer cleanup, paste protection scale, and app-eval coverage.

Major gaps or risks

- The plan bundles too many independent objectives into one workstream: a correctness fix, orchestrator decomposition, async hardening, scroll geometry extraction, timer cleanup, type contract changes, protection batching, dead-seam cleanup, TODO resolution, and test harness relocation. These should be split into implementation contracts with explicit PR boundaries. Otherwise the refactor surface is large enough to obscure regressions in editing, paste, and sheet switching.
- The cell-property subscription contract is not precise enough. `IGridEditingSystem` says the callback fires when value, format, or other properties change, and the plan says value/format/metadata; the existing `cell-property-subscriptions.ts` listens only to `cell:format-changed` and `cell:metadata-changed`. If value changes are required, the plan needs to name the `cell:changed` / `cells:batch-changed` event handling and per-cell filtering contract. If value changes are not required, the public interface text and tests should be narrowed to format/metadata.
- Some evidence is stale or overstated. `comment-hover-coordination.ts` already tracks `showTimer`/`hideTimer` and clears them in cleanup, and `FindReplaceCoordinator.dispose()` clears `searchDebounceTimer`. There may still be a need to document timing constants or prove sheet-switch disposal, but "not tracked for cleanup" is not accurate.
- The dead-seam removal objective crosses the declared source-folder boundary. `named-ranges-integration.ts` is a no-op, but `sheet-coordinator.ts` imports and calls it. Deleting it therefore requires an explicit cross-folder edit and verification gate, not just a local cleanup item.
- One stated invariant is false as written: accessors are not the only places that call `actor.getSnapshot()` in this folder. The orchestrator and coordination modules call it in production paths. The plan should narrow this to external/handler snapshot reads, or define which internal snapshot reads are allowed.
- The plan asks to "fully specify" `DrawBorderCoordinator` and `CommentHoverCoordinator`, but it does not list the required method surface or consumers. That leaves implementers to rediscover the contract instead of executing one.
- Protection batching is specified as "bounded concurrency window" but does not define the target concurrency, failure semantics, cancellation behavior, or whether a partially failed protection scan should block paste, warn, or conservatively treat cells as protected.
- Verification gates are useful but not command-specific. For this repo, the plan should include exact package commands such as the spreadsheet package unit test target and typecheck command, plus the exact app-eval/API-eval scenario names expected for editing and clipboard paths.

Contract and verification assessment

The contract section is better than average because it names the public surface, mutation boundary, machine/coordination split, actor ownership, cleanup discipline, commit/validation termination, selection source semantics, and drag terminator mapping. Those are the right contracts for this folder.

The weak spots are contract precision and test executability. The cell-property contract conflicts with the currently available subscription module; the `getSnapshot()` invariant conflicts with current production code; the timer contract needs to distinguish "already cleaned up" from "needs documented timing / sheet-switch proof"; and the named-range cleanup needs a cross-folder contract. The verification gates should be converted from descriptive acceptance criteria into exact test/typecheck/eval commands and a short list of new tests with file locations.

Concrete changes that would raise the rating

- Split the plan into separate implementation specs: cell-property bug fix; orchestrator/paste decomposition; async validation hardening; scroll geometry extraction; table/pivot actor type fix; paste protection scaling; cleanup/harness relocation.
- Define the cell-property subscription event matrix explicitly: which workbook events trigger callbacks, how single-cell and batch events are filtered, whether value changes are included, and what unsubscribe guarantees hold across sheet switches.
- Correct the stale timer finding and replace it with a narrower requirement: document constants, prove cleanup on dispose/sheet-switch, and add tests only for gaps not already covered by local timer tracking.
- Adjust the actor snapshot invariant to match reality, or add a deliberate migration objective to centralize snapshot reads with a complete inventory.
- Add exact verification commands and scenario names for the spreadsheet package, typecheck, and relevant app/api evals.
- Make cross-folder changes explicit for `sheet-coordinator.ts`, contracts package updates, and any worksheet protection range API addition, with dependency direction and build gates attached.
