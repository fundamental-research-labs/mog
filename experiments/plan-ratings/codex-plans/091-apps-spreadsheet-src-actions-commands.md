# 091 - Spreadsheet Action Commands Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/apps/spreadsheet/src/actions/commands`

Queue item: 91

Scope: the spreadsheet app command registry, built-in command definitions, and public exports that feed the command palette and any future command-driven surfaces.

Files inspected in scope:

- `built-in-commands.ts`
- `command-registry.ts`
- `index.ts`

Adjacent production and contract paths inspected:

- `apps/spreadsheet/src/hooks/toolbar/use-command-registration.ts`
- `apps/spreadsheet/src/chrome/toolbar/primitives/ToolbarContainer.tsx`
- `apps/spreadsheet/src/dialogs/navigation/CommandPalette.tsx`
- `apps/spreadsheet/src/keyboard/definitions/{clipboard,formatting,navigation,view,workbook}.ts`
- `apps/spreadsheet/src/actions/dispatcher.ts`
- `apps/spreadsheet/src/actions/dispatcher-read-only.ts`
- `apps/spreadsheet/src/actions/handlers/ui/file-handlers.ts`
- `contracts/src/actions/{index,types}.ts`
- `contracts/src/core/commands.ts`
- `types/commands/src/commands.ts`
- `types/editor/src/actions/action-types.ts`

This is a public Mog source folder. Implementation belongs in `mog`; this plan remains internal in `mog-internal`.

## Current role of this folder in Mog

`actions/commands` is the app-local command palette registry layer. It adapts command metadata from `@mog-sdk/contracts/commands` into executable handlers used by `CommandPalette`.

The current production path is:

1. `ToolbarContainer` builds a `CommandActions` object from dispatcher calls, store toggles, callbacks, and local closures.
2. `useCommandRegistration` calls `registerBuiltInCommands(actions)` once on mount.
3. `built-in-commands.ts` builds a static list of command metadata and only registers entries whose optional handler exists.
4. `command-registry.ts` stores handlers in a singleton `Map`, offers fuzzy search, and executes by command id.
5. `CommandPalette` calls `commandRegistry.search(query, { limit: 50 })` and `commandRegistry.execute(command.id)`.

Observed issues in the production path:

- The built-in catalog is manually duplicated from dispatcher actions, keyboard definitions, and toolbar behavior. There is no systematic contract tying command ids, action types, payloads, shortcuts, categories, labels, or availability together.
- Several declared built-in commands never register because `ToolbarContainer` does not pass handlers for them, including `deleteSelection`, `selectAll`, row/column insertion, row/column header toggles, sort ascending/descending, `goToCell`, `findAndReplace`, `insert.function`, and keyboard shortcuts help.
- `useCommandRegistration` registers once with an empty dependency list, so handlers that close over mutable state can become stale. `toggleCalculationMode` is one concrete example because the callback captures `calculationMode` from the initial render.
- The registry is a global singleton with a single `registeredCommandIds` list for built-ins. Multiple registrars, feature modules, tests, or future workspaces can unregister each other's commands.
- Command execution bypasses dispatcher result semantics. It returns only `success` or `error`, while dispatcher handlers can return structured `handled: false` reasons such as disabled, read-only blocked, or not implemented.
- Shortcut display strings are hand-written and can drift from the keyboard registry. The inspected keyboard definitions show `Ctrl+Shift+P` assigned both to `OPEN_COMMAND_PALETTE` in `view.ts` and `OPEN_GO_TO_SPECIAL_DIALOG` in `navigation.ts`; the command catalog has no parity gate to catch or explain conflicts.
- Search and UI grouping are too implicit. Search sorts by score only, while `CommandPalette` groups by adjacent categories, so repeated category sections can appear when same-category results are not contiguous.
- `CommandPalette` does not subscribe to registry changes. Results are memoized by query only, so commands or enabled states that change while the palette is open are not guaranteed to update.
- The file comments mention thread safety and search-index caching, but the current implementation is a synchronous mutable map with no cache, no versioning, and no subscription contract.

## Improvement objectives

1. Make built-in commands a typed production contract over `ActionType`, payloads, keyboard shortcut definitions, command metadata, and availability, not a manually maintained bag of optional callbacks.

2. Route command execution through the unified dispatcher wherever a command maps to a spreadsheet action, preserving the same production behavior as keyboard, ribbon, toolbar, context menu, and AI input.

3. Ensure every command id, category, label, shortcut, action type, payload, and availability rule is declared exactly once and validated exhaustively.

