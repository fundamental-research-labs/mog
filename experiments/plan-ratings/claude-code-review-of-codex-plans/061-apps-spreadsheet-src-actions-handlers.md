Rating: 8/10

# Review: 061 — apps/spreadsheet/src/actions/handlers


## Summary judgment

This is a strong, evidence-grounded plan. Nearly every specific claim it makes about the
current state of the folder checks out against the source, and the proposed direction
(a typed action-contract registry that becomes the single source of truth for
`HANDLER_MAP`, `REPEATABLE_ACTIONS`, read-only blocking, and test coverage) is the right
architectural lever for this folder's real weaknesses. The invariants section is unusually
good: it correctly identifies the production-path constraints that any refactor here must
not break (single dispatch path, `mog` ⊁ `mog-internal`, mutations terminating at
`WorkbookInternal`/worksheet APIs, exactly-once receipt delivery, synchronous clipboard
activation reservation).

It loses points on two things: (1) the centerpiece test proposal — "replace regex symmetry
tests with registry *import* tests" — collides with a documented Jest ESM limitation that
is the actual reason those tests scan source text today, and the plan never addresses it;
and (2) the scope is enormous (it touches essentially the entire ~41.6k-line action system
plus public contracts) with no incremental, independently-landable milestones, only parallel
agent lanes. As written it reads closer to a multi-month epic charter than a single
executable plan.

## Verification of the plan's factual claims

I confirmed the following against the working tree (read-only):

- `HANDLER_MAP: Record<ActionType, AnyActionHandler>` is a large hand-written map in
  `dispatcher.ts`, with a `notImplemented` sentinel. ✅
- The exact placeholders named in step 4 are real `notImplemented` entries:
  `TOGGLE_OUTLINE_SYMBOLS`, `TOGGLE_OBJECTS_VISIBILITY`, `OPEN_THREADED_COMMENTS`,
  `CALCULATE_ALL_FORCE`, `CALCULATE_REBUILD_DEPENDENCIES`, `READ_ACTIVE_CELL`,
  `OPEN_ACCESSIBILITY_GUIDE`, `SAVE_AS`, `OPEN_SEARCH_BOX`, and the `KANBAN_*`/`GALLERY_*`/
  `CALENDAR_*`/`TIMELINE_*` families. ✅ I further confirmed `KANBAN_*` is wired to real
  keyboard shortcuts (`keyboard/definitions/kanban.ts`) while being `notImplemented` in the
  dispatcher — exactly the "exposed but unimplemented" hazard the plan flags.
- `dispatch(action, deps, payload?: any)` is untyped on payload, matching the plan's
  critique. The contract types confirm `ActionHandler`/`AsyncActionHandler` both take
  `payload?: any`. ✅
- No `ActionPayloadMap` exists anywhere yet — this is net-new, as the plan implies. ✅
- The symmetry tests (`dispatch-symmetry-a/b/c.test.ts`) do `readFileSync` +
  structural text scan of `dispatcher.ts`. ✅
- `getTargetSheetIds` is genuinely duplicated across `formatting/shared.ts`,
  `structure.ts`, `structure-row-column.ts`, and `editor.ts`; the `formatting/shared.ts`
  body literally returns `[deps.getActiveSheetId()]` — the active-sheet-only narrowing the
  plan wants to replace. ✅
- `platform`, `shellService`, `hostCommands`, and `onUIAction` all exist on
  `ActionDependencies`; `onUIAction`/`window.open`/`document.`/`fetch` usages exist in
  `charts.ts`, `object.ts`, `print-export.ts`, `cell-format-dialogs.ts`, etc. ✅
- `platform.shell.openExternal(url)` already exists in `IPlatform`, so the proposed
  hyperlink/help re-routing is feasible, not speculative. ✅
- `bridge-error-guard.ts` centralizes `PartialArrayWrite` handling as described. ✅

One small inaccuracy: the plan says "roughly 30k lines"; the folder is ~41.6k lines of TS
(editor.ts alone is 2090 lines, charts.ts 1718, object.ts 1540, table.ts 1400). This
understates the size and therefore the effort — a point in the wrong direction given the
scope concerns below.

## Major strengths

- **Contract-first framing is correct for this folder.** The core problem really is that
  behavior is implicit and scattered across parallel hand-maintained structures
  (`HANDLER_MAP`, `REPEATABLE_ACTIONS`, read-only lists, regex tests). Deriving all of them
  from one `ActionContract` registry is the highest-leverage change available here.
- **Production-path invariants are concrete and testable**, not platitudes. The
  exactly-once receipt rule, the "no empty receipt arrays from non-mutating handlers" rule,
  the synchronous-clipboard-reservation constraint, and "normalize async failures without
  masking programming errors" are all real footguns in this code, and the plan names them.
- **Side-effect cleanup is grounded in already-available abstractions.** It doesn't invent
  capabilities; `platform`, `shellService`, `hostCommands`, and the UI store all exist, and
  `openExternal` is already there. The clipboard-activation caveat shows real awareness of
  why naive abstraction breaks here.
- **Risk section is candid** about import cycles (via `dispatcher-types.ts`), behavior
  change from multi-sheet targeting, and decomposition churn.
- **Non-goals are well-chosen** (no compat shims, no `mog-internal` migration of behavior,
  no kernel-bypass), and they directly reinforce the stated invariants.

## Major gaps or risks

