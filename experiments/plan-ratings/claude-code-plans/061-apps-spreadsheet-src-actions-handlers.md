# 061 — Improve `mog/apps/spreadsheet/src/actions/handlers` (user command handlers & mutation dispatch)

## Source folder and scope

- **Folder:** `mog/apps/spreadsheet/src/actions/handlers`
- **Size:** 81 production `.ts` files + 35 `*.test.ts`. The folder is the largest in `actions/`. Top files by size: `editor.ts` (2,090 lines / 70 exported handlers), `charts.ts` (1,718 / 52), `object.ts` (1,540 / 50), `table.ts` (1,400 / 33), `clipboard.ts` (1,218 / 19), `data-analysis.ts` (1,010 / 46), `filter.ts` (894 / 19), `structure.ts` (690 / 23). Subfolders: `selection/`, `formatting/`, `fill/`, `ui/`.
- **In scope (edit targets):**
  - **Handler modules:** every `*.ts` under `handlers/**` exporting `ActionHandler`/`AsyncActionHandler` constants keyed by `ActionType` (the files above plus `comments.ts`, `conditional-formatting.ts`, `slicer.ts`, `pivot.ts`, `split.ts`, `ink.ts`, `diagram.ts`, `equation.ts`, `text-effects.ts`, `formulas.ts`, `format-painter.ts`, `navigation.ts`, `sheets.ts`, `workbook.ts`, `total-row.ts`, `drag-drop.ts`, `print-export.ts`, `paste-validation.ts`, `repeat.ts`, `expand-to-data-region.ts`, `chart-clipboard.ts`, `chart-selection.ts`, `structure-row-column.ts`, and the `selection/`, `formatting/`, `fill/`, `ui/` submodules).
  - **Shared seams:** `handler-utils.ts` (the single `getUIStore`/`handled`/`notHandled`/protection-feedback cast point), `bridge-error-guard.ts` (`guardBridgeMutation`), `edit-entry.ts` (coordinator grid edit-session bridge), `index.ts` (barrel).
- **Out of scope (named for coupling, not edit targets):**
  - **`actions/dispatcher.ts`, `actions/dispatcher-types.ts`, `actions/dispatcher-read-only.ts`** — the dispatch loop that builds `HANDLER_MAP` and awaits/error-wraps handlers. This plan treats the dispatcher contract (sync-or-`Promise<ActionResult>`, receipt pull-path, repeatable tracking, read-only safety net) as an invariant to preserve, and only proposes the minimum dispatcher change needed to land typed payloads (see plan step 1).
  - **`actions/types.ts`, `actions/type-guards.ts`, `actions/data-command-target.ts`** — sibling files in the parent `actions/` folder; referenced where handlers depend on them.
  - **`@mog-sdk/contracts/actions` (`mog/contracts/src/actions/types.ts`)** — the canonical `ActionDependencies` / `ActionResult` / `ActionHandler` / `ActionType` definitions handlers bind to. Payload-typing (objective 1) requires a coordinated change here; flagged as a cross-folder dependency.
  - `WorkbookInternal` / `Worksheet` (`@mog-sdk/contracts/api`), the Rust `compute-core` reached via `deps.workbook`, the UI store (`ui-store/`), the view adapters (`views/`), and the coordinator. Changes rippling into them are flagged.

## Current role of this folder in Mog

This folder is **the single implementation site for every user command in the spreadsheet app**. Every input source — keyboard shortcuts, ribbon/toolbar clicks, context menus, and the AI agent path — funnels through `dispatch(actionType, deps, payload)` (`actions/dispatcher.ts:1356`), which looks the action up in `HANDLER_MAP` and invokes the handler exported from this folder. Handlers are documented as pure functions `(deps, payload?) => ActionResult | Promise<ActionResult>` that:

- read actor/UI state through `deps.accessors` and the typed `getUIStore(deps)` helper,
- perform all data/compute mutations through the one unified `deps.workbook` API (terminating at `ComputeBridge → MutationResultHandler → EventBus`),
- return `{ handled, receipts?, error?, reason? }`.

