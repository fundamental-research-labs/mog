Rating: 8/10

# Review: 095 — Apps Spreadsheet Canvas Overlays

## Summary judgment

This is a strong, evidence-grounded plan. Nearly every factual claim it makes about the
current code checks out against the actual source, and the diagnoses point at real defects
rather than invented ones. It correctly identifies the central architectural tension of this
folder — that it is a DOM/canvas alignment surface with several parallel, ad hoc coordinate
and dispatch conventions — and proposes a coherent contract-first remediation. The main thing
holding it back from a 9–10 is scope: it is effectively a multi-quarter program of work
(14 implementation steps, 6 parallel agents, public-contract changes across four packages)
presented as one plan, and a few of its harder steps (validation model integration,
form-control geometry API) stay at the objective level rather than naming the concrete
production seams they must hook into.

## Verification of the plan's factual claims

I confirmed the load-bearing claims directly:

- `aria-hidden="true"` sits on the overlay container that holds focusable children
  (`CanvasInteractiveOverlay.tsx:92`), which is exactly the accessibility defect the plan
  flags in objective 4 and step 6.
- Focusable targets use `opacity: 0` (`ValidationDropdownOverlay.tsx:48`,
  `CheckboxOverlay.tsx:51`), so focus is invisible — confirms the "invisible-but-inaccessible"
  diagnosis.
- The validation dropdown is genuinely a placeholder: `ValidationDropdownPlaceholder` with a
  `console.log` on select, a `// TODO: Wire this to actual cell mutation`, and `options.slice(0, 20)`
  truncation (`ValidationDropdownOverlay.tsx:101-138`). Step 7's framing is accurate.
- The public contract gap is real: `FilterButtonElementMetadata` (`public-types.ts:961-967`)
  has no `sheetId`, while checkbox/comment/validation metadata all do — exactly the asymmetry
  step 2 calls out. `InteractiveElementBounds` is bare `x/y/width/height` with no
  `coordinateSpace` brand anywhere.
