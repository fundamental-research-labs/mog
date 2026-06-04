Rating: 9/10

# Review — Plan 094: `mog/apps/spreadsheet/src/hooks/grid-mouse`


## Summary judgment

This is an unusually well-grounded plan. Nearly every factual claim it makes about
the source is independently verifiable, and I verified the load-bearing ones — they
hold exactly, down to the line numbers. It is scoped honestly (hardens an
explicitly mid-refactor folder rather than pretending to finish the larger
extraction), orders work by value/risk, preserves the right invariants, and is
candid about which objectives are blocked on capabilities that do not yet exist.
It reads like it was written by someone who actually opened the files, not someone
pattern-matching on folder names.

Verified against the public source folder:

- **O1** — `console.log` calls are present *inside* the `cursor` `useMemo` at
  `use-cursor-manager.ts:271` and `:280`, including the per-call
  `inkCursor?.slice(0, 50)` allocation. Confirmed shipped defect.
- **O2 (warp-adjust)** — `rg` across `apps/spreadsheet/src` excluding `grid-mouse/`
  finds zero consumers of the hook or its `getWarpAdjustCursor`/`isWarpAdjustHandle`/
  `calculateWarpAdjustHandlePosition` helpers; the live path is
  `systems/objects/machines/object-interaction-machine.ts`. Confirmed dead/divergent.
- **O2 (filter button)** — filter clicks ship via `FilterButtonOverlay`
  (`components/canvas-overlays/`), and `SpreadsheetGrid.tsx:352` carries the exact
  "now handled by DOM overlays" note. Confirmed stranded hit-test.
- **O3** — `use-cell-interaction.ts:388` does `void handleValidationDropdownClick(...)`
  then `return false`; the handler types at `:124` and `:146` are
  `boolean | Promise<boolean>`. Confirmed race + under-specified contract.
- **O4** — `helpers/cursor-position.ts:47` allocates a fresh
  `document.createElement('canvas').getContext('2d')` per call, with a parallel
  `calculateCursorPositionWithMeasurer` DI variant. Confirmed.
- **O5** — local `findPrev/NextWordBoundary` exist at `:542`/`:560`; the O(n)
  `for (…) editorActions.selectRight()` loop is at `:453–455`; and the canonical
  `findPreviousWordBoundary`/`findNextWordBoundary` plus `selectWordLeft/Right`
  genuinely exist in `systems/grid-editing/machines/editor/cursor-movement.ts`.
  Confirmed.
- **O7** — `borderTolerance = e.pointerType === 'touch' ? 5 : 3` is duplicated at
  `hooks/shared/use-grid-mouse.ts:954, 1122, 1454, 1966`, and that orchestrator is
  indeed 2139 lines. Confirmed exactly.
- **O8** — `use-formula-range-drag.ts:254–261` synthesizes a `{0,0,0,0}` bounds
  region with the "tracked separately" comment. Confirmed.

This level of evidentiary precision is the plan's defining strength and the basis
for the high rating.

## Major strengths

- **Evidence-first framing.** The "Key structural facts established by inspection"
  section ties each objective to a concrete, line-referenced defect rather than a
  speculative improvement. This makes the plan auditable, which it survived.
- **Correct value/risk ordering.** O1–O2 (pure subtractions) → O3–O5
  (correctness/perf) → O6–O9 (structural). The sequencing notes (land in-folder
  pure changes first, schedule cross-cutting O6/O8 with owning folders) are
  realistic.
- **Honest blocking.** O8 is explicitly marked *blocked* on a rendered-region
  accessor from `@mog-sdk/sheet-view` and told to split into a follow-up if the
  accessor is absent — rather than hand-waving a fix. This is the right call.