1. **The registry-import test proposal ignores the documented reason the current tests use
   regex.** `dispatch-symmetry-a.test.ts` explicitly states it avoids importing the
   dispatcher because Jest's experimental ESM loader hits a "module is already linked" error
   when the ~50-handler / 100+ ActionType import graph loads in-process (same baseline issue
   noted for `read-only-mode.test.ts`). The plan's step 8 — "replace regex symmetry tests
   with registry import tests" — will very likely reproduce that exact failure if the
   registry is composed from per-domain files that import handler functions (which step 1
   prescribes). The plan needs to resolve this head-on: either (a) keep the registry's
   *metadata* in a leaf, handler-free module that can be imported standalone (handlers
   referenced by string/lazy import), or (b) fix the underlying ESM loader issue first. As
   written, the flagship verification deliverable may be unbuildable.

2. **Scope has no internal milestones or landing order.** Seven objectives spanning a typed
   payload map across all actions, a mutation runtime, full side-effect re-routing,
   decomposition of six 1000–2000-line modules, multi-sheet targeting changes, and a test
   rewrite — over a 41.6k-line surface plus public-contract edits. The only sequencing
   offered is five *parallel* agent lanes, which maximizes merge churn against the very
   files being decomposed. There is no "phase 1 lands and is shippable on its own" story.
   This is the single biggest practical risk to execution.

3. **Several sub-proposals need a discovery step the plan treats as decided.** "Implement
   real production handlers" for `KANBAN_*`/`GALLERY_*`/`CALENDAR_*`/`TIMELINE_*` via a
   "view-adapter action registry" assumes infrastructure that does not exist today (I found
   no view-adapter registry; only keyboard definitions and `notImplemented` entries).
   Whether the spreadsheet dispatcher should own, delegate, or disclaim these is an open
   product/architecture question — the plan should scope a decision/spike, not assert the
   answer. Similarly, deciding which of `SAVE_AS`, `OPEN_SEARCH_BOX`, accessibility-guide,
   etc. are spreadsheet-owned vs. app-chrome-owned is real upstream work.

4. **Generic `dispatch<A>` vs. dynamic-string callers is under-specified.** The plan adds a
   `dispatchUnknownAction` wrapper, which is the right instinct, but keyboard/agent/command-
   palette paths dispatch runtime-computed action strings widely. Migrating the generic
   signature without breaking those call sites is a non-trivial sub-project that gets one
   bullet. At least an inventory of dynamic-dispatch call sites should be a named deliverable.

5. **Marginal-value gates.** "Registry completeness: every `ActionType` has exactly one
   contract" largely duplicates what `Record<ActionType, …>` already enforces at compile
   time (the existing symmetry test even says so). The plan should articulate what the
   registry test adds *beyond* the type system (e.g. policy completeness, real-function
   references, owner+reason for unimplemented) rather than listing completeness checks the
   compiler already provides.

## Contract and verification assessment

The contract design is the plan's best feature and is concrete enough to implement:
`ActionContract` fields (`mutates`, `readOnlyPolicy`, `repeatable`, `receiptPolicy`,
`protectionPolicy`, `sideEffects`, `requiredCapabilities`) map cleanly onto the invariants
and onto today's scattered structures. The `ActionPayloadMap` keyed by `ActionType` with
`undefined` for payloadless actions is the correct shape and is genuinely net-new value.

Verification gates are mostly well-chosen: package-scoped Jest runs, repo-level typecheck
for contract changes, owning-crate tests for any receipt-contract change, and an insistence
that E2E exercise *real* keyboard/mouse/clipboard paths rather than direct handler calls —
which is exactly right for a folder whose whole point is that all input converges on
`dispatch`. The two material weaknesses are (a) the ESM-import blocker above, which
undermines the registry-test gate, and (b) no quantified coverage target or baseline — "add
result-shape tests for every domain" has no acceptance threshold, and there's no statement
of the current test baseline to regress against. The plan also doesn't note that the
existing symmetry tests' compile-time `ActionType` constraint already provides drift
protection that the new tests must at least match.

## Concrete changes that would raise the rating

1. **Resolve the ESM-import constraint explicitly.** Specify that contract *metadata* lives
   in a handler-free leaf module (handlers referenced lazily/by key) so registry tests can
   import it without pulling the full handler graph — or make "fix the Jest ESM linking
   issue" an explicit prerequisite deliverable. This is the difference between a buildable
   and an unbuildable flagship gate.
2. **Add an incremental landing sequence.** E.g. Phase 1: introduce the registry + payload
   map and *derive* `HANDLER_MAP`/`REPEATABLE_ACTIONS`/read-only from it with zero behavior
   change (proven by existing tests still passing). Phase 2: mutation runtime + receipt/
   protection normalization for one domain end-to-end as a template. Phase 3+: per-domain
   migration and decomposition behind the now-stable registry. Make each phase independently
   shippable and revertible.
3. **Demote the speculative pieces to spikes.** Convert the view-adapter ownership decision
   and the "implement all placeholders" item into a scoped discovery deliverable that
   produces an owner+disposition table for every `notImplemented` action before any handler
   is written.
4. **Inventory dynamic-dispatch call sites** (keyboard, agent, command palette, context
   menu) as a named artifact, and specify exactly how `dispatchUnknownAction` interoperates
   with the generic `dispatch<A>` for each, including the validation/error contract.
5. **State the current test baseline and a coverage target**, and acceptance criteria per
   workstream (what "done" means for "result-shape tests for every domain").
6. **Correct the size estimate** to ~41.6k lines and re-scope effort/parallelism accordingly;
   call out `editor.ts` (2090), `charts.ts` (1718), `ui/dialog-handlers.ts` (1715),
   `object.ts` (1540), and `table.ts` (1400) as the decomposition hotspots with the highest
   churn risk.