The dispatcher owns cross-cutting concerns: a read-only safety net (`dispatcher-read-only.ts` allow-list), receipt pull-path processing via `deps.coordinator.processReceipts`, F4 repeatable-action tracking, devtools reporting, and a single `try/catch` that converts any thrown/rejected handler into `{ handled: false, error }`. The handler files themselves are meant to be thin, deterministic, and individually testable.

`handler-utils.ts` is the deliberate "one cast point": because `ActionDependencies.uiStore` is typed `IUIStoreApi` (`getState(): unknown`) in contracts to break a circular dependency, `getUIStore()` is the single place that casts to the app's `UIState`. This dedup is already done well — no handler file redefines `getUIStore`/`handled`/`notHandled` locally.

## Evidence (observed in the current tree)

- **Action payloads are completely untyped end-to-end.** The contract types both `ActionHandler` and `AsyncActionHandler` as `(deps, payload?: any)` (`contracts/src/actions/types.ts:369,379`) and the dispatcher passes `payload?: any` (`dispatcher.ts:1359`). Handlers recover shape by hand-casting: there are **265 `payload as {…}` / `payload?.` sites across 10 handler files**, with each call site re-asserting an ad-hoc structural type (e.g. `payload as { functionName: string }` in `formulas.ts`, `payload as { width?: number }` in `structure.ts`, `payload as { rangeIndex, startCellId, endCellId }` in `editor.ts:2044`). No per-`ActionType` payload registry exists, and nothing validates the payload before the cast. The AI-agent dispatch path can therefore deliver a malformed payload that slips past TypeScript and faults deep inside a handler (surfacing only as a generic `{ handled:false, error }` from the dispatcher catch).

- **Multi-sheet ("Group Mode") selection is silently dropped by every sync mutation handler.** The contract advertises `getSelectedSheetIds?(): string[] | Promise<string[]>` for broadcasting formatting/structure edits to all selected sheets (`contracts/src/actions/types.ts`, "Stream H"). It is **never awaited anywhere in the folder.** Instead, `getTargetSheetIds(deps)` is **triplicated** in `editor.ts:86`, `structure.ts:61`, and `structure-row-column.ts:18`, each with the comment "getSelectedSheetIds is async — sync callers use active sheet as safe default" and a body that returns `[deps.getActiveSheetId()]` unconditionally. So with three sheets group-selected, applying bold or inserting a column writes only to the active sheet — a real parity regression hidden behind a "safe default."

- **Protection-rejection feedback is applied inconsistently across mutation handlers.** The shared helpers `isProtectionRejection(err)` + `showProtectionFeedback(deps)` (`handler-utils.ts:50-70`) raise the user-facing "sheet is protected" alert. They are used only by `editor.ts`, `object.ts`, `structure.ts`, and `structure-row-column.ts`. The other mutation-heavy handlers — `clipboard.ts`, `table.ts`, `charts.ts`, `data-analysis.ts`, `filter.ts`, `fill/flash-fill.ts` — do **not** call them. When a mutation is rejected on a protected sheet, those handlers let the `API_PROTECTED_SHEET` error bubble to the dispatcher's generic catch (`dispatcher.ts:1473`), which `console.error`s and returns `{ handled:false, error }` with **no protection alert shown to the user**.

- **`guardBridgeMutation` (PartialArrayWrite "can't change part of an array" guard) is applied unevenly.** `bridge-error-guard.ts` exists precisely because direct-mutation handlers bypass the editor commit pipeline and must absorb `PartialArrayWrite` rejections inline. It is used in `editor.ts` (12), `fill/flash-fill.ts` (3), `drag-drop.ts` (3), `total-row.ts` (2), `filter.ts` (2), and `data-analysis.ts` (2) — but other direct-mutation paths (paste in `clipboard.ts`, table-resize in `table.ts`, several `fill/` variants) do not consistently route through it, so a partial-array overwrite there surfaces as a raw error instead of the Excel-parity no-op + message.

