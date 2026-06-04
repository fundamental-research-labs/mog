# Plan 091 — Command Registry & Built-in Command Contracts (`apps/spreadsheet/src/actions/commands`)

## Source folder and scope

- **Folder:** `mog/apps/spreadsheet/src/actions/commands`
- **Files in scope:**
  - `index.ts` — barrel re-export of the registry singleton and built-in registration helpers.
  - `command-registry.ts` — `CommandRegistryImpl` (implements `ICommandRegistry` from `@mog/types-commands/commands`) plus the hand-rolled fuzzy search and the module-level `commandRegistry` singleton.
  - `built-in-commands.ts` — the `CommandActions` handler interface, the `createBuiltInCommands(actions)` factory that declares ~60 commands across 11 categories, and `registerBuiltInCommands` / `unregisterBuiltInCommands` / `getRegisteredBuiltInCommandIds`.
- **Adjacent (read for grounding, not edited by this plan unless noted):**
  - `apps/spreadsheet/src/hooks/toolbar/use-command-registration.ts` — the React hook that calls `registerBuiltInCommands` from `ToolbarContainer`.
  - `apps/spreadsheet/src/dialogs/navigation/CommandPalette.tsx` — the sole UI consumer (Ctrl+Shift+P palette).
  - `types/commands/src/commands.ts` — canonical contract (`Command`, `CommandCategory`, `ICommandRegistry`, `CommandSearchOptions`, `CommandExecutionResult`, `CommandPaletteState`), re-exported via the `@mog-sdk/contracts/commands` shim.
  - `apps/spreadsheet/src/hooks/navigation/use-keyboard.ts` + the `KeyboardCoordinator` / `@mog-sdk/contracts/keyboard` registry — the **independent** source of truth for actual keyboard shortcuts and platform (Cmd↔Ctrl) normalization.

The folder is small (3 files, ~1.3k LOC) but sits on a public-facing contract surface (`ICommandRegistry`) and is the discovery/execution backbone for the Command Palette.

## Current role of this folder in Mog

This folder is the **command catalog and dispatch layer** for the spreadsheet app:

1. `CommandRegistryImpl` is a single global, mutable, in-memory map (`Map<string, {command, handler}>`) that implements the contract `ICommandRegistry`. It supports register / unregister / get / search / execute / setEnabled / getByCategory / has / clear.
2. `built-in-commands.ts` is the catalog: it maps each user-facing action (copy, bold, freeze panes, insert chart, calc-now, find/replace, export, print, …) to a `Command` descriptor (id, label, category, shortcut display string, icon, description, keywords) and a runtime handler pulled from `CommandActions`.
3. `useCommandRegistration` wires live action handlers (from `useToolbarActions`, clipboard hooks, etc.) into the singleton on mount and tears them down on unmount.
4. `CommandPalette.tsx` reads `commandRegistry.search(query, { limit: 50 })`, renders grouped results, and calls `commandRegistry.execute(id)` on Enter/click.

In short: this is the only place that turns "every toolbar/keyboard action" into a searchable, keyboard-discoverable list. Its correctness directly determines whether the palette shows the right commands, in the right enabled state, with the right shortcuts, and whether executing them is reliable.

## Improvement objectives

Evidence-grounded problems found while reading the code and its consumers:

1. **Stale-closure / missing-handler registration (correctness).** `useCommandRegistration` runs `registerBuiltInCommands(actions)` inside a `useEffect` with an **empty dependency array** (`[]`, see `use-command-registration.ts:61-72`). Combined with `addCommand` only pushing a registration **when the handler is defined at registration time** (`built-in-commands.ts:153-157`), this means: (a) any handler that becomes available *after* first mount (lazily-loaded feature, conditionally-enabled action) is **permanently absent** from the palette for that session; (b) if a `useCallback` handler's identity changes, the registry keeps the **stale closure** and never re-registers. The comment "handlers are stable due to useCallback" is an unverified assumption, not an invariant.

