# 096 - Spreadsheet Toolbar Command Surface Improvement Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/apps/spreadsheet/src/chrome/toolbar`

Queue item: 96

Scope reviewed:

- `primitives/TabbedToolbar.tsx`, `TabBar.tsx`, `RibbonButton.tsx`, `SplitButton.tsx`, `ToolbarGroup.tsx`, `RibbonDropdown.tsx`, `CollapsedGroupDropdown.tsx`, `ToolbarContainer.tsx`, `RibbonCollapseToggle.tsx`, `RibbonDisplayOptions.tsx`, and `ToolbarStyles.ts`.
- Ribbon tabs under `tabs/`: Home, Insert, Page Layout, Formulas, Data, Review, View, Help, Table Design, Draw/Ink, format-object, and text-effects surfaces.
- Contextual tab framework under `contextual/`: registry, visibility hook, chart, picture, slicer, sparkline, diagram, and pivot contextual tools.
- Command groups under `groups/`: clipboard, font, alignment, number, styles, cells, editing, themes, page setup, scale to fit, sheet options, and arrange.
- Shared ribbon systems under `collapse/`, `visibility/`, `keytips/`, `galleries/`, `shape-preview/`, and `backstage/`.
- Adjacent production contracts and consumers: `contracts/src/ribbon/*`, `types/editor/src/actions/action-types.ts`, `apps/spreadsheet/src/ui-store/slices/ribbon/*`, `apps/spreadsheet/src/keyboard/definitions/ribbon.ts`, `keyboard/definitions/keytips-*.ts`, `actions/handlers/ui/keytip-handlers.ts`, and `hooks/toolbar/use-action-dependencies.ts`.

The folder exists and contains 119 files. This is public Mog source work in `mog`; this planning artifact remains private in `mog-internal`.

Out of scope for the implementation itself:

- Rewriting workbook, worksheet, grid, chart, pivot, drawing, or compute engines.
- Implementing every currently staged or visibility-hidden Excel command. The plan strengthens the command surface contract and production routing; missing product behavior should be represented explicitly instead of silently exposed.
- Moving public source code or tests into `mog-internal`.

## Current role of this folder in Mog

`chrome/toolbar` is the spreadsheet app's Excel-like command surface. It owns the visible ribbon tabs, contextual tabs, quick access command cluster, backstage/File surface, responsive ribbon collapse, command dropdowns, command galleries, shape previews, keytip badge display, and feature-gated ribbon visibility wrappers.

The production data flow is split across several layers:

- `TabbedToolbar` composes the tab strip, the active ribbon panel, keytip overlay, contextual tab discovery, visibility wrappers, and collapse provider.
- `TabBar` renders File, base/contextual tabs, undo/redo, collaboration, save, print, PDF, export, ribbon collapse, and display options. It also registers tab keytip badges.
- `RIBBON_BASE_TABS`, `activeRibbonTab`, `visibleBaseTabs`, and `contextualTabIds` live in the ribbon UI store slice. The slice validates active-tab writes against currently visible tabs.
- `useContextualTabs` derives visible contextual tabs from table, chart, object, slicer, sparkline, diagram, and pivot state, then pushes contextual tab ids into the UI store.
- `RibbonVisibilityContext` maps feature-gate visibility config paths onto tabs, groups, buttons, formula-bar controls, and collaboration chrome.
- `RibbonButton`, `SplitButton`, `ToolbarGroup`, `RibbonDropdown`, and `CollapsedGroupDropdown` are intended to be the local primitives for command buttons, split buttons, groups, menus, and collapse behavior.
- Toolbar groups generally dispatch through `useDispatch()` and the unified action system, with action dependencies collected by `useActionDependencies`.
- Keyboard execution for ribbon keytips lives in `keyboard/definitions/ribbon.ts` and `keyboard/definitions/keytips-*.ts`; `keyTipRegistry` is now display-only and feeds `KeyTipOverlay`.

Important strengths already present:

- Active ribbon tab membership is store-owned and validates gated/contextual tab activation.
- Collapse is centralized in `useRibbonCollapse` with content-aware overflow escalation and a stable ResizeObserver target.
- Visibility gating has a typed schema under `contracts/src/ribbon/visibility-config.ts`.
- Many groups are self-sufficient and no longer receive broad prop chains.
- Dropdown open state for many keytip-openable menus is centralized in the `ribbonDropdowns` slice.
- Tests already cover some primitive behavior, visibility gating, collapse breakpoints, table design rendering, data import, macro removal, and keyboard chord coordination.