4. Move command registration ownership out of `ToolbarContainer` so commands exist independently of toolbar mount state, ribbon display mode, or toolbar render performance constraints.

5. Replace global built-in cleanup state with scoped registration handles so feature modules can register, update, and unregister independently.

6. Add dynamic enablement and disabled reasons that reflect selection state, active sheet state, read-only mode, object focus, dialog focus, and dispatcher availability.

7. Keep the command palette responsive to live registry changes using a subscription/version contract compatible with React's external-store model.

8. Derive shortcut display from the production keyboard registry and add conflict/parity gates so palette-visible shortcuts never drift from real input behavior.

9. Make command search deterministic, ranked, category-aware, and tested against real command names, keywords, shortcut aliases, and common spreadsheet terminology.

10. Preserve public contract boundaries: command types may move into or be strengthened in `types/commands` and `@mog-sdk/contracts/commands`, but `mog` must not depend on `mog-internal`.

## Production-path contracts and invariants to preserve or strengthen

Command identity and metadata:

- Command ids must be stable, unique, and namespaced by product area, for example `edit.copy`, `format.bold`, `view.zoomIn`, or `file.export`.
- Existing command ids should be preserved unless they are clearly erroneous and migrated in one audited pass. The current `format.underlineType` id should be reviewed because it appears to expose a cell format field name rather than a user command name.
- Every built-in command must have a category from the command contract or a deliberate contract extension. Categories should align with ribbon/keyboard categories where possible.
- Labels, descriptions, keywords, icons, and categories must be command metadata only. Behavior must live in dispatcher actions or explicitly named command handlers.
- Duplicate user-visible concepts such as `insert.function` and `formulas.insertFunction` need a deliberate policy: either one canonical command with multiple discoverability aliases, or two distinct commands with different destinations.

Execution:

- Command execution must use the same dispatcher path as keyboard and toolbar actions for every `ActionType`-backed command.
- Commands with payloads, such as alignment, number format, chart type, or ribbon tab switching, must carry typed payloads validated against `KeyboardActionPayload` or a command payload map.
- Direct callback commands are allowed only for true host callbacks that are not yet dispatcher-owned, and each must have an owner and migration target.
- Read-only mode must fail closed using `dispatcher-read-only` semantics; mutating commands must not execute from the palette when keyboard dispatch would block them.
- Dispatcher `ActionResult` reasons should be preserved in command execution results so disabled, not implemented, unavailable, and host-denied cases are visible to UI and telemetry.
- Async commands must not leave the palette in an inconsistent state. Closing behavior should be explicit: close before execute, close after handled, or stay open on disabled/error.

Registration and lifecycle:

- The registry must support scoped registration tokens or owner namespaces. Unregistering one owner must not remove another owner's commands.
- Re-registering the same command id from the same owner should update metadata and handler atomically.
- Re-registering the same command id from a different owner should be rejected or require an explicit override policy.
- Command registration must be independent of toolbar mount state. A dedicated command provider inside the coordinator/action-dependencies boundary should own built-ins.
- Handler freshness must be guaranteed by reading current dependencies at execution time or by updating registrations when dependencies change. Empty-dependency React effects must not freeze command behavior.
- The registry must expose a version/subscription API so command consumers can update when metadata, handlers, or enablement changes.

Keyboard and shortcut parity:

- Palette shortcut text must be generated from production keyboard definitions, including platform-specific Ctrl/Cmd display and alternate bindings.
- Shortcut conflicts must be detected with context, priority, and registration-order semantics, not by string comparison alone.
- If two commands share a physical binding intentionally because contexts differ, the command metadata should record that context distinction.
- The `Ctrl+Shift+P` conflict between command palette and Go To Special needs an explicit product decision and test coverage.
- Command palette itself should remain openable through the unified keyboard action `OPEN_COMMAND_PALETTE`.

Availability:

- Availability should be a typed function over production state snapshots, not a static `enabled` flag stored in command metadata.
- The default search should hide disabled commands only if the UI intentionally wants that behavior. If disabled commands are shown, the disabled reason must be visible to execution and accessibility.
- Commands must account for active sheet, selection, object selection, chart selection, editing mode, protected/read-only state, host ownership of file commands, and feature flags.
- Availability reads must be cheap and side-effect-free.

Search and display:

- Search must be deterministic for equal scores and preserve a stable command order.
- Search should index label, id segments, category, description, keywords, shortcut aliases, and common synonyms such as "formula bar", "headings", "freeze", "xlsx", and "format cells".
- Category grouping must be based on grouped data, not accidental adjacency in a scored list.
- Registry search should not mutate stored command order.
- Empty-query ordering should be explicit, preferably by command rank, category order, then label.

