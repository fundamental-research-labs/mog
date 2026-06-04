Rating: 8/10

Summary judgment

This is a strong, evidence-driven plan for a sensitive input-path folder. It correctly treats `grid-mouse` as production behavior, not a cleanup sandbox, and it anchors most recommendations in concrete source facts: production cursor logging, dead filter hit tests after `FilterButtonOverlay`, orphaned warp-adjust code, duplicated word-boundary logic, per-call canvas allocation, fire-and-forget validation dropdown handling, duplicated touch tolerance, and the formula-range frozen-pane gap. The plan's preservation contracts are also unusually good: render isolation, duck-typed `GridMouseEvent`, context-menu reconciliation, caret placement fidelity, protected-cell alert behavior, and formula-range edit semantics are all called out explicitly.

The rating is not higher because the plan's scope contract is internally inconsistent. It says the plan changes only `apps/spreadsheet/src/hooks/grid-mouse`, but several objectives require edits in `hooks/shared/use-grid-mouse.ts`, `systems/grid-editing`, renderer packages, and possibly sheet-view/viewport contracts. The plan acknowledges these dependencies later, but the implementation contract should be split into in-folder changes versus cross-folder contract changes so owners and verification can compose cleanly.

Major strengths

- The plan is grounded in real production-path inspection. The cursor `console.log` issue is in the cursor computation path, `handleCellClick` really fire-and-forgets `handleValidationDropdownClick`, and `use-formula-range-drag` really synthesizes a zero-bounds main-pane-only region.
- It prioritizes the right invariants for this folder: no React renders during move/drag, direct DOM cursor writes, ref-based drag state, on-demand snapshots, and preserving subtle context-menu selection behavior.
- It avoids whack-a-mole cleanup by grouping whole categories: dead input hit tests, duplicated measurement paths, duplicated word-boundary logic, duplicated pointer tolerance, and render/input constant drift.
- The test plan is broad and relevant: pure helper coverage, hook behavior, cursor priority, formula-range frozen panes, benchmarks, typecheck, and app-eval scenarios.
- Sequencing is mostly sensible. Pure deletions and local performance cleanup come before editor/selection contract changes and renderer/view capability work.

Major gaps or risks

- The scope statement needs correction. O3, O5, O6, O7, and O8 cannot be completed by changing only `grid-mouse`. This is not just logistics; changing the orchestrator's click interception contract or adding editor commands affects public behavior outside this folder.
- O3 is the least crisp part of the plan. It proposes a synchronous handled verdict plus deferred async editor start, while also saying the orchestrator should await consistently. Those are different contracts. The production orchestrator currently relies on `cellInteraction.handleCellClick` being synchronous before later async table handling, so the final contract should define exactly which side effects happen before return, which happen after return, and whether selection fallback is suppressed by a returned `true`.
- O5 says to use canonical word-boundary exports, but names `findPrev/NextWordBoundary`; the canonical previous helper is `findPreviousWordBoundary`. More importantly, replacing the `selectRight()` loop depends on a concrete editor API that does not appear to exist yet. The plan should specify the command name, event payload, selection-anchor semantics, and tests at the machine level.
- O6 has a small inconsistency: the objectives mention moving `FILTER_BUTTON` geometry into shared constants, while the implementation sequence first deletes the filter-button hit-test and later says to move only validation/comment constants. The latter is likely correct, but the objective should match.
- Deleting barrel exports for warp-adjust and filter helpers is probably safe inside `apps/spreadsheet/src`, but the plan should require a repo-wide import search, not only a search excluding the folder, before removal. These are exported symbols and could be consumed by tests or nearby packages through a barrel.
- O8 is valuable but under-specified. "Iterate actual rendered regions" is the right direction, but the plan does not name the capability shape, ordering rules for overlapping frozen/main regions, coordinate-space contract, or how `moveFormulaRangeDrag` should stay pane-aware after the drag starts.

Contract and verification assessment

The preservation contracts are the best part of the plan. They identify the behavior that could be accidentally broken while making cleanups: context-menu default-prevention rules, full-row/full-column selection preservation, protected-cell alerts, active-sheet filtering for formula ranges, and caret placement using the actual canvas font and padding. That is exactly the level of contract needed for pointer code.

Verification is good but should be made more executable. "Workspace typecheck for `@mog/spreadsheet`" should be replaced with the exact package command. Since this folder owns pointer, drag, and context-menu input paths, at least one browser-driven app-eval or Playwright path should exercise real pointer/right-click/double-click input rather than only hook calls. For O3 in particular, a test must prove that validation dropdown clicks do not fall through to selection or table handling on the same event.

Concrete changes that would raise the rating

- Split the plan into an in-folder batch and named cross-folder contracts, with explicit owning packages and exact files for each dependency.
- Rewrite O3 as a precise API contract: return type, ordering, handled semantics, allowed async side effects, and orchestrator call-site behavior.
- Define the editor `selectRange` or `selectWord` event contract before asking implementers to replace the `selectRight()` loop.
- Make O6 internally consistent by deleting all references to shared `FILTER_BUTTON` constants if the filter hit-test is removed.
- Specify the rendered-region capability needed for O8, including coordinate spaces and frozen-pane precedence.
- Replace generic verification commands with exact commands and add at least one real UI input-path gate for pointer/context-menu behavior.
