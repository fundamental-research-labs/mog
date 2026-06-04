Rating: 8/10

Summary judgment

This is a strong, source-grounded plan for `mog/apps/spreadsheet/src/components/grid`. It correctly treats the folder as the app-facing grid integration boundary rather than as a cell-rendering implementation, and it identifies the main production risks: `SpreadsheetGrid.tsx` has become a very large composition root, `useRenderContextConfig` is a broad callback push surface with migration-pending comments and direct `updateContext()` effects, editor overlays are independently mounted, async worksheet reads are only locally cancelled, and overlay geometry frequently collapses multi-rect results to `rects[0]`.

The plan earns a high rating because it specifies the right architectural direction: typed contracts, source-of-truth ownership, sheet/generation scoping, page-vs-container overlay geometry, real input-path verification, and production-path performance measurement. It is not a 9 or 10 because the implementation plan is too large as a single workstream and several of its highest-risk contracts are described directionally rather than as crisp deliverables with acceptance criteria.

Major strengths

- The scope is accurate. The plan covers `SpreadsheetGrid.tsx`, the `effects`, editor overlays, layout scroll/split code, tooltip/accessibility surfaces, and the adjacent hooks/coordinator/renderer packages that this folder actually depends on.
- The diagnosis matches the source. Evidence includes a 1000+ line `SpreadsheetGrid.tsx`, a large `useRenderContextConfig.ts` with 30+ callback registrations, direct context pushes for floating objects, trace arrows, page breaks, and remote cursors, untyped casts in `useSparklineCFIntegration`, `String.fromCharCode()` table range growth, rich-text TODOs, split-box placeholders, and repeated `rects[0]` overlay anchoring.
- The plan keeps package boundaries clear. It says this folder should compose public renderer/coordinator capabilities, not reimplement rendering, hit testing, viewport layout, binary parsing, or print/export internals.
- The contract inventory objective is the right first move. This folder is an integration hub, so an executable inventory over render context fields, overlays, editor surfaces, event listeners, and invalidation paths would provide real leverage before refactoring.
- The production-path focus is strong. The plan explicitly rejects test-only routes, calls for browser verification through real UI input paths, and ties performance work to the real spreadsheet grid rather than mocks.
- The verification section is unusually complete. It lists relevant package gates, dependent package gates, browser behaviors to exercise, and specific test categories for async scoping, geometry, editors, rich text, picker behavior, scrollbars, split panes, accessibility, and print/page-break preview.
- The parallelization notes are credible. The proposed agent split follows real seams: registry/inventory, `SpreadsheetGrid` extraction, async adapters, geometry helpers, editor router/rich text, type cleanup, split/scrollbar work, accessibility/render isolation, and browser verification.

Major gaps or risks

- The plan is too broad for one coherent implementation slice. It includes runtime extraction, a render data-source registry, async adapter migration, overlay geometry centralization, an editor router, full rich-text editing, picker hardening, split/scrollbar integration, type cleanup, print/page-break adapter work, render isolation instrumentation, accessibility expansion, and cross-package caller updates. Those are all plausible, but the plan needs a sharper critical path and milestone boundaries.
- The typed render data-source registry is underspecified. The plan says each entry should declare source kind, consumer capability, `undefined` vs `null`, invalidation, and scoping, but it does not define the registry shape, where it lives, how it relates to existing renderer `RenderContextConfig`, or how exhaustiveness is mechanically checked against upstream context fields.
- The async scoping contract needs a more precise consume-side policy. A shared `useSheetScopedAsyncValue` helps React effects, but several reads are renderer-invoked callback promises. Those need sheet identity, renderer current sheet, workbook revision or dependency key, and generation validation at the point the renderer accepts data, not only inside React hook cleanup.
- The overlay geometry policy is directionally right but incomplete. The plan says multiple rects must be handled explicitly, yet it does not define how to choose anchors for dropdowns, date pickers, paste options, and editors when a range spans frozen or split panes. This policy should be specified before migration.
- The editor router and rich-text editor completion are coupled too tightly. Routing editor surfaces is a boundary cleanup; full rich-text segment editing may require editor machine and Worksheet API changes. The plan should separate the router contract from rich-text feature completion unless the rich-text storage/write APIs are already confirmed.
- Verification breadth is high, but acceptance thresholds are thin. Render isolation should name concrete expected render counts or upper bounds for scroll, selection, cache updates, and cursor movement. Browser verification should map to specific app-eval or Playwright scenarios rather than a very broad manual checklist.
- The plan does not explicitly require characterization tests before the largest extraction. It mentions preserving existing plain-text contracts and adding tests, but the first refactor step after inventory should lock current behavior for editor focus, input listeners, scroll sync, and context pushes before moving code.

Contract and verification assessment

The contract framing is the plan's strongest quality. It correctly identifies contracts that matter at this boundary: sheet-aware renderer callbacks, binary viewport data as the hot-path source where available, coordinator/state machines as owners of user intent, explicit async generations, page-coordinate vs container-local overlay geometry, multi-rect frozen/split panes, scrollbars and InputCoordinator as one scroll model, native browser editing behavior, accessibility live regions, and render isolation.

The verification gates are also mostly appropriate. `cd mog/apps/spreadsheet && pnpm test`, app package typecheck, repo typecheck for shared TypeScript contracts, dependent package gates for renderer/sheet-view/print changes, and browser verification through real UI input paths are the right categories. The plan respects the production-path rule for performance work and calls out that E2E tests must not mutate renderer state directly.

The main verification weakness is lack of prioritization and measurable pass/fail criteria. For example, "measure React render counts" should become explicit thresholds or snapshots per interaction. "Exercise the real grid in a browser" should become named scenarios covering the core contract paths. The registry inventory should fail in CI when a new renderer context field lacks a disposition, but the plan should say exactly what source of truth is introspected or enumerated.

Concrete changes that would raise the rating

- Split the implementation into required phases with hard exit criteria: contract inventory and characterization tests first; registry and async scoping second; geometry helpers third; editor router fourth; rich-text completion and print adapter as separate dependent workstreams.
- Specify the `GridRenderDataSourceRegistry` API shape, its source-of-truth relationship to renderer context types, and the exact exhaustiveness mechanism that fails on missing dispositions.
- Define the async generation contract at both producer and renderer-consumer boundaries, including sheet id, renderer current sheet id, dependency key, workbook/sheet revision where available, cancellation behavior, and fallback semantics.
- Add explicit overlay anchor policies for frozen/split/multi-rect cases before requiring migration away from `rects[0]`.
- Separate the editor surface router acceptance criteria from full rich-text editing. Confirm the editor machine and Worksheet API rich-text contract before including segment-preserving commit/cancel as part of the same change.
- Convert the browser verification checklist into named E2E/app-eval scenarios with real keyboard, mouse, pointer, wheel, clipboard, and focus paths.
- Add concrete render-isolation thresholds, such as expected parent render counts for scroll frames, selection changes, cell cache invalidation, chart cache updates, and editor cursor movement.
- Include a rollback-safe migration sequence for `SpreadsheetGrid` extraction so subscriptions, native listeners, context pushes, and overlay mounting can be moved without changing behavior in the same patch that changes contracts.
