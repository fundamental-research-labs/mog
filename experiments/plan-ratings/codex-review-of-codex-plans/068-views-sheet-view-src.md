Rating: 8/10

Summary judgment

This is a strong, source-grounded plan for turning `@mog-sdk/sheet-view` into a real public capability substrate instead of a partly public wrapper over renderer internals. It correctly identifies the production escape hatches (`__mogInternalGridRenderer`, raw `GridRenderer`, `updateContext()`), the untyped public contract holes (`SheetViewDataSources`, `SheetViewportConfig`, `SheetViewportLayout`), and the hit-test mismatch between the public union, `UnifiedHitResult`, and lower-level grid hit-test providers. The plan is unusually complete on invariants and verification, and it keeps the work on the production spreadsheet path.

The main reason it is not a 9 or 10 is that it is still more of an architectural program than an implementation-ready contract in several places. It names the right categories, but does not enumerate the exact final public DTOs, current `RenderContextConfig` key inventory, expected API snapshot delta, backward-compatibility/deprecation policy, or per-phase acceptance criteria tightly enough for parallel agents to implement without re-specifying significant details.

Major strengths

- The plan is well calibrated to the folder's role: it treats `views/sheet-view/src` as a public package boundary and centers package-root imports, owned DTOs, API snapshots, docs, and app migration.
- It is grounded in real current code. The claims about hidden renderer access, data-source passthroughs, untyped viewport types, `render-state` silent ignores, and missing hit-test coverage are supported by the source.
- It avoids test-only optimization and requires migration of the actual spreadsheet app path, not just package-local mocks.
- The hit-test section is especially valuable because it recognizes that fixing only `views/sheet-view/src/capabilities/type-mappers.ts` would leave unreachable public variants and would not prove real UI behavior.
- Verification expectations are broad and appropriate for the blast radius: sheet-view package tests/typecheck/build, API snapshot control, renderer/app tests where changed, repo typecheck unless narrowed, and browser exercise for UI-affecting changes.
- The sequencing and parallelization notes identify sensible slices and the cross-folder dependencies that must converge on one public contract.

Major gaps or risks

- The typed data-source work is described by category examples rather than a complete field inventory. A plan at this level should list every current production `RenderContextConfig` key pushed by `useRenderContextConfig`, `RendererExecutionResult.updateContext`, and direct app calls, with its target public group, callback signature, nullability, ownership, and internal mapper key.
- The public API migration strategy is underspecified. Removing or replacing `SheetViewDataSources = Record<string, unknown>`, `SheetViewportLayout = unknown`, and hidden renderer access is a breaking public/package behavior change unless the plan defines deprecation windows, compatibility aliases, versioning expectations, and the exact expected API snapshot diff.
- The viewport DTO section says to mirror "only the view semantics hosts need" but does not define the final discriminated unions, layout shape, overlay semantics, or whether public layout should use arrays, maps, immutable snapshots, viewport roles, pane IDs, and coordinate-space tags. That leaves high-risk design work to implementers.
- Lifecycle semantics are requested as a "table in code comments or docs"; for a public package this should be an explicit API contract, with a method-by-method matrix of post-dispose behavior, observer disposal behavior, emitted events, and owned resources.
- The plan is very large for one improvement stream. It spans public API design, grid renderer hit-test internals, spreadsheet app migration, docs, API snapshots, object scene behavior, overlays/decorations/layers, and browser validation. That breadth is architecturally valid, but the plan needs clearer phase boundaries and "stop/go" criteria to prevent partially landed public contracts.
- The object and extension-layer work is less tightly connected to the core objective than the capability/data-source/hit-test/viewport migration. It may be correct scope, but it should be explicitly prioritized or split as a follow-on unless required to remove renderer internals.
- It does not call out performance regression checks for the `updateContext` dispatch-table path. Typed data-source adapters must preserve the current low-allocation, field-specific update behavior.

Contract and verification assessment

The contract direction is correct: public consumers should import only `@mog-sdk/sheet-view`; SheetView should own its public DTOs; internal renderer, viewport, and canvas types should be adapted at the package boundary; API snapshot changes should be deliberate. The plan also correctly treats the spreadsheet app as a production consumer that must migrate to the same capability surface external users get.

The contract clarity is strongest for invariants and weakest for exact final shapes. The plan should replace "for example" data-source groups and broad viewport-layout bullets with concrete TypeScript-like definitions or a key-by-key mapping table. It should also define whether any generic escape hatch remains, what qualifies as intentionally opaque user/plugin payload, and how unknown future renderer config is prevented from leaking back into the public package.

The verification gates are appropriate and better than average. The plan names package tests, package typecheck/build, API snapshot verification, targeted renderer/app tests, repo typecheck unless justified, and browser exercise with real UI paths. What is missing is a precise command for API snapshot verification/update, exact app test targets for the known production callers, and acceptance criteria for "no hidden renderer dependency remains" such as a grep gate for `__mogInternalGridRenderer`, `getRenderer()`, and raw `updateContext()` in production app code.

Concrete changes that would raise the rating

- Add a complete current-to-target data-source mapping table: every `RenderContextConfig` key currently pushed from the app, its typed SheetView group, public callback signature, internal adapter setter, dirty/invalidation behavior, and tests.
- Include the exact proposed public DTO definitions for viewport config/layout and data-source groups, or at least a normative schema appendix detailed enough for parallel implementation.
- Add an API compatibility section covering breaking vs additive changes, deprecation/removal of `SheetViewDataSources`, `SheetViewportLayout`, `getRenderer()`, and `__mogInternalGridRenderer`, plus the expected API snapshot changes.
- Split the work into contract milestones with acceptance gates: contract/API definitions, mapper coverage, app migration, hidden renderer removal, docs/snapshots, browser verification.
- Add mechanical grep/type gates proving production callers no longer use raw renderer handles or raw `updateContext()` except in explicitly documented debug/test paths.
- Specify performance constraints for the typed data-source adapter so the migration preserves the renderer's current field-dispatch and low-allocation update path.
- Promote lifecycle semantics from comments into a public method-by-method contract table and test matrix.