- **A divergent duplicate of the action contract lives in the app and is re-exported publicly.** `actions/types.ts` redefines `ActionDependencies`, `ActionResult`, and `ActionHandler` locally, and `actions/exports.ts` re-exports `ActionHandler`/`ActionResult` from it. This local copy has **drifted** from the canonical `@mog-sdk/contracts/actions`: it lacks `getActiveSheetId`, `coordinator`, `platform`, `shellService`, `featureGates`, `hostCommands`, and types `commands` as a tiny `{copy;paste}` stub; its doc comments still reference a `not_applicable` reason that is not in the actual `reason` union. Handlers correctly import from contracts (64 files do), so the local copy is dead for handlers but remains a public, stale type surface for other consumers.

- **`deps.coordinator` is `unknown` and reached through ad-hoc structural casts.** The contract types `coordinator?: unknown` (`contracts/src/actions/types.ts`). Ten handler files cast it inline; `edit-entry.ts:19-25` rebuilds a one-off `{ grid?: { beginEditSession?: … } }` shape, and `dispatcher.ts:1413` re-asserts `{ processReceipts }`. There is no shared typed coordinator capability surface, so each consumer re-invents (and can mistype) the contract.

- **Several large handlers are god-files with no dedicated tests.** `clipboard.ts` (1,218 lines, 19 handlers), `slicer.ts`, `comments.ts`, `conditional-formatting.ts`, `format-painter.ts`, `formulas.ts`, `split.ts`, `ink.ts`, and `sheets.ts` have **no matching `__tests__` file**, despite being mutation- and side-effect-heavy. `editor.ts`/`charts.ts`/`object.ts` are tested but are 1,500–2,000-line monoliths that mix unrelated concerns (e.g. editor lifecycle + fill + special-insert + formula point-mode in one file), which hurts review, isolated testing, and tree-shaking.

## Improvement objectives

1. **Make action payloads type-safe and validated** via a per-`ActionType` payload-type map plus narrow runtime guards at handler entry, eliminating the 265 ad-hoc `payload as {…}` casts and hardening the AI-agent dispatch path.
2. **Restore multi-sheet (Group Mode) correctness** by making target-sheet resolution honor `getSelectedSheetIds`, de-duplicating `getTargetSheetIds` into one shared helper, and converting the affected handlers to await it.
3. **Unify error handling** so every mutation handler surfaces protection rejections (`showProtectionFeedback`) and absorbs `PartialArrayWrite` consistently — ideally via one shared `runMutation` wrapper instead of per-handler boilerplate.
4. **Retire the divergent local `ActionDependencies`/`ActionResult`/`ActionHandler` copy** in `actions/types.ts`/`exports.ts`, re-exporting the canonical contract types so there is a single source of truth.
5. **Introduce a typed coordinator capability seam** so `deps.coordinator` is consumed through one narrow typed accessor instead of ten inline structural casts.
6. **Decompose the largest god-files and close the test-coverage gap** for the untested mutation handlers, without changing the `HANDLER_MAP` action keys or barrel exports.

## Production-path contracts and invariants to preserve or strengthen

- **`HANDLER_MAP` completeness & key stability.** Every `ActionType` maps to exactly one handler; the map is `Record<ActionType, AnyActionHandler>` so a missing/renamed handler is a compile error. No decomposition or rename may drop or rekey an entry; barrel re-exports in `index.ts` and the direct convenience exports must stay byte-identical in name.
- **Sync-or-async handler shape.** Handlers return `ActionResult | Promise<ActionResult>`; the dispatcher awaits Promises and runs receipt/repeatable/devtools bookkeeping on both branches. Any handler converted from sync to async (objective 2) must still resolve to a real `ActionResult` and must not double-process receipts.
- **Single mutation pipeline.** All data/compute mutations continue to go through `deps.workbook` (terminating at the one `ComputeBridge → MutationResultHandler → EventBus` path). No handler may reach the engine or DOM directly; the `window.__SHELL__`/`window.__` reach-arounds are already gone (only a doc-comment reference remains) and must stay gone.
- **Read-only safety net.** The `dispatcher-read-only.ts` allow-list is the last line of defense for read-only documents; new handlers must be classified (mutating → blocked by default) and the allow-list updated in lockstip.
- **`handler-utils.ts` as the one cast point.** `getUIStore` remains the sole `uiStore → UIState` cast; new shared concerns (target-sheet resolution, mutation wrapper, typed coordinator) belong in this shared layer, not re-implemented per file.
- **`ActionResult.receipts` semantics.** Receipts are the pull-path that lets rendering/selection/undo avoid re-querying; handlers that mutate must keep returning receipts (or the EventBus fallback) — decomposition must not silently drop them.
- **Result `reason` union integrity.** `reason` is exactly `'not_found' | 'not_implemented' | 'wrong_context' | 'disabled' | 'blocked'`; stale references to `not_applicable` in comments/types must be corrected, not propagated.

