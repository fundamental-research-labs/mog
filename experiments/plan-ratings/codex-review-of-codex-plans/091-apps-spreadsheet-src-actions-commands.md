Rating: 8/10

Summary judgment

This is a strong plan with a clear understanding of the production command-palette path and the real architectural problems in `apps/spreadsheet/src/actions/commands`. It correctly identifies that the current folder is not just a small registry utility: it is an under-specified contract boundary between command metadata, keyboard shortcuts, dispatcher actions, toolbar wiring, and palette execution. The proposed direction is architecturally sound: typed command specs, dispatcher-backed execution, scoped observable registration, live availability, keyboard parity, and production-path tests.

The main reason this is not a 9 or 10 is that the plan is still more of a comprehensive design agenda than an implementation-ready contract. It names the right systems and failure modes, but it does not fully pin down the exact catalog acceptance matrix, provider ownership model, public-vs-app-local type boundaries, command instance scoping, or rollout slices needed to make the work independently verifiable.

Major strengths

- The production-path diagnosis is accurate. The plan correctly traces `ToolbarContainer` -> `useCommandRegistration` -> `registerBuiltInCommands` -> singleton `commandRegistry` -> `CommandPalette`, and the inspected source confirms the issues around optional handler registration, stale empty-effect registration, global cleanup state, hard-coded shortcut strings, result loss, and non-reactive palette search.
- The plan targets the right architectural fix rather than local patches. Moving from optional `CommandActions` callbacks to typed command specs backed by `ActionType` and payload contracts is the right direction for this folder.
- Dispatcher alignment is treated as a hard invariant. The plan correctly insists that command execution preserve the same behavior and read-only semantics as keyboard, toolbar, ribbon, context menu, and other input paths.
- It recognizes that shortcut display is a contract with the keyboard registry, not a display string. The noted `Ctrl+Shift+P` conflict between command palette and Go To Special is real and deserves a contextual conflict policy rather than a naive string check.
- Verification coverage is broad and mostly production-relevant: scoped registry tests, search ranking tests, command/action symmetry tests, dispatcher-result preservation, palette live update tests, and E2E coverage through real keyboard and mouse input.
- The parallelization notes are useful and map cleanly to the natural boundaries: catalog, registry, execution integration, keyboard parity, UI, and tests.

Major gaps or risks

- The command catalog is not specified as an acceptance matrix. The plan says to inventory all current commands and action types, but it does not include the resulting table of `commandId -> action -> payload -> shortcut source -> availability -> owner -> test`. Without that, implementers can still make inconsistent choices command by command.
- Some action mappings remain placeholders, such as "DELETE_CELLS or the correct delete-selection action" and broad `FORMAT_*` references. That is acceptable for discovery notes, but weak for a plan whose main goal is verifiable command contracts.
- The provider ownership model needs sharper boundaries. "Under the coordinator/action-dependencies boundary" is directionally right, but the plan should specify whether the registry remains a process singleton with scoped registrations or becomes per spreadsheet/coordinator instance. Multiple mounted spreadsheets, embeds, tests, and future workspaces are a central risk for this folder.
- Public contract changes are under-specified. The plan says to evaluate `types/commands` and `contracts`, but does not define the decision rule for what must be public SDK API versus app-local `BuiltInCommandSpec`. That leaves room for unnecessary public API churn.
- Availability is correctly identified but not contracted tightly enough. The plan lists state inputs and disabled reasons, but it does not define the snapshot shape, evaluation timing, subscription granularity, or how to avoid expensive broad store reads while searching.
- Search behavior needs exact acceptance criteria. "Deterministic, ranked, category-aware" is right, but the plan should specify whether category grouping is allowed to reorder relevance-ranked results, how aliases are rendered, and what stable rank/category order is expected for empty queries.
- Rollout sequencing is risky. The plan appears to replace registration, execution, availability, shortcut derivation, search, UI rendering, and public contracts in one large pass. It should define staged migration checkpoints that keep the palette working after each slice.
- Verification commands are not concrete enough. "Relevant spreadsheet unit/integration test package" and "contracts declaration/public fixture gates" should name the package scripts or package-level commands expected in this repo.

Contract and verification assessment

The proposed contracts are directionally excellent: a discriminated `BuiltInCommandSpec`, action-backed execution, payload typing against `KeyboardActionPayload`, scoped registration handles, observable registry versions, shortcut lookup from production keyboard definitions, and preservation of dispatcher `ActionResult` reasons. Those contracts directly address the current folder's biggest weaknesses.

However, the plan should make the contracts more testable before implementation starts. The highest-value missing artifact is a catalog fixture or table that can become a symmetry test: every built-in command has exactly one identity, one execution source, one shortcut source if applicable, one availability rule, and one expected disabled/execution result shape. The plan also needs to define the `CommandExecutionResult` compatibility strategy: whether the public union is extended, wrapped app-locally, or adapted at the boundary.

The verification plan is strong in breadth and correctly emphasizes real UI input paths for E2E. It should add exact gates and fixture names, including a no-hand-written-shortcut gate, a duplicate command/action/alias gate, a registry instance isolation test, and an E2E that proves toolbar unmount or alternate ribbon display does not affect palette command availability. No implementation verification was run here, which is appropriate for this review-only task.

Concrete changes that would raise the rating

- Add a command acceptance matrix for every existing and proposed built-in command: id, label, category, rank, action type, typed payload, shortcut definition id, contexts, availability rule, disabled reason set, owner, and required tests.
- Decide and document the registry scoping model explicitly: process singleton with per-owner handles, per-spreadsheet registry instance, or a hybrid public facade over scoped app registries.
- Replace placeholder action mappings with exact `ActionType` names or mark each gap as a dispatcher action that must be added before the command becomes palette-visible.
- Define the public-contract decision tree for `types/commands` changes, including the adapter shape if richer app-local results are not promoted to `@mog-sdk/contracts/commands`.
- Specify the availability snapshot API and subscription model, including what state changes bump the registry version and which checks are re-run immediately before execution.
- Turn the search requirements into deterministic fixtures with expected order for empty query, exact match, fuzzy match, shortcut alias, category filter, disabled filtering, and aliases.
- Split implementation into staged checkpoints that preserve production behavior after each stage: catalog tests first, scoped registry second, provider migration third, dispatcher result preservation fourth, shortcut parity fifth, then UI/live availability.
- Name the exact `pnpm` package tests, typecheck command, and any public contract fixture gates required after touching this area.
