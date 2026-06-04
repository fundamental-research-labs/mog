Rating: 8/10

Summary judgment

This is a strong, evidence-backed plan. It correctly treats the toolbar as a production command-surface contract problem rather than a collection of isolated React cleanup tasks, and it identifies real drift across tab ids, contextual visibility roots, keytip routing, dropdown ids, visibility keys, and action ownership. The plan fits Mog's architecture well: public ids and contracts stay in `mog`, React rendering remains in the spreadsheet app, and verification emphasizes production UI paths.

The rating is not higher because the proposed manifest work is still too broad and slightly under-specified at the migration boundary. It names the right target state, but needs sharper milestone contracts for what lands first, what remains as verifier-only drift, and how public action/visibility ids are migrated without breaking hosts or profiles.

Major strengths

- The plan is grounded in actual source evidence: `TabbedToolbar` still has a local `TabId` mirror, `TableDesignRibbon` registers display keytips under `tableDesign`, `chart-format` and pivot tabs render without `RibbonVisibilityTab`, and `useContextualTabs` lacks visibility mappings for some contextual ids.
- The architectural objective is correct: one typed command-surface source projected into tabs, keytips, dropdowns, visibility, collapse, action dispatch, and stable test ids.
- It preserves important existing invariants, especially File/backstage not being a ribbon tab, active-tab validation in the UI store, display-only keytip registry behavior, unified action dispatch, and the single `useRibbonCollapse` coordinator.
- Verification is unusually complete. It includes unit/contract tests, keyboard/keytip set equality, visibility profiles, read-only/protection checks, collapse coverage, and browser app-eval scenarios using real UI input.
- The parallelization notes are useful and map cleanly to independent workstreams: contract, toolbar integration, keyboard/keytip, dropdown/collapse, command enablement, and verification.

Major gaps or risks

- The manifest boundary needs a stricter shape. The plan says the manifest should include payload factories, disabled selectors, and command execution owners, but those are not all appropriate for public contracts. Public packages should contain serializable ids and schema-level metadata; app-local modules should own React renderers, selectors, payload builders, and host dispatch details.
- Migration sequencing is still high level. "Contract-only and verifier-only first" is the right first milestone, but the plan should specify which exact projections become generated immediately versus only asserted by set-equality tests, and which drift is intentionally allowed during rollout.
- The public compatibility story is thin. `RibbonTabId`, `RibbonDropdownId`, and visibility profile keys are public-ish contracts. The plan rejects compatibility shims after migration, but does not define a deprecation or bridge policy for external hosts, saved visibility configs, app-eval profiles, or keyboard definitions during the transition.
- Scope is very large for one implementation plan: base tabs, all contextual tabs, backstage, tab-bar chrome, dropdown primitives, collapse, command execution, enablement, and app-eval coverage. The plan would be stronger with named acceptance checkpoints per tab family, starting with Home and Table Design as already suggested.
- The raw-button/dropdown audit proposal is good, but it needs an explicit allowlist contract so AST tests do not become noisy around picker cells, backstage panels, gallery items, and non-command UI controls.

Contract and verification assessment

The contract direction is excellent: typed ids, exhaustive projection checks, canonical tab ids, dropdown ownership, visibility roots, command dispositions, and action ownership would make the ribbon much harder to drift. The plan also correctly distinguishes visibility from authorization and requires handler-side fail-closed behavior.

Verification gates are production-relevant and appropriately strict. The plan requires focused toolbar tests, keyboard/UI-store tests, spreadsheet typecheck, repo-level typecheck when public contract surfaces change, and browser exercise for UI changes. The main missing detail is an explicit CI-friendly audit artifact format and exact failure semantics for "known current drift" during the first verifier-only milestone.

Concrete changes that would raise the rating

- Define the manifest split precisely: public serializable command ids and visibility/dropdown/keytip metadata in contracts or types, app-local execution/selectors/payload factories in spreadsheet modules.
- Add a milestone table with acceptance criteria for each phase: manifest plus failing/current-drift audit, Table Design canonicalization, contextual visibility roots, dropdown id ownership, Home command inventory, backstage/tab-bar chrome, then remaining tabs.
- Specify migration/deprecation behavior for public `RibbonTabId`, `RibbonDropdownId`, visibility roots, profile configs, and keyboard shortcut ids.
- Include an explicit AST-test allowlist for raw buttons and generic dropdowns, with examples of approved exceptions.
- Add a first-pass command disposition inventory template so implementation agents can classify commands consistently as implemented, host-owned, locally UI-only, disabled by capability, hidden by profile, or unsupported.