Main architectural weakness:

The toolbar command surface is still maintained as parallel hand-written registries. Tab ids, visibility keys, collapse configs, command ids, keytips, dropdown ids, action names, test ids, contextual predicates, and rendered components are repeated across React components, contracts, UI store slices, keyboard definitions, and docs. That makes drift likely and leaves some drift visible in the current snapshot:

- `TabbedToolbar` declares a local `TabId` union that mirrors `RibbonTabId` instead of using one typed source.
- `CONTEXTUAL_TAB_REGISTRY` documents keytips for picture, slicer, sparkline, and diagram contextual tabs, but `TabBar.TAB_KEYTIP_MAP` and `RIBBON_SHORTCUTS` do not cover those tabs.
- `TableDesignRibbon` registers command-level display keytips under `tabId: 'tableDesign'` while the active tab id is `'table-design'`, so display filtering can miss those command badges.
- `chart-format`, `pivot-analyze`, and `pivot-design` render without `RibbonVisibilityTab` wrappers and are absent from the visibility schema as distinct contextual tab roots.
- `useContextualTabs.contextualTabVisibilityKey()` has no visibility key for `chart-format`, `pivot-analyze`, or `pivot-design`.
- Some command menus still use generic `DropdownMenu` or custom raw buttons instead of the ribbon dropdown/menu primitive path.
- Some command groups rely on normalized labels or `data-testid` fallbacks for visibility keys instead of explicit command ids.
- Staged or disabled controls are mixed into components without a complete manifest that explains whether they are public, app-eval only, hidden, disabled by capability, unsupported, or fully implemented.

## Improvement objectives

1. Make the ribbon an explicit command-surface contract rather than a set of parallel React, keyboard, visibility, and test registries.
2. Use one typed source for tab ids, contextual tab ids, tab labels, visibility roots, group ids, command ids, dropdown ids, keytips, collapse config ids, action names, and stable test ids.
3. Eliminate id drift between kebab-case tab ids, camelCase visibility keys, display-only keytip registration, keyboard shortcut definitions, UI store active-tab validation, and rendered DOM ids.
4. Complete contextual tab contracts for chart format, picture tools, slicer tools, sparkline tools, diagram tools, and pivot tools, including visibility roots, keytip tab switches, command badges, active-tab repair, and render wrappers.
5. Make every visible command declare one of these dispositions: implemented action, host-owned action, disabled because capability/selection/protection forbids it, or intentionally hidden by profile.
6. Route all executable ribbon commands through the unified action system or an explicit host-command bridge, not local ad hoc state mutation.
7. Preserve render isolation: selection churn, drag, fill handle, scroll, object movement, and remote-collab updates must not re-render the whole toolbar unless the visible command state actually changes.
8. Strengthen dropdown, split-button, and gallery behavior so mouse, keyboard, keytips, focus, escape, click-outside, visibility gating, and collapsed-group rendering all share the same production path.
9. Make responsive collapse verifiable per tab and per profile, with no clipping, layout feedback loops, missing dropdown icons, or hidden essential commands at supported widths.
10. Add contract tests and browser app-eval gates that exercise the real UI input paths for tab switching, keytips, command execution, dropdowns, contextual tabs, visibility profiles, read-only/sheet-protected states, and collapse widths.

## Production-path contracts and invariants to preserve or strengthen