2. **`enabled` state is declared but never driven (correctness + UX).** The contract has `enabled?: boolean`, `ICommandRegistry.setEnabled`, and `execute` already refuses disabled commands (`command-registry.ts:166-168`). Yet a repo-wide search shows **no caller ever invokes `setEnabled`**. Every command is therefore always enabled. The palette will happily execute Undo with no history, Paste with an empty clipboard, Sort/Remove-Duplicates with no row selection, Unfreeze with no frozen panes, etc. The handler may no-op or throw; either way the user gets a misleading "always available" catalog.

3. **Shortcut display strings are a second, drifting, non-platform-aware source of truth (correctness).** Each command hardcodes a display string like `'Ctrl+C'`, `'Ctrl+B'`, `'Alt+Shift+P'` (`built-in-commands.ts`). The actual shortcuts are owned by the **KeyboardCoordinator** and the `@mog-sdk/contracts/keyboard` registry, which explicitly normalizes Cmd↔Ctrl per platform (`use-keyboard.ts:8-13`). The two are maintained by hand and can drift, and on macOS the palette displays the wrong modifier ("Ctrl+B" instead of "⌘B"). Worse, the *binding* and the *palette label* can disagree about what a command actually does.

4. **Execution failures are silently swallowed (correctness + observability).** `execute` returns a `CommandExecutionResult` discriminated union, but `CommandPalette.executeCommand` does `await commandRegistry.execute(command.id)` and **discards the result** (`CommandPalette.tsx:106-112`). A failed command produces no toast, no log, no telemetry — it just closes the palette and looks like nothing happened. There's also no concurrency guard against double-execution of an async command.

5. **Search is hand-rolled, O(n) per keystroke, and the documented cache does not exist (quality + perf).** The class doc claims "Caches search index and invalidates on registration changes" (`command-registry.ts:11`), but **no cache is implemented** — every `search()` does `getAll()` → `map(score)` → `sort` over the full set. The contract itself recommends a real fuzzy library ("should use a fuzzy search library (e.g., Fuse.js)", `commands.ts:108-110`). The current scorer has no acronym matching ("ttc" → "Text to Columns"), no word-boundary weighting, and a `Math.min(0.6, …)` cap that flattens subtle ranking differences.

6. **`recentCommands` (MRU) is in the contract but unimplemented (feature gap).** `CommandPaletteState.recentCommands` exists (`commands.ts:193`) but neither the registry nor the palette tracks or surfaces recently-used commands, so the empty-query view is a static alphabetical dump.

7. **Global singleton + module-level mutable `registeredCommandIds` (architecture / multi-instance hazard).** Both `commandRegistry` and the `registeredCommandIds` cleanup array are module-scoped globals (`command-registry.ts:266`, `built-in-commands.ts:957`). Two spreadsheet instances on one page, or fast unmount/remount, race on the same global: the second `registerBuiltInCommands` overwrites the first's tracking array, so the first's cleanup unregisters the *second's* commands. There is also no dev-time warning on duplicate-ID overwrite in `register`/`registerMany`.

8. **Untyped string IDs and a category/contract mismatch (maintainability).** IDs are bare strings with at least one inconsistency (`'format.underlineType'` vs the sibling `'format.bold'`/`'format.italic'` naming). `CommandActions` groups `goToCell`/`findAndReplace` under a `// Selection` comment but the commands are emitted with category `'Navigation'`; the contract defines both `'Navigation'` and `'Selection'`, so the intent is ambiguous. There is no exhaustive map proving every `CommandActions` key has a corresponding command and vice-versa.

9. **Zero test coverage.** No `*.test.*` / `*.spec.*` references the registry or built-in commands. The fuzzy scorer, enable/disable gating, dedup-by-id, and registration lifecycle are entirely unverified.

**Objectives (in priority order):**

- O1. Make registration robust to changing/late-arriving handlers (fix the stale-closure and empty-deps issues) without losing teardown correctness.
- O2. Drive `enabled` from real application context so the palette reflects what is actually executable.
- O3. Make shortcut display derive from the keyboard registry (single source of truth, platform-aware) instead of hardcoded strings.
- O4. Surface execution results (success/failure) to the user and to telemetry; guard against double-execution.
- O5. Replace the hand-rolled search with a properly-indexed, cached, higher-quality matcher and actually implement the documented cache invalidation.
- O6. Implement `recentCommands` MRU per the existing contract.
- O7. Harden the singleton/instance and duplicate-ID story.
- O8. Type the command IDs and reconcile the category/contract surface; add an exhaustiveness check.
- O9. Add comprehensive unit tests and a palette integration scenario.

