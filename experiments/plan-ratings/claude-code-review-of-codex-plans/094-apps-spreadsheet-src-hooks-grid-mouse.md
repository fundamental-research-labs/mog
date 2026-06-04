Rating: 8/10

# Review of 094 — Spreadsheet Grid Mouse Input Path Improvement Plan

## Summary judgment

This is a strong, evidence-grounded plan. The author actually read the target folder and the surrounding production code, and the factual claims I spot-checked all hold up:

- `hooks/shared/use-grid-mouse.ts` really is the 2,139-line production owner that imports the extracted folder (verified: `wc -l` = 2139). The plan's central framing — "the target folder is an extracted helper package consumed by `hooks/shared`, not the owner" — is accurate and is the right thing to fix.
- The weak tests are real. `use-cell-interaction.test.ts` contains literal `expect(true).toBe(true)` placeholders with comments saying "We can't test these directly" (lines 24–35). `benchmarks.test.ts` carries `// Temporary stubs until test utils are migrated` and returns `mean: 0, min: 0, max: 0, p95: 0, …`. The plan's critique of these as non-gating is correct.
- `use-cursor-manager.ts` does contain `console.log('[useCursorManager] …')` debug statements (lines 271, 280). The plan flags exactly this.
- `use-formula-range-drag.ts` line 248–253 literally says frozen-pane awareness is unhandled and the synthesized region preserves "main pane only" behavior. The plan's objective 7 quotes this faithfully.

Because the diagnosis is anchored in the real code rather than narrative, the proposed contracts (pointer lifecycle, hit-priority matrix, coordinate spaces, async generation tokens, event-claiming outcomes, cursor/action consistency) target genuine, observable defects rather than hypothetical ones. The verification section is concrete and correctly insists on native-pointer-path and real-UI-input proof rather than direct state mutation — which matches this repo's stated app-eval discipline.

## Major strengths

- **Production-path honesty.** The plan explicitly rejects test-only/shim/benchmark-only work and names the real owner to dissolve. Objective 2 ("do not keep two owners of the hook") is the correct structural call.
- **Contract-first framing.** It converts implicit, comment-driven branch ordering into a declarative `hit-priority.ts` matrix consumed by both pointerdown routing and cursor feedback, with the explicit invariant that "the same hit classification drives cursor and action." This directly attacks the most dangerous class of input bug (cursor says one thing, click does another).
- **Async correctness is treated as mandatory, not optional.** Generation tokens (sheet id + pointer sequence + editor session + pointer target) for validation/comment/page-break/formula CellId resolution is exactly the right mechanism, and the plan repeats it consistently across objectives 5, 6, 8, 9.
- **Route/effect split.** Separating pure `routePointerDown/Move/Up/DoubleClick/ContextMenu` from a single effect executor is sound: it makes the priority matrix unit-testable without mocking the whole app while keeping real side effects in one place.
- **Verification gates are specific and layered** — narrow filter tests first, then `pnpm typecheck`, then full app test, then real-UI app-eval/Playwright scenarios, plus a manual boundary-affordance checklist and explicit perf/render-loop guards for the high-frequency pointermove path.
- **Parallelization is credibly decomposed** around the contract as the first dependency, with non-overlapping file ownership per agent.

## Major gaps or risks

