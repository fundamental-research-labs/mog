Rating: 8/10

Summary judgment

This is a strong, production-aware plan for one of the highest-risk UI input areas in the spreadsheet app. It correctly identifies that `apps/spreadsheet/src/hooks/grid-mouse` is not yet the true production owner: the live `useGridMouse` implementation still sits in `hooks/shared/use-grid-mouse.ts`, while the target folder mostly exports extracted helpers and sub-hooks. The plan is also grounded in real source conditions: native pointer listeners own the primary path, current scrollbar tests mirror snippets instead of mounting the production listener, `useCellInteraction` fire-and-forgets validation dropdown startup, cursor lookup has async stale-update risks, `useFormulaRangeDrag` still synthesizes a main-pane-only hit region, and existing tests include narrative/assert-constant coverage.

The rating is not higher because the plan is closer to a comprehensive architecture program than an execution-ready implementation plan. It names the right destination, but it does not sufficiently stage the migration from the current 2k-line hook into small, behavior-preserving vertical slices with explicit rollback points, exact acceptance criteria, and baseline behavior locks before the large router/effect-executor split.

Major strengths

- The scope is correctly production-path focused. It does not optimize test-only paths, and it explicitly centers the native pointer listener path that `SpreadsheetGrid` actually uses.
- The architectural target is sound: make `grid-mouse` own mouse routing, define event/coordinate/result contracts, unify hit priority, and make cursor affordances share the same classification as pointerdown behavior.
- The plan captures the important input invariants: overlay opt-out, scrollbar rejection, editor focus preservation, button semantics, pointer capture cleanup, Radix context menu default-prevention behavior, object-over-cell priority, range-picker priority, formula range drag priority, raw modifier propagation, and direct DOM cursor writes.
- The async race analysis is especially valuable. The plan names concrete stale-result sources: page-break cursor hit testing, validation dropdown reads, table metadata, comment/CellId lookup, formula range CellId conversion, sheet switches, pointer movement, and editor-session changes.
- The test direction is right. It calls out weak existing tests, requires production listener/hook tests instead of snippet mirrors, and requires app-level UI input scenarios that use real browser pointer/context-menu paths.
- The parallelization notes are useful and align with the folder boundaries: contracts/router, native listener lifecycle, cell/context/formula, cursor/performance, object/table/page-break, and UI verification can proceed mostly independently after a shared route/result contract lands.

Major gaps or risks

- The sequencing is too coarse for the blast radius. Moving `useGridMouse`, creating a typed lifecycle, extracting native listeners, introducing pure route functions, adding an effect executor, and rebuilding tests are all correct, but the plan should define a phase-zero behavior freeze and then smaller vertical migrations that keep each gesture family green before the next one moves.
- The route/effect-executor design is under-specified for a system that already has coordinator methods, selection/editor actors, object interaction machines, UI store actions, and dispatch actions. Without a clear rule for what belongs in a route command versus an existing coordinator action, the new command layer could become a parallel action DSL and introduce another source of truth.
- The hit-priority matrix is excellent as an inventory, but it does not define a concrete schema for preconditions, tie-breaks, coordinate-space inputs, async hit sources, or whether rows 18 and 19 should really be ordered after normal selection when renderer hit types for resize/hidden boundaries already arrive as non-cell hits.
- The plan says to avoid two independent `useGridMouse` owners, which is right, but it does not provide an import-cycle and export migration checklist beyond `hooks/index.ts`. A move of this hook should explicitly enumerate direct import sites, expected public exports, and any temporary forwarding file policy.
- The UI verification list is comprehensive but not executable enough. It should identify which existing app-eval/Playwright harnesses and fixtures will be used, what new scenario files are required, and which assertions prove success for each high-risk gesture.
- Performance gates are directionally right but lack budgets. "Measured on production routing functions" and "no React render loop" should be backed by explicit thresholds, baseline capture, and pass/fail criteria for pointermove, cursor writes, and async request churn.
- Formula range drag requirements are correct but need a sharper contract with the renderer overlay. The plan says to use the same rendered-region model as the formula overlay, but it should name the concrete capability/API that owns visible regions, zoom, frozen panes, split panes, and cross-sheet filtering.
- Context menu coverage is strong for right-click, but keyboard context-menu behavior is left conditional. If the grid supports keyboard context-menu invocation or Shift+F10 elsewhere, the plan should either include that path in the contract or explicitly declare it out of scope for this folder.

Contract and verification assessment

The contract section is the best part of the plan. It defines the right categories of behavior and is much more useful than a list of implementation chores. In particular, the distinctions between client, viewport, layer/data, cell-local, and screen coordinates are necessary for this folder; so are the contracts around editor interception before awaits, stale async generation checks, Radix `preventDefault` behavior, and cursor/action consistency.

The verification plan is broad and mostly appropriate: targeted Jest gates for `@mog/app-spreadsheet`, package typecheck, broader package tests after export movement, browser exercise, app-eval/Playwright coverage, and production-path performance checks. It also respects the requirement that E2E tests use real UI input.

The weakness is specificity. The plan should convert the invariant list into a traceable acceptance matrix: each priority row and lifecycle cleanup condition should map to at least one unit/router test and, for user-visible flows, one browser-level scenario. It should also define exact performance budgets and exact async-generation assertions, such as "older validation cursor promise cannot update after `resetCursor` or after pointer target changes."

Concrete changes that would raise the rating

- Add a phase-zero baseline: codify current behavior with production-hook tests for native pointerdown/move/up/cancel, context menu, double-click, editor focus preservation, scrollbar/overlay rejection, and cursor/action agreement before moving ownership.
- Break implementation into vertical, mergeable slices: listener extraction first, then hook move with no behavior changes, then route/result contracts for one gesture family, then cursor unification, then async generation checks, then table/formula/object integrations.
- Define the route command schema precisely, including command idempotency, cancellation, generation-token shape, executor ownership, and the rule for delegating to existing coordinator/actor APIs instead of duplicating them.
- Turn the hit-priority matrix into test data with preconditions, expected cursor, expected pointerdown command, expected double-click behavior where applicable, and async/stale-result behavior.
- Name the renderer/sheet-view APIs that will supply rendered regions for formula range drag and table/object hit routing, or explicitly add those API changes as prerequisites.
- Add concrete app-eval/Playwright scenario names, fixtures, and assertions for the UI gates, rather than a long checklist of flows.
- Add performance budgets based on current production behavior: maximum pointermove route time, maximum cursor DOM writes per movement, allowed React renders during drag, and maximum outstanding async cursor requests.
- Include an import/export migration checklist for `useGridMouse`, including direct imports, barrel exports, tests that reference `hooks/shared/use-grid-mouse.ts`, and the policy for deleting or forwarding the old shared file.