## Production-path contracts and invariants to preserve or strengthen

**Preserve (do not break):**

- `ICommandRegistry` shape in `types/commands/src/commands.ts` must remain satisfied. Any additions (e.g. an MRU accessor, a `subscribe` for index invalidation) are **additive** to the contract — extend the interface, do not remove members.
- `CommandExecutionResult` discriminated union return type of `execute` is the public failure channel; keep it and start *consuming* it.
- The `index.ts` barrel exports (`commandRegistry`, `registerBuiltInCommands`, `unregisterBuiltInCommands`, `getRegisteredBuiltInCommandIds`, `CommandRegistryImpl`, `CommandActions` type) are imported by `use-command-registration.ts` and `CommandPalette.tsx`; keep names/signatures stable or update all call sites in the same change.
- `registerBuiltInCommands` must remain idempotent (it currently self-unregisters first) and must keep its "only register commands whose handler is present" behavior as a *floor* (handlers genuinely absent for a build should not appear), while fixing the *late-arrival* case.

**Strengthen / add as invariants:**

- **I1 — Single source of truth for shortcuts.** A command's displayed shortcut must be derived from the keyboard registry keyed by command id (or an explicit binding ref), never hand-typed. If no binding exists, show none. Platform normalization (Cmd vs Ctrl, ⌥/⇧ glyphs) is the keyboard layer's job.
- **I2 — `enabled` reflects executability.** For every command that has a precondition (history non-empty, selection present, clipboard non-empty, panes frozen, …), `enabled` must be kept in sync via `setEnabled`. `execute` continues to refuse disabled commands.
- **I3 — Unique ids.** `register`/`registerMany` must warn (dev) on overwriting an existing id; built-in ids must be unique by construction (enforced by a test).
- **I4 — Handler freshness.** The registry must always invoke the *current* handler for a command id at execute time, not a closure captured at first mount.
- **I5 — Search determinism.** For equal scores, ordering is stable (category, then label) so palette results don't jitter between keystrokes.
- **I6 — No silent failures.** A failed `execute` must produce user-visible feedback and a telemetry/log event.

## Concrete implementation plan

> Production-path only. No test-only shims, no scope reduction. Steps are ordered so each is independently shippable.

### Step 1 — Fix registration lifecycle (O1, I4)
- In `built-in-commands.ts`, change the handler storage model so the registry stores a **stable indirection** to handlers rather than the captured closure. Concretely: keep `createBuiltInCommands` producing `{command, handler}` but have `registerBuiltInCommands` accept a `getActions: () => CommandActions` *or* re-register on actions change.
- In `use-command-registration.ts`, replace the `[]` dependency array with a dependency on `actions` (or a stable ref + per-render handler lookup). Memoize `actions` at the `ToolbarContainer` call site to avoid thrash; document that requirement at the call site rather than relying on an unstated assumption.
- Keep the "skip command when handler undefined" floor, but re-evaluate it on every (re)registration so late-arriving handlers appear.
- Acceptance: changing a handler's identity updates what `execute` calls; a handler that is `undefined` on first render but defined later becomes available after re-registration.

### Step 2 — Drive `enabled` from context (O2, I2)
- Add a lightweight, declarative `precondition` concept. Two viable shapes (decide in design review — see open question Q1):
  - (a) Add an optional `isEnabled?: (ctx) => boolean` to each built-in command definition and a `commandRegistry.refreshEnabled(ctx)` that batch-calls `setEnabled`; or
  - (b) Keep the registry context-free and have a new `useCommandEnablement` hook subscribe to the relevant stores (undo/redo availability, selection, clipboard, freeze state, calc mode) and call `setEnabled` on change.
- Prefer (b) for separation of concerns: the registry stays a dumb store; enablement is app state. Wire it from the same place as `useCommandRegistration`.
- Acceptance: with empty undo history, `edit.undo` is `enabled:false` and is filtered out of palette results (the palette already defaults `enabledOnly:true` via `search`).

