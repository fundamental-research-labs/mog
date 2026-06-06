# Improve Spreadsheet Action Handlers and Mutation Dispatch

## Source folder and scope

Source folder: `mog/apps/spreadsheet/src/actions/handlers`

Scope reviewed:
- Handler folder with roughly 30k lines of TypeScript across selection, editor, clipboard, formatting, structure, UI, workbook/sheets, charts, objects, tables, filters, fill, print/export, data analysis, ink, slicers, diagrams, text effects, and equations.
- Adjacent production dispatch path in `mog/apps/spreadsheet/src/actions/dispatcher.ts`, because this folder's handlers are only production-relevant through `HANDLER_MAP`, `dispatch()`, repeat tracking, read-only blocking, receipt processing, and devtools reporting.
- Public contracts in `mog/contracts/src/actions/types.ts`, because handler dependencies, `ActionResult`, `ActionType`, async handler shape, `hostCommands`, `platform`, and `shellService` define the handler boundary.
- Existing handler tests and dispatch symmetry tests under `mog/apps/spreadsheet/src/actions/**/__tests__`.

This plan is for public Mog source work in `../mog`. Planning artifacts stay only in `mog-internal`.

## Current role of this folder in Mog

`handlers` is the concrete command execution layer for the spreadsheet app's unified action system. Keyboard shortcuts, toolbar controls, context menus, command palette entries, and agent-facing actions converge on `dispatch(action, deps, payload)`, which looks up a handler from `HANDLER_MAP` and returns an `ActionResult` or `Promise<ActionResult>`.

The folder is not just UI glue. It orchestrates production mutations through `deps.workbook` and worksheet domain APIs, updates actor state through `deps.commands`, reads actor state through `deps.accessors`, updates ephemeral UI through the Zustand `uiStore`, returns mutation receipts for coordinator pull-processing, records repeatable actions for F4, and converts some bridge/protection failures into user-visible feedback.

The current architecture already has important foundations:
- `handler-utils.ts` centralizes the UI store cast, `handled()`, `notHandled()`, active sheet lookup, and protection feedback helpers.
- `bridge-error-guard.ts` centralizes `PartialArrayWrite` handling for direct async bridge mutations.
- `dispatcher-types.ts` breaks the import cycle for handlers that re-dispatch actions.
- `dispatcher-read-only.ts` provides a read-only safety net before handler execution.
- Domain folders already exist for selection, formatting, fill, and UI handlers.

The main weakness is that action behavior is still implicit and scattered: handler registration lives in a large hand-written map, payloads are mostly `any`/`unknown`, repeatability/read-only/implementation status are separate lists, mutation receipt contracts differ by domain, and several tests assert dispatch symmetry by regex-scanning `dispatcher.ts` instead of importing a stable contract.

## Improvement objectives

1. Make every action's production contract explicit and machine-readable: handler, payload type, implementation state, mutating/read-only policy, repeatability, expected receipts, required capabilities, side-effect class, and owning domain.
2. Replace source-text symmetry tests with typed registry tests that can verify coverage without parsing `dispatcher.ts`.
3. Make payload typing action-specific from dispatch through handler implementation, eliminating broad `payload?: any` and local ad hoc casts for new and migrated handlers.
4. Normalize mutation execution so worksheet/workbook mutations consistently set undo descriptions, route through workbook APIs, handle protected sheets/cells, convert bridge errors, return receipts, and report handled/error states.
5. Remove remaining stringly or global side-effect paths from handlers where a public dependency already exists: `onUIAction`, direct `window`/`document` reach-arounds, direct `fetch`, and local storage calls should move behind `uiStore`, `platform`, `shellService`, `hostCommands`, or typed app services.
6. Decompose the largest modules by command family while preserving the public action surface and production dispatch path.
7. Strengthen verification so command handlers are proven through unit tests, typed registry invariants, and real UI input paths for keyboard/clipboard/ribbon/context-menu behavior.

## Production-path contracts and invariants to preserve or strengthen