## Concrete implementation plan

**Phase A — Contract & shared-seam hardening (enables the rest; touches contracts + handler-utils).**
1. **Typed payloads.** In `@mog-sdk/contracts/actions`, add an `ActionPayloadMap` (`Record<ActionType, payload-shape>`, `void` where none) and a generic `ActionHandlerFor<A>` = `(deps, payload: ActionPayloadMap[A]) => ActionResult | Promise<ActionResult>`. Keep `AnyActionHandler` for the map value to avoid a big-bang. In the handlers folder, replace `payload as {…}` casts with `payload: ActionPayloadMap['X']` typing plus a small `assertPayload`/narrow guard in `handler-utils.ts` for the AI-agent path (validates required fields, returns `notHandled('wrong_context')` on mismatch instead of faulting). Migrate file-by-file (start with `formulas.ts`, `structure.ts`, `sheets.ts` — small, well-bounded payloads — then the large files).
2. **Shared target-sheet resolver.** Add `getTargetSheetIds(deps): Promise<SheetId[]>` (and a sync `getActiveTargetSheetIds` for genuinely sync paths) to `handler-utils.ts` that awaits `deps.getSelectedSheetIds?.() ?? [deps.getActiveSheetId()]`. Delete the three duplicated copies in `editor.ts`/`structure.ts`/`structure-row-column.ts`; convert the affected formatting/structure handlers to async and `await` it. Verify the dispatcher's async branch handles the now-async handlers (it already does).
3. **Shared mutation wrapper.** Add `runMutation(deps, fn)` to `handler-utils.ts` that wraps `guardBridgeMutation` (PartialArrayWrite → no-op + message) and `isProtectionRejection` → `showProtectionFeedback` → `notHandled('disabled')`, returning a normalized `ActionResult` with receipts threaded through. Route the unguarded mutation handlers (`clipboard.ts`, `table.ts`, `charts.ts`, `data-analysis.ts`, `filter.ts`, `fill/*`) through it.
4. **Typed coordinator seam.** Define a `CoordinatorCapabilities` interface (the actually-used surface: `processReceipts`, `grid.beginEditSession`, scroll ops) in the contract or a shared `handlers` type module, and a `getCoordinator(deps)` accessor in `handler-utils.ts`. Replace the inline casts in `edit-entry.ts` and elsewhere.

**Phase B — Contract dedup (independent, low-risk).**
5. Retire `actions/types.ts`'s local `ActionDependencies`/`ActionResult`/`ActionHandler`; re-export the canonical types from `@mog-sdk/contracts/actions` through `exports.ts`. Fix the stale `not_applicable` doc references.

**Phase C — Decomposition & coverage (mechanical, per-file; depends on A landing first so split files inherit the shared seams).**
6. Split the god-files along the concern seams already present as comment banners — `editor.ts` → `editor/{lifecycle,fill,special-insert,formula-point-mode}.ts`; similarly `charts.ts`, `object.ts`, `table.ts`, `clipboard.ts` — keeping the same exported handler names and re-exporting from a per-feature `index.ts` so `dispatcher.ts` imports and `HANDLER_MAP` keys are unchanged.
7. Add `__tests__` for the untested mutation handlers (`clipboard`, `slicer`, `comments`, `conditional-formatting`, `format-painter`, `formulas`, `split`, `ink`, `sheets`), prioritizing protection-rejection, PartialArrayWrite, multi-sheet, and receipt-propagation paths exercised by the new shared seams.

