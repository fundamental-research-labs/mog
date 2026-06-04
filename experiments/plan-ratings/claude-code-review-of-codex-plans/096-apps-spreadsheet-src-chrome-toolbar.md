Rating: 8/10

# Review of Plan 096 — Spreadsheet Toolbar Command Surface

Source folder: `mog/apps/spreadsheet/src/chrome/toolbar`
Plan: `mog-internal/plans/active/experiments/plan-ratings/codex-plans/096-apps-spreadsheet-src-chrome-toolbar.md`

## Summary judgment

This is a strong, evidence-grounded plan. Its central thesis — that the ribbon is currently maintained as several hand-written parallel registries (React renderers, contracts, UI-store slices, keyboard definitions, visibility schema, tests) and that this duplication produces real, observable drift — is correct, and the specific drift instances it cites are verifiable in the tree right now. The proposed remedy (one typed command-surface manifest projected into every consumer, plus exhaustiveness/set-equality tests that fail when projections diverge) is the architecturally right shape for this problem. The invariants section is unusually disciplined: it correctly separates UI visibility from authorization, keeps `keyTipRegistry` display-only, routes execution through the unified action system, and preserves the single `useRibbonCollapse` coordinator. The verification section pairs contract/unit gates with real-input app-eval coverage, which matches how this folder is actually tested.

The plan's main weakness is scope discipline rather than correctness. It reads closer to a multi-quarter charter than a single bounded change, and the concrete acceptance criteria for the first shippable increment are softer than the diagnosis. A few component names in the implementation steps don't match the files on disk.

## Verification of claims (spot-checked against source)

Every drift claim I checked is accurate:

- `TabbedToolbar.tsx:58` declares a local `type TabId` union (home/insert/draw/page/.../diagram-format) that mirrors `RibbonTabId` (`types/editor/src/actions/action-types.ts:43`). Confirmed parallel source of truth.
- `TableDesignRibbon.tsx` registers command keytips under `tabId: 'tableDesign'` (lines ~355–363) while dropdown/active-tab ids use `'table-design'` (lines 290, 297–298). Confirmed id mismatch.
- `useContextualTabs.ts` `contextualTabVisibilityKey()` (line 190) has cases for table-design, chart-design, picture-tools, slicer-tools, sparkline-tools, diagram-design, diagram-format — and **no** case for `chart-format`, `pivot-analyze`, or `pivot-design` (returns `null`). Confirmed.
- `contracts/src/ribbon/visibility-config.ts` defines `chartDesign` but **not** `chartFormat`, `pivotAnalyze`, or `pivotDesign` roots. Confirmed.
- The contextual registry (`contextual-tab-registry.ts`) lists `chart-format`, `pivot-analyze`, `pivot-design` as tab ids, so the missing visibility keys/roots above are genuine gaps, not non-existent surfaces. Confirmed.
- `primitives/TabbedToolbar.tsx.bak` exists. Confirmed.

This level of accuracy materially raises confidence in the rest of the diagnosis.

## Major strengths

- **Diagnosis is real and checkable.** The plan does not hand-wave; the cited drift exists. That makes the manifest justification concrete rather than aspirational.
- **Correct production-path framing.** Visibility-config-hides-only-UI, authorization-stays-in-handlers, keytips-are-display-only, action-system-for-execution, single-collapse-coordinator — these are the right invariants and they match the code.
- **Test strategy fits the failure mode.** Set-equality/exhaustiveness tests are exactly the mechanism that catches the kind of drift the plan documents, and the app-eval scenarios drive real keyboard/mouse/file paths rather than asserting internal state.
- **Sequencing has a credible entry point.** "First milestone is contract-only + verifier-only: land the manifest plus tests that prove current drift, then migrate one tab family at a time (Home and Table Design as references)." That is the right de-risking order — prove the drift in CI before touching renderers.
- **Risks section is substantive**, not boilerplate: kebab/camel id bridging, contextual-tab overlap ordering, keytip longest-match prefixes (`Alt+H,S` vs `Alt+H,S,O`), collapsed-group popover cleanup on unmount, user-activation gaps for file/clipboard/print, ResizeObserver feedback loops, and over-generic manifest encoding layout. These are the actual sharp edges.

## Major gaps or risks

