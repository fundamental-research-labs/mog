Rating: 8/10

Summary judgment

This is a strong, source-aware plan for `mog/apps/spreadsheet/src/systems/grid-editing`. It correctly treats the folder as a production editing subsystem rather than a set of isolated XState machines, and it identifies the right high-risk contracts: actor ownership, edit/session identity, commit completion, formula point mode, DOM editor pointer ownership, paste semantics, read-only policy, live layout predicates, public capability surfaces, and real UI input paths.

The plan is especially valuable because several cited problems are real in the current source. `IGridEditingSystem.subscribeToCellPropertyChanges()` still returns a no-op despite an existing `subscriptions/cell-property-subscriptions.ts` helper. `getSlicerCache()` still returns `null`. `setCheckboxCoordination()` installs new cleanup without disposing a prior installation. `read-only-mode.test.ts` still reads production source text instead of exercising a real grid-editing instance. `refreshLayoutCallbacks()` documents the mid-session hidden-row/column staleness limitation, while `rows:hidden`, `rows:unhidden`, `columns:hidden`, and `columns:unhidden` events already exist upstream.

The rating is not higher because the plan is broader than its executable contracts. It proposes lifecycle graphs, contract files, an edit session controller, an input router, a mutation policy, a clipboard workflow service, live layout indexes, public API capability narrowing, and observability in one program. Those are mostly the right directions, but many of the new abstractions are named rather than specified. Parallel implementers would still have to invent important type shapes, ownership boundaries, migration milestones, and acceptance criteria.

Major strengths

- The production-path diagnosis is substantially correct. The plan accounts for `GridEditingSystem`, actor-access wrappers, editor/selection/clipboard coordination, `SheetCoordinator`, `systems/input`, `CoordinatorProvider`, `InlineCellEditor`, clipboard hooks/actions/domain code, and public exports.
- It preserves key architectural direction: machines should not import each other directly, `GridEditingSystem` owns the actors, actor access is the programmatic boundary, DOM blur is not normal commit intent, and selection-machine layout predicates must stay synchronous.
- It identifies real placeholder or weak public APIs. The no-op cell-property subscription and null slicer cache are public contract problems, not cleanup trivia.
- It correctly elevates async edit validity beyond source-text fetches. Current `edit-entry-service.ts` has generation checks for several entry steps, but commit validation/dialog callbacks in `editor-commit-coordination.ts` can still send events after a newer edit has started.
- The read-only section asks the right question: "what is the complete set of UI mutation paths?" That is better than only guarding keyboard dispatch or fill handle entry.
- The verification plan is production-relevant. It distinguishes unit/coordinator tests, production-shaped simulator tests, and browser/UI tests for focus, keyboard capture, pointer bubbling, composition, native clipboard, and canvas hit testing.
- The sequencing starts with contracts and behavior tests before refactoring, which is important for a subsystem with subtle workflow invariants.
- The parallelization notes are plausible and identify separable workstreams once the shared contracts are nailed down.

Major gaps or risks

- The central abstractions need concrete API sketches. `GridEditingInputRouter`, lifecycle nodes, `GridEditingRuntime`, edit session identity, mutation policy, clipboard workflow service, and layout predicate index are all directionally useful, but the plan does not define enough method signatures, event payloads, state ownership, or error behavior for independent workers to compose safely.
- The scope is very large for one plan. Lifecycle extraction, input routing, edit transaction identity, read-only policy, clipboard service unification, public API cleanup, layout events, type-facade cleanup, observability, and UI tests could each cause regressions. The plan needs sharper mergeable milestones with "done means" gates for each slice.
- The layout section is slightly stale. The plan says to add workbook event wiring and conditionally add typed events if missing, but upstream already emits row/column hidden and unhidden events. A higher-grade plan would cite those exact event names and focus on consuming/coalescing them in grid-editing rather than presenting the event surface as uncertain.
- The clipboard diagnosis overstates duplication in places. `use-clipboard.ts` and action handlers already use shared domain helpers such as `unifiedPaste`, `buildClipboardData`, `writeToSystemClipboard`, and pending paste/capture trackers. There are still multiple production call sites, but the migration plan should distinguish existing shared domain logic from the remaining routing/intent duplication.
- Public API narrowing is underspecified. Moving slicer, draw-border, comment, or find/replace methods into optional capabilities can affect `exports.ts` consumers and coordinator wiring. The plan needs a compatibility/deprecation strategy and type-level tests for public package consumers.
- The input router could accidentally blur ownership between `systems/input` and `systems/grid-editing`. The plan says both document keyboard capture and grid pointer hooks should call the router, but it does not define which layer owns raw DOM normalization, keyboard action dispatch, focus exclusions, autocomplete/picker priority, or app-wide shortcuts.
- Observability is listed well, but the metric contract is not specified. It should define event names, required fields, redaction/size limits, sampling expectations if any, and whether metrics are best-effort or must not throw.
- Risk mitigation is mostly final-gate oriented. For a refactor this large, the plan should require pre-refactor characterization tests and equivalence snapshots before replacing lifecycle, input, and clipboard paths.

Contract and verification assessment

The contract inventory is one of the plan's strongest parts. It names the important behavioral invariants for actor ownership, formula editing, CSE commit target, commit navigation, blur behavior, inline editor pointer handling, autocomplete/picker key ownership, selection modes, drag/fill/resize context retention, paste semantics, layout predicates, read-only scope, cleanup order, and package dependency direction. These are the right contracts for this folder.

The weakness is that many contracts are still prose, not executable interfaces. For example, "centralize input intent routing" should include a discriminated union for intents, allowed consumers, sync/async return semantics, and explicit responsibility boundaries with `KeyboardCoordinator`. "Single edit transaction model" should include session IDs on machine events, current-session read APIs, and the rule for rejecting stale dialog callbacks. "Mutation policy" should include a denial type and the complete workflow-to-policy-method mapping.

The verification section is above average and respects the repo's rule that UI-sensitive E2E tests must use real input paths. The command list also matches the package scripts present in `@mog/app-spreadsheet`. It would be stronger if it named exact new or migrated test files, required characterization tests before each refactor phase, and type/public-boundary gates for any exported actor/event/capability changes.

Concrete changes that would raise the rating

1. Add concrete TypeScript sketches for the lifecycle node contract, `GridEditingInputIntent` union, edit session identity, mutation policy result, clipboard workflow service, and optional capability interfaces.
2. Split the migration into smaller acceptance milestones: lifecycle equivalence, edit session stale-callback hardening, read-only policy coverage, public API cleanup, clipboard routing, layout event refresh, and input router integration.
3. Replace uncertain layout wording with exact existing upstream events: consume `rows:hidden`, `rows:unhidden`, `columns:hidden`, `columns:unhidden`, `merges:changed`, and sheet deletion events, then specify coalescing and prior-known-good fallback behavior.
4. Add a compatibility plan for public exports and `IGridEditingSystem` capability narrowing, including type tests and a list of affected consumers.
5. Define ownership between `GridEditingInputRouter`, `KeyboardCoordinator`, `CoordinatorProvider`, grid mouse hooks, and inline editors so raw DOM normalization and editing intent routing do not become dual authorities.
6. Add pre-refactor characterization tests for commit navigation, formula point mode, click-away commit, paste/cut retention, read-only behavior, and sheet-switch/layout callbacks before moving implementation behind new abstractions.
7. Turn the observability section into an executable metric schema with required fields, optional fields, payload limits, and tests proving metrics are emitted without changing workflow behavior.
