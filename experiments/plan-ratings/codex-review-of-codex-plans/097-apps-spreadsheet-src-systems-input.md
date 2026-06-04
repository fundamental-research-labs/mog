Rating: 8/10

Summary judgment

This is a strong, source-aware plan for `apps/spreadsheet/src/systems/input`. It correctly treats input as a production coordination boundary rather than an isolated utility folder, and it identifies real issues in the live code: the no-op `forwardToSheet` bridge, unhandled resize event variants, fixed header selection bounds, partial F6 command wiring, dormant initial-focus and pointer-capture helpers, auto-scroll wiring gaps, excluded test utilities, and mixed timing semantics in `ScrollPhysics`.

The rating is not higher because the plan is larger than a crisp implementation contract. It spans input, grid-editing, objects, renderer capabilities, action dependencies, kernel keyboard policy, UI chrome registration, and test infrastructure, but it does not always define the exact new interfaces, acceptance criteria, or migration stop points that would let those streams compose safely.

Major strengths

- The plan is grounded in production paths. It names the surrounding hooks, providers, coordinator wiring, action handlers, renderer capability boundary, and `use-grid-mouse.ts` path that actually receive user input.
- The architectural fit is good. It preserves pure XState machines, keeps DOM/renderer/timer effects in coordinators, keeps `InputSystem` as the facade, and avoids moving grid-editing or object mutation policy into input.
- The gap analysis is specific and mostly verifiable. Examples include `input-events.ts` missing `COLUMN_RESIZE_START` / `ROW_RESIZE_START`, hard-coded `endRow: 999` and `endCol: 25`, `useRendererSync` installing a no-op `forwardToSheet`, and `KeyboardCoordinator.buildActionDependencies()` omitting `paneFocusActor` despite the dependency being supplied.
- The verification section is much better than a compile-only plan. It calls for focused unit tests, app typecheck, input-test typechecking, and browser/UI checks through real keyboard, pointer, wheel, touch, blur, and focus paths.
- The parallelization notes are useful. The proposed streams have mostly clean ownership boundaries and identify cross-folder dependencies that an integrator would need to coordinate.

Major gaps or risks

- The implementation scope is too broad without an explicit contract-first phase. Eleven major work items plus six parallel streams could work, but only if the plan first freezes the `SheetInputEvent`, pane-focus, pointer-capture, auto-scroll, and keyboard-policy contracts. As written, several agents could still make incompatible local choices.
- The pointer bridge migration needs sharper sequencing. "Preserve existing `use-grid-mouse.ts` behavior while moving classification/routing into one typed adapter in phases" is directionally right, but it needs a precise rule for which pointer events are owned by the old path, which are owned by the new bridge, and what runtime/test evidence proves there is no duplicate selection/edit/resize behavior at each phase.
- The proposed contract files are underspecified. The plan says to add `contracts/input-ownership.ts`, `contracts/sheet-input-events.ts`, `contracts/focus-contracts.ts`, and `contracts/gesture-policy.ts`, but it does not define their shapes, whether they are runtime tables, type-only maps, generated metadata, or test fixtures. Without that, they risk becoming documentation-like files despite the plan warning against that.
- The F6 section should distinguish existing provider wiring from actual pane element registration. `PaneNavigationSetup` is mounted and exposes callbacks, while `PaneNavigationProvider`/`usePaneElementRefs` appears unused by real components. The plan is right to demand end-to-end registration, but should be more exact about the current state.
- Header dimension handling is conceptually correct but needs a concrete chosen contract. The plan lists workbook dimensions, renderer bounds, or full-row/full-column selection semantics as options; the final implementation plan should choose one canonical representation before coding.
- Observability is a useful addition, but the plan does not define metric names, cardinality limits, sampling/error policy, or how diagnostics avoid becoming required dependencies. That can easily become inconsistent across workstreams.

Contract and verification assessment

The contract intent is strong: production input ownership, exhaustive event routing, actor access for pane focus, deterministic physics policy, and real-input verification are the right axes. The most important missing piece is a small set of explicit acceptance contracts per workstream: exact event variants and routing outcomes, exact pane cycle/fallback behavior, exact drag states that trigger capture/auto-scroll, exact scroll timing invariants, and exact read-only/chord result reasons.

The verification gates are relevant and production-focused. They should be tightened by naming the new or existing E2E scenario files for F6, pointer capture, auto-scroll, resize start, header selection, and IME/chord behavior, plus a required negative gate that proves new `SheetInputEvent` or `ActionType` variants fail until classified. The plan correctly avoids direct actor mutation for E2E behavior.

Concrete changes that would raise the rating

- Add a phase 0 deliverable that defines the exact type/runtime shapes for the input ownership map, sheet input routing table, pane focus registration policy, gesture policy, and keyboard read-only/chord policy before implementation begins.
- Split the pointer migration into explicit milestones with ownership tables: current `use-grid-mouse.ts` owner, new `InputCoordinator` owner, shared adapter owner, and deletion criteria for each old-path responsibility.
- Choose one header selection dimension contract and make it testable, such as full-row/full-column selection semantics in the selection actor instead of materialized max row/column ranges.
- Add concrete acceptance tests per workstream, including real UI scenarios and compile-time completeness tests for `SheetInputEvent` and mutating/non-mutating action classification.
- Specify metric names and payload limits, or defer observability to a separate plan if the contract cannot be made precise now.
- Clarify the F6 current-state inventory: provider installed, callbacks exposed, `PaneNavigationProvider` currently unused, and `buildActionDependencies()` missing `paneFocusActor`.