- All spreadsheet user inputs continue to execute through the unified action dispatch path, not parallel toolbar or keyboard-only implementations.
- Public repo dependency direction remains strict: `mog` must not depend on `mog-internal`.
- Data mutations continue to terminate at the public `WorkbookInternal` / worksheet APIs and their compute/mutation pipeline. Handlers must not reintroduce direct kernel internals, private mutation shims, or test-only state changes.
- `ActionResult` keeps stable semantics: `handled: true` means the action consumed the command; `handled: false` must carry a concrete reason when the action is disabled, blocked, in the wrong context, not found, or not implemented; async failures are normalized instead of escaping the dispatcher.
- Mutation receipts are delivered exactly once to coordinator receipt processing. Handlers that produce receipts return them in `ActionResult.receipts`; handlers that do not mutate do not invent empty receipt arrays.
- Protected sheet/cell behavior remains user-visible and non-mutating. Protection rejection detection should be centralized and applied to all mutating worksheet/object/table/fill/formatting paths.
- Read-only mode remains a dispatcher-level safety net and should be generated from the same action metadata used by tests and UI disablement.
- F4 repeatability remains opt-in, excludes `REPEAT_LAST_ACTION`, and stores the action plus payload only after a successful handled result.
- Selection/editor state machines stay the source of truth for keyboard movement, edit mode, formula point mode, rich text selection, merge-aware navigation, hidden row/column behavior, and context focus.
- Multi-sheet operations must honor selected sheets where the action is supposed to broadcast. Current sync fallbacks to only the active sheet should be replaced with an async-safe target sheet contract instead of silently narrowing scope.
- Browser activation-sensitive operations, especially clipboard writes, must preserve synchronous reservation behavior.
- Host/platform operations stay behind public abstractions: `platform`, `shellService`, `hostCommands`, and typed UI store methods.

## Concrete implementation plan

1. Introduce a typed action contract registry.
   - Add an `ActionPayloadMap` in the public action type layer, keyed by `ActionType`, with `undefined` for payloadless actions and exact payload shapes for actions like chart formatting, page setup, ribbon dropdowns, table selection, print/export, object insert/update, fill options, and data analysis commands.
   - Add `ActionContract<A extends ActionType>` metadata with fields for `action`, `handler`, `domain`, `implemented`, `payload`, `mutates`, `readOnlyPolicy`, `repeatable`, `receiptPolicy`, `protectionPolicy`, `sideEffects`, and `requiredCapabilities`.
   - Build `HANDLER_MAP`, `REPEATABLE_ACTIONS`, implementation stats, and read-only blocking from the registry instead of separate hand-maintained structures.
   - Keep per-domain registration files near the handlers so domains can evolve independently, then compose them into one registry consumed by `dispatcher.ts`.

2. Make handler signatures action-specific.
   - Replace generic `AnyActionHandler` use at registration boundaries with `ActionHandlerFor<A>` and `AsyncActionHandlerFor<A>`.
   - Update `dispatch` to be generic: `dispatch<A extends ActionType>(action: A, deps: ActionDependencies, payload: ActionPayloadMap[A])`.
   - Preserve the runtime signature for callers that dispatch dynamic action strings by adding a validated `dispatchUnknownAction` wrapper rather than weakening all handler types.
   - Convert payload validation from local `if (!payload)` checks and casts into reusable guards tied to the registry. Invalid payloads should return `notHandled('disabled')` or a handled error according to the action contract.

3. Centralize mutation execution semantics.
   - Add a handler runtime helper for worksheet/workbook mutations, for example `executeActionMutation(deps, options, fn)`.
   - Options should cover active sheet lookup, multi-sheet target lookup, undo description, protected sheet/cell behavior, bridge error conversion, receipt collection, and success/error `ActionResult` shape.
   - Replace repeated direct patterns in formatting, structure, editor clear/fill/sort, objects, charts, tables, slicers, data analysis, diagrams, equations, and text effects.
   - Promote provisional receipt types, such as the local pivot receipt shape, into public contracts or domain APIs so handler code does not cast kernel receipts through `unknown`.