### Step 3 — Single-source shortcut display (O3, I1)
- Remove hardcoded `shortcut` strings from built-in command definitions. Instead, at registration (or at palette render), look up the binding for each command id from the `@mog-sdk/contracts/keyboard` registry / `KeyboardCoordinator` and format it platform-aware.
- Where a command id and a keyboard shortcut id differ, introduce an explicit mapping rather than guessing.
- Acceptance: on macOS the palette shows ⌘-glyphs; renaming/removing a binding in the keyboard registry changes the palette without editing this folder.

### Step 4 — Surface execution outcome + guard concurrency (O4, I6)
- In `CommandPalette.executeCommand`, inspect the `CommandExecutionResult`; on `{success:false}` show a toast/error surface and emit a telemetry event; on success optionally emit a usage event (feeds Step 6 MRU).
- Add an in-flight guard in `CommandRegistryImpl.execute` (or the palette) so a command cannot be double-dispatched while its async handler is pending; reflect a pending state if needed.
- Acceptance: a handler that throws yields a visible error and a logged event; rapid double-Enter executes once.

### Step 5 — Real search index + cache (O5, I5)
- Implement the cache the doc already promises: build a search index lazily and invalidate it on `register`/`registerMany`/`unregister`/`clear`/`setEnabled`. Expose invalidation via an internal dirty flag.
- Replace or augment the scorer with a vetted fuzzy matcher (the contract names Fuse.js) **or** a hardened in-house scorer adding acronym/word-boundary matching and removing the `0.6` cap that flattens ranking. Decide via Q2.
- Keep stable tie-break (category, label).
- Acceptance: typing "ttc" surfaces "Text to Columns"; repeated identical queries don't re-score from scratch; ranking is deterministic.

### Step 6 — `recentCommands` MRU (O6)
- Implement MRU tracking (cap ~5–8) keyed off successful executions (Step 4 emits the signal). Persist to the existing `CommandPaletteState`/UIStore (`recentCommands` already exists in the contract).
- Surface a "Recently used" group at the top of the empty-query palette view in `CommandPalette.tsx`.
- Acceptance: executing a command moves it to the top of the recent list and it appears first on next open with empty query.

### Step 7 — Singleton / multi-instance hardening (O7, I3)
- Move `registeredCommandIds` off module scope: return the id list from `registerBuiltInCommands` and have `unregisterBuiltInCommands` take it (the caller — the hook — already has a natural place to hold it per-instance). Keep a backward-compatible overload that uses the last-registered set if no arg is passed, but log a dev warning so the unsafe global path is discouraged.
- Add a dev-only `console.warn` (gated on a debug flag) in `register`/`registerMany` when overwriting an existing id.
- Document that `commandRegistry` is a process-global singleton and is **not** safe to share across two independent spreadsheet instances; if multi-instance is a real requirement (Q3), introduce a factory `createCommandRegistry()` and provide the instance via context instead of a module global.
- Acceptance: mount/unmount/remount and two-instance scenarios don't leave dangling or cross-unregistered commands.

### Step 8 — Typed ids + category reconciliation + exhaustiveness (O8)
- Introduce a `BuiltInCommandId` union (or `const` map) so ids are not free strings; fix the `format.underlineType` inconsistency (rename with care — ids may be referenced elsewhere; grep first and update all refs, or keep id and only fix the variable).
- Decide `Navigation` vs `Selection` category for go-to/find-replace and align the `CommandActions` comment with the emitted category.
- Add a compile-time/test-time exhaustiveness check that every `CommandActions` key maps to exactly one command and vice-versa.

### Step 9 — Documentation truth-up
- Update the `command-registry.ts` header (which currently claims thread-safety and a non-existent cache) to describe the actual, now-correct behavior.

## Tests and verification gates

Per constraints, this plan does **not** run builds/tests; the following are the gates the implementing change must add and pass.

