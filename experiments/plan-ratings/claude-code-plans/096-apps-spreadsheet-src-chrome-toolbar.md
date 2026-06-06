# Plan 096 — Unify dispatch, close visibility drift, and de-duplicate the spreadsheet ribbon

## Source folder and scope

- **Folder:** `mog/apps/spreadsheet/src/chrome/toolbar`
- **Scope:** the ribbon command surface — `primitives/` (TabbedToolbar, RibbonButton,
  RibbonDropdown, SplitButton, ToolbarGroup, TabBar, collapse-aware rendering), `tabs/`
  (Home/Insert/PageLayout/Formulas/Data/Review/View/Help/TableDesign/Draw/etc.),
  `groups/` (Clipboard/Font/Alignment/Number/Styles/Cells/Editing/Arrange/PageSetup/…),
  `contextual/` (registry + `useContextualTabs`), `visibility/`
  (`RibbonVisibilityContext`), `collapse/`, `galleries/`, `backstage/`, `keytips/`,
  `shape-preview/`. ~119 files, ~28,400 LOC.
- **Adjacent code referenced but NOT owned by this plan** (coordinated follow-ups, not edited here):
  - `mog/apps/spreadsheet/src/actions/dispatcher.ts` — the central `dispatch()` and `HANDLER_MAP`.
  - `mog/apps/spreadsheet/src/hooks/toolbar/use-action-dependencies.ts` — `useActionDependencies` / `useDispatch`.
  - `mog/contracts/src/ribbon/visibility-config.ts` — canonical `RibbonVisibilityConfig`,
    `RIBBON_VISIBILITY_SCHEMA`, `isRibbonPathVisible`, `normalizeRibbonVisibilityKey`.
  - `mog/contracts/src/ribbon/*` collapse configs (e.g. `CLIPBOARD_COLLAPSE_CONFIG`).
  - `mog/apps/spreadsheet/src/ui-store/slices/ribbon.ts` — `RIBBON_BASE_TABS`, `selectVisibleRibbonTabs`, contextual tab id state.

## Current role of this folder in Mog

This folder is the **entire ribbon command surface** of the spreadsheet app: the tab
bar, all ribbon tabs and their groups/buttons/dropdowns/galleries, the backstage
(File) menu, contextual tabs for selected objects (charts, pictures, pivots, slicers,
sparklines, diagrams, tables), keytips (Alt-key access), and the content-aware
collapse/overflow system. It is the primary way users issue commands, and it is the
public-build rollout gate via the ribbon visibility config (`RIBBON_VISIBILITY.md`):
hiding a button keeps staged UI out of public builds while action handlers and
read-only policy still enforce whether a command may actually run.

The subsystem is mid-migration and carries three structural debts that are now load-bearing:

1. **Two competing command-dispatch mechanisms run in parallel.** The modern path is
   `useDispatch()` → `dispatch(actionId, deps, payload)` with a typed `ActionType`
   union and a central `HANDLER_MAP` (used by `HomeRibbon`, `ClipboardGroup`,
   `FontGroup`, `AlignmentGroup`, `DataRibbon`). The legacy path is callback-prop
   drilling: `TabbedToolbarProps` declares **~78 callback/state props**
   (`primitives/TabbedToolbar.tsx:82-207`) that are threaded down to `ViewRibbon`
   (20+ props, `tabs/ViewRibbon.tsx:356-454`) and `TableDesignRibbon` (16 props).
   Comments record that Home/Insert/PageLayout callbacks were removed from consumers
   but the props **remain in the interface**, so the surface is full of dead props
   that still type-check and invite re-coupling.

2. **The ribbon-visibility tree drifts silently from the rendered ribbon.** Visibility
   is resolved by string-path lookup against `RIBBON_VISIBILITY_SCHEMA`, with button
   keys resolved through a **5-level fallback chain**
   (`visibilityKey → testId → label → title → ariaLabel`,
   `visibility/RibbonVisibilityContext.tsx:103-117`) and on-the-fly
   `normalizeRibbonVisibilityKey()` of group/button labels. There is no compile-time or
   test-time check that rendered paths exist in the schema, so a renamed label or
   missing wrapper disables gating with no error.