Public contracts:

- `types/commands/src/commands.ts` currently defines `Command`, `CommandRegistration`, `CommandSearchOptions`, `CommandExecutionResult`, and `ICommandRegistry`. Any strengthening must preserve public import paths through `@mog-sdk/contracts/commands`.
- If app-only metadata is needed, keep it app-local as `BuiltInCommandSpec` unless the shape is genuinely part of the public SDK command contract.
- `@mog-sdk/contracts` remains the public facade. `mog` must not import planning text or any private `mog-internal` module.

## Concrete implementation plan

1. Create a command inventory and classify every candidate command.
   - Inventory all current built-in command ids and optional `CommandActions` handlers.
   - Inventory all `ActionType` members that are user-invokable from keyboard, ribbon, context menu, toolbar, backstage, or dialogs.
   - Inventory all keyboard definitions with `id`, `action`, `actionArg`, `category`, contexts, priority, and bindings.
   - Classify commands as command-palette built-ins, ribbon-only commands, context-only commands, object-context commands, internal navigation commands, modal-local commands, or non-user commands.
   - Record missing current registrations as defects, not as one-off fixes: edit deletion/select all, structure insertion, sort, navigation, find/replace, headers, help, and insert function duplication should be resolved by the same catalog work.

2. Introduce a typed built-in command spec.
   - Add an app-local spec type near this folder, for example `BuiltInCommandSpec`.
   - Required fields: `id`, `label`, `category`, `description`, `keywords`, `rank`, and one behavior source.
   - Behavior sources should be a discriminated union:
     - `{ kind: 'action'; action: ActionType; payload?: KeyboardActionPayloadFor<ActionType> | CommandPayloadFor<ActionType> }`
     - `{ kind: 'callback'; owner: string; execute: CommandHandler }` only for real host callbacks or temporary dispatcher gaps
     - `{ kind: 'alias'; targetCommandId: CommandId }` if aliases are kept discoverable
   - Optional fields: `icon`, `shortcutSource`, `contexts`, `availability`, `disabledReason`, `telemetryName`, and `featureFlag`.
   - Use `satisfies readonly BuiltInCommandSpec[]` so TypeScript catches invalid categories, payloads, and action names.

3. Build the first complete built-in catalog from production actions.
   - Replace `createBuiltInCommands(actions: CommandActions)` with a static catalog plus a runtime resolver.
   - Map current direct dispatch commands to their exact `ActionType` and payload:
     - clipboard: `COPY`, `CUT`, `PASTE`, `OPEN_PASTE_SPECIAL_DIALOG`
     - history/structure: `UNDO`, `REDO`, `DELETE_CELLS` or the correct delete-selection action, `SELECT_ALL`, row/column insert actions
     - formatting: `TOGGLE_BOLD`, `TOGGLE_ITALIC`, `TOGGLE_UNDERLINE`, `TOGGLE_STRIKETHROUGH`, `SET_HORIZONTAL_ALIGN`, `SET_VERTICAL_ALIGN`, `TOGGLE_WRAP_TEXT`, `FORMAT_*` or `SET_NUMBER_FORMAT`
     - view: formula display, worksheet gridlines/headings, zoom, freeze panes
     - insert: chart, pivot, function, hyperlink
     - data: sort, remove duplicates, text to columns
     - formulas: calculate now/sheet, insert function, calculation mode
     - navigation/file/help: go to, find/replace, export, print, shortcuts
   - Where no dispatcher action exists, implement the dispatcher action first in the future production change or mark the command blocked in the catalog with an owner and issue, not as an optional omission.
   - Decide canonical ids for duplicates and erroneous ids before changing behavior.

4. Add a command execution resolver tied to action dependencies.
   - Create a command provider hook or component under the coordinator/action-dependencies boundary, not under toolbar rendering.
   - The resolver should look up the current `ActionDependencies` at execution time and call `dispatch(spec.action, deps, spec.payload)` for action-backed commands.
   - Convert dispatcher `ActionResult` into a strengthened `CommandExecutionResult` while preserving command id, action type, handled state, reason, and error message.
   - Keep host callback commands such as export/print only where the dispatcher cannot own them yet; otherwise route them through `SAVE`, `EXPORT_FILE`, `PRINT`, and host bridge handlers.
   - Remove the `CommandActions` optional callback interface after all built-ins are action-backed or deliberately callback-backed.