- **Scope is very large and only loosely bounded.** Twelve implementation workstreams touching contracts, app renderers, keyboard, ui-store, and tests, across 119 files and six parallel agents. The "manifest unifies everything" framing risks an open-ended refactor. The per-tab-family milestone helps, but the plan never states a cut-line: what ships if only Home + Table Design land, and what is explicitly deferred.
- **Milestone-1 acceptance is fuzzier than the diagnosis.** "Land manifest + tests that prove current drift" is the right idea but underspecified. It should name the exact projections asserted equal in PR 1 (e.g., `RIBBON_BASE_TABS` ↔ `RibbonTabId`, registry tab ids ↔ `contextualTabVisibilityKey` keys ↔ visibility-config roots) and which of today's drifts the first PR is allowed to leave as a documented, test-quarantined failure vs. must-fix.
- **Component-name mismatches with the tree.** Step 3 says to wrap `ChartFormatRibbon`, `PivotAnalyzeRibbon`, and `PivotDesignRibbon` in `RibbonVisibilityTab`. On disk, contextual renderers are `ChartFormatRibbon.tsx`, `ChartToolsRibbon.tsx`, and a single `PivotToolsRibbon.tsx` (no separate Analyze/Design files). The plan should reconcile whether pivot is one renderer with two tab ids or two renderers, because that decision changes the wrapper work. Minor, but it signals the renderer layer was inspected less closely than the contracts/ids layer.
- **"Some" without an inventory.** The plan repeatedly says "some command menus still use generic `DropdownMenu`" and "some groups rely on normalized labels" without enumerating which. Since the plan explicitly wants to kill normalization-as-source-of-truth and unify menus, the executor has to rediscover the list. A concrete file/menu inventory (even partial) would convert rediscovery cost into checkable scope.
- **No effort/size signal.** Given the breadth, the plan would benefit from a rough ordering of which workstreams are mandatory for correctness vs. which are quality/coverage, so it can be time-boxed without losing the core fix.

## Contract and verification assessment

The contract direction is sound and the gates are appropriate. `RibbonTabId` is correctly identified as the canonical tab identifier and `file`-is-not-a-tab is preserved (`Alt+F` → `OPEN_BACKSTAGE`). The exhaustiveness + set-equality approach is the correct enforcement mechanism for the documented drift, and the app-eval list covers the real input surfaces (mouse tab switch, Alt-tap/Alt-letter, contextual creation via real selection, keytip dropdowns, visibility profiles, read-only/protection, responsive widths, backstage, import via host-command paths).

Two improvements would tighten it:
1. **Name the precise equalities for PR 1** rather than "set equality for tab ids, contextual tab ids, visibility roots, group ids, command ids, dropdown ids, keytip sequences" as one bundle. Each pair is a discrete test; listing them makes the first PR self-defining.
2. **State a disposition for the existing drift under test.** When the verifier tests land before the migration, today's mismatches (`tableDesign`/`table-design`, missing pivot/chart-format keys) will fail. The plan should say whether PR 1 fixes those inline or marks them as known-failing with a tracking note, so CI is green-by-design.

The verification gates themselves (`pnpm --filter @mog/app-spreadsheet test`, `typecheck`, repo-level `pnpm typecheck` when contracts/types-editor change) are correct and the contracts-build dependency for declaration rollup is implicitly respected.

## Concrete changes that would raise the rating

1. Add a **PR-1 definition of done**: the exact manifest modules created, the exact projection equalities asserted, and the disposition (fix-now vs. quarantine) for each currently-failing drift. This alone would move it toward 9.
2. Reconcile the **pivot/chart contextual renderer names** with the tree (`PivotToolsRibbon.tsx`, `ChartToolsRibbon.tsx`) and decide one-renderer-two-tab-ids vs. split, since step 3's wrapping work depends on it.
3. Replace "**some menus / some groups**" with a concrete inventory (or an explicit "discovery task produces this list before migration") so dropdown unification and visibility-key cleanup have a bounded target.
4. Add a **cut-line / priority ordering** across the twelve workstreams: which are correctness-mandatory (id normalization, missing visibility roots, keytip canonical tab id) vs. coverage/quality (audit report, full responsive-width matrix), so the plan can be time-boxed without abandoning its core.
5. Specify the **multi-contextual-tab ordering policy** as a concrete rule (priority list + active-tab promotion + fallback) rather than "needs deterministic policy," since the plan correctly flags this as a risk but leaves the resolution open.
