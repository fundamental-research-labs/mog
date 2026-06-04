Rating: 9/10

# Review of Plan 096 — `mog/apps/spreadsheet/src/chrome/toolbar`


## Summary judgment

This is a strong, evidence-grounded plan. It targets three real, verifiable structural
debts in the ribbon command surface — dual dispatch mechanisms, silent visibility drift,
and a concrete contextual-tab gating bug — and proposes to fix the bug *structurally*
(make the registry the single source of truth) rather than by patching three lines. Every
load-bearing factual claim I spot-checked against the source holds, the phasing respects
dependencies, contracts to preserve are named precisely, and the verification gates
include a test that would fail today (pinning the bug). The deductions are for the one
genuinely under-specified mechanism (the drift-validation utility), a soft acceptance bar
on the boilerplate-reduction phase, and a sequencing dependency on out-of-folder handler
work that could stall prop removal.

## Verification of factual claims

I confirmed the plan's evidence against the working tree:

- **Stray artifacts exist:** `primitives/TabbedToolbar.tsx.bak` (26 KB) and
  `primitives/icon-test.html` are both present. ✓
- **Contextual-tab gating bug is real:** `TabbedToolbar.tsx:599/632/634` render
  `<ChartFormatRibbon />`, `<PivotAnalyzeRibbon />`, `<PivotDesignRibbon />` bare under
  `activeTab === …` guards, while every other contextual tab is wrapped in
  `<RibbonVisibilityTab tab=…>`. The `contextualTabVisibilityKey()` switch
  (`useContextualTabs.ts:190-209`) has cases for `table-design`, `chart-design`,
  `picture-tools`, `slicer-tools`, `sparkline-tools`, `diagram-design`, `diagram-format`
  and a `default → null` (which the filter treats as "always visible"). `chart-format`,
  `pivot-analyze`, `pivot-design` are absent — exactly as the plan states. ✓
- **Dead-prop surface:** `TabbedToolbarProps` spans lines 82-207; my count of
  callback/optional props in that range is ~78, matching the plan's "~78". ✓
- **Registry stores stub components:** `contextual-tab-registry.ts` entries set
  `component: (() => null) as ComponentType<…>` with the real components imported
  separately into `TabbedToolbar` — confirming the plan's Phase 1.3 premise. ✓
- **5-level fallback chain:** `resolveButtonKey` resolves
  `visibilityKey ?? testId ?? label ?? title ?? ariaLabel`
  (`RibbonVisibilityContext.tsx`). ✓
- **Dual dispatch:** `useDispatch` is already adopted in many tabs/groups; `ViewRibbon`
  carries explicit `@deprecated Use dispatch('TOGGLE_SPLIT')` notes and even calls
  `dispatch('TOGGLE_SPLIT', deps)` at line 495. `RibbonButton` takes `visibilityKey`/
  `onClick` and does not import `dispatch`. ✓
- **File sizes:** FormulasRibbon 1,638 / ViewRibbon 1,208 / DataRibbon 989 LOC. ✓

This level of accuracy is the plan's biggest credibility asset.

## Major strengths

- **Structural fix over patch.** The decision to make `ContextualTabConfig.visibilityKey`
  the single source of truth and render contextual tabs from the registry behind one
  unconditional `RibbonVisibilityTab` wrapper means "forgetting to wrap" becomes
  impossible by construction, not by reviewer vigilance. That is the right altitude for
  the bug.
- **Contracts section is precise and conservative.** It names the exact invariants —
  visibility ≠ authorization, `isRibbonPathVisible` cascade semantics, profile merge
  order (`named → JSON env override → explicit FeatureGates`), `dispatch(action, deps,
  payload)` with lazy `accessors`/`commands` getters, collapse hysteresis (8px,
  observe stable ancestor), kebab↔camel id mapping, stable test-id/aria contracts — and
  commits to *strengthen not change* them.
- **Verification gate pins the bug.** The drift test that asserts
  `chart-format`/`pivot-analyze`/`pivot-design` are gated "would fail today" — a
  regression-locking test, not a vanity check.
- **Sequencing is explicit and correct.** Phase 2.3 (prop removal) gated on 2.1–2.2
  (consumer migration); the shell typecheck failure is deliberately used as the
  tripwire confirming ownership reassignment. Phase 3's drift test depends on Phase 1.
- **Refuses workarounds.** Controls lacking a `HANDLER_MAP` entry get a real handler in
  `dispatcher.ts` (coordinated), not a local callback shim — consistent with the
  "no temporary workaround" constraint.
