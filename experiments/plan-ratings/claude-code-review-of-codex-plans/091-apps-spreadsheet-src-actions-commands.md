Rating: 8/10

# Review of Plan 091 — Spreadsheet Action Commands


## Summary judgment

This is a strong, evidence-grounded plan. Nearly every "Observed issue" it cites is independently verifiable in the current source, and the diagnosis is correct, not speculative. It correctly identifies the central architectural weakness — `actions/commands` is a hand-maintained catalog of optional callbacks that duplicates and silently diverges from the dispatcher, keyboard registry, and ribbon — and proposes a coherent contract-first redesign: a typed `BuiltInCommandSpec`, dispatcher-routed execution, scoped/observable registration, derived shortcut display, and catalog-symmetry gates. The objectives, contracts-to-preserve, implementation steps, tests, risks, and parallelization sections are all present and mutually consistent.

It loses points for breadth-over-depth: it is closer to a program charter than a single executable plan, several action-type mappings are guessed rather than confirmed, and it lacks per-workstream acceptance criteria / sequencing barriers. None of these are fatal, but they leave real ambiguity for an implementer.

## Major strengths

- **Claims check out.** I verified the load-bearing observations directly:
  - `format.underlineType` id (an internal cell-format field name leaking as a command id) is real — `built-in-commands.ts:311`.
  - `useCommandRegistration` registers with an empty dependency array and a stale-closure comment — `use-command-registration.ts:60-72`. The stale-`calculationMode` risk is real.
  - The `Ctrl+Shift+P` collision is real and non-trivial: `OPEN_COMMAND_PALETTE` (`view.ts:271`, priority `high`) vs `OPEN_GO_TO_SPECIAL_DIALOG` (`navigation.ts:344`, priority `medium`) bind the identical chord. The plan's note that this needs context/priority-aware analysis rather than string comparison is well-founded.
  - The registry is a singleton `Map` with a single global `registeredCommandIds` list, `execute()` returns only `{success|error}`, `setEnabled` mutates a static `enabled` flag, and there is no `subscribe`/version API — all confirmed in `command-registry.ts`.
  - `CommandPalette` memoizes results by query only and groups by *adjacent* category (`CommandPalette.tsx:50-63`), so non-contiguous same-category results produce repeated headers — exactly as claimed.
  - The misleading `return => unregisterBuiltInCommands` doc example is real (`built-in-commands.ts:14,978`).
- **Contract boundary discipline.** It repeatedly and correctly enforces that `mog` must not depend on `mog-internal`, keeps app-only metadata as an app-local `BuiltInCommandSpec`, and gates public `types/commands` / `contracts/src/core/commands.ts` changes behind "only if promoted to public API." This matches the actual public `Command`/`ICommandRegistry` shape I inspected.
- **Strong verification design.** The "catalog symmetry" gates (no duplicate ids, every action-backed command references a valid `ActionType`, every payload satisfies the action payload contract, every shortcut resolves to a keyboard definition, no hand-written shortcut disagrees with the registry) are precisely the invariants that would have prevented the bugs it found. This is the best part of the plan.
- **Honest non-goals.** Forbidding "leave commands optional to hide missing coverage" and "execute unimplemented actions without a real handler" directly counter the failure mode that produced the current silent gaps.

## Major gaps or risks

- **Scope is a program, not a change.** Ten objectives and ten implementation steps span catalog redesign, registry rewrite, provider relocation, read-only integration, shortcut derivation, search overhaul, and contract strengthening. There is no MVP / phasing recommendation and no explicit ordering barrier (e.g. "land the typed catalog + symmetry tests before touching the registry store"). The parallelization section lists six workers but does not state which must complete before others, despite obvious dependencies (catalog → execution integration; registry store → UI subscription).
- **Action-type mappings are unverified.** Step 3 lists `DELETE_CELLS` "or the correct delete-selection action," `SELECT_ALL`, `TOGGLE_BOLD`, `SET_NUMBER_FORMAT`, `EXPORT_FILE`, `PRINT`, etc. These are plausible but the plan does not confirm they exist in `action-types.ts`, and it hedges on several. For a plan whose thesis is "tie command ids to real `ActionType`s," not having pinned the actual enum members is a notable gap — the inventory work (step 1) is asserted as future work rather than partially done here.
- **No decision where a decision is needed.** The `Ctrl+Shift+P` conflict and the `insert.function` vs `formulas.insertFunction` duplication are flagged but explicitly deferred to "a product decision." That's defensible, but the plan could at least propose a default (e.g. keep palette on the chord, rebind Go To Special) so implementation isn't blocked.
- **Availability cost vs. correctness tension is named but not resolved.** It wants live, per-keystroke availability with disabled reasons *and* warns evaluators must be cheap, but gives no concrete strategy (memoized selectors? evaluate-on-open + on-execute only?). This is the kind of detail that determines whether the feature regresses palette responsiveness.
- **`useSyncExternalStore` migration of `CommandPalette` is under-specified.** It names the API but doesn't address that results are query-derived; subscribing to registry version still requires re-running search, and the interaction with the open/selected-index state isn't covered.

## Contract and verification assessment

Contract clarity is high. The discriminated-union `BuiltInCommandSpec` (`action` | `callback` | `alias`) with `satisfies readonly BuiltInCommandSpec[]` is the right shape and would make the catalog statically checkable. The plan correctly preserves the public `ICommandRegistry` surface while proposing richer app-local methods, and is explicit about strengthening `CommandExecutionResult` (`commandId`, `action`, `handled`, `reason`, `details`) only if promoted through public review — consistent with the current minimal contract.

Verification gates are above average for this experiment: unit + integration + catalog-symmetry + E2E through real keyboard/mouse, plus named `pnpm typecheck` and contracts declaration gates. The symmetry tests are concrete and directly tied to the defects. Weaknesses: no per-step definition-of-done, and the E2E/test expectations don't specify fixtures or how read-only blocking is asserted at the mutation layer. The plan honestly states no verification commands were run (read-only worker), which is appropriate.

## Concrete changes that would raise the rating

1. **Add an explicit phase plan with barriers.** e.g. Phase 1: typed catalog + symmetry tests (no behavior change); Phase 2: dispatcher-routed execution + provider relocation; Phase 3: scoped observable registry + UI subscription; Phase 4: shortcut derivation + conflict gate. State which workers block which.
2. **Pin the real `ActionType` members.** Replace "`DELETE_CELLS` or the correct action" with the verified enum names from `types/editor/src/actions/action-types.ts`, and flag the genuinely missing ones as explicit dispatcher-gap tickets.
3. **Propose default resolutions** for the `Ctrl+Shift+P` conflict and the `insert.function`/`formulas.insertFunction` duplication, marked as overridable by product, so implementation is unblocked.
4. **Specify the availability evaluation strategy** (when it runs, what snapshot it reads, memoization) rather than only asserting it must be cheap.
5. **Add per-workstream acceptance criteria** (the symmetry tests are a great seed — turn them into a DoD checklist) and name at least one concrete E2E fixture and the read-only no-mutation assertion mechanism.
