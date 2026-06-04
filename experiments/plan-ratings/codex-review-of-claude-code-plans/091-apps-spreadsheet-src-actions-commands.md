Rating: 8/10

Summary judgment

This is a strong, evidence-grounded plan for a small but important production surface. It correctly identifies real issues in the command registry, built-in catalog, registration hook, command palette consumer, and public command contract. The plan is appropriately ambitious: it treats stale handlers, enablement, shortcut drift, silent failures, search quality, MRU, duplicate IDs, and tests as a related command-system cleanup rather than isolated fixes.

The rating is not higher because several contracts needed for implementation are still underspecified or slightly inaccurate. In particular, registry state changes need a reactivity/subscription story, recents are not actually present in the current UI store, shortcut derivation needs a concrete mapping to the app's keyboard definitions, and the multi-instance hazard is not solved while retaining a global singleton with shared command IDs.

Major strengths

- The source analysis is mostly correct. The empty-dependency `useCommandRegistration` effect, hardcoded shortcut strings, module-level `registeredCommandIds`, discarded `CommandExecutionResult`, missing `setEnabled` callers, hand-rolled uncached search, and lack of direct tests all line up with the production files.
- The plan keeps the public `ICommandRegistry` surface in view and frames changes as additive where contract changes may be needed.
- The objectives and invariants are the right level of ambition for this folder. They prioritize production behavior and user-visible correctness, not just code cleanup.
- The sequencing is broadly sensible: fix lifecycle and typing before higher-level palette behavior, then add tests and integration coverage.
- The verification section is much better than a generic "run tests" list. It names registry, search, catalog, lifecycle, and palette scenarios that would actually prove the changed behavior.

Major gaps or risks

- Registry mutations are not tied to React rendering. `CommandPalette` recomputes search results only when `query` changes, so late registration, `setEnabled`, MRU updates, or command metadata changes can occur without the open palette re-rendering. The plan should add an explicit registry version/subscription contract or route command state through an existing reactive store.
- Step 6 overstates current recents support. `CommandPaletteState` in the command contract has `recentCommands`, but the actual spreadsheet UI store currently appears to expose only `commandPaletteOpen` and open/close/toggle actions. The plan needs a concrete UI-store slice update, persistence decision, and selectors/actions for MRU.
- Shortcut single-sourcing is directionally right but under-specified. The runtime shortcut definitions live in the spreadsheet keyboard module and are keyed by shortcut IDs/actions such as `toggle-bold`, `COPY`, and `OPEN_COMMAND_PALETTE`, not by command IDs like `format.bold`. Many commands also have multiple bindings or context-specific bindings. The plan needs an explicit `BuiltInCommandId -> keyboard shortcut id/action(s)` mapping and display-priority rule.
- The enablement objective needs an exhaustive precondition matrix for all built-in commands. Without a table mapping each command to its state source and enabled rule, Step 2 risks becoming partial coverage of undo/paste/freeze while leaving other commands misleadingly enabled.
- The multi-instance fix is not decisive. Returning registered IDs from `registerBuiltInCommands` helps cleanup bookkeeping, but a process-global singleton with identical command IDs still cannot safely represent two independent spreadsheet instances. The plan should either make context-provided registry instances part of the required architecture or explicitly declare multi-instance out of scope.
- Step 1's "re-register on actions change" path conflicts with the current global `unregisterBuiltInCommands()` behavior. If re-registration remains global, an actions change in one instance can unregister commands belonging to another instance.
- Search performance is probably not the highest-risk production problem at roughly 60 commands. If adopting Fuse.js, the plan should justify bundle cost and define whether the cache is an index cache or query-result cache keyed by query/options.
- Failure UX and telemetry are named but not contracted. The plan should identify the toast/error API and telemetry/logging surface to use, plus whether the palette closes before or after a failed async command.

Contract and verification assessment

The contract framing is good, but it needs sharper implementation contracts before handoff. The missing contracts are: a command registry change notification/version mechanism, a per-instance registration handle or registry provider, a typed built-in command ID map, an explicit command-to-keyboard mapping, a UI-store MRU contract, and a full enablement matrix. Those contracts would make the plan verifiable rather than relying on implementer judgment.

The verification gates are strong for unit coverage and include a relevant app-eval path. They should also require a real browser/dev-server exercise for the UI changes, per repo instructions. The app-eval scenario must drive the command palette with real keyboard/mouse input and should avoid test-only command injection to manufacture failures. If `types/commands` or keyboard contracts change, the gates should explicitly include the relevant contract package build/typecheck in addition to the spreadsheet typecheck and tests.

Concrete changes that would raise the rating

- Add a table listing every built-in command: ID, handler key, category, shortcut source, enablement rule, state source, and required tests.
- Decide the multi-instance architecture before Step 1: either introduce `createCommandRegistry()` plus context/provider use in the palette and registration hook, or document that this registry is intentionally single-instance and remove partial fixes that imply safety.
- Add `subscribe`/`getSnapshot`/versioning or an equivalent UI-store bridge so registration, enablement, and MRU changes re-render the palette deterministically.
- Replace the shortcut section with a concrete mapping to spreadsheet keyboard shortcut definitions and display utilities, including rules for multiple bindings and context-specific bindings.
- Correct the MRU plan to add the missing UI-store state/actions/selectors and specify persistence scope.
- Specify the exact toast and telemetry/log APIs for failed execution, and define whether async command execution keeps the palette open until the result is known.
- Tighten the verification list with exact package gates and a real UI/browser check, while keeping the e2e path faithful to user input.
