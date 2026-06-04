Rating: 8/10

# Review of Plan 097 — Spreadsheet Input Systems

## Summary judgment

This is a strong, unusually well-grounded plan. Every diagnostic claim I spot-checked against the live source held up: the no-op `forwardToSheet` bridge (`useRendererSync.ts:212`, with an inline "this is a no-op bridge" comment), the unhandled `COLUMN_RESIZE_START`/`ROW_RESIZE_START` variants (present in `machines/input-types.ts:54-55` but absent from the switch in `input-events.ts`), the hard-coded header bounds `endRow: 999` / `endCol: 25` (`input-events.ts:82,88`), the uncalled `setupInitialFocusCoordination` and `setupPointerCaptureCoordination` (definitions exist, zero production call sites), and the mixed-clock semantics in `ScrollPhysics` (`update(deltaTimeMs)` at line 110 alongside `performance.now()` inside `animateTo`/`update` at lines 115, 297). The plan correctly distinguishes pure machines from side-effecting coordinators, names the real adjacent contract surfaces (`CoordinatorProvider`, `use-grid-mouse.ts`, `sheet-coordinator.ts`, `@mog-sdk/sheet-view`), and is disciplined about production-path-only work with an explicit, sensible non-goals list.

Where it loses points: it is really a multi-week program (11 implementation areas, 6 parallel agents) presented as one plan, with no MVP slice or sequencing of what to land first; the single highest-risk item — replacing the no-op bridge and migrating selection/object pointer logic out of `use-grid-mouse.ts` — is the least concretely specified; and a couple of contracts depend on artifacts that may not yet exist (an action registry for read-only completeness).

## Major strengths

- **Evidence quality.** The "current role" and "production gaps" sections read like they were written from the code, not from a template. The gaps are real and verifiable, which makes the whole plan trustworthy.
- **Ownership-contract framing.** Objective 1 plus the "contracts to preserve" section establish *who owns what* (wheel/touch/pan, pointer classes, focus, pane focus, capture, auto-scroll, drag termination) before touching code. This is the right altitude for an input layer where the central disease is ambiguous ownership and duplicated routing.
- **Exhaustiveness as a gate, not a hope.** The `never`-default + compile-time/test gate for `SheetInputEvent` (objectives 3 and the invariant on line 112) directly fixes the silent-drop class of bug shown by the missing resize cases. This is a concrete, enforceable contract.
- **Anti-duplication discipline.** The plan repeatedly insists the bridge be *one* path, not a second pointer implementation beside `use-grid-mouse.ts`, and keeps mutation semantics in the owning systems while allowing hit-test classification to move into input. That boundary is the correct one and is stated more than once because it's the main risk.
- **Verification spans the real stack.** Unit gates for pure machines/physics, a test-typecheck gate that addresses genuine mock drift (the stale `coordinateSystem` helpers), and browser/UI gates that exercise actual keyboard/pointer/touch events rather than direct actor sends. The explicit "E2E must not mutate actors directly" non-goal is exactly right for input.
- **Determinism fix is precise.** Objective 8 correctly localizes the clock inconsistency and pins down the subtle invariants (programmatic `animateScrollTo` must not trigger snap-to-cell; reduced-motion; preserve curves).

## Major gaps or risks

- **No sequencing or MVP.** Six agents (A–F) are declared "parallel," but several share the same battleground: the `forwardToSheet`/`use-grid-mouse.ts` migration (A) and pointer-capture lifecycle (B) both rewrite the pointer-down→drag path; focus init (C) and chord/focus restoration (E) both touch focus rAF timing. The plan understates merge/coordination cost and gives no "land this first" ordering. A staged sequence (exhaustiveness gate → contracts → bridge behind a flag → capture/auto-scroll → physics/keyboard polish) would de-risk it.
- **The riskiest item is the vaguest.** Objective 3 ("replace the no-op bridge") is the load-bearing change, yet it's specified as "in phases" with no concrete phase boundaries, no behavior-equivalence oracle, and no per-phase acceptance criteria. Migrating selection/fill/resize/table/object/double-click/click-away off `use-grid-mouse.ts` without regression is most of the actual work and deserves its own decomposition.
- **Contracts-as-files risk.** Objective 1 proposes four new `contracts/*.ts` files. The plan warns against "documentation-only files," but the only stated enforcement is "use these in tests." Without a concrete mechanism (types that the switch must satisfy, a generated routing table consumed at runtime), these can rot into comments. Tie each contract to a compile-time consumer.
- **Dependency on not-yet-existing artifacts.** The read-only allowlist is to be "generated from action metadata once the action registry exists." That conditional ("once… exists") is doing a lot of work; the fallback (a completeness test) is good, but the plan should verify whether that registry exists today and, if not, scope the interim explicitly.
- **Unverified capability assumptions.** Dimension-aware header selection assumes a reachable sheet-dimension capability (workbook/renderer geometry/selection command) from inside the input layer. The plan lists three candidate sources but doesn't confirm one is actually exposed to `input-events.ts` without widening a boundary — worth a quick check before committing the contract.
- **`use-grid-mouse.ts` end-state is ambiguous.** The plan oscillates between "preserve existing behavior" and "complete the bridge." Whether `use-grid-mouse.ts` is ultimately deleted, thinned to a shim, or kept is never decided. Leaving this open invites exactly the dual-path duplication the plan elsewhere forbids.

## Contract and verification assessment

The invariant list (lines 97–124) is the best part of the document: it is specific, testable, and production-anchored (single scroll-publication owner via `setScrollPosition`; capture starts only after active pointer ID + drag state and releases on up/cancel/blur/reset; trackpad-vs-discrete discrimination; IME-first guard; default-deny read-only). These are real contracts, not platitudes.

The exhaustiveness gate and the test-typecheck gate are the two strongest verification mechanisms — both convert a current silent-failure mode into a hard stop. The browser/UI gate inventory is comprehensive and maps to user-exercised paths.

The main weakness is that acceptance is mostly phrased as "add tests for X" rather than measurable pass/fail. For the pointer-bridge migration in particular there is no behavioral oracle (golden interaction traces, before/after parity assertions) to prove the rewritten path is equivalent to `use-grid-mouse.ts`. The pnpm/typecheck command list is plausible and folder-scoped, but I could not validate command correctness here (running build/test tooling is out of scope for this review).

## Concrete changes that would raise the rating

1. **Add an explicit landing sequence and an MVP.** e.g.: (1) exhaustiveness gate + resize routing + dimension-aware headers; (2) contracts wired to a compile-time consumer; (3) `forwardToSheet` bridge behind a feature gate with parity tests; (4) capture + auto-scroll; (5) physics + keyboard policy. State which agents block which.
2. **Decompose Objective 3** into named phases with per-phase acceptance criteria and a behavior-equivalence oracle (recorded pointer-interaction traces or parity assertions against `use-grid-mouse.ts`), and **decide the end-state of `use-grid-mouse.ts`** (delete / shim / keep).
3. **Bind each `contracts/*.ts` file to an enforcing consumer** (a routing table the switch must exhaust, a type the handler signature must satisfy) so they cannot degrade to documentation.
4. **Confirm the sheet-dimension capability** is reachable from the input layer before committing the header-selection contract; if it isn't, specify the command boundary that will carry whole-row/whole-column semantics.
5. **Resolve the action-registry dependency now:** state whether it exists, and if not, fully scope the completeness-test interim rather than deferring with "once it exists."
6. **Add rollback/feature-flag guidance** for the bridge and capture wiring so a regression in the production pointer path can be reverted without unwinding the whole migration.
