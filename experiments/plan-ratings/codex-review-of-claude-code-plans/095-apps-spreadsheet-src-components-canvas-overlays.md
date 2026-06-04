Rating: 8/10

Summary judgment

This is a strong, production-path-aware plan. It correctly identifies the canvas-overlays folder as the DOM bridge for canvas-rendered controls, and most of its defect inventory is backed by the current source: the validation dropdown overlay is a placeholder, focusable overlay controls sit under `aria-hidden` containers, outline geometry is re-derived in the app, scroll sync differs by subsystem, and form-control resolution performs serialized async lookups.

The plan does not reach 9/10 because several hard contracts are still described at the intent level rather than the implementation-contract level. The validation dropdown fix needs a precise commit path, the outline geometry migration needs explicit new element metadata and ownership boundaries, and the scroll refactor needs exact coordinate-space acceptance criteria. A few claims are also overstated or rely on non-repo memory references instead of verifiable local contracts.

Major strengths

- The source mapping is accurate. The plan names the real mount points for `CanvasInteractiveOverlay`, `OutlineToggleOverlay`, `FormControlLayerContainer`, and `HarnessOverlayMirrors`, and it distinguishes their different coordinate spaces instead of flattening them into one generic overlay abstraction.
- The highest-impact defects are real. `ValidationDropdownOverlay.tsx` currently logs selected options instead of committing them, `CanvasInteractiveOverlay.tsx` and `OutlineToggleOverlay.tsx` hide focusable children with ancestor `aria-hidden`, and `OutlineToggleOverlay.tsx` mirrors renderer math in app code.
- The plan preserves load-bearing production contracts: `pointer-events: none` containers with interactive leaves opting into `pointer-events: auto`, `data-no-grid-pointer` on leaves, stable app-eval `data-testid`s, linked cell as the source of truth for form controls, and action routing through existing coordinator/worksheet APIs.
- It thinks in categories rather than isolated patches. Shared hit-target primitives, single-sourced geometry, tokenized visible controls, and batched form-control resolution are the right kinds of systemic fixes for this folder.
- Verification coverage is broad and relevant: app-eval scenarios for real UI input, alignment tolerance checks, accessibility assertions, scroll render-count/perf gates, and async-race coverage.
- Cross-folder dependencies are called out instead of hidden. The plan correctly flags that outline geometry and bulk worksheet lookups are not purely local to `canvas-overlays`.

Major gaps or risks

- The validation dropdown phase is under-specified at exactly the point where correctness matters. The existing reusable `components/grid/ValidationDropdown.tsx` takes `items`, `currentValue`, `onSelect`, `isOpen`, `width`, and `allowBlank`; it does not take `cellId`, `row`, `col`, and `options` as the plan says. The existing in-grid path commits through the editor actor with `PICKER_COMMIT`. The plan needs to state whether the DOM overlay should enter the editor state machine and reuse `OPEN_CELL_PICKER`/`PICKER_COMMIT`, or bypass it with `ws.setCell`. That decision affects undo, protected cells, selection movement, current value, blank handling, and duplicate interaction with the existing grid editor overlay.
- The outline geometry migration lacks a concrete contract. "Extend `ISheetViewInteractiveElements` to emit outline-level-button and outline-toggle" is the right direction, but the plan should define the element type names, metadata shape, stable ids, bounds coordinate space, collapsed/level semantics, and which renderer layer owns emission. Without that, multiple agents could produce incompatible pieces.
- The current double-dispatch discussion should be sharper. `setLevelCollapsed` is naturally idempotent for a target level, but `toggleGroupCollapsed(groupId)` is not idempotent if invoked twice. The plan does call for a single-dispatch gate, but it should treat duplicate toggle dispatch as a correctness risk rather than "idempotent enough."
- The scroll-sync refactor is directionally good but not yet an implementable spec. `ValidationCirclesMirror` uses fixed page rects from `getCellPageRect`, while form controls use document-space positions plus an ancestor transform. Moving mirrors and outline toggles to an imperative transform model needs explicit formulas for document space vs viewport/page space, including frozen panes, hidden headers, resizes, and zoom.
- The form-control "race" claim is partly overstated. The current `cancelled` flag does guard the final `setResolvedControls` from stale effect runs. The real problems are serialized lookups, wasted in-flight async work, and lack of abort/backpressure. The plan should reframe that risk so implementers do not solve a non-existent partial-state race while missing the batching contract.
- Phase sequencing is inconsistent. Phase 1 is marked highest user-visible value and "independent," but it likely touches `components/grid`, editor actions, and worksheet mutation semantics. The recommended order then delays it behind accessibility/shared primitives. That may be reasonable, but the plan should explain whether validation is blocked on the primitive refactor or should ship first.
- The plan references memory-style contracts such as `[[no-excel-in-code]]` and `[[formula-edit-click-commits]]`. Those may be true project conventions, but this review artifact should spell out the invariant or cite a repo document so the contract is verifiable by future workers.

Contract and verification assessment

The plan's contract section is one of its best parts. It identifies the real external surfaces for this folder: geometry alignment, coordinate spaces, `data-no-grid-pointer`, stable test ids, linked-cell truth, and harness mirror selectors. That gives implementers a useful checklist and keeps the plan focused on production behavior rather than test-only shims.

The verification section is also strong, but it should be made more executable. It lists `pnpm --filter @mog/spreadsheet typecheck` and relevant build gates, but the app-eval, axe, alignment, and render-count gates need exact commands or scenario names once known. The validation scenario should explicitly drive the real overlay button by mouse/keyboard, select an item, verify cell value, verify undo/protected-cell behavior if applicable, and verify the existing editor overlay does not produce a second picker or second commit. The outline scenario should assert exactly one state transition for a toggle click.

Concrete changes that would raise the rating

- Add a "Validation overlay commit contract" section defining the chosen mutation path, current-value source, allowBlank source, popover lifecycle, undo/protection behavior, selection movement, and interaction with the existing editor `ValidationDropdownOverlay`.
- Define the proposed outline interactive element union in the plan: type strings, metadata fields, id format, coordinate space, renderer emitter, consumer behavior, and migration steps for removing canvas-side hit testing.
- Replace high-level scroll-sync language with coordinate formulas and acceptance cases for normal scrolling, frozen panes, header visibility changes, row/column resize, and validation-circle harness mirrors.
- Reframe Phase 6 around batching, cancellation/backpressure, and latest-run wins; remove the inaccurate implication that the current code can land partial stale state.
- Make the phase order explicit: either ship validation first as the highest user-visible bug, or state why shared primitives/a11y must precede it.
- Replace nonlocal memory references with explicit invariants in the plan text, and add exact verification commands or scenario invocation names for the app-eval and accessibility gates.