3. **A concrete visibility-gating bug already exists.** Three contextual tabs are
   rendered **without** the `RibbonVisibilityTab` wrapper and are **missing from**
   the `contextualTabVisibilityKey` switch, so they bypass visibility gating in both
   layers (tab-bar filtering and in-tab group gating):
   - `chart-format` — `primitives/TabbedToolbar.tsx:599` renders `<ChartFormatRibbon />` bare; not in switch (`contextual/useContextualTabs.ts:190-209`).
   - `pivot-analyze` — `primitives/TabbedToolbar.tsx:632` bare; not in switch.
   - `pivot-design` — `primitives/TabbedToolbar.tsx:634` bare; not in switch.
   Every other contextual tab (`table-design`, `chart-design`, `picture-tools`,
   `slicer-tools`, `sparkline-tools`, `diagram-design`, `diagram-format`) is both
   wrapped and mapped. This is a rollout-control correctness defect: a profile that
   hides these surfaces will still show them.

Additional debt: heavy hand-coded JSX with repeated dropdown/state boilerplate
(`tabs/FormulasRibbon.tsx` is 1,638 LOC with ~42 `RibbonDropdown` instances, each with
its own `useState`/open-close wiring; `tabs/ViewRibbon.tsx` 1,208; `tabs/DataRibbon.tsx`
989); manually-registered keytips that can target stale `elementId`s; and two stray
artifacts in the source tree — `primitives/TabbedToolbar.tsx.bak` (26 KB) and
`primitives/icon-test.html`.

## Improvement objectives

1. **Single command-dispatch mechanism.** Finish migrating `ViewRibbon` and
   `TableDesignRibbon` to `useDispatch()` and delete the dead callback-prop surface
   from `TabbedToolbarProps`, so the ribbon has exactly one way to issue a command.
2. **Make the contextual-tab registry the single source of truth** for visibility key,
   accent, and component, eliminating the parallel `contextualTabVisibilityKey` switch
   and the hand-written render ladder in `TabbedToolbar` — which closes the
   chart-format / pivot drift bug structurally rather than by patching three lines.
3. **Make ribbon-visibility drift detectable**: explicit, typed visibility keys at the
   button/group level and a validation that every rendered ribbon path exists in
   `RIBBON_VISIBILITY_SCHEMA` (and vice-versa, that schema leaves correspond to real
   render sites).
4. **Cut ribbon-content boilerplate** with a shared dropdown-state primitive and a
   small declarative descriptor for menu-style groups, reducing the largest tab files
   and the per-dropdown `useState` sprawl.
5. **Tie keytip registration to button rendering** so keytips cannot target removed or
   renamed elements.
6. **Remove stray artifacts** (`TabbedToolbar.tsx.bak`, `icon-test.html`) from the
   production source tree.

## Production-path contracts and invariants to preserve or strengthen

- **Visibility ≠ authorization.** Hiding a button must never be the only thing
  preventing a command from running; action handlers and read-only policy remain the
  enforcement boundary (`RIBBON_VISIBILITY.md`). This plan does not move any
  authorization into the toolbar.
- **`RibbonVisibilityConfig` shape and `isRibbonPathVisible` semantics are canonical**
  (`contracts/src/ribbon/visibility-config.ts`): default-visible-when-omitted,
  `false` cascades to descendants, `true` overrides lower-priority profile defaults.
  Strengthen, do not change, these semantics. Profiles `public` / `app-eval` (alias
  `all`) and the merge order (named profile → JSON env override → explicit
  `FeatureGates.ribbonVisibility`) must be preserved exactly.
- **`dispatch(action, deps, payload)` contract and the `ActionType` union remain
  authoritative.** Migration adds call sites; it must not add new action strings that
  lack a `HANDLER_MAP` entry, and it must keep `deps` sourced from
  `useActionDependencies` (lazy `accessors`/`commands` getters that avoid
  render-time XState reads, `use-action-dependencies.ts:95-211`).
- **RibbonButton stays presentational.** It takes `onClick`/`onDoubleClick` and a
  `visibilityKey`; it must not import `dispatch`. The group/tab owns the
  handler→dispatch binding (`primitives/RibbonButton.tsx`).
