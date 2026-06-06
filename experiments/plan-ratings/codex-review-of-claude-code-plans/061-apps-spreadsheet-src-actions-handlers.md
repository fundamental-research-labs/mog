Rating: 8/10

Summary judgment

This is a strong plan for `mog/apps/spreadsheet/src/actions/handlers`. It is evidence-driven, aimed at production command dispatch rather than test-only code, and it correctly treats handler behavior as a contract surface rather than a pile of isolated functions. The strongest parts are the systematic categories: typed action payloads, multi-sheet target resolution, normalized mutation rejection feedback, stale action type exports, coordinator typing, and coverage for untested mutation-heavy handlers.

It is not a 9 or 10 because several implementation-critical contracts are still underspecified or slightly stale. In particular, the plan references `actions/exports.ts`, but the inspected public checkout exposes the stale local action types from `apps/spreadsheet/src/exports.ts`; it also says the AI-agent path goes through dispatch in one place and that agent mutations bypass dispatch in another. The typed-payload and `runMutation` proposals are directionally correct, but need sharper definitions before implementation.

Major strengths

- The plan is grounded in real source evidence. The handler contract still uses `payload?: any`, the dispatcher accepts `payload?: any`, `getSelectedSheetIds` exists in contracts, and current target-sheet helpers return only the active sheet in several production handlers.
- It preserves the right architectural boundaries: handlers remain command implementations, mutations continue through `deps.workbook`, dispatcher receipt and repeat tracking remain central, and `handler-utils.ts` stays the shared app-local helper layer.
- It identifies complete bug categories instead of single instances. Group-mode dropping, partial-array rejection handling, protection feedback, coordinator casts, and stale type exports are all class-level problems.
- The sequencing is mostly sensible: shared contracts and helpers first, stale public type dedup independently, then mechanical decomposition and tests.
- Verification is much better than average. It calls for type gates, targeted unit tests, receipt propagation tests, existing regression tests, app evals, and a `HANDLER_MAP` key snapshot for decomposition.

Major gaps or risks

- The scope boundary is inconsistent. The plan is nominally for `handlers/**`, but its first phase requires `@mog-sdk/contracts/actions`, parent `actions/dispatcher.ts`, parent `actions/types.ts`, and the public spreadsheet export surface. That may be the right architectural scope, but the plan should declare it as cross-folder contract work up front rather than treating it as incidental.
- The payload typing proposal needs a real contract design. `ActionPayloadMap`, `ActionHandlerFor<A>`, `void` payloads, optional payloads, and `AnyActionHandler` migration are not defined precisely enough to guarantee key-specific inference through `HANDLER_MAP` and call sites. It also should reconcile existing payload types already exported from `@mog/types-editor/actions/action-types`.
- Runtime payload validation is too vague. A generic `assertPayload` helper is not enough unless the plan specifies a per-action guard/schema registry, how malformed optional payloads behave, and which producers are covered.
- The AI-agent claim is contradictory. Contracts and dispatcher comments say AI actions dispatch through the unified action system, while the dispatcher read-only comment says agent mutations bypass dispatch through `OSExecutionContext -> kernel`. The plan must determine the true production path before claiming payload guards harden the agent path.
- `runMutation` may erase handler-specific semantics unless its contract is tighter. Existing handlers differ in whether they return receipts, false/no-op results, user-facing messages, or rethrow non-protection errors. A single wrapper should specify how it handles partial success, multiple sheet mutations, receipt threading, and whether protection returns `handled: false` with `reason: 'disabled'` or a handled disabled result.
- The sync-to-async group-mode conversion needs a complete caller audit. The dispatcher supports promises, but toolbar hooks, keyboard paths, repeat handling, tests, and any direct `result.handled` consumers need to be named and checked. The plan mentions this risk but does not turn it into a concrete inventory.
- Phase C is too broad as written. Splitting `editor.ts`, `charts.ts`, `object.ts`, `table.ts`, and `clipboard.ts` after behavioral contract changes is reasonable, but the proposed module boundaries are only sketched for `editor.ts`. The plan should either make decomposition its own plan or enumerate exact files, exports, and move-only verification for each split.

Contract and verification assessment

The plan has the right verification categories, but the contract gates should be more explicit. For payload typing, acceptance should require a source-of-truth map covering every `ActionType`, compile-time checks that every handler's payload matches its key, and typed public dispatch helpers for the main call sites rather than only typing handler parameters. For malformed payloads, every runtime guard should have a specific expected `ActionResult` contract.

For group mode, unit tests on `getTargetSheetIds`, bold, and insert column are necessary but not sufficient. Add a production UI-path or app-eval scenario that group-selects sheets and applies at least one formatting command and one structure command through real dispatch input.

For protection and `PartialArrayWrite`, the proposed tests should assert both returned `ActionResult` semantics and user-visible feedback calls. They should also cover non-protection errors to prove the wrapper does not swallow unrelated failures.

For public type dedup, the plan should correct the export path and verify declaration output or publish-readiness for the spreadsheet package, because stale local types are currently exported from `apps/spreadsheet/src/exports.ts`, not from a local `actions/exports.ts` file in the inspected tree.

Concrete changes that would raise the rating

- Correct stale path references and explicitly list all non-handler files that are in scope for the contract migration.
- Resolve the true agent/AI command path and restate the payload-hardening objective accordingly.
- Define `ActionPayloadMap` in detail: source package, exact optional/void conventions, how existing payload types are reused, and how `HANDLER_MAP` preserves per-key type checking.
- Add an inventory step for every dispatch producer and every direct consumer of `ActionResult | Promise<ActionResult>` before converting handlers to async.
- Specify `runMutation` with overloads or result policies for receipts, partial-array no-ops, protection feedback, multiple mutations, and non-protection rethrows.
- Split Phase C into exact move-only subplans, or defer it until the shared contract work lands and has stable tests.