## Tests and verification gates

- **Type gate:** `ActionPayloadMap` must cover every `ActionType` (compile-enforced); `HANDLER_MAP` stays `Record<ActionType, …>` complete. Typecheck the spreadsheet app + contracts package after each phase.
- **New/updated unit tests:**
  - Payload guards: each migrated handler rejects a malformed payload with `notHandled('wrong_context')` rather than throwing.
  - Multi-sheet: `getTargetSheetIds` returns all selected sheets; a bold/insert-column handler writes to every selected sheet (extend `__tests__/workbook-grouping.test.ts`).
  - Protection: every mutation handler routed through `runMutation` surfaces `showProtectionFeedback` on `API_PROTECTED_SHEET` and returns `disabled` (new `protection-feedback.test.ts`).
  - PartialArrayWrite: paste/fill/table-resize return a no-op `false` + message, not a thrown error.
  - Receipt propagation: decomposition preserves receipts (extend `__tests__/receipt-propagation.test.ts`).
- **Regression gates:** existing `__tests__` (charts, editor-commit-unified, sort, merge-operations, borders-direct-mode, etc.) must stay green; the app-eval scenarios that drive these handlers (formatting, fill, filter, clipboard) must pass unchanged.
- **No-behavior-change gate for Phase C:** decomposition diffs should be import/move-only; a snapshot of `getImplementedActions()` / `HANDLER_MAP` keys before and after must be identical.
- (Per task constraints, this plan does not itself run build/test/typecheck; gates above are the acceptance criteria for the implementing change.)

## Risks, edge cases, and non-goals

- **Sync→async conversion risk (objective 2):** awaiting `getSelectedSheetIds` makes some currently-sync handlers async. Keyboard fast-paths must still feel synchronous; verify no input handler assumes a synchronous `ActionResult` (the dispatcher already supports Promises, but callers that read `result.handled` directly without awaiting must be audited).
- **Contract change blast radius (objective 1 & 5):** editing `@mog-sdk/contracts/actions` ripples to every action consumer (keyboard, ribbon, agent). Land the additive `ActionPayloadMap`/`ActionHandlerFor` first (non-breaking), migrate handlers, then consider tightening `AnyActionHandler` — do not flip the map value type in one step.
- **Decomposition must not rekey actions:** the single highest-risk mistake is dropping/renaming a `HANDLER_MAP` entry or a barrel export during a split; mitigated by the key-snapshot gate.
- **Protection wrapper false positives:** `isProtectionRejection` does substring matching on messages; broadening its use must not swallow unrelated errors — keep the `code === 'API_PROTECTED_SHEET'` branch primary and treat substring matching as fallback only.
- **Non-goals:** changing the dispatcher's read-only allow-list policy, redesigning the UI store, altering the `ComputeBridge`/EventBus mutation pipeline, adding new user-facing commands, or modifying the agent execution context (which bypasses `dispatch()` entirely). Localization of message strings is out of scope.

## Parallelization notes and dependencies on other folders

- **Phase A objective 1 (typed payloads)** and **objective 5 (typed coordinator)** require a coordinated edit to `@mog-sdk/contracts/actions` (`mog/contracts/src` — covered by plans 001–003) and a downstream consumer sweep (keyboard, ribbon, agent dispatch). Sequence: contracts change → handlers migrate → consumers. This is the only hard cross-folder coupling.
- **Phase B (contract dedup)** is independent of A and C and can land first as a quick win; it touches `actions/exports.ts` and `actions/types.ts` (parent folder) and any external consumer importing the stale public types.
- **Phase C (decomposition + tests)** is internal to `handlers/**`, parallelizable per-file once the shared seams from Phase A exist, and depends on nothing outside this folder.
- **Adjacent folders for coupling awareness:** `actions/dispatcher*.ts` (await/receipt/repeatable invariants), `ui-store/` (the `UIState` cast target behind `getUIStore`), `views/` (view adapters reached via `deps.accessors`), and the coordinator implementation (objective 5's typed seam must match the real coordinator's method set). None of these are edit targets here except the minimal dispatcher payload-type plumbing in step 1.