- `OutlineToggleOverlay` does mirror renderer constants (`OUTLINE_BUTTON_SIZE`,
  `OUTLINE_LEVEL_HEIGHT`, `OUTLINE_LEVEL_WIDTH`, `getEffectiveHeaderDimensions`) and its own
  header comment admits the double-dispatch hazard ("If both layers fire on a single click,
  that's a future cleanup"). Steps 4 and 8 target a real duplication.
- `useInteractiveElementPositions` calls `setElements(snapshot.elements)` on every observe
  with no structural diffing (`use-interactive-element-positions.ts:69-71`), confirming step 13.

This level of corroboration is the plan's biggest strength: the work is anchored to defects a
reviewer can see, not to a speculative redesign.

## Major strengths

- **Contract-first framing.** It separates "what the public contract should guarantee" (the
  invariants section) from "what to change" (implementation steps), and the invariants are
  specific and testable (coordinate-space branding, single-path event ownership, sheet-scoped
  async generation guards, linked-cell-as-source-of-truth). This is the right altitude for a
  folder whose bugs are mostly contract leakage.
- **Coordinate-space taxonomy is the correct mental model.** Distinguishing cell-viewport vs
  canvas-origin (gutters) vs document-space (form controls) vs page (portal popovers) matches
  exactly why this folder has bugs, and the `OutlineToggleOverlay` comment independently
  validates that the gutter space is genuinely different.
- **Verification gates are concrete and layered:** focused per-package test commands, a
  defined set of unit/integration tests, real-input app-eval scenarios, and an explicit
  "measure in the production grid, not a synthetic harness" note for the perf step.
- **Sequencing discipline.** It correctly orders contract landing before app de-inference, and
  insists duplicate canvas mouse paths be removed only after browser coverage proves DOM
  ownership — the safe direction for a change that could regress mouse users.
- **Non-goals are real boundaries**, not throat-clearing (no renderer rewrite, no eval-mirror
  expansion, no compat shims for stale element shapes).

## Major gaps or risks

- **Scope is a single-plan-too-large risk.** Six agents touching `types/rendering`,
  `contracts/rendering`, `views/sheet-view`, the grid-renderer, the app overlays, grid-mouse
  paths, and Worksheet form-control APIs is a program, not a task. The plan acknowledges
  atomic contract landing (risk #1) but does not propose a slicing that lets value ship
  incrementally — e.g. accessibility + diffing (steps 6, 13) are independently shippable and
  low-risk and should be called out as a fast first wave, decoupled from the contract churn.
- **The validation-model integration (step 7) is underspecified at the seam.** It says "the
  same validation/data model used by the renderer" but never names the actual coordinator/
  Worksheet API or where list options are resolved today. Given this is the one step replacing
  a placeholder with real mutation UI, it deserves a named target API and a statement of how
  dynamic-range option resolution is fetched, not just a feature list.
- **The form-control "typed geometry API" (step 10) is asserted, not located.** It must know
  anchor-cell size vs configured size vs merged bounds vs range anchor — but the plan does not
  say whether that API exists, must be created, or lives in sheet-view vs the app. This is the
  riskiest single step (async generation-scoping + virtualization + structural-event
  subscription) and is the least concretely specified.
- **Frozen/split multi-rect ambiguity is raised but left unresolved.** Risk bullet and
  invariant both flag that one logical cell can be visible in multiple panes, and step 2
  offers an "optional viewport/pane identifier," but the plan never *decides* one-target-per-
  rect vs one-canonical-target. That decision belongs in the plan, not deferred to
  implementation, because it changes the contract shape.
- **Some named test files are aspirational.** `overlay-canvas-offset-lint.test.ts` and
  `overlay-coordinate-conversion.test.ts` are cited as gate commands but are tests-to-be-added;
  that is fine, but the gate section reads as if they exist. Minor, but worth flagging so a
  reader does not treat them as a current baseline.

## Contract and verification assessment

Contract clarity is the plan's best dimension. It names the precise public types
(`InteractiveElementInfo`, `InteractiveElementBounds`, `ISheetViewInteractiveElements`), the
exact missing fields (`sheetId` on filter buttons, `coordinateSpace`), and demands no compat
shims — all consistent with the source. The "branded coordinate types" proposal is the right
mechanism to make wrong-space positioning a compile error rather than a runtime drift.

Verification is well-constructed: it pairs unit tests for pure geometry/value helpers with
DOM-render tests asserting the specific accessibility invariants (no focusable child under
`aria-hidden`, visible focus, `aria-*` state), and then real-input app-eval scenarios for each
interaction family plus a combined scroll/zoom/resize/freeze/sheet-switch alignment scenario.
The one weakness is that the gates do not tie each app-eval scenario to a pass/fail assertion
on the *production* state (e.g. "Worksheet value equals selected option") as explicitly as the
unit list does — though the scenario prose implies it.

## Concrete changes that would raise the rating

1. **Add a phasing/slicing section.** Designate a low-risk first wave (step 6 accessibility,
   step 13 diffing) that ships without the contract churn, then the contract wave (steps 2–3),
   then the per-family ownership waves. This de-risks the "atomic across four packages" concern.
2. **Resolve the frozen/split multi-rect decision in the plan**: state whether an element emits
   one target per visible rect or one canonical target, and make `pane`/`viewport` identity a
   required (not optional) field if multi-rect is chosen.
3. **Name the seams for steps 7 and 10**: the concrete coordinator/Worksheet mutation API for
   validation commit and the existing-or-new geometry API for form-control anchoring, with a
   one-line note on dynamic-range option/item resolution source.
4. **Tighten the app-eval gates** to state the production-state assertion for each scenario
   (cell value, undo stack entry, filter active state) rather than only the interaction.
5. **Mark the two new gate test files as net-new** so the gate list is not misread as a current
   baseline.