5. Refactor the registry into a scoped observable store.
   - Replace `registeredCommandIds` with registration handles returned by `registerMany(owner, registrations)`.
   - Store entries as `{ owner, command, execute, availability, version }`.
   - Add `subscribe(listener)`, `getSnapshotVersion()`, and atomic update semantics so React consumers can use `useSyncExternalStore`.
   - Add duplicate id policy: same owner updates, different owner conflicts unless explicitly replacing a lower-priority extension point.
   - Preserve `ICommandRegistry` methods where public contract requires them, but add app-local richer methods if the public interface should remain narrow.
   - Fix comments so the implementation accurately describes caching, thread/concurrency assumptions, and singleton scope.

6. Add live availability and read-only integration.
   - Implement an availability evaluator per command or command group.
   - Use dispatcher read-only rules, implemented-action checks, active sheet state, selection state, object/chart focus, editing mode, and host command ownership where applicable.
   - Add disabled reasons such as `read_only`, `no_selection`, `requires_grid_focus`, `requires_chart_selection`, `host_disabled`, `not_implemented`, and `feature_disabled`.
   - Make `setEnabled` either a scoped override with reason or remove it from built-in availability paths in favor of derived state.
   - Ensure execution rechecks availability immediately before dispatching.

7. Derive shortcut display and validate keyboard parity.
   - Build a shortcut lookup from `keyboard/definitions/index.ts` or the production keyboard registry rather than hard-coded command strings.
   - Let command specs name the shortcut by action plus payload or by keyboard definition id when one action has multiple bindings.
   - Render platform-aware shortcut labels in the palette.
   - Add a keyboard conflict report that understands contexts, priority, and stable registration order.
   - Resolve or explicitly document the inspected `Ctrl+Shift+P` command-palette versus Go To Special conflict.

8. Improve search and category grouping.
   - Add a normalized search index with tokens for id segments, labels, categories, descriptions, keywords, and shortcuts.
   - Keep the no-dependency approach if it is sufficient, but make scoring behavior explicit and tested. If a search library is introduced, it must be justified by production behavior and bundle impact.
   - Add stable tie-breakers: command rank, category order, label, id.
   - Make category grouping in `CommandPalette` group by category after ranking or render mixed results without repeated category headers.
   - Consider returning scored results internally while keeping public `search()` compatible if necessary.

9. Strengthen the command contracts package only where needed.
   - Evaluate whether `CommandExecutionResult` should include `commandId`, `action`, `handled`, `reason`, and `details`.
   - Evaluate whether `CommandSearchOptions` needs `includeDisabled`, `contexts`, or `source` instead of only `enabledOnly`.
   - If these are public SDK concepts, update `types/commands/src/commands.ts` and `contracts/src/core/commands.ts` through normal public-contract review.
   - If they are app-only, keep the richer types in `actions/commands` and adapt to the current public `ICommandRegistry`.

10. Remove obsolete manual wiring.
   - Delete `CommandActions` after migration or reduce it to a small extension-only interface.
   - Remove `useCommandRegistration` from `ToolbarContainer`.
   - Register built-ins from a command provider mounted with the spreadsheet coordinator.
   - Keep `index.ts` as the stable barrel for `commandRegistry`, the provider/registration API, and any exported test helpers.
   - Update docs/comments that currently show cleanup examples with `return => unregisterBuiltInCommands`; the existing example is also syntactically misleading because it returns the function reference incorrectly.

## Tests and verification gates

Unit and contract tests:

- Add registry tests for scoped registration, same-owner updates, cross-owner duplicate rejection, unregister handles, clear behavior, live subscription versioning, and handler freshness.
- Add search tests for exact match, prefix, fuzzy match, keyword match, id-segment match, shortcut alias match, disabled filtering, category filtering, empty-query ordering, and stable tie-breakers.
- Add execution tests that verify dispatcher-backed commands pass the right `ActionType` and payload and preserve dispatcher `ActionResult` reasons.
- Add availability tests for read-only blocking, missing selection, object/chart-specific commands, host-owned file commands, and not-implemented actions.
- Add catalog symmetry tests:
  - no duplicate command ids
  - every built-in action-backed command references a valid `ActionType`
  - every command payload satisfies the action payload contract
  - every shortcut reference resolves to a keyboard definition
  - no hand-written shortcut string disagrees with the keyboard registry
  - every command marked built-in has a production execution path

Integration tests:

- Add React tests for `CommandPalette` updating while open when commands register/unregister or enabled state changes.
- Test category grouping with interleaved search results so repeated headers cannot regress.
- Test stale handler prevention by changing calculation mode or view state after mount, then executing the command from the palette.
- Test that toolbar unmount or collapsed ribbon mode does not remove built-in commands.