- **Scope vs. sequencing.** This is effectively a full rewrite of the spreadsheet input layer (move + dissolve a 2,139-line hook, introduce ~5 new contract modules, split route/effect, rebuild the test suite, add ~20 E2E scenarios) presented as one plan executed by six parallel agents. The single biggest risk — silently reordering Excel-like precedence — is acknowledged in "Risks" but the mitigation is mis-sequenced: characterization/E2E lock-down (step 12, agent F) is listed *last and in parallel* with the refactor (steps 2–11). For a behavior-preserving refactor of this size, "lock down current behavior before refactoring large branches" must be a **hard precondition gate**, not a parallel slice. As written, agents B–E could land routing changes before the behavioral net exists to catch regressions.
- **Contract shapes are sketched, not specified.** The discriminated unions and command types are named (`GridEventClaim`, `GridMouseRouteResult`, the ~20 command variants, `CellInteractionOutcome`) but their field-level definitions are mostly absent. `coordinate-space.ts` lists helper *names* but not the distinct coordinate types (client / viewport / data-layer / cell-local / screen) as concrete branded types, even though objective/invariant text demands they "be distinct types." Without those shapes pinned, agent A's contract and agents B–E's consumers can diverge.
- **No parity/acceptance criteria.** There is no statement of how behavioral equivalence with the current hook is demonstrated beyond "tests pass." A characterization-test inventory (which current behaviors must be captured before touching code) and an explicit "no behavior change" acceptance bar would make "done" verifiable.
- **Import-cycle risk under-specified.** The plan correctly anticipates cycles between `hooks/shared`, `grid-mouse`, `systems/grid-editing`, coordinator, and components, but offers only a principle ("extract pure contracts") rather than a concrete dependency-direction rule or a check. Moving the hook could surface real cycles that block the whole effort.
- **Warp-adjust resolution is left as an open decision (objective 10).** It frames two outcomes ("route through grid-mouse" vs "remove the duplicate") but defers the choice to an audit. That's defensible, but it means agent E starts without a settled target.
- **Effort is unbounded.** No phasing into independently shippable increments; the plan reads as atomic. A staged delivery (contracts + characterization tests → listener extraction → router/cursor → formula/table/warp → test rebuild) would de-risk and allow value to land before the whole thing is complete.

## Contract and verification assessment

The contract intent is excellent and the invariants section (lines 109–153) is the plan's best feature — it enumerates focus guard, button contract, pointer capture, hit priority, coordinate spaces, modifier pass-through, editor interception, hyperlink/comment/validation/checkbox/context-menu/double-click/formula/cursor/table/cleanup contracts. These are real, named, and largely match the behaviors visible in the code. Two weaknesses keep this from a 9–10:

1. The contracts are prose + type *names*; they are not yet machine-checkable shapes. The plan says contracts "should be imported by implementation and tests" — good intent — but doesn't pin the shapes enough for that to be unambiguous.
2. Verification is well-chosen but rests on tests that don't exist yet, authored by the same effort that does the refactor, with no characterization baseline captured first. The gates are correct; their *ordering relative to the refactor* is the flaw.

The required commands are concrete and appropriate (`pnpm --filter @mog/app-spreadsheet test -- src/hooks/grid-mouse …`, `typecheck`, full app test, app-eval real-input scenarios). The insistence that E2E use browser-level pointer/keyboard/context-menu paths rather than store mutation is exactly right for this folder.

## Concrete changes that would raise the rating

1. **Promote characterization tests to a Phase 0 hard gate.** Before any of steps 2–11, capture the current hit-priority and cursor/action behavior as passing E2E + router snapshot tests against the existing 2,139-line hook. Make "all Phase 0 tests green before and after" an explicit acceptance bar. This single change addresses the dominant regression risk.
2. **Pin the contract shapes.** Give field-level definitions for `GridMouseRouteResult`, the command union, `GridEventClaim`, `CellInteractionOutcome`, and the five branded coordinate types in `coordinate-space.ts`. Agent A should deliver these as compilable stubs day one so B–E build against fixed types.
3. **Add a phased delivery plan** with independently mergeable increments and a stated dependency-direction rule (e.g., `grid-mouse` may depend on contracts and `systems/*` public APIs but `hooks/shared` must not re-acquire routing), plus a concrete cycle check to run after the hook move.
4. **Decide warp-adjust ownership in the plan** (state the preferred outcome as the default and make the audit a confirmation step, not an open fork) so agent E is not blocked on a design decision.
5. **State a behavioral-parity acceptance criterion** — an explicit list of current behaviors that must be byte-for-byte preserved, tied to the Phase 0 tests — so reviewers can verify "no behavior change" objectively rather than trusting that new tests cover it.
