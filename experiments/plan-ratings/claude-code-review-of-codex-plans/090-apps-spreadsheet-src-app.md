Rating: 8/10

# Review of Plan 090 — Spreadsheet App Composition and Coordinator Wiring


## Summary judgment

This is a strong, evidence-grounded plan. Nearly every factual claim it makes about
`apps/spreadsheet/src/app` checks out against the actual source, and it correctly
distinguishes the production-critical surface (`CoordinatorProvider.tsx`,
`SpreadsheetIndicators.tsx`) from the unmounted scaffolding (`Shell.tsx`,
`ViewSwitcher.tsx`, `RecordDetailSidebar.tsx`). The contract/invariant section is the
plan's best feature: it pins the genuinely dangerous behaviors (keyboard capture
ordering, IME pass-through, single keydown/keyup listener, read-only gating, editor
commit routing through public worksheet APIs) before proposing any refactor. The
verification section is concrete and exhaustive.

The deductions are for scope/sequencing rather than correctness: the plan is really a
multi-PR epic presented as one plan, it leaves an unresolved product-scope decision
(multi-view shell: implement vs. delete) at its center, and it does not acknowledge
that some of the host-capability injection it proposes already partially exists.

## Verification performed

I confirmed against the live tree:

- All seven listed files exist; `CoordinatorProvider.tsx` is 834 lines / 33 KB — the
  "large enough to hide several contracts" claim is accurate.
- `index.tsx` imports `SpreadsheetCoordinatorProvider` (line 77, mounted 758–861) and
  `SpreadsheetIndicators` mounted with the inert
  `exportState={{ progress: 0 }} exportNotification={null}` (line 817) — exactly as
  described.
- `Shell.tsx` and `ViewSwitcher.tsx` are **not** imported anywhere in production (no
  `app/Shell` import; the `ViewSwitcher` hits outside the folder are unrelated store
  action names in `navigation.ts`). The "unused scaffolding" framing is correct.
- `ViewSwitcher.tsx` does contain the `viewId === viewType` placeholder
  (lines 37–40); `Shell.tsx` carries the `ViewContainerById` placeholder + a
  "once ShellCoordinator is implemented" TODO. Accurate.
- The bridge components the plan proposes to "split out" (`PaneNavigationSetup`,
  `UndoSelectionCoordinatorSetup`, `RangeSelectionCoordinatorSetup`,
  `CollabPresenceBridge`, `KeyboardCaptureSetup`) already exist as **inline** inner
  components, and `handleKeyDownCapture` is an inline function inside a `useEffect`
  (line 292), with `enterMode` handling at 409 and `console.error` at 742. So
  objectives 4–5 describe real, locatable work, not invented structure.
- `window.confirm` (use-coordinator.tsx:91) and `(window as any).__COORDINATOR__`
  (use-coordinator.tsx:206) exist as claimed; `PaneNavigationProvider` is genuinely
  not mounted in production.
- The `createKeyUpCapture` test exists and locks the documented Windows bare-Alt
  contract, matching the plan's description.

The plan is unusually faithful to the codebase; it is not speculative.

## Major strengths

- **Production-path discrimination.** It does not treat all seven files equally. It
  identifies what is load-bearing vs. inert and refuses to let scaffolding masquerade
  as a working production path (objective 5, step 7, and a non-goal forbidding
  compatibility shims for the `viewId === viewType` model).
- **Contract-first.** The invariants in the "contracts to preserve" section are the
  right ones and are stated precisely enough to write tests against (single
  keydown/keyup listener removed on unmount; IME never intercepted; editor state
  machine — not DOM ancestry — owns edit mode; Enter/Tab/Escape route once).
- **Verification gates are real and specific.** Exact `pnpm --filter` commands, a
  long enumerated list of unit cases (IME, dialog Escape, autocomplete pass-through,
  `enterMode` printable input, keyup handled/unhandled), provider-lifecycle tests
  including StrictMode double-mount and listener attach/remove counts, plus E2E
  through real input paths with an explicit prohibition on direct-state-mutation
  setup. This is well above average for the rated plans.
- **Honest scope fencing.** Out-of-scope correctly defers `SheetCoordinator`
  internals to plan 062 and action-handler/dispatcher work to plan 061, and forbids
  `mog-internal` coupling and public-export leakage.
- **Good risk register.** Effect-ordering changes, stale pane DOM refs, async
  circular-reference callback teardown, and z-order/feature-gate drift from moving
  the layout are all the genuine hazards.

