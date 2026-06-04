Rating: 8/10

Summary judgment

This is a strong, evidence-driven plan. It correctly identifies several production-path problems in the input subsystem: the no-op `forwardToSheet` bridge, live pointer ownership in `use-grid-mouse`, duplicate machine-vs-physics scroll state, inconsistent reduced-motion handling, the untracked zoom-end timer, the no-op `enableKeyboard` flag, and fragile focus/pane coordination. The plan also has unusually good contract language and a sensible phase order with the dead pointer-routing decision up front.

The rating is not higher because a few contracts are under-specified in ways that could cause regressions during implementation. The biggest issue is that Phase 0 treats `InputCoordinator.handlePointerDown/Move/Up` as removable sheet-routing infrastructure, but those same methods also own middle-click and space-drag panning. They appear unused in production today because no production pointer listener calls them, so the plan needs an explicit decision about that configured gesture feature rather than deleting the handlers as if they only routed sheet selection events.

Major strengths

- The scope is clear and respects repo/package boundaries. It distinguishes this folder from the keyboard registry, kernel keyboard matcher, shell focus machine, renderer/sheet-view contracts, and React listener layer.
- The evidence is concrete and largely verifiable from the current tree. The plan names specific no-op wiring, dead consumers, timer sites, state duplication, and focus restoration hazards.
- The architectural fit is good: pure machines plus side-effecting coordinators is the right local pattern, and the plan preserves that pattern while proposing a chord-machine extraction.
- The contracts section is valuable. It calls out single owner of scroll position, single owner of pointer routing, KeyTip parity, fail-closed read-only behavior, idempotent disposal, DOM focus invariants, and accessibility expectations.
- The sequencing is mostly sound. Making the pointer-path decision first is correct because it determines the blast radius for `input-coordination.ts`, `input-types.ts`, React listener wiring, and tests.

Major gaps or risks

- Phase 0 misses the middle-click/space-drag panning contract. `handlePointerDown/Move/Up` are not just dead sheet-routing code; they also drive `PAN_START`, `PAN_MOVE`, `PAN_END`, `middleClickPanEnabled`, and `spacebarPanEnabled`. If the production path does not attach these handlers, the plan should either wire that gesture path into the real listener layer or delete the config/events/tests as intentionally dead. As written, excision could silently erase a configured feature without naming it.
- The read-only metadata proposal does not reconcile the separate dispatcher-level read-only allowlist in `apps/spreadsheet/src/actions/dispatcher-read-only.ts`. Making keyboard routing metadata-driven while leaving dispatcher gating hand-maintained would still leave duplicated authority.
- The Phase 1 selector story is underspecified. `getInputSnapshot(state)` currently receives only the XState snapshot and delegates to `inputSelectors`; it cannot read physics state without a new coordinator-owned snapshot API or a changed selector contract. The plan should define that interface explicitly.
- The `focusEditor` resolution needs a concrete source for cell identity. The live cross-system caller is `grid.onEditStart(() => this.input.focusEditor())`; changing `focusEditor(cellId)` requires specifying how edit start exposes the cell or how input reads the active selection.
- The verification gate naming is imprecise. `apps/spreadsheet/package.json` is `@mog/app-spreadsheet`, while `@mog/spreadsheet` is the workspace root package. The plan should say whether it expects app-local `pnpm --filter @mog/app-spreadsheet typecheck/test` or root `pnpm typecheck`.
- At least one named existing test fixture appears stale against the current `InputCoordinatorDependencies` shape (`scroll-zoom-gestures.test.ts` constructs `coordinateSystem/getActiveSheetId`, while the production dependency contract is `hitTest/viewport/geometry/commands/forwardToSheet`). The plan should separate baseline test-contract cleanup from implementation verification.

Contract and verification assessment

The contract coverage is above average. The plan preserves the core architectural contracts and identifies the right behavior that must not regress, especially KeyTip parity and fail-closed read-only behavior. The main missing contracts are the panning gesture contract, the single read-only authority across keyboard and dispatcher, and the exact public snapshot contract after scroll/zoom state moves out of the machine.

The verification section is broad and relevant, but it needs more exact runnable gates. It should name app-local unit tests, root or app typecheck intentionally, and any app-eval scenarios that exercise real UI input paths for keyboard, wheel, touch, pointer, focus, and pane navigation. It should also add an explicit production-path assertion for pointer ownership after Phase 0, not just unit coverage around deleted or test-only routing.

Concrete changes that would raise the rating

- Split Phase 0 into two decisions: sheet pointer routing ownership and gesture panning ownership. Explicitly choose whether middle-click/space-drag pan is wired into production or removed with its config/events/tests.
- Define a single read-only metadata source and have both keyboard routing and dispatcher gating consume the same fail-closed helper.
- Specify the new scroll/zoom snapshot contract: either a coordinator-owned `getInputSnapshot()` combining phase-machine state with physics state, or renamed selectors that only operate on machine phase.
- Replace the ambiguous package gate with exact commands for `@mog/app-spreadsheet` and state when root `pnpm typecheck` is required.
- Add a baseline-test note for currently stale input tests, or remove stale tests from the "must stay green" list until their dependency contract is updated.
- For `focusEditor`, define the source and format of the real cell id before requiring it in `IInputSystem`.
