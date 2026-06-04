Rating: 8/10

# Review — Plan 091: Command Registry & Built-in Command Contracts


## Summary judgment

This is a strong, unusually well-grounded plan. Every concrete defect it cites is real and I verified it against the source: the `[]` dependency array with the "handlers are stable due to useCallback" assumption (`use-command-registration.ts:60-72`); `addCommand` skipping commands whose handler is `undefined` at registration time (`built-in-commands.ts:152-157`); the non-existent search cache despite the header comment claiming one (`command-registry.ts:11`); the `Math.min(0.6, …)` score cap (`command-registry.ts:72`); `execute` returning a `CommandExecutionResult` that `CommandPalette.executeCommand` discards (`CommandPalette.tsx:106-112`); the absence of any caller of `setEnabled` (the only other `setEnabled` in the app is the unrelated collab store); `recentCommands` existing only in the contract (`types/commands/src/commands.ts:190`) with no implementation; the module-global `registeredCommandIds` (`built-in-commands.ts:957`) with `registerBuiltInCommands` self-unregistering globally; the `format.underlineType` naming inconsistency; the `// Selection` comment over commands emitted as `category: 'Navigation'`; the contract's own Fuse.js suggestion (`commands.ts:106-108`); and the keyboard layer being the real, platform-normalizing source of truth for shortcuts (`use-keyboard.ts:8-13`). Nothing in the problem inventory is fabricated or stale.

The plan also gets the production-path framing right: it identifies the public contract surface (`ICommandRegistry`, `CommandExecutionResult`, the `index.ts` barrel), commits to additive-only changes, and explicitly defers the contract-build/rollup concern. Objectives are prioritized, invariants (I1–I6) are concrete and testable, and steps are sequenced with a sensible "land low-risk foundations first" ordering. It is honest about not running builds/tests and lists the gates the implementer must satisfy instead.

What holds it back from a 9–10 is that the two highest-value cross-folder steps lean on mechanisms whose existence the plan asserts but does not establish, and a couple of verification gates are likely impractical as written.

## Major strengths

- **Evidence density.** Claims are line-cited and accurate. This is the difference between a plan that survives contact with the code and one that doesn't.
- **Correctness-first prioritization.** O1 (handler freshness) and O2 (enabled state) are the genuinely user-visible correctness bugs, and they are sequenced first. The "always-enabled catalog executing Undo with no history / Paste with empty clipboard" framing is exactly the right way to motivate O2.
- **Contract discipline.** Preserve/strengthen split is explicit; additive-only stance on `@mog/types-commands` is correct and the contracts-rollup gotcha is acknowledged.
- **Open questions are the right ones.** Q1 (registry callback vs enablement hook), Q2 (Fuse vs hardened in-house on a per-keystroke hot path), Q3 (is multi-instance real?) are genuine design forks, not filler. Recommending the enablement hook (Q1b) for separation of concerns is the right default.
- **Honest non-goals.** Explicitly not reworking `KeyboardCoordinator`, not adding new commands, not touching collab — keeps blast radius bounded.

## Major gaps or risks