- **Collapse is content-aware and must not regress.** The ResizeObserver observes a
  stable ancestor (not the content panel) with an 8px release hysteresis to avoid the
  documented tab-flicker feedback loop (`collapse/use-ribbon-collapse.ts:150-237`).
  Any descriptor/refactor must keep group `collapseConfig` honored and the
  `GroupRenderModeContext` contract intact.
- **Tab id vocabulary.** The kebab-case render ids (`table-design`, `chart-design`,
  `chart-format`, `pivot-analyze`, `pivot-design`, …) and their camelCase schema keys
  (`tableDesign`, `chartDesign`, …) must stay in a single mapping; auto-promotion of
  the first visible contextual tab when on `home` (`TabbedToolbar.tsx:415-422`) must be
  preserved.
- **Test-id and `aria-label` contracts** consumed by app-eval/api-eval must be kept
  stable; visibility-key changes must not silently rename test ids that scenarios rely
  on (see app-eval/ribbon scenarios).

## Concrete implementation plan

### Phase 0 — Hygiene (no behavior change)
- Delete `primitives/TabbedToolbar.tsx.bak` and `primitives/icon-test.html` from the
  source tree. Confirm via `rg` that nothing imports/references them.

### Phase 1 — Close the contextual-tab visibility drift structurally
1. Extend `ContextualTabConfig` (`contextual/contextual-tab-registry.ts:153-264`) with
   an explicit `visibilityKey: RibbonVisibilityTabKey | null` field per entry, and set
   it for **all** tabs including the three currently missing
   (`chart-format`, `pivot-analyze`, `pivot-design`). If those keys are not yet valid
   members of `RibbonVisibilityTabKey`, add the schema leaves in
   `contracts/src/ribbon/visibility-config.ts` first (coordinated change) so they are
   gateable; otherwise map them to their parent (`chartDesign`/the pivot tab key) and
   document that choice in the registry.
2. Delete `contextualTabVisibilityKey()` (`contextual/useContextualTabs.ts:190-209`)
   and read `tab.visibilityKey` directly in the `useMemo` filter
   (`useContextualTabs.ts:166-174`). The switch becoming impossible to forget is the
   fix.
3. Render contextual tabs from the registry in `TabbedToolbar` instead of the
   hand-written ladder (`primitives/TabbedToolbar.tsx:567-636`). Map
   `contextualTabConfigs` to `{id, component}` and render the active one wrapped in a
   single `<RibbonVisibilityTab tab={config.visibilityKey}>` for every contextual tab,
   so wrapping cannot be omitted per-tab. Wire the real component for each registry
   entry (currently the registry stores stub `() => null` components and the real
   components are imported separately into `TabbedToolbar`).

### Phase 2 — Collapse the dual dispatch surface
1. Migrate `ViewRibbon` (`tabs/ViewRibbon.tsx`) groups to `useDispatch()` for the
   actions that already have handlers (gridlines/headings/formula-bar/scrollbar
   toggles, zoom, freeze, split — several already carry “use `dispatch('TOGGLE_*')`”
   deprecation notes). For any control without a `HANDLER_MAP` entry, the action is
   added in `dispatcher.ts` as a coordinated follow-up (listed under Dependencies) —
   not faked with a local callback.
2. Migrate `TableDesignRibbon` the same way (16 props → dispatch + selection state via
   `useActionDependencies`/contextual hooks).
3. Once both consumers no longer read them, delete the now-dead callback/state props
   from `TabbedToolbarProps` (`primitives/TabbedToolbar.tsx:82-207`), keeping only
   genuinely external inputs the shell must still supply (e.g. undo-history dropdown
   data if it is owned outside the toolbar — verify ownership before removing). Update
   the single shell call site that constructs `<TabbedToolbar …/>` accordingly
   (out-of-folder, coordinated).
4. Result: `RibbonButton` handlers everywhere resolve to `dispatch(actionId, …)`; no
   tab receives command callbacks.

### Phase 3 — Make visibility keys explicit and drift detectable
1. Require an explicit `visibilityKey` on every `RibbonButton`/`ToolbarGroup` that is
   gateable, and **demote the label/title/aria fallback chain to a dev-only warning
   path** (`visibility/RibbonVisibilityContext.tsx:103-117`): if a button resolves its
   key via a fallback rather than an explicit `visibilityKey`, log a one-time dev
   warning. This keeps runtime behavior identical while surfacing every implicit
   coupling for follow-up.