- **Unit — registry (`command-registry.test.ts`):** register/registerMany/unregister/clear; duplicate-id overwrite warns; `get`/`has`/`getByCategory`; `execute` success, failure (handler throws → `{success:false}`), and disabled-command refusal; `setEnabled` flips `search` visibility; in-flight guard.
- **Unit — search:** exact > prefix > substring > fuzzy ordering; acronym match ("ttc"); empty-query category/label sort; `limit`, `categories`, `enabledOnly` options; cache invalidation after registration mutations; deterministic tie-break.
- **Unit — built-in catalog:** all ids unique; every `CommandActions` key ↔ command exhaustiveness; only commands with present handlers are registered; no hardcoded shortcut strings remain (after Step 3).
- **Unit — lifecycle (`use-command-registration`):** late-arriving handler becomes registered; changed handler identity is the one executed (I4); unmount unregisters exactly this instance's ids (I3/Step 7).
- **Integration / app-eval scenario (`dev/app-eval`):** open palette (Ctrl/Cmd+Shift+P); empty query shows recents after a prior execution; typing filters; disabled command (e.g. Undo with empty history) is absent; executing a failing command surfaces an error toast; macOS run shows ⌘ glyphs. (Author as a new `.spec.ts`; do not modify existing scenarios.)
- **Gates:** `pnpm --filter @mog/spreadsheet typecheck` + the new unit tests green; targeted app-eval scenario green; no drift in the `@mog/types-commands` contract beyond additive members.

## Risks, edge cases, and non-goals

**Risks / edge cases:**
- Re-registering on every `actions` change (Step 1) could cause churn if the call site doesn't memoize — mitigate by requiring a memoized `actions` and/or diffing before re-register.
- Driving `enabled` (Step 2) adds store subscriptions; a too-broad subscription could cause re-render storms — keep enablement computation cheap and batched.
- Deriving shortcuts from the keyboard registry (Step 3) requires a reliable command-id↔shortcut-id mapping; missing mappings must degrade gracefully (show no shortcut, not a wrong one).
- Renaming `format.underlineType` (Step 8) is a potential breaking id change — must grep all consumers (persisted MRU, telemetry, tests) before renaming, or keep the id and only rename the local symbol.
- Swapping in a fuzzy library (Step 5) adds a dependency and bundle weight — weigh against a hardened in-house scorer; this folder is on a hot path (every keystroke).

**Non-goals:**
- Redesigning the Command Palette UI beyond the recents group and error feedback.
- Adding new user-facing commands/features (only correctness/quality of the existing catalog and registry).
- Changing the keyboard handling architecture (`KeyboardCoordinator`); this plan *consumes* it, not reworks it.
- Server/collab/multi-document command sync.

## Parallelization notes and dependencies on other folders

- **Independent / can start immediately:** Steps 5 (search+cache), 8 (typed ids/exhaustiveness), 9 (docs) are local to this folder.
- **Touches `apps/spreadsheet/src/hooks` (toolbar/keyboard):** Steps 1, 2, 3 depend on the contracts in `@mog-sdk/contracts/keyboard` and on store accessors (undo/redo, selection, clipboard, freeze, calc mode). Coordinate with the owners of `hooks/navigation` (keyboard) and `hooks/toolbar`.
- **Touches `apps/spreadsheet/src/dialogs/navigation/CommandPalette.tsx`:** Steps 4, 6 (error feedback, recents UI). The UIStore `recentCommands` field already exists, so no contract change needed there.
- **Contract folder `types/commands`:** only additive members if Steps 6/7 expose new registry methods (e.g. MRU accessor, `createCommandRegistry`). Treat as a public-contract change requiring `pnpm --filter @mog-sdk/contracts build` before consumers typecheck (see the contracts declaration-rollup gotcha).
- **Suggested sequencing:** land Step 1 (registration correctness) and Step 8 (typing) first as low-risk foundations, then Steps 5/9, then the cross-folder Steps 2/3/4/6, finally Step 7 hardening once multi-instance requirements (Q3) are confirmed.

### Open questions for design review
- **Q1:** Enablement via registry callback (`isEnabled(ctx)`) vs a dedicated `useCommandEnablement` hook driving `setEnabled`? (Plan recommends the hook.)
- **Q2:** Adopt Fuse.js (contract's own suggestion) vs harden the in-house scorer, given the per-keystroke hot path and bundle budget?
- **Q3:** Is multiple independent spreadsheet instances on one page a real requirement? If yes, replace the module-global singleton with a context-provided `createCommandRegistry()` instance (larger blast radius — affects `index.ts`, the hook, and the palette).