- **Step 3 rests on an unverified mapping.** The plan asserts shortcuts should be derived from the `@mog-sdk/contracts/keyboard` registry "keyed by command id," but it never establishes that the keyboard registry is keyed compatibly with command ids, or that a command-id↔shortcut-id correspondence exists at all. This is the load-bearing assumption for the entire step. If the two registries use disjoint id schemes, Step 3 silently degrades to "introduce an explicit mapping" — i.e. a second hand-maintained table, which reintroduces the very drift O3 set out to kill, just relocated. The plan should have spent the cheap read to confirm the keyboard registry's key shape before committing the step. As written it is a plan to investigate, dressed as a plan to implement.
- **Step 1's mechanism is two half-committed alternatives.** "store a stable indirection to handlers" *or* "re-register on actions change" are materially different designs (indirection fixes I4 without re-registration churn; re-register-on-change reintroduces the churn risk the plan itself flags). Leaving this unresolved pushes the core correctness fix into design review. The indirection approach (registry stores `() => getActions().foo()`) is clearly superior and the plan could have just said so.
- **Two verification gates are impractical.** (a) "macOS run shows ⌘ glyphs" as an app-eval assertion assumes the app-eval harness runs on / can simulate macOS platform normalization; app-eval typically runs on a fixed Linux platform, so this gate may be untestable as stated. (b) "disabled command (Undo with empty history) is absent" depends on O2 being fully wired, which makes the integration scenario gate dependent on the riskiest cross-folder step — fine, but the dependency should be called out so the scenario isn't authored before Step 2 lands.
- **Scope creep in disguise.** O5 (better fuzzy search), O6 (MRU), and the recents UI are quality/feature work, not correctness. The plan is honest that these come from the contract, but bundling nine objectives into one folder's plan risks the high-value O1/O2/O4 fixes being gated behind lower-value search/MRU work. The sequencing notes partially mitigate this, but an explicit "O1/O2/O4 are shippable independently of O5/O6" statement would harden it.
- **Double-execution guard is under-specified.** Step 4 says add an in-flight guard "in `CommandRegistryImpl.execute` (or the palette)" — these have different semantics (registry-level guard blocks all callers of an id; palette-level guard only blocks the palette). The contract impact differs. Should be decided, not parenthesized.

## Contract and verification assessment

The contract analysis is the plan's strongest dimension. It correctly treats `ICommandRegistry` and `CommandExecutionResult` as the public surface, keeps changes additive, and notes that exposing an MRU accessor or `createCommandRegistry()` would be a real contract change requiring the declaration rollup. Invariants I1–I6 are individually testable and map cleanly onto the verification gates.

The verification section is well-structured (registry unit / search unit / catalog exhaustiveness / lifecycle / integration) and the catalog exhaustiveness check ("every `CommandActions` key ↔ command, ids unique, no hardcoded shortcuts remain") is exactly the kind of regression lock this folder lacks today (zero test coverage confirmed). Weaknesses are the two impractical gates above and the fact that the integration scenario silently presumes O2/O3 are complete. The plan also rightly respects the "do not modify existing scenarios, author a new `.spec.ts`" constraint.

One small accuracy note in the plan's favor: it correctly states `execute` already refuses disabled commands (`command-registry.ts:166-168`) — so O2 is purely about *driving* the flag, not adding the gate. That precision is good.

## Concrete changes that would raise the rating

1. **Verify and pin the command-id↔shortcut-id story before Step 3.** Add a short investigation result: how is `@mog-sdk/contracts/keyboard` keyed, does a compatible mapping to command ids exist, and if not, state plainly that Step 3 delivers a single *explicit* mapping table (and why that is still better than per-command hardcoded strings). Without this, Step 3 is the plan's biggest unknown.
2. **Commit Step 1 to the indirection design.** Specify that the registry stores a handler thunk that resolves the current `actions` at execute time (satisfying I4 without re-registration), and relegate "re-register on change" to a fallback. This removes the churn risk the plan itself lists.
3. **Decide the double-execution guard location** (registry vs palette) and note the contract implication.
4. **Mark O1/O2/O4 as independently shippable** ahead of O5/O6, so correctness isn't blocked on search/MRU polish.
5. **Fix the two verification gates:** replace the macOS-glyph app-eval assertion with a platform-formatting *unit* test (feed a known platform, assert glyph output), and explicitly note the disabled-command scenario depends on Step 2 landing first.
6. **Address the persisted-id risk for Step 8 concretely.** The plan flags that renaming `format.underlineType` could break persisted MRU/telemetry — but since MRU isn't implemented yet (O6), state whether any *persisted* consumer exists today; if none, the rename is free and the warning is moot.