- `RibbonTabId` remains the action and UI-store identifier for active ribbon tabs. `file` is not a ribbon tab; File opens backstage directly.
- The active tab must always be in `selectVisibleRibbonTabs(state)`. Contextual tab updates that invalidate the active tab must repair state atomically in the UI store, not through chained React effects.
- Base tab visibility is controlled by feature gates and `RibbonVisibilityConfig`; contextual tab visibility is controlled by selection/object state plus the same visibility config.
- Visibility config hides UI only. Authorization and read-only policy remain enforced by action handlers, workbook APIs, host-command ownership, and protection permission hooks.
- Keytip execution is owned by the keyboard coordinator and typed keyboard definitions. `keyTipRegistry` remains display-only and must not carry executable closures.
- Display keytips, keyboard shortcut definitions, and rendered DOM targets must be isomorphic: no executable keytip without a visible command target when the command is visible, and no visible keytip badge without a runnable or intentionally disabled command disposition.
- All toolbar writes that mutate document state go through `dispatch(action, deps, payload)` or a typed host-command request. UI-only writes such as opening a controlled dropdown may use the UI store slice if the same action path exists for keytips.
- Toolbar components must not subscribe to raw full selection state when a derived boolean or command-state selector can be maintained by coordinators.
- `useRibbonCollapse` remains the single collapse coordinator. Components consume collapse level; they do not create independent width observers or local collapse breakpoints.
- Collapse escalation remains monotonic and bounded for a content change. It must not observe the ribbon content panel in a way that recreates ResizeObserver feedback loops.
- A group whose collapse config can render as `dropdown` must have a dropdown icon and accessible label. The collapsed dropdown must preserve the same command semantics and visibility gating as the expanded group.
- `RibbonButton` and `SplitButton` are the normal command button primitives. Raw buttons inside toolbar chrome are allowed only for primitive internals, non-command picker cells, backstage document panels, or explicitly justified surfaces with equivalent aria/test/visibility contracts.
- All command controls must have stable accessible names, disabled state, focus ring behavior, and test selectors derived from command ids.
- Read-only mode, sheet protection, selection state, object selection, host capability gates, and public/app-eval visibility profiles must be reflected in both button disabled state and handler behavior.
- Backstage, save, print, export, PDF export, collaboration, and display options remain part of the command chrome contract even though some are rendered in the tab bar rather than inside a ribbon tab.
- Public source folders must not depend on `mog-internal`, and internal planning text must not leak into public docs or public packages.

## Concrete implementation plan

1. Add a typed ribbon command-surface manifest.

   Create a pure data contract, likely split between `contracts/src/ribbon` and `apps/spreadsheet/src/chrome/toolbar`, so non-React ids live in contracts and React renderers stay in the app. The manifest should model:

   - base tabs and contextual tabs
   - tab label, tab id, visibility root, keytip sequence, group label, contextual group, and accent token
   - groups with group id, visibility path, collapse config id, priority, and optional dialog launcher command
   - commands with command id, label, aria label, icon key, keytip sequence, action name and payload factory, dropdown id, visibility path, capability/protection selectors, disabled reason, test id, and public/app-eval support status
   - dropdowns and galleries with typed ids, owning command, menu item ids, keyboard behavior, and close policy
   - non-ribbon chrome commands such as File, undo, redo, save, print, PDF export, XLSX export, collaborate, ribbon collapse, and ribbon display options

   Use `satisfies` and exhaustiveness checks so adding a tab, contextual family, dropdown id, or visibility root breaks compile-time checks until all projections are updated.

2. Generate or verify all existing projections from the manifest.

   Replace hand-maintained parallel lists with manifest projections where feasible:

   - `RIBBON_BASE_TABS`
   - contextual tab registry metadata
   - tab keytip map
   - `RIBBON_SHORTCUTS`
   - `RibbonDropdownId`
   - visibility schema roots, groups, and commands
   - collapse config coverage by group
   - stable DOM ids and `data-testid` values
   - command-level display keytip registrations

   Where direct generation is too much for one patch, add production-compiled verifier tests that assert exact set equality. Do not keep undocumented drift as a compatibility layer.

3. Normalize tab ids and contextual tab rendering.

   Remove `TabbedToolbar`'s local `TabId` union and consume `RibbonTabId` plus a typed render registry. Make the render branch data-driven enough that every visible tab id has exactly one renderer and one visibility wrapper.

   Specific fixes to include:

   - Use `'table-design'` consistently for active tab ids and command-level display keytip `tabId` values.
   - Add explicit visibility roots for `chartFormat`, `pivotAnalyze`, and `pivotDesign`, or deliberately merge them into documented roots if the product wants one root per contextual family. The renderer and visibility schema must agree.
   - Wrap `ChartFormatRibbon`, `PivotAnalyzeRibbon`, and `PivotDesignRibbon` in `RibbonVisibilityTab`.
   - Add `contextualTabVisibilityKey` mappings for every contextual tab in `CONTEXTUAL_TAB_REGISTRY`.
   - Add tab-switch keytips and typed keyboard definitions for picture, slicer, sparkline, and diagram contextual tabs if they are meant to be accessible from the ribbon.
   - Define deterministic behavior when multiple contextual families are visible at once: order, group labels, active-tab auto-promotion, and fallback when the selected object/table disappears.