E2E tests using real UI input paths:

- Open the command palette through the real keyboard shortcut, type a command query, press Enter, and verify a visible spreadsheet behavior.
- Exercise formatting commands through the palette, for example search "bold" and verify the selected cell becomes bold through the same mutation pipeline as toolbar/keyboard.
- Exercise a read-only or disabled command path and verify it does not mutate the workbook.
- Exercise a command with payload, such as align center or format percentage.
- Exercise search and mouse execution with real clicks.

Verification commands for the future implementation:

- Run the relevant spreadsheet unit/integration test package for `actions/commands`, `dialogs/navigation/CommandPalette`, keyboard definitions, and command catalog symmetry.
- Run `pnpm typecheck` for TypeScript changes unless a narrower explicit type gate is approved for that workstream.
- For UI changes, run the spreadsheet dev server and exercise the command palette in a browser with keyboard and mouse input.
- If contract types under `types/commands` or `contracts` change, also run the contracts declaration/public fixture gates used by that package.

No verification commands were run for this planning task because this worker was explicitly constrained to read-only inspection and writing the plan file.

## Risks, edge cases, and non-goals

Risks and edge cases:

- Moving command ownership out of `ToolbarContainer` can expose previously missing commands. That is desired, but each command must have correct availability so users do not see commands that cannot safely execute.
- Some current toolbar callbacks are not pure dispatcher actions. The migration must either add proper dispatcher actions or retain explicitly owned callback commands until the dispatcher gap is closed.
- Keyboard shortcuts can be context-sensitive and priority-sensitive. A naive shortcut display or conflict check can falsely flag intentional overlaps or hide real conflicts.
- Command aliases can improve discoverability but can also duplicate results. Aliases need a display and execution policy before adding many of them.
- Read-only and host ownership rules are easy to bypass if command execution calls callbacks directly. Dispatcher-backed commands should be the default to avoid that.
- Live availability can become expensive if it reads broad stores on every keystroke. Evaluators should use narrow snapshots and cheap selectors.
- Public contract changes in `types/commands` can affect SDK consumers. Keep app-only extensions app-local unless they are true public command API improvements.

Non-goals:

- Do not build a temporary compatibility shim that preserves optional `CommandActions` as the primary built-in contract.
- Do not optimize a test-only palette harness. All improvements must target the production command palette and dispatcher path.
- Do not add commands that execute unimplemented actions without a real production handler.
- Do not make `mog` depend on `mog-internal`.
- Do not rewrite unrelated keyboard, toolbar, ribbon, or dispatcher architecture except where needed to make command contracts verifiable.
- Do not hide missing command coverage by leaving commands optional in the built-in catalog.

## Parallelization notes and dependencies on other folders, if any

Natural parallel workstreams:

- Catalog and contract worker: inventory command ids, action mappings, payloads, categories, aliases, and availability rules; produce the typed `BuiltInCommandSpec` catalog.
- Registry worker: implement scoped registration, subscription/versioning, duplicate policy, search ranking, and execution result preservation in `actions/commands`.
- Execution integration worker: mount a command provider under the coordinator, route commands through `dispatch`, remove toolbar-owned registration, and close dispatcher gaps.
- Keyboard parity worker: derive shortcut labels from keyboard definitions and add conflict/parity tests, including the `Ctrl+Shift+P` decision.
- UI worker: update `CommandPalette` to subscribe to registry state, render disabled states/reasons, fix grouping, and verify with real keyboard/mouse input.
- Test worker: build unit, integration, catalog symmetry, and E2E coverage against the production command palette path.

Dependencies:

- `apps/spreadsheet/src/actions/dispatcher.ts` and `types/editor/src/actions/action-types.ts` for action ownership and payload typing.
- `apps/spreadsheet/src/keyboard/definitions/**` and keyboard registry utilities for shortcut display and conflict analysis.
- `apps/spreadsheet/src/dialogs/navigation/CommandPalette.tsx` for live search/render/execute behavior.
- `apps/spreadsheet/src/chrome/toolbar/primitives/ToolbarContainer.tsx` and `hooks/toolbar/use-command-registration.ts` for removing current registration ownership.
- `apps/spreadsheet/src/actions/dispatcher-read-only.ts` for read-only availability and execution blocking.
- `types/commands/src/commands.ts` and `contracts/src/core/commands.ts` only if command result/search contracts are promoted to public API.

