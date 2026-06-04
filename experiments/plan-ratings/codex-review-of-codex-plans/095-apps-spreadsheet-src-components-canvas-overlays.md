Rating: 8/10

Summary judgment

This is a strong, evidence-backed plan for `apps/spreadsheet/src/components/canvas-overlays`. It correctly treats the folder as a contract boundary between canvas-painted affordances and real DOM interaction, rather than as a collection of styling bugs. The plan's core observations line up with the current source: `CanvasInteractiveOverlay` and `OutlineToggleOverlay` put focusable children under `aria-hidden` containers, the standard overlay triggers use fully transparent focusable elements, `ValidationDropdownOverlay` is still a placeholder that logs selection, `OutlineToggleOverlay` mirrors renderer geometry, form-control resolution is sequential and async, `useInteractiveElementPositions` updates React state for every emitted snapshot, and legacy mouse handling still overlaps with DOM overlay behavior.

The rating is not higher because several central contracts are described as objectives rather than finalized specifications. The plan identifies the right architectural work, but an implementer would still need to decide the exact `InteractiveElementInfo` shape, frozen/split-pane emission semantics, validation-dropdown integration path, form-control batch API, and performance acceptance thresholds.

Major strengths

- The plan is production-path relevant. It does not optimize harness-only mirrors or test shortcuts, and it explicitly requires real UI input coverage for filter buttons, checkbox cells, comments, validation dropdowns, outline controls, and form controls.
- The scope map is accurate. It names the necessary adjacent public packages and folders: `types/rendering`, `contracts/rendering`, `views/sheet-view`, `canvas/grid-renderer`, grid mounting, mouse hooks, comments, filters, validation, and worksheet form-control APIs.
- The contract framing is right. Coordinate spaces, event ownership, focus policy, accessibility, mutation routing, and eval observability are treated as separate invariants instead of being folded into component-local fixes.
- The plan catches actual accessibility defects: focusable descendants under `aria-hidden` ancestors and focus rings hidden by `opacity: 0`.
- The sequencing recognizes the most important dependency: renderer/sheet-view contract changes must land before app overlays can stop inferring coordinates and identities.
- The verification section is much better than a compile-only gate. It includes component tests, renderer tests, sheet-view tests, app-level scenarios, accessibility checks, and manual browser exercise for a DOM/canvas alignment surface.

Major gaps or risks

- Frozen and split panes are left as an unresolved risk. The plan says metadata may include an optional viewport/pane identifier, but it should decide whether a logical element emits one target per visible rect or one canonical target. For DOM hit targets, the safer contract is likely one emitted element per visible rect, with a stable logical identity plus pane/viewport identity in the element id or metadata.
- The proposed overlay geometry primitives could duplicate existing coordinate infrastructure. `types/rendering/src/coordinates.ts` already has branded document, viewport, and layer-relative coordinate types, and the renderer exposes canonical geometry/page-bound APIs. The plan should explicitly say whether to extend those contracts or wrap them, instead of adding a new app-local coordinate layer that may drift.
- The validation dropdown work is underspecified for such a large behavioral change. It says to replace the placeholder with a real picker, but does not specify whether to reuse the existing editor picker path, validation model APIs, and grid-editing state machines, or to create a new overlay-owned list picker. Without that decision, the implementation could create a second validation UI and mutation path.
- The "overlay contract inventory" is useful but not mechanically specified. It should name where the inventory lives, how it is enforced, and whether exhaustiveness comes from TypeScript discriminated unions, a table-driven test, a generated registry, or a lint rule.
- Form-control rework is directionally correct but very broad. It needs a smaller set of explicit contracts: batch read API shape, generation key contents, event subscription source, z-index ordering semantics, and whether linked-cell writes must go through coordinator commands for undo/protection rather than `Worksheet.setCell`.
- Removing legacy mouse paths is correct only after per-family coverage is proven. The plan says this, but it should define concrete removal criteria because current DOM paths do not yet preserve every legacy side effect, such as checkbox selection semantics and validation edit-state behavior.
- Performance goals are qualitative. Structural diffing is the right target, but the plan should define the stable equality key, expected no-rerender cases, and a production-grid measurement gate or budget.

Contract and verification assessment

The contract assessment is mostly strong. The plan clearly distinguishes cell-viewport overlays, canvas-origin gutter overlays, document-space form controls, and page/fixed popovers. It also insists that event ownership be single-path, that mutations route through Worksheet/coordinator/state-machine APIs, and that eval mirrors remain non-interactive observability only.

The weakest contract area is the final public shape of interactive elements. The current `FilterButtonMetadata` lacks `sheetId`, all `InteractiveElementBounds` are just unbranded viewport numbers, and unknown element metadata falls back to `Record<string, unknown>`. The plan calls out these problems, but it should include a proposed target union with required fields, coordinate-space branding, pane/rect identity, and exhaustiveness behavior.

The verification gates are credible and use the right package names for the focused paths. However, because the plan explicitly changes public contracts, it should add package-level type gates for `@mog/types-rendering`, `@mog-sdk/contracts`, and `@mog-sdk/sheet-view`, not only `@mog/app-spreadsheet typecheck` plus conditional repo-level `pnpm typecheck`. It should also name the app-eval command(s) for the browser scenarios rather than leaving them as prose.

Concrete changes that would raise the rating

- Specify the target `InteractiveElementInfo`/renderer `InteractiveElement` contract, including branded rect type, `sheetId` for every element, logical cell identity, pane/viewport identity, action target identity, and exhaustive unknown-type behavior.
- Make a decisive frozen/split-pane rule: one DOM target per visible rect, or one canonical target, with the exact keying and focus behavior.
- Reuse or extend the existing branded coordinate and renderer geometry contracts instead of introducing potentially separate app-local coordinate primitives.
- Define the validation dropdown integration path: which validation APIs resolve options, which coordinator/editor command commits values, how undo/protection/focus are handled, and whether the existing editor picker is reused.
- Turn the form-control section into explicit API contracts for batched anchor/value/item resolution, generation cancellation, subscribed structural events, linked-cell write semantics, and virtualization behavior.
- Add concrete legacy-path removal gates for each interaction family: filter, checkbox, comment, validation, and outline.
- Add typecheck gates for the public contract packages and name the exact app-eval/browser commands that exercise real UI input.