4. Turn keytips into a verifiable command contract.

   Move command-level keytip registrations out of per-component effects where possible and into a manifest-driven hook that registers currently rendered commands with the display registry. If some commands still need local registration because their DOM target is conditional, wrap registration in a typed helper that requires a `RibbonCommandId`.

   Add tests that prove:

   - every visible tab keytip in `TabBar` has a matching keyboard shortcut entry
   - every `OPEN_RIBBON_DROPDOWN` shortcut uses a `RibbonDropdownId` whose owner command is rendered in that tab
   - every command-level display keytip uses the canonical active tab id
   - multi-key sequences with shared prefixes resolve longest-match behavior correctly
   - hidden visibility-profile commands do not render badges or execute through keytip paths
   - disabled commands may show badges only if activation routes to the same disabled/no-op user feedback as mouse activation

5. Unify dropdown and menu primitives.

   Convert remaining command menus that use generic `DropdownMenu` or bespoke panels into `RibbonDropdown` or a deliberate extension of it, unless the surface is a non-command picker grid. Every keytip-openable dropdown must be controlled by the `ribbonDropdowns` slice and a typed `RibbonDropdownId`.

   Strengthen menu behavior:

   - one open/close path for mouse, keyboard, escape, click outside, tab switch, profile change, and collapsed group unmount
   - roving keyboard behavior for menu items and nested submenus
   - stable `role`, `aria-label`, `aria-expanded`, `data-testid`, and `data-value`
   - focus restoration to the trigger or grid according to command type
   - no orphaned popovers after the owning tab or contextual object disappears

6. Tighten command primitive usage and visibility keys.

   Add a command primitive contract so `RibbonButton`, `SplitButton`, and command-like gallery triggers receive an explicit command id or visibility key instead of relying on label/test-id normalization. Keep normalization as a schema helper only where it is intentionally used for backwards-compatible profile authoring, not as the normal source of truth for new commands.

   Add static tests or lint-like AST tests for:

   - raw `<button>` command controls outside approved primitive internals and picker/backstage exceptions
   - missing `visibilityKey` or command id for command buttons
   - missing accessible name or test id
   - `ToolbarGroup` labels whose normalized keys do not match manifest group ids
   - groups with dropdown collapse mode but no `dropdownIcon`

7. Make command execution and enablement systematic.

   For every command in the manifest, declare its execution owner:

   - unified action system
   - host command bridge
   - local UI state only, for dropdown/display commands
   - intentionally disabled or intentionally hidden

   Then remove local fallback `() => {}` handlers for commands that should be required. If a command requires a table id, chart id, selected object id, active sheet id, permission, or host owner, the enabled selector should make that explicit and the handler should still fail closed if state changes before execution.

   Data import, table tools, chart tools, pivot tools, picture tools, page setup, formula auditing, and backstage commands should each get a small contract inventory: visible command, action payload, disabled state, handler, expected user feedback, and app-eval scenario.

8. Reconcile staged, public, and app-eval surfaces.

   Use the visibility manifest to classify controls as public, app-eval, all, hidden, or unsupported. Staged controls should not appear as active public commands merely because they are present in TSX.

   Specific surfaces to audit:

   - Insert illustrations, sparklines, filters, and text controls hidden in the public profile
   - Data queries/connections and forecast controls
   - View macro controls that tests already assert are absent
   - Draw/Ink and `TabbedToolbar.tsx.bak`
   - chart format, pivot analyze/design, diagram design/format, slicer tools, and sparkline tools
   - backstage browse/open/save/export/print/share panels

   Delete obsolete backup or abandoned code only as part of an implementation workstream where tests prove it is not imported. Do not keep dead command surfaces as undocumented alternates.

9. Strengthen contextual-state ownership.

   Keep contextual visibility based on derived coordinator/UI-store state, not broad selection subscriptions in the toolbar. For each contextual family, document and test the producer:

   - table selection
   - chart selection
   - floating object type selection
   - slicer selection
   - active-cell sparkline presence
   - diagram selection
   - pivot selection

   Add a contextual tab invariant test that changes each producer from absent to present to absent and asserts visible tabs, active tab, keytip badges, renderer, and visibility profile behavior in one transition family.

10. Make collapse coverage tab-aware and command-aware.

   Extend collapse tests beyond breakpoint arithmetic. For each tab and contextual tab:

   - render at representative widths for levels 0 through 4
   - assert no horizontal clipping of `panel-ribbon`
   - assert essential high-priority commands stay reachable
   - assert collapsed groups open dropdowns with their visible commands
   - assert hidden groups are intentionally hidden by collapse config
   - assert text labels do not overflow fixed button dimensions

   Keep the current stable-ancestor ResizeObserver design. Any future content measurement should remain bounded and should not observe elements whose size changes as a result of the collapse level.

