Rating: 8/10

## Summary judgment

This is a strong plan for the `apps/spreadsheet/src/actions/handlers` area. It identifies the real production boundary: handlers matter through `dispatcher.ts`, `HANDLER_MAP`, repeat tracking, read-only blocking, receipt processing, and the public contracts in `contracts/src/actions/types.ts`. The major recommendations are also well aligned with the current code: there is a hand-written `Record<ActionType, AnyActionHandler>`, payloads are still `any`, read-only and repeatability policy live in separate lists, placeholder actions remain in the dispatcher, source-text dispatch symmetry tests exist, and mutation/result handling is inconsistent across domains.

The rating is not higher because the plan is still more of an architectural direction than an execution-ready contract. For a migration this large, it needs a sharper action inventory, exact registry schema, staged compatibility path, and acceptance criteria that prevent "typed metadata exists" from becoming advisory-only metadata.

## Major strengths

- It correctly anchors the work in the production dispatch path instead of treating the handlers folder as isolated UI glue.
- It targets complete categories of drift: handler registration, payload typing, read-only policy, repeatability, receipts, implementation status, side effects, and tests.
- It recognizes existing architecture rather than proposing a replacement from scratch: `handler-utils.ts`, `bridge-error-guard.ts`, `dispatcher-types.ts`, `dispatcher-read-only.ts`, `repeatable.ts`, and domain subfolders are all called out.
- It has good architectural instincts around moving from regex tests over `dispatcher.ts` to importable typed registry invariants.
- It calls out high-risk spreadsheet behavior that must be preserved: F4 repeat, clipboard transient activation, protected sheets/cells, multi-sheet targeting, coordinator receipt delivery, formula/editing state machines, and view-adapter ownership.
- The verification section is materially better than a compile-only plan. It includes package tests, typecheck, registry gates, receipt tests, and focused app-eval/E2E scenarios using real UI input paths.

## Major gaps or risks

- The plan does not include an action-by-action inventory. It says to add exact payload shapes for many families, but does not enumerate which `ActionType`s have payloads, which are payloadless, which are dynamic-only, or which current payload shapes are ambiguous. That leaves the hardest contract work underspecified.
- The proposed `ActionContract` schema is promising but not precise enough. Fields such as `mutates`, `receiptPolicy`, `protectionPolicy`, `sideEffects`, `requiredCapabilities`, and `readOnlyPolicy` need explicit enum values and semantics, especially whether they drive runtime behavior or only tests.
- The migration sequencing is too broad. Introducing a registry, changing dispatch typing, centralizing mutations, decomposing six large modules, replacing side-effect paths, fixing placeholders, and replacing tests are all valid, but the plan needs a staged path that preserves behavior after each slice.
- `dispatch<A extends ActionType>(..., payload: ActionPayloadMap[A])` needs a compatibility design for payloadless actions, optional payload actions, and current callers that dispatch dynamic actions. The named `dispatchUnknownAction` wrapper is not enough without specifying validation behavior and call-site migration.
- Mutation normalization is under-contracted. `executeActionMutation` needs a concrete API and result contract: how undo descriptions are set, how receipts are collected, how partial success across selected sheets is handled, when errors are user-blocked versus unexpected, and how exactly-once receipt processing is guaranteed.
- The placeholder-action cleanup may span product ownership outside this folder. The plan notices non-grid view actions, but it should make "delegate to active view adapter" a prerequisite before demanding all view commands be implemented from the spreadsheet dispatcher.
- The side-effect section should distinguish data mutation escape hatches from legitimate UI/browser affordances. For example, `window.print`, fullscreen, native context menu dispatch, clipboard activation, and devtools reporting each need different treatment; a blanket no-direct-globals gate could either fail unnecessarily or force leaky abstractions.
- Large-module decomposition is useful, but it should be explicitly secondary to contract extraction. Splitting files before registry and mutation contracts are stable would create high churn without reducing behavioral risk.

## Contract and verification assessment

The contract direction is good: one machine-readable registry should produce or govern handler registration, read-only policy, repeatability, implementation stats, payload expectations, receipt expectations, and test coverage. That would fit this folder well because the current source already shows the same facts scattered across `dispatcher.ts`, `dispatcher-read-only.ts`, `repeatable.ts`, handler payload casts, and regex tests.

The plan should tighten the contract so implementers cannot interpret it differently. It needs exact `ActionPayloadMap` rules, typed handler aliases, registry composition rules, owner/domain definitions, and runtime enforcement points. It should also specify whether invalid payloads return `notHandled('disabled')`, `wrong_context`, or handled errors by policy instead of leaving that decision local to each handler.

Verification is strong but could be more concrete. The listed gates are relevant, and the E2E real-input requirement matches repository policy. To raise confidence further, the plan should require an initial baseline inventory test, type-level compile assertions for dispatch payloads, registry-derived read-only/repeatability tests, receipt exactly-once tests through `dispatch`, and focused UI tests for at least one keyboard, ribbon, context-menu, and clipboard command per migrated policy family.

## Concrete changes that would raise the rating

1. Add an appendix inventorying every current `ActionType` in this scope with owner, current handler, implemented/not implemented state, payload shape, mutation/read-only/repeat/protection policy, receipt policy, and expected side-effect capability.
2. Define the exact registry TypeScript types, including allowed enum values and which fields are runtime-enforced versus test-only.
3. Split the implementation into explicit phases: registry mirror with no behavior change, generated `HANDLER_MAP`/stats/read-only/repeat sets, payload typing migration by domain, mutation helper adoption by highest-risk mutation families, side-effect cleanup, then module decomposition.
4. Specify a compatibility path for dispatch callers, including optional payloads, payloadless actions, dynamic string dispatch, handler-facing redispatch through `dispatcher-types.ts`, and invalid-payload results.
5. Give `executeActionMutation` a concrete contract with examples for formatting, structure, object/chart/table receipts, protected-sheet rejection, bridge errors, undo groups, and multi-sheet broadcast failure behavior.
6. Separate spreadsheet-owned placeholders from view-adapter-owned placeholders, and require explicit owner/delegation contracts before implementation work.
7. Make decomposition acceptance criteria behavior-neutral: no public action names changed, no imports broken, no test-only shims, and registry tests passing before and after each split.