- **Invariant preservation is specific.** The context-menu reconciliation rules
  (replace-on-outside, `isFullColumn`/`isFullRow` guards, "floating-object hits must
  not `preventDefault`"), caret-placement fidelity, and protected-cell alerts are
  called out as must-stay-green, with the existing 769-line context-menu test named
  as the guard.
- **Render-isolation discipline.** The plan repeatedly reaffirms the folder's
  dominant non-functional concern (no React re-renders on the per-frame path,
  `useRef` drag state, `getSnapshot` reads) and ties it to `benchmarks.test.ts`
  thresholds as a guardrail — and notably warns that O3 must not introduce a
  subscription.

## Major gaps or risks

- **O3's proposed mechanism is the weakest design.** The plan oscillates between
  "return one awaited `Promise<boolean> | boolean`" and a "preferred fully
  synchronous handled-verdict with the async editor-start deferred in a microtask."
  Validation-dropdown opening is genuinely async, so the synchronous-verdict path
  requires splitting "is this a dropdown hit?" (sync, cheap) from "open it" (async)
  — which is achievable but is precisely the design that needs to be nailed down,
  not left as two alternatives. The microtask-deferral idea is also a latent
  re-entrancy hazard (a subsequent `pointerdown` racing stale editor state); the
  plan flags this as an edge case (Edge case — O3) but does not resolve it. This is
  the one objective where the "how" is materially under-specified relative to the
  rest.
- **O6's shared-constants home is unconfirmed.** "e.g. under `@mog/grid-renderer` or
  a `spreadsheet-utils` location already imported by both layers" leaves open
  whether such a module actually exists and is importable by both the input layer
  and the renderer without a new dependency edge or cycle. For a cross-package move
  this is the crux, and it is hand-waved. The risk (render snapshot ripple) is
  acknowledged but the feasibility question is not answered.
- **O5 behavior-change risk is real and slightly undersold.** The local `[\w]`
  regex and the canonical editor functions almost certainly differ on
  punctuation/Unicode. The plan says to "diff behavior on a fixture table" and adopt
  canonical semantics — good — but adopting canonical word-nav changes user-visible
  double-click word-select behavior, and there is no app-eval assertion proposed to
  pin the new behavior (only a unit diff). A scenario lock would de-risk this.
- **No measured benchmark baseline.** The plan asserts O1 "should improve" and O4
  "should reduce allocation" against `benchmarks.test.ts` thresholds but does not
  state the current thresholds or whether they are tight enough to actually catch a
  regression. The guardrail is named but not characterized.

## Contract and verification assessment

Contract clarity is strong on the preserve side and adequate on the strengthen
side. The `GridMouseEvent` duck-type, the context-menu `preventDefault` asymmetry,
the active-sheet formula-range filtering, and the protected-cell path are each
stated as explicit invariants with the tests that encode them. The one contract
genuinely being *changed* (O3's sync/async return type) is the least precisely
specified — the new type is described as "a single explicit type" without writing
it down.

Verification gates are above average: per-objective test additions (dropdown click
does not mutate selection; word-select issues a single command asserted via spy,
not N `selectRight` calls; `console.*` not invoked during cursor computation;
cursor priority cascade unchanged; cached vs DI measurer produce identical indices;
tolerance mouse→3/touch→5/missing→default), plus keeping the context-menu and
click-detection suites green, plus the benchmark perf gate, plus a named set of
app-eval scenarios. The plan correctly notes it does not itself run these per
harness constraints. The gap is the absence of a concrete app-eval lock for the O5
word-select behavior change and for the O8 frozen-pane drag (the latter is at least
proposed as a fixture test, contingent on the blocked accessor).

## Concrete changes that would raise the rating

1. **Pin down O3.** Write the exact post-refactor type and the precise call sequence:
   e.g. a synchronous `classifyCellClick(cell, pos): { handled: boolean; openDropdown?: () => Promise<void> }`
   so the orchestrator returns/short-circuits synchronously and invokes the async
   open only after selection is settled. Replace the "microtask" hand-wave with a
   stated ordering guarantee and a test for the back-to-back pointerdown case.
2. **Resolve O6 feasibility before committing.** Name the actual module that both
   `click-detection.ts` and the renderers can import (or state that one must be
   created and where), and confirm no new dependency cycle. Without this, O6 is a
   wish, not a plan.
3. **Add an app-eval lock for the O5 word-select semantics change** (double-click on
   a word with adjacent punctuation), so the deliberate behavior change is captured
   as an expected output rather than only a unit diff.
4. **State the current `benchmarks.test.ts` thresholds** (handler time/event,
   cursor-update time, zero-render assertion) so reviewers can see the guardrail has
   teeth and O1/O4 improvements are measurable.
5. **Minor:** confirm the O9 `activeSheetId` removals against each callback *body*
   (the identifier is heavily used elsewhere in `use-cell-interaction.ts`, so the
   claim is per-callback and worth a one-line "verified unreferenced in
   `handleCommentIndicatorClick`/`handleContextMenu` bodies").