11. Bring backstage and tab-bar commands under the same surface contract.

   Treat File/backstage, undo/redo, save, print, PDF export, XLSX export, collaborate, avatar visibility, ribbon collapse, and ribbon display options as command surface entries. They need the same visibility, capability, aria, keytip, test id, host ownership, and app-eval treatment as ribbon-panel commands.

   This should preserve File as a backstage trigger, not a tab. `Alt+F` continues to dispatch `OPEN_BACKSTAGE` directly.

12. Add a toolbar command-surface audit report for implementation tracking.

   Build a test-backed inventory, not a static doc, that reports:

   - all tabs and contextual tabs
   - all groups by tab
   - all commands by group
   - visibility path
   - keytip sequence
   - dropdown id
   - action owner
   - disabled/hidden disposition
   - rendered test id
   - current unit and app-eval coverage

   The report can be generated in CI or snapshot-tested. It should make "one missing command in a category" visible as a full category gap.

## Tests and verification gates

Required gates for the implementation workstream:

- `pnpm --filter @mog/app-spreadsheet test -- src/chrome/toolbar`
- `pnpm --filter @mog/app-spreadsheet test -- src/ui-store/slices/ribbon src/keyboard/definitions src/systems/input/keyboard`
- `pnpm --filter @mog/app-spreadsheet typecheck`
- repo-level `pnpm typecheck` if `@mog-sdk/contracts`, `@mog-sdk/types-editor`, action payloads, keyboard definitions, or public declaration surfaces change

Add focused contract/unit tests:

- Manifest projection set equality for tab ids, contextual tab ids, visibility roots, group ids, command ids, dropdown ids, and keytip sequences.
- `RIBBON_BASE_TABS` and `RibbonTabId` exhaustiveness: no local tab union drift.
- Contextual visibility coverage for table, chart design, chart format, picture tools, slicer tools, sparkline tools, diagram design, diagram format, pivot analyze, and pivot design.
- `TableDesignRibbon` display keytips use `'table-design'` and appear after `Alt+J,T`.
- Every tab-level keytip has a matching typed shortcut and rendered target.
- Every command-level keytip has a rendered target, canonical tab id, and matching keyboard action or explicit disabled disposition.
- Every `RibbonDropdownId` has exactly one owner command and every keytip-openable dropdown is controlled by `ribbonDropdowns`.
- `RibbonVisibilityConfig` hides tabs, groups, commands, contextual tabs, formula-bar controls, and collaboration chrome through the same path semantics.
- Raw command button audit with approved exceptions for primitive internals, picker cells, backstage panels, and other documented non-ribbon command contexts.
- Collapse config completeness: every group has a config or an explicit "never collapses" disposition; dropdown-capable groups have icons.
- Disabled/read-only/protected states for core formatting, clipboard, table, data, insert, page setup, and object commands.

Add production-path app-eval/E2E scenarios using real UI input:

- Mouse tab switching across Home, Insert, Page Layout, Formulas, Data, Review, View, Help, and File/backstage.
- Alt-tap and Alt+letter tab switching across all base tabs.
- Contextual tab creation/removal via real table selection, chart selection, picture/shape selection, slicer selection, sparkline active cell, diagram selection, and pivot selection.
- Contextual keytips: table design, chart design, chart format, picture tools, slicer tools, sparkline tools, diagram tools, and pivot tools.
- Command dropdowns opened by mouse and keytips: paste, merge, orientation, cells insert/delete/format, conditional formatting, cell styles, insert shapes, sparklines, formulas function categories, data get-data, page setup menus, freeze panes, appearance, and table style gallery.
- Visibility profiles: public profile hides staged controls; app-eval/all profiles expose intended controls; hidden commands cannot be triggered by keytips.
- Responsive widths: desktop, laptop, tablet, narrow/mobile, and zoomed browser widths with screenshot assertions for no clipped ribbon panel and reachable collapsed groups.
- Read-only and sheet-protected workbooks: commands are disabled in UI and rejected by handlers when invoked through keyboard/keytips.
- Backstage commands: File, open, save, save as, export, print, print preview, share, and return-to-workbook focus behavior.
- Import controls: CSV/JSON/Web data import via real file picker/host-command paths where feasible, preserving user activation constraints.