- **Honest non-goals.** Explicitly excludes a general ribbon DSL, visual redesign, and
  keytip→action rebinding, which bounds scope on a 28k-LOC folder.

## Major gaps or risks

- **Phase 3.2 drift-validation utility is under-specified.** "Given the rendered
  ribbon's declared paths, assert each exists in `RIBBON_VISIBILITY_SCHEMA`" hand-waves
  the hard part: *how* the set of rendered/declared paths is enumerated without actually
  rendering every tab in every state. Is it a static registry of declared keys, or a
  render-and-collect crawl in the test? The plan leans on "drive it from a test" but
  doesn't specify the collection mechanism, which is the make-or-break detail for
  whether this check is sound or merely partial. This is the weakest contract in the
  plan.
- **Phase 4 has no acceptance bar.** "Cut boilerplate" / "reduce the largest tab files"
  has no target metric (LOC delta, dropdown-count migrated, or a guard against the
  FormulasRibbon regrowing). Without a measurable bar, Phase 4 risks being declared
  "done" with a token migration of a few dropdowns. It is also the lowest-value phase
  and could be deferred without harming the bug fix.
- **Cross-folder handler dependency can stall Phase 2.** Prop removal (2.3) depends on
  ViewRibbon/TableDesignRibbon being fully migrated (2.1–2.2), which in turn depends on
  `dispatcher.ts` having handlers for every migrated control — owned by a *different*
  queue item. If that item lags, Phase 2.3 cannot complete, and the plan doesn't define
  a fallback (e.g. partial prop removal for controls that already have handlers).
- **TableDesignRibbon is already partially on `useDispatch`.** It appears in the
  `useDispatch` consumer list, so the "16 props → dispatch" framing may overstate the
  remaining work or understate which props are still load-bearing. The plan would
  benefit from acknowledging the partial-migration starting state.
- **Phase 3.1 fallback-demotion warning could be noisy.** Demoting label/title/aria
  resolution to a "one-time dev warning" is sound, but the plan doesn't say what
  "one-time" keys on (per element id? per key?) — a poorly keyed warning either floods
  the console or hides repeat offenders. Minor, but worth nailing down.

## Contract and verification assessment

Contract clarity is excellent — the canonical shapes, semantics, and merge order are
quoted with file:line anchors and the right "preserve exactly" posture. The visibility ≠
authorization boundary is correctly held outside the toolbar.

Verification gates are above average: a bug-pinning drift test, a `useContextualTabs`
registry-filtering test, explicit preservation of the named existing test suite,
app-eval ribbon scenarios under the `app-eval`/`all` profile to prove test-id/aria
stability, and the contracts declaration rebuild gate (`pnpm --filter @mog-sdk/contracts
build`) before app typecheck if `RibbonVisibilityTabKey` gains members — which matches
the known contracts-rollup constraint. The one gate that is asserted but not operationally
defined is the schema↔render bidirectional drift check (Phase 3.2). The "snapshot the
resolved key set" mitigation for app-eval test-id stability is a good, concrete guard
against silent key renames.

## Concrete changes that would raise the rating

1. **Specify the Phase 3.2 enumeration mechanism.** State whether rendered paths are
   collected by (a) a static list of declared `visibilityKey`s gathered from the
   registry + a per-tab declaration manifest, or (b) a render-and-walk over each tab in
   each contextual state. Define what "rendered path exists" means operationally, and how
   unreachable states are handled. This converts the plan's marquee anti-drift guarantee
   from aspiration to spec.
2. **Add a measurable acceptance bar to Phase 4** (e.g. "FormulasRibbon ≤ N LOC; all 42
   dropdowns on `useRibbonDropdownState`; a lint/test guard preventing new raw
   `useState` dropdown wiring") — or explicitly mark Phase 4 as deferrable so it cannot
   block the bug fix.
3. **Define a Phase 2 fallback** for when `dispatcher.ts` handlers are not yet available:
   which props may be removed incrementally vs. which must wait, so a lagging coordinated
   item doesn't strand the whole prop-removal step.
4. **Reconcile the TableDesignRibbon starting state** — note it already consumes
   `useDispatch` and list which of the 16 props actually remain command callbacks vs.
   genuine external inputs (mirroring the undo-history caveat already applied to
   ViewRibbon).
5. **Pin the dev-warning key** in Phase 3.1 (per resolved key, deduped) so the fallback
   audit is actionable rather than noisy.

These are refinements, not corrections — the plan's diagnosis and structural strategy are
sound and unusually well-evidenced.