## Major gaps or risks

- **Unresolved product decision sits at the plan's center.** Objective 5 / step 7
  forks on "is multi-view shell product-live?" and never resolves it — yet that
  answer changes whether an agent implements real view instances + a typed
  `ShellCoordinator` or deletes three files. A plan should at minimum name the owner
  of that decision and a default. As written, an executing agent could pick either
  branch. (Note: the existing `Shell.tsx` TODO says ShellCoordinator is *not yet
  implemented*, which leans toward "delete/move" — the plan could have committed to
  that as the default and flagged the alternative.)
- **This is an epic, not a plan.** Eight objectives and nine implementation steps span
  a high-risk keyboard refactor, a full layout extraction out of `index.tsx`, a
  provider decomposition, a view-shell resolution, and an indicators rewire. There is
  no PR-phasing or landing order beyond "Agent A–F in parallel." Given the risk
  profile, an explicit sequence (e.g. land pure-function keyboard extraction + tests
  *first* and independently, defer the `index.tsx` layout move) would de-risk this far
  more than the parallel-agent framing.
- **Parallelization story understates conflict.** Agents A (extract layout from
  `index.tsx`), C (split `CoordinatorProvider.tsx`), and B (keyboard capture, which
  lives inside `CoordinatorProvider.tsx`) all mutate the same two files. These are not
  cleanly parallelizable; the plan asserts they are "once the boundary contract is
  accepted" without showing the seam.
- **Partial existing injection unacknowledged.** Step 6 proposes threading a host
  capability for `confirm`/`document`/devtools, but a `confirmDialog` injection point
  already exists (`coordinator/types.ts:363`, wired at `use-coordinator.tsx:91`). The
  plan should build on that rather than imply greenfield, or it risks duplicate/churning
  abstractions.
- **The "source-level contract test that fails if scaffolding remains exported"
  (step 1) is underspecified and potentially brittle.** A grep-style test that breaks
  on documentation strings is a maintenance hazard; the mechanism needs definition or
  it will be skipped or flaky.

## Contract and verification assessment

The contract section is the plan's strongest part and is faithful to the code — the
single-listener, IME, edit-mode-ownership, and read-only-no-bypass invariants are
exactly the ones a keyboard/provider refactor can break. Verification is concrete:
named package commands, an enumerated unit matrix that maps onto observed code paths
(`enterMode` at line 409, keyup handled at 477), lifecycle tests covering StrictMode
and listener counts, and an E2E set that exercises the real Alt-keytip/Enter-Tab-Escape
paths with direct-mutation setup explicitly banned. The one weakness is that gates are
not tied to the phasing — there is no "this subset of tests must pass before the layout
move lands," so the gates read as an end-state checklist rather than per-step ratchets.

## Concrete changes that would raise the rating

1. **Resolve the view-shell fork.** State a default (the evidence — unimplemented
   ShellCoordinator, unmounted files — supports "move to an experimental area / delete"),
   name who can override it, and make the rest of step 7 conditional on that single
   decision instead of branching mid-stream. (→ removes the plan's biggest ambiguity)
2. **Add an explicit landing sequence and PR boundaries.** Recommended order: (a) pure
   keyboard-capture extraction + unit matrix, landable alone; (b) provider bridge
   file-splitting + lifecycle tests; (c) host-capability consolidation; (d) the
   `index.tsx` layout move; (e) indicators wiring; (f) view-shell resolution. Tie the
   relevant gate subset to each step.
3. **Fix the parallelization claim.** Acknowledge that the keyboard, provider-split,
   and layout-extraction work contend on `CoordinatorProvider.tsx` and `index.tsx`;
   either serialize them or define the file seam that lets them proceed independently.
4. **Reference the existing `confirmDialog`/host injection** and frame step 6 as
   extending it, not introducing it, so the implementer doesn't create a parallel
   abstraction.
5. **Replace the "source-level contract test" with a concrete mechanism** (e.g. an
   `exports.ts` allowlist assertion or a knip/ts-prune lint rule) or drop it.
6. **Pin effect-install ordering as a testable assertion**, not prose — the plan says
   "tests must pin which bridge installs before keyboard capture starts routing"; given
   the current nesting (`KeyboardCaptureSetup` is the outermost wrapper at line 814),
   state the required order explicitly so the refactor can't silently reorder it.