Verification must include browser exercise for UI changes. Unit tests can assert contracts, but E2E proof must drive the same keyboard, mouse, file, and dropdown paths a user uses.

## Risks, edge cases, and non-goals

Risks and edge cases:

- Id migration can break keyboard routing or visibility profiles if kebab-case tab ids and camelCase visibility keys are not bridged deliberately through typed mappings.
- Contextual tabs can overlap. A table cell in a pivot-backed sheet, a selected chart, or a selected object may expose multiple contextual families; ordering and auto-promotion need deterministic policy.
- Visibility config is not authorization. Hidden commands must still be rejected by action/protection policy if invoked through another path.
- Keytip sequences share prefixes. `Alt+H,S` versus `Alt+H,S,O`, and `Alt+J,T` versus `Alt+J,T,S`, must preserve longest-match behavior.
- Dropdowns opened from collapsed groups can unmount when width, tab, or contextual selection changes. Open-state cleanup must be explicit.
- Browser user activation affects file import, clipboard, print, and export flows. Abstractions must not insert asynchronous gaps before activation-sensitive calls.
- ResizeObserver and content measurement are sensitive to feedback loops. Collapse improvements must preserve the stable ancestor observer.
- Some staged controls are intentionally hidden. The correct contract is "not public yet" rather than a fake no-op implementation.
- Generated or manifest-driven command code can become too generic if it tries to encode component layout. Keep command identity/data in the manifest and layout/rendering in toolbar components.
- Accessibility regressions are easy when moving raw buttons into primitives. Preserve aria labels, `role="tab"`, `aria-selected`, `aria-expanded`, `aria-haspopup`, disabled semantics, and focus-visible styles.

Non-goals:

- Do not implement unsupported spreadsheet features solely to satisfy visible button inventory.
- Do not introduce compatibility shims for old tab ids or dropdown ids after the production paths are migrated.
- Do not optimize benchmark-only or test-only toolbar paths.
- Do not bypass the unified action system to make E2E scenarios pass.
- Do not move durable workbook, selection, table, chart, pivot, or object state into the toolbar.
- Do not make `mog` depend on `mog-internal`.

## Parallelization notes and dependencies on other folders, if any

This work should be split across parallel agents with explicit contracts:

- Contract agent: define the ribbon command-surface manifest, typed id unions, projection helpers, and visibility/dropdown/keytip exhaustiveness tests in `contracts/src/ribbon`, `types/editor/src/actions`, and toolbar manifest modules.
- Toolbar integration agent: migrate `TabbedToolbar`, `TabBar`, `ToolbarGroup`, `RibbonButton`, `SplitButton`, contextual renderers, and tab-bar command chrome to consume the manifest.
- Keyboard/keytip agent: reconcile `RIBBON_SHORTCUTS`, `keytips-*.ts`, display keytip registration, canonical tab ids, and keyboard coordinator tests.
- Dropdown/collapse agent: unify remaining command menus, controlled open-state, collapsed-group dropdown behavior, focus/escape/click-outside behavior, and collapse width coverage.
- Command enablement agent: inventory executable actions, host-command bridges, disabled states, protection/read-only selectors, and handler fail-closed behavior across Home, Insert, Data, Page Layout, Formulas, View, contextual tabs, and backstage.
- Verification agent: add contract tests, app-eval scenarios, Playwright/browser coverage, and screenshot/DOM assertions for visibility profiles and responsive widths.

Dependencies outside this folder:

- `@mog-sdk/contracts/ribbon` for collapse, visibility, and new command-surface ids.
- `@mog-sdk/contracts/actions` and `@mog-sdk/types-editor/actions` for `RibbonTabId`, `RibbonDropdownId`, action payloads, and shortcut action args.
- `apps/spreadsheet/src/ui-store/slices/ribbon` for active-tab, contextual-tab, dropdown, backstage, and display-mode state.
- `apps/spreadsheet/src/keyboard/definitions` and `systems/input/keyboard` for keytip execution.
- `apps/spreadsheet/src/actions/handlers` for command execution and fail-closed behavior.
- `apps/spreadsheet/src/hooks/selection`, `hooks/charts`, `hooks/objects`, `hooks/data`, and coordinator modules for contextual state producers.
- `@mog/shell` popover/dropdown primitives for menu positioning, dismissal, and focus behavior.

The first integration milestone should be contract-only and verifier-only: land the manifest plus tests that prove current drift. Then migrate one tab family at a time, with Home and Table Design as the reference implementations before expanding to the rest of the ribbon and backstage.
