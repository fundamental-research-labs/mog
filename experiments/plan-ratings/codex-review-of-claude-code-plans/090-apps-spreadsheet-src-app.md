Rating: 8/10

Summary judgment

This is a strong, source-grounded plan for `mog/apps/spreadsheet/src/app`. It correctly treats this folder as a production composition root rather than a miscellaneous React component folder, and it identifies the highest-risk live surfaces: document-level keyboard capture, editor dependency construction, dead export indicators, the `onUIAction` protocol, and the orphaned multi-view shell files.

The plan is not a 9 or 10 because some diagnoses move faster than the evidence supports. Most notably, range-selection dialog minimize/restore is not simply unimplemented: `startRangeSelectionMode`, `completeRangeSelection`, `cancelRangeSelection`, `minimizeStack`, `restoreStack`, and `MinimizableDialog` already form a UI-store-owned minimize/restore path. The no-op callbacks in `CoordinatorProvider.tsx` may still be misleading or obsolete, but the plan should audit the existing dialog/store contract before prescribing new callback-driven behavior. Several other phases are cross-folder or product-decision work and need sharper acceptance contracts before implementation.

Major strengths

- The evidence is mostly accurate. `CoordinatorProvider.tsx` is a large composition file, keyup capture is the only extracted keyboard unit, keydown routing is branch-heavy and untested in isolation, `editorDependencies` embeds nontrivial commit and validation behavior, `SpreadsheetIndicators` is rendered with `exportNotification={null}`, and `Shell`/`ViewSwitcher`/`RecordDetailSidebar` have no apparent production callers.
- The plan is production-path oriented. It focuses on the app entry wiring that every edit, shortcut, validation dialog, and coordinator action flows through, and it avoids optimizing harness-only paths.
- The keyboard invariants section is valuable. IME ordering, capture-phase routing, Escape bubbling with dialogs, suggestions/picker deferral, focus-layer exclusion, and handled-only `preventDefault`/`stopPropagation` are exactly the contracts an implementation must preserve.
- The `editorDependencies` extraction objective is architecturally sound. Moving commit, validation, circular-reference, datetime, structured-reference, and array-formula behavior behind an explicit factory would make a high-blast-radius contract testable without mounting the full provider.
- The plan recognizes real cross-folder dependencies instead of pretending all fixes fit inside `src/app`. `index.tsx`, `systems/input`, `views`, UI store slices, and chart/action handler migration all affect whether the app-level surface is correct.
- The parallelization notes are sensible: keydown extraction and editor-dependency extraction are independent enough to run concurrently, while index wiring, range-selection UI, shell convergence, and type-boundary hardening need coordination.

Major gaps or risks

- The range-selection diagnosis is overstated. The callbacks passed from `RangeSelectionCoordinatorSetup` are no-ops, but the current store and dialog components already minimize and restore dialog stacks from `rangeSelectionMode`. The plan should first prove the production collapse/restore behavior is broken through a real dialog flow, then decide whether to delete the callbacks as obsolete, wire them to existing stack actions, or add missing test coverage.
- Phase 4 needs a more concrete export-notification design. `index.tsx` currently has a bespoke `handleExport` and `isExporting` state, while `useExport` exists elsewhere. "Thread the live export hook" is not precise enough unless the plan says whether to replace the bespoke XLSX export path with `useExport`, extend it with notifications, or remove `SpreadsheetIndicators`.
- The `onUIAction` repair is directionally correct but should bias harder toward retiring the string protocol. Several handlers and comments already describe migration away from unwired `onUIAction`; simply passing a real handler from `index.tsx` risks preserving a deprecated escape hatch unless the remaining actions are inventoried and intentionally kept.
- The keydown "pure decision function" contract is underspecified. Passing a live `KeyboardEvent` to `decideKeydownRouting` is not very pure; a safer contract would pass a normalized key/modifier/target snapshot plus precomputed target classifications. The plan also says the effect keeps the IME guard first, while the proposed unit-test list includes the IME guard, so ownership of that invariant needs to be explicit.
- The editor-dependencies factory tests may be harder than stated if helper behavior remains hidden behind direct imports such as `checkCalculatedColumnAutoFill` and the datetime dynamic import. Either inject those helpers for tests or classify the tests as integration-style stubs around a realistic workbook.
- Phase 5 is too product-shaped for a cleanup plan. Converging the orphaned shell onto the canonical view system may be right, but absent a product decision it is not clearly better than deleting or parking dead placeholder components. The plan should define the intended multi-view entry path before asking agents to build wiring around it.
- Type-boundary hardening is valid, but the plan should inventory all casts and sibling casts. For example, similar UI-store superset casting exists outside this file, so fixing only the app provider may not solve the category.

Contract and verification assessment

The contract section is one of the plan's best parts. It names the keyboard, editor commit, validation, circular-reference, focus-layer, and DAG-boundary invariants that matter most. The plan would be safer if it also defined the new contracts it introduces: exact `coordinator-keydown-capture` input/output types, the editor-dependency factory dependency interface, the export-notification state source, and the final disposition of `onUIAction`.

Verification is directionally good but not executable enough. The app package is `@mog/app-spreadsheet`, while the plan says `@mog/spreadsheet`; exact commands should use the package script surface, for example targeted Jest under `apps/spreadsheet` plus `pnpm --filter @mog/app-spreadsheet typecheck`. The app-eval coverage list is appropriate for production behavior, but the plan should name scenario files to create or existing scenarios to run, especially for keyboard routing, range-selection dialog collapse/restore, export notifications, and `onUIAction`-backed commands. UI wiring changes should also include a browser/dev-server smoke pass through the real app.

Concrete changes that would raise the rating

- Replace Phase 3 with an explicit audit of the existing `rangeSelectionMode` plus `MinimizableDialog` path, then specify whether callbacks are deleted, wired to stack actions, or covered by regression tests.
- Define `coordinator-keydown-capture` as a true snapshot-based decision contract, including ownership of the IME preguard and exact handled-only side effects.
- Make `createEditorDependencies` dependency injection explicit enough to test calculated-column auto-fill, datetime conversion, formula syntax qualification, and async rejection propagation deterministically.
- Restate Phase 4 as either "adopt `useExport` for the root XLSX path and feed `SpreadsheetIndicators`" or "delete the dead indicator surface"; do not leave both plausible.
- Inventory all remaining `onUIAction` producers and consumers, then choose one endpoint: complete migration to direct UI store/state surfaces or intentionally wire the protocol with tests.
- Gate Phase 5 on a product/architecture decision for multi-view shell ownership, and allow removal of dead placeholder components if they are not intended to become the canonical path.
- Replace generic verification bullets with exact package commands and named Jest/app-eval scenario files.