2. Add a validation utility (pure function in `contracts/src/ribbon/` or the toolbar
   `visibility/`) that, given the rendered ribbon’s declared paths, asserts each path
   exists in `RIBBON_VISIBILITY_SCHEMA` and reports schema leaves with no render site.
   Drive it from a test (Phase “Tests”) rather than at runtime.
3. Add a “contextual tabs + automatic wrapping requirement” section to
   `RIBBON_VISIBILITY.md` documenting that contextual tabs are rendered from the
   registry and must declare a `visibilityKey`.

### Phase 4 — De-duplicate ribbon content
1. Introduce a `useRibbonDropdownState(id)` hook (in `primitives/` or `collapse/`)
   that wraps the repeated `useState`/`openRibbonDropdown`/`closeRibbonDropdown`
   pattern (e.g. `tabs/FormulasRibbon.tsx:705-749`). Adopt it across the ~42 dropdowns
   in `FormulasRibbon` and the dropdowns in `ViewRibbon`/`DataRibbon` to remove the
   parallel state declarations.
2. For purely menu-style groups (Function Library categories, paste menus), introduce a
   small **declarative descriptor** (`{ label, icon, items: MenuItem[] }`) rendered by
   a shared component, so adding a function category is data, not JSX. Keep the
   descriptor co-located with the tab; do not over-generalize into a framework. This
   targets the FormulasRibbon size specifically.
3. Keep complex/stateful controls (color pickers, border picker, galleries) as
   bespoke components — the descriptor is for menu lists only.

### Phase 5 — Keytip staleness
1. Replace per-tab `useEffect` keytip registration blocks (e.g.
   `FormulasRibbon` registration block) with registration co-located on the button —
   either a `keyTip` prop on `RibbonButton` that registers/unregisters with the
   button’s own `id`, or a small `useKeyTip(id, key)` hook called next to the button.
   This guarantees `elementId` matches a rendered element and auto-cleans on unmount
   (`keytips/keytip-registry.ts`). Keytip→action wiring stays in
   `keyboard/definitions/keytips-*.ts` (display-only registry invariant preserved).

## Tests and verification gates

> Per constraints, no build/test/typecheck commands are run while authoring this plan.
> The gates below are what the implementation PR must pass.

- **Unit (Jest/RTL) in `toolbar/`:**
  - Extend `visibility/RibbonVisibilityContext.test.tsx` with a **drift test**: render
    each tab (including all contextual tabs) and assert every declared visibility path
    exists in `RIBBON_VISIBILITY_SCHEMA`, and that `chart-format`/`pivot-analyze`/
    `pivot-design` are now gated (hidden under a config that hides their key, visible
    under `app-eval`). This test would fail today — it pins the bug fix.
  - New test for `useContextualTabs`: registry-driven `visibilityKey` filtering for all
    tabs; no missing entries (assert no tab resolves to an un-gateable key
    unintentionally).
  - `useRibbonDropdownState` behavior test (open/close, single-open coordination via
    UIStore).
  - Keytip test: every `RibbonButton` that declares a keytip registers an `elementId`
    that resolves to a rendered node; unmount unregisters.
  - Preserve existing `collapse/use-ribbon-collapse.test.ts`, `RibbonButton.test.tsx`,
    `RibbonDropdown.test.tsx`, `TabBar.test.tsx`, `RibbonLayoutTokens.test.ts`,
    `StylesGroup.test.ts`, `DataRibbon*.test.tsx`, `ViewRibbon-labels.test.ts`,
    `TableDesignRibbon.test.tsx` — they guard the migrated surfaces and must stay green.
- **app-eval (existing ribbon scenarios):** `dev/app-eval/scenarios/ribbon/*` and the
  collapse/visibility scenarios must pass with the `app-eval` (`all`) profile, proving
  the full internal surface still renders and test-ids/aria-labels are unchanged. Pay
  attention to the known harness gotchas: feature-gate URL leaks across scenarios and
  async overlay rendering for dropdowns (waitFor before readback).