4. Fix action coverage as a complete set.
   - The current dispatcher has explicit placeholders for spreadsheet/UI commands (`TOGGLE_OUTLINE_SYMBOLS`, `TOGGLE_OBJECTS_VISIBILITY`, `OPEN_THREADED_COMMENTS`, `CALCULATE_ALL_FORCE`, `CALCULATE_REBUILD_DEPENDENCIES`, `READ_ACTIVE_CELL`, `OPEN_ACCESSIBILITY_GUIDE`, `SAVE_AS`, `OPEN_SEARCH_BOX`) and non-grid view commands (`KANBAN_*`, `GALLERY_*`, `CALENDAR_*`, `TIMELINE_*`).
   - For spreadsheet-owned placeholders, implement real production handlers or route to typed public services. Do not leave `notImplemented` entries for commands exposed by keyboard, menus, accessibility, or app chrome.
   - For non-grid view commands, move ownership to a view-adapter action registry or implement typed delegation to the active view adapter. The spreadsheet dispatcher should not pretend to own commands it cannot execute.
   - Add a registry gate that fails if an exposed command is `implemented: false` without an explicit owner and product reason.

5. Decompose oversized handler modules by command family.
   - Split `editor.ts` into edit lifecycle, commit/navigation, clear/fill, formula mode, formula auditing/evaluation, sort, and date/time/autosum modules.
   - Split `charts.ts` into chart lifecycle, data selection, z-order/nudge, clipboard, creation wizard, context formatting dialogs, title editor, and UI error/tooltip slices.
   - Split `object.ts` into selection/delete, picture, shape insertion, form controls, arrangement/z-order, clipboard, and text/object editing modules.
   - Split `table.ts` into table CRUD, style operations, row/column operations, selection, dialogs, totals/header/banding toggles, and auto-correct options.
   - Split `clipboard.ts` into copy/cut, paste core, paste options, mismatch/overwrite dialogs, and picture/link paste integration.
   - Split `data-analysis.ts` into goal seek, forecast/consolidate, spelling, watch window, error checking, evaluate formula, data table, and scenario manager.
   - Keep the existing selection, formatting, fill, and UI subfolder patterns, but make all domains register through the same contract shape.

6. Replace remaining UI side-effect escape hatches.
   - Convert chart format dialog actions away from stringly `onUIAction` payloads to typed UI store methods or typed dialog services.
   - Move `window.open` uses for hyperlinks/help behind `platform.shell.openExternal` or a dedicated navigation capability with protocol validation.
   - Keep `QUICK_PRINT` host ownership checks, but isolate the direct `window.print()` browser call behind a platform/host print capability where possible.
   - Move direct `document` element focus/fullscreen operations into typed UI commands or platform capabilities.
   - Move picture fetch/import behind `platform` or a document asset service so object handlers do not own network policy.
   - Keep clipboard activation constraints explicit; any abstraction must preserve synchronous reservation before awaits.

7. Normalize active sheet and multi-sheet targeting.
   - Replace duplicated `getTargetSheetIds()` implementations that currently fall back to `[activeSheetId]` because `getSelectedSheetIds` can be async.
   - Add an async target resolver used by all mutating handlers, with per-action policy for active-sheet-only, selected-sheets broadcast, explicit payload sheet, or active view adapter target.
   - Add tests proving multi-sheet formatting/structure actions broadcast when selected sheets are present and stay active-sheet-only when the action contract requires it.

8. Upgrade tests from implementation snapshots to contracts.
   - Replace regex-based dispatch symmetry tests with registry import tests that assert all action types have a contract, all public command/ribbon/keyboard/context-menu actions are implemented, and no mutating action is missing read-only/protection policy.
   - Add result-shape tests for every domain: success, wrong context, disabled, blocked/protected, invalid payload, bridge error, and async rejection.
   - Add receipt tests that cover object/chart/diagram/equation/pivot/table mutations through the dispatcher path, not just direct handler calls.
   - Add targeted E2E coverage for keyboard, context menu, toolbar/ribbon, clipboard, and dialog flows using real UI input events.

