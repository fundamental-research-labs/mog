Rating: 8/10

Summary judgment

This is a strong, source-grounded plan. Its main bug claim is real and important: `chart-format`, `pivot-analyze`, and `pivot-design` are in the contextual tab registry and tab bar keytip map, but they bypass both `contextualTabVisibilityKey()` filtering and `RibbonVisibilityTab` wrapping in `TabbedToolbar`, while the current visibility schema has no independent `chartFormat`, `pivotAnalyze`, or `pivotDesign` keys. The plan correctly treats this as a production rollout-control problem rather than a cosmetic toolbar cleanup.

The rating is not higher because several core contracts remain undecided or under-specified. The plan says to either add missing visibility schema keys or map the affected tabs to a parent key; that choice is the contract. It also claims Phase 1 can render contextual tabs directly from the registry before Phase 2 removes `TableDesignRibbon` props, but `TableDesignRibbon` currently needs table state and callbacks from `TabbedToolbar`, so the proposed sequencing does not compose without an additional render-prop/adapter contract or a phase reorder.

Major strengths

- The plan is based on concrete production files and current behavior, not an abstract cleanup wish list. The contextual gating gap, dead `TabbedToolbarProps` surface, fallback visibility-key chain, stray artifacts, and keytip registration pattern all match the current source shape.
- The architectural direction is right: one command dispatch path, a contextual tab registry as the source of truth, explicit visibility keys, and validation that detects schema/render drift.
- It preserves important existing invariants: visibility is not authorization, `dispatch()` and `HANDLER_MAP` remain authoritative, `RibbonButton` stays presentational, collapse behavior remains content-aware, and test ids / aria labels should remain stable.
- The verification section is better than most plans in this experiment. It names unit, app-eval, type, and manual/eval gates, and it specifically calls out the contextual tabs that should fail today and pass after the fix.

Major gaps or risks

- The visibility-key decision for `chart-format`, `pivot-analyze`, and `pivot-design` is left open. Adding independent schema keys versus parent-gating them changes rollout semantics, public profile behavior, and future contract vocabulary. The plan should choose one and list the exact schema nodes.
- The registry-render step is not safely sequenced. A registry `component: ComponentType<ContextualTabProps>` cannot directly replace the current render ladder while `TableDesignRibbon` still requires table props and callbacks. Either Phase 2 must happen first, or the registry needs an explicit `render(context)`/adapter contract that can receive `TabbedToolbar` inputs without weakening the abstraction.
- The dispatch migration scope is larger than the toolbar folder. View and Table Design still depend on callback props for several controls, and some migrated actions require exact payload/state contracts in `contracts`, `dispatcher.ts`, handlers, `use-action-dependencies`, and the shell call site. The plan names this as coordinated work, but it does not enumerate the full action list, payloads, selectors, or ownership split.
- The visibility drift validation is conceptually right but mechanically vague. "Given the rendered ribbon's declared paths" needs a defined collector: a static manifest, test-only extraction API, data attributes, or typed descriptors. A DOM render alone will not reliably expose `visibilityKey` values, and schema leaves for disabled/future controls may need explicit exceptions.
- The keytip refactor focuses on `RibbonButton`, but the toolbar also uses checkboxes, labels, selects, dropdown panels/items, and tab-level keytips. The plan should specify whether all keytip-bearing render sites get a shared hook or only button-like controls are in scope.
- Phase 4 is useful but broad and lower urgency than the correctness work. It should define typed `RibbonDropdownId` coverage, a completion metric, and a clear stop line so descriptor work does not become a general ribbon DSL.

Contract and verification assessment

The plan has good contract awareness, especially around visibility semantics, dispatch authority, collapse behavior, and stable app-eval selectors. Its weakest contract area is contextual tab identity: render id, schema key, keytip tab id, active-tab store id, and component binding should be one typed mapping, not a partially optional field plus an unresolved parent-key fallback.

Verification gates are directionally strong but should be made more exact. Add dispatch-symmetry coverage for every newly migrated View/TableDesign action, handler tests for any new payload shapes, and app-eval scenarios that drive the real UI path for contextual tab selection and public-profile hiding. The drift test should validate a typed manifest or explicit declarations, not infer too much from rendered labels. The plan correctly calls for contracts build plus app typecheck when schema keys change.

Concrete changes that would raise the rating

- Decide and document the exact visibility mapping for `chart-format`, `pivot-analyze`, and `pivot-design`, including the schema keys and public/app-eval profile defaults.
- Reorder Phase 1 and Phase 2, or define a typed contextual registry render contract that can handle `TableDesignRibbon` until it becomes self-sufficient.
- Enumerate the complete ViewRibbon and TableDesignRibbon action migration matrix: control, old prop, new `ActionType`, payload, required dependency accessor, handler status, and verification test.
- Specify the visibility drift validation mechanism and any intentional schema/render exceptions.
- Expand the keytip plan to cover non-`RibbonButton` controls or explicitly exclude them with rationale.
- Split the de-duplication phase into a follow-up or give it precise typed boundaries around `RibbonDropdownId` and menu descriptor coverage.