- **Type gate:** `pnpm --filter @mog-sdk/contracts build` before consumers typecheck if
  `RibbonVisibilityTabKey` gains members; then app typecheck must pass with the dead
  `TabbedToolbarProps` props removed (compile errors at the shell call site are the
  signal that ownership was correctly reassigned).
- **Manual/eval smoke:** select a chart, picture, pivot, slicer, sparkline, diagram,
  and table; confirm the correct contextual tab auto-promotes from `home`, renders, and
  is correctly hidden under a `public` profile that gates it.

## Risks, edge cases, and non-goals

- **Risk — adding `RibbonVisibilityTabKey` members changes contracts.** Mitigate by
  doing the contracts change first, rebuilding declarations, and gating behind the
  existing profiles so `public` keeps current behavior unless a profile explicitly
  hides the now-gateable tabs.
- **Risk — removing `TabbedToolbarProps` props breaks the shell call site.** Mitigate
  by migrating consumers first (Phase 2.1–2.2), then removing props (2.3); the typecheck
  failure at the call site is the intended tripwire. Verify undo-history dropdown data
  ownership before removing those props.
- **Risk — dispatch migration exposes missing `HANDLER_MAP` entries.** Any View/Table
  control without a handler must get a real handler in `dispatcher.ts` (coordinated),
  not a local callback shim — this is the “no temporary workaround” constraint.
- **Risk — visibility-key tightening renames a key an app-eval scenario depends on.**
  Mitigate: keep `visibilityKey` values equal to today’s normalized result so resolved
  keys are unchanged; the change is making them explicit, not different. Snapshot the
  resolved key set in the drift test.
- **Edge — collapse interaction.** The dropdown-state hook and declarative menu
  descriptors must still render correctly in collapsed/dropdown render modes
  (`GroupRenderModeContext`); include a collapsed-mode case in the dropdown-state test.
- **Non-goals:** redesigning the visual ribbon, restyling tokens, changing the backstage
  panels’ behavior, altering `dispatch()`/`HANDLER_MAP` semantics, building a
  general-purpose ribbon DSL, or changing keytip→keyboard action bindings. Galleries,
  shape-preview geometry, and print preview are out of scope except where they consume
  the migrated primitives.

## Parallelization notes and dependencies on other folders

- **Independent, can start immediately:** Phase 0 (artifacts), Phase 1 (contextual
  registry + `TabbedToolbar` render ladder), Phase 4 (`useRibbonDropdownState` +
  descriptors), Phase 5 (keytips). These are folder-local.
- **Cross-folder dependencies (coordinate, do not edit blindly):**
  - `mog/contracts/src/ribbon/visibility-config.ts` — if `RibbonVisibilityTabKey` gains
    `chartFormat`/`pivotAnalyze`/`pivotDesign`; requires the contracts declaration
    rollup build before app typecheck.
  - `mog/apps/spreadsheet/src/actions/dispatcher.ts` — new `ActionType` handlers for any
    View/TableDesign control lacking one (Phase 2). Owned by the actions/dispatcher
    queue item.
  - `mog/apps/spreadsheet/src/hooks/toolbar/use-action-dependencies.ts` — relied on
    as-is; only changes if a migrated action needs a new dependency accessor.
  - The shell component that instantiates `<TabbedToolbar>` — must drop the removed
    callback props (Phase 2.3).
  - `mog/apps/spreadsheet/src/ui-store/slices/ribbon.ts` — contextual tab id state and
    `selectVisibleRibbonTabs`; verify the registry-driven render keeps the
    `setContextualTabIds` effect (`useContextualTabs.ts:182-185`) intact.
- **Sequencing:** Phase 2.3 (prop removal) depends on Phases 2.1–2.2 (consumer
  migration). Phase 3’s drift test depends on Phase 1 (registry visibility keys). Phase
  1’s new schema keys (if needed) block the contracts rebuild but nothing else.

---
*Status: actionable. The contextual-tab visibility gap (chart-format / pivot-analyze /
pivot-design bypassing gating) and the ~78-prop dead callback surface are verified
against current source; the rest is structural debt with concrete file:line evidence.*