## Tests and verification gates

For the eventual implementation, run these gates from `mog` unless a narrower package command is explicitly better:

- `pnpm --filter @mog/app-spreadsheet test -- src/actions`
- `pnpm --filter @mog/app-spreadsheet test -- src/actions/handlers`
- `pnpm --filter @mog/app-spreadsheet typecheck`
- Repo-level `pnpm typecheck` for public contract or action type changes.
- Focused app-eval/E2E scenarios for keyboard movement/editing, toolbar formatting, context-menu paste/fill/sort, chart/object/table commands, protected sheet rejection, read-only mode, and F4 repeat. These must use real keyboard, mouse, and clipboard paths rather than direct handler or state mutation shortcuts.
- For any changed worksheet/kernel API receipt contract, also run the owning package/crate tests for that domain.

Additional contract gates to add:
- Registry completeness: every `ActionType` has exactly one contract and one owner.
- Handler export consistency: every implemented contract references a real function.
- Payload typing: every payload-bearing action has a public payload type and invalid payload tests.
- Policy completeness: every mutating action declares read-only, protection, undo, receipt, and repeatability policy.
- No forbidden escape hatches: mutating handlers must not use `onUIAction`, direct globals, or test-only APIs.

## Risks, edge cases, and non-goals

Risks and edge cases:
- Import cycles can return if handler modules import the composed dispatcher registry. Keep handler-facing redispatch through `dispatcher-types.ts` or a similarly acyclic indirection.
- Clipboard commands are sensitive to browser transient activation. Abstractions must not add awaits before activation-dependent calls.
- Multi-sheet target resolution changes behavior in formatting/structure domains that currently use active-sheet-only fallbacks. Tests must pin both broadcast and active-only cases.
- Read-only and protection policies can diverge if metadata is only advisory. The dispatcher and tests must consume the same registry fields.
- Some view actions may belong to non-spreadsheet adapters. The fix is explicit delegation/ownership, not silent removal from coverage.
- Async handler normalization can mask programming errors if every throw becomes a handled user error. Contract metadata should distinguish user-blocked failures from unexpected exceptions.
- Large-module decomposition can create churn without behavior changes. Preserve action names, public imports, and existing direct exports during migration.

Non-goals:
- Do not introduce compatibility shims, test-only dispatch paths, or mock-only handler behavior.
- Do not move public action behavior into `mog-internal`.
- Do not optimize a benchmark harness or test-only pathway.
- Do not bypass workbook/worksheet APIs for direct kernel mutation.
- Do not remove Excel-parity command coverage to reduce scope.

## Parallelization notes and dependencies on other folders, if any

Natural parallel workstreams:
- Agent A: action registry, payload map, handler type generics, and registry completeness tests.
- Agent B: mutation runtime helper, receipt/protection/bridge-error normalization, and domain migration for formatting/structure/editor mutations.
- Agent C: UI side-effect boundary cleanup for chart dialogs, print/export, navigation/help, fullscreen/focus, object import, and clipboard activation preservation.
- Agent D: large-module decomposition for charts, object, table, clipboard, editor, and data-analysis domains.
- Agent E: verification suite migration from regex symmetry scans to registry tests plus E2E scenarios using real UI input.

Dependencies:
- `mog/contracts/src/actions/types.ts` and `@mog/types-editor/actions/action-types` for action and payload type contracts.
- `mog/apps/spreadsheet/src/actions/dispatcher.ts`, `dispatcher-read-only.ts`, `dispatcher-types.ts`, and `repeatable.ts` for dispatch composition.
- `mog/apps/spreadsheet/src/ui-store` for typed UI state and dialog commands.
- `mog/apps/spreadsheet/src/coordinator` for receipt processing.
- Worksheet/workbook domain APIs in public contracts/kernel for receipts, protected mutations, multi-sheet operations, and object/chart/table/pivot domains.
- `platform`, `shellService`, and `hostCommands` contracts for browser/desktop side effects.
