# 007 - types/bridges/src Bridge Contract Hardening Plan

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/types/bridges/src`

Package: `@mog/types-bridges`

This folder currently contains the bridge contract package for spreadsheet cross-layer adapters:

- `chart-bridge.ts`
- `diagram-bridge.ts`
- `equation-bridge.ts`
- `index.ts`
- `ink-recognition-bridge.ts`
- `locale-bridge.ts`
- `pivot-bridge.ts`
- `schema-bridge.ts`
- `text-effect-rendering-bridge.ts`

In scope:

- TypeScript interface and handoff payload definitions owned by `@mog/types-bridges`.
- Root and subpath export policy for `@mog/types-bridges` and its public projection through `@mog-sdk/contracts/bridges`.
- Contract alignment with production consumers in `kernel`, `types/api`, `types/rendering`, `canvas`, `charts`, `runtime/sdk`, and native chart rasterization.
- Runtime schema ownership for bridge handoffs that leave TypeScript, especially chart mark raster requests.
- Type-level and behavior verification that real production bridge implementations satisfy these contracts.

Out of scope:

- Rewriting pivot, chart, diagram, ink, equation, schema, locale, or text-effect algorithms.
- Adding new spreadsheet features.
- Test-only shims or compatibility wrappers around old bridge shapes.
- Changing the dependency direction: public `mog` packages must not depend on `mog-internal`.

## Current role of this folder in Mog

`@mog/types-bridges` is a workspace-internal type shard that becomes part of the public SDK contract through `@mog-sdk/contracts`. It is listed in the root project references and in `pnpm-workspace.yaml`, and `contracts/scripts/rollup-public-dts.mjs` bundles it into public declaration output.

The package is a Tier 2 contract layer over `@mog/types-core`, `@mog/types-commands`, `@mog/types-culture`, `@mog/types-data`, `@mog/types-events`, and `@mog/types-objects`. It does not own bridge implementations. The implementations live primarily in `kernel/src/bridges` and `kernel/src/domain/*`, with additional consumers in rendering, canvas, charts, runtime SDK export, and native chart rasterization.

Observed production consumers:

- `kernel/src/bridges/pivot-bridge.ts` implements `IPivotBridge` and delegates pivot config and computation to Rust/Yrs through `ComputeBridge`.
- `kernel/src/bridges/schema-bridge.ts` implements `ISchemaBridge` and processes Rust validation annotations into cell metadata and validation events.
- `kernel/src/bridges/locale-bridge.ts` implements `ILocaleBridge` using `@mog/culture`.
- `kernel/src/domain/charts/chart-bridge.ts` implements `IChartBridge`; `renderCached()` is synchronous canvas paint-path code, while `getMarksAtSize()` feeds SDK and native image export.
- `runtime/sdk/src/chart-export/node-chart-image-exporter.ts` serializes `ChartMark[]` into a versioned JSON request for `compute/core/crates/compute-chart-render`.
- `charts/src/primitives/types.ts` aliases chart engine primitives back to `ChartMark`, making this folder the canonical chart render IR owner.
- `types/api/src/kernel/kernel-context.ts` exposes all spreadsheet bridges on `ISpreadsheetKernelContext`.
- `types/api/src/api/worksheet/pivots.ts` exposes public worksheet pivot placement payloads that duplicate the bridge placement shape.
- `contracts/src/bridges/*` mostly re-export from `@mog/types-bridges`, but `contracts/src/bridges/ink-recognition-bridge.ts` currently duplicates the full ink bridge contract to own the public runtime `DEFAULT_RECOGNITION_THRESHOLDS` value.

Important evidence from inspection:

- `types/bridges/src` has no local tests or contract fixtures.
- `types/bridges/package.json` has only `typecheck: tsc -b .`.
- `pivot-bridge.ts` exports `PivotBridgePlacementSpec` and `PivotBridgePlacementPatch`, but `index.ts` does not re-export them.
- `kernel/src/bridges/pivot-bridge.ts` redeclares the pivot placement spec and patch locally, then widens the implementation patch with `sortByValue`; the public bridge contract has a dedicated `setSortByValue()` method.
- `types/api/src/api/worksheet/pivots.ts` has a separate `PivotPlacementSpec` and `PivotPlacementPatch` with the same shape.
- `schema-bridge.ts` defines `SchemaValidationOptions`, and `kernel/src/bridges/schema-bridge.ts` redeclares it locally.
- `IChartBridge` documents sheet-scoped duplicate chart IDs, and the implementation accepts optional `sheetId` on several cache methods, but the interface only exposes that scope on `renderCached()` and `ensureCompiled()`.
- The native chart raster request schema is local to `runtime/sdk/src/chart-export/node-chart-image-exporter.ts` and the Rust deserializer, not owned by this bridge contract package.
- Several chart tests cast `{ type: 'group' }` through `unknown as ChartMark[]`, while the production `ChartMark` union only includes `rect`, `path`, `arc`, `text`, and `symbol`.
- `DEFAULT_RECOGNITION_THRESHOLDS` is exported from `@mog/types-bridges` and separately from `@mog-sdk/contracts/bridges`, with the public runtime inventory marking the contracts copy as the source of truth.

## Improvement objectives

1. Make `@mog/types-bridges` the single TypeScript source of truth for bridge handoff shapes, not one of several copies.
2. Keep public runtime values owned by `@mog-sdk/contracts`, and make `@mog/types-bridges` effectively type-only unless a runtime value is explicitly required and inventoried.
3. Centralize portable cross-runtime schemas, especially chart mark raster request V1, so TypeScript serializers and Rust deserializers are verifying the same contract.
4. Strengthen bridge method signatures around branded IDs, cache scoping, lifecycle semantics, async/sync boundaries, and mutation payloads.
5. Add contract tests that compile real production implementations against the bridge interfaces without casts or redeclared payload types.
6. Make declaration rollups, API snapshots, and external fixtures catch drift between `@mog/types-bridges` and `@mog-sdk/contracts/bridges`.
7. Preserve production behavior: charts must keep synchronous paint, pivots must keep Rust-backed config state, schema validation annotations must keep the Rust recalc path as the source, and runtime-only caches must not become persisted state.

## Production-path contracts and invariants to preserve or strengthen

- `@mog/types-bridges` owns type identities for bridge contracts; consumers import or alias these types rather than redeclaring equivalent shapes.
- `@mog-sdk/contracts/bridges` is the public SDK facade. Published declarations must not leak private package imports after rollup.
- Public runtime values are contracts-owned and verified by `tools/contracts-runtime-inventory.json`; private type shards should not become accidental public runtime dependencies.
- `IChartBridge.renderCached()` remains synchronous and non-throwing for normal cache misses. It must never `await`, return a promise, or do data resolution in the canvas paint path.
- Chart compilation and export must use the same `ChartMark` IR from browser canvas through Node SDK serialization into the native Rust rasterizer.
- Chart mark IR values must be finite, serializable, and discriminated. Unsupported richer paints must be projected explicitly at the export boundary rather than silently accepted by native rasterization.
- Chart cache keys must be able to distinguish duplicate imported chart IDs by sheet and render frame where the implementation already requires that distinction.
- `IPivotBridge` CRUD and placement operations continue to delegate to Rust-backed pivot config storage. No TypeScript pivot store should be reintroduced.
- `updatePlacement()` should update only generic placement fields. Value sort mutation belongs to `setSortByValue()` unless the public contract deliberately changes.
- Pivot and chart sheet IDs should use the branded `SheetId` type at the bridge layer wherever the implementation requires a resolved sheet identity.
- `ISchemaBridge` processes Rust recalc annotations into metadata and validation events exactly once. On-demand validation may be async internally, but the contract must make fire-and-forget behavior explicit where the method returns `void`.
- Locale normalization stays a pure culture lookup plus normalization operation; no stale side cache should be part of the contract.
- Diagram and text-effect computed layout/drawing-object caches remain runtime-only and are cleared on stop/destroy. They are not persisted to Yjs.
- Ink recognition thresholds and confidence scores are bounded in `[0, 1]`; `getThresholds()` returns a defensive copy, and `setThresholds()` must not accept out-of-range values silently.
- Equation parsing remains side-effect-free and deterministic. If lifecycle is intentionally absent from `IEquationBridge`, the implementation's `destroy()` remains an internal singleton reset detail rather than a document context contract.

## Concrete implementation plan

1. Establish explicit bridge ownership rules.

   - Add a short contract ownership note in `types/bridges/src/index.ts` or a package-local contract document explaining that `types/bridges/src` owns bridge type shapes, while `contracts/src/bridges` owns public runtime values and public projection.
   - Audit every exported bridge type and decide whether it belongs in the root barrel or only in a domain subpath. Prefer exporting operation payloads and result types from the root when methods on root-exported bridge interfaces mention them.
   - Update `types/bridges/src/index.ts` to re-export missing method payload and helper types that production consumers need by name, including pivot placement spec/patch and chart style/mark helper types.

2. Remove duplicate pivot placement contracts.

   - Promote `PivotBridgePlacementSpec` and `PivotBridgePlacementPatch` as the canonical placement operation payloads.
   - Rename them if needed to the user-facing names `PivotPlacementSpec` and `PivotPlacementPatch`, or provide exact type aliases with one canonical source.
   - Update `types/api/src/api/worksheet/pivots.ts` to alias the canonical bridge types instead of redeclaring the same shape.
   - Update `kernel/src/bridges/pivot-bridge.ts` to import the canonical spec/patch types from `@mog-sdk/contracts/bridges`.
   - Remove the implementation-only widened `PivotBridgeInternalPlacementPatch` from the public `updatePlacement()` path. Keep `sortByValue` mutation in `setSortByValue()` and any private helper should not be accepted through the public patch signature.
   - Normalize `IPivotBridge` sheet parameters from plain `string` to `SheetId` where the implementation and call sites require branded IDs.

3. Remove duplicate schema options.

   - Make `SchemaValidationOptions` in `types/bridges/src/schema-bridge.ts` the only option type.
   - Update `kernel/src/bridges/schema-bridge.ts` to import that type and delete the local redeclaration.
   - Make the contract explicit about which methods are fire-and-forget (`validateCell`) and which return a promise (`validateColumn`, `validateSheet`, query methods). If keeping `void | Promise<void>` is intentional for implementation flexibility, encode it consistently.

4. Fix public contracts facade drift for ink recognition.

   - Convert `contracts/src/bridges/ink-recognition-bridge.ts` into a type re-export shim plus a local contracts-owned `DEFAULT_RECOGNITION_THRESHOLDS` value typed with `RecognitionThresholds` from `@mog/types-bridges/ink-recognition-bridge`.
   - Remove the full duplicate interface/type declarations from the contracts copy.
   - Decide whether `@mog/types-bridges` should continue exporting the runtime constant. Preferred direction: make `@mog/types-bridges` type-only, remove its runtime `DEFAULT_RECOGNITION_THRESHOLDS` export, and keep all runtime consumers on `@mog-sdk/contracts/bridges`.
   - Update `tools/contracts-runtime-inventory.json` only if the runtime export set changes. The expected public runtime source should remain contracts-owned.
   - Add threshold validation in the ink bridge implementation so the `[0, 1]` invariant is enforced at runtime, not just documented.

5. Make chart portable schemas first-class.

   - Add exported type definitions for the native raster request V1 currently local to `runtime/sdk/src/chart-export/node-chart-image-exporter.ts`: request, options, serializable marks, serializable style, serializable clip, symbol shape, and request version.
   - Keep those as types in `chart-bridge.ts`; the Node exporter can still own the actual runtime `version: 1` literal.
   - Update the Node chart image exporter to use the canonical serializable request types and `satisfies` checks instead of local duplicate type declarations.
   - Add a type-level exhaustive mapping from `ChartMark['type']` to serializable mark variants so adding a new mark type forces Node export and native raster updates.
   - Keep Rust as the runtime validator for malformed JSON, but align field names and supported mark variants with the TypeScript schema.
   - Add tests that reject unsupported runtime mark types without casting production fixtures to `ChartMark`.

6. Clarify chart cache scope and browser-only paint boundaries.

   - Introduce explicit types such as `ChartCacheScope`, `ChartCacheUpdateTarget`, or equivalent to model `chartId`, optional `sheetId`, and optional render frame scope.
   - Update `IChartBridge` cache methods to match the implementation where sheet-scoped duplicate chart IDs matter: `invalidateChart`, `isChartDirty`, and `clearDirtyFlag` should either expose the optional scope or the implementation should stop accepting unused parameters.
   - Preserve `renderCached()` as the only browser-canvas paint method on `IChartBridge`; document that Node/headless callers use `getMarksAtSize()` and `getRenderSnapshotAtSize()`.
   - Avoid moving DOM-specific canvas types into portable chart mark schema types. The native raster request types must not require DOM lib concepts.

7. Normalize lifecycle contracts.

   - Add small shared lifecycle types if they improve clarity, for example `BridgeDisposable`, `BridgeStartable`, and `BridgeDestroyable`, without forcing every bridge into the same lifecycle if the production path differs.
   - Make chart, diagram, text-effect, schema, pivot, locale, and ink lifecycle requirements match the document context destroy path.
   - Leave equation stateless unless there is a production need for document-scoped cleanup. If the implementation keeps `destroy()` for singleton tests, keep that outside `IEquationBridge` or explicitly add it and update context teardown.

8. Add contract conformance checks in production consumers.

   - In `kernel`, add type-only conformance fixtures that instantiate or reference `PivotBridge`, `SchemaValidationBridge`, `LocaleInputBridge`, `ChartBridge`, `DiagramBridge`, `TextEffectRenderingBridge`, `EquationBridge`, and the ink factory through their bridge interfaces.
   - These fixtures should fail if implementations narrow parameters, widen accepted public payloads, omit lifecycle methods, or require casts.
   - Keep implementation package tests in the implementation packages to avoid making `@mog/types-bridges` depend on `kernel`.
   - Add type-only external fixtures for `@mog-sdk/contracts/bridges` root and subpaths proving the public facade exports the same bridge types and only the intended runtime values.

9. Update documentation and generated contract artifacts.

   - Update chart and pivot internal docs where they reference bridge method signatures or native export schema ownership.
   - Regenerate API snapshots and generated API specs only as a consequence of real public type changes, then review the diff for accidental surface expansion.
   - Update package inventory/runtime inventory only for deliberate export policy changes.

## Tests and verification gates

Run these after the implementation, not during this planning task:

- `pnpm --filter @mog/types-bridges typecheck`
- `pnpm --filter @mog/types-api typecheck`
- `pnpm --filter @mog-sdk/contracts build`
- `pnpm --filter @mog-sdk/kernel typecheck`
- `pnpm --filter @mog-sdk/kernel test -- pivot-bridge`
- `pnpm --filter @mog-sdk/kernel test -- schema-bridge`
- `pnpm --filter @mog-sdk/kernel test -- ink-recognition-bridge`
- `pnpm --filter @mog-sdk/kernel test -- chart-bridge`
- `pnpm --filter @mog-sdk/kernel test -- chart-render-cache`
- `pnpm --filter @mog-sdk/kernel test -- chart-render-orchestrator`
- `pnpm --filter @mog-sdk/kernel test -- diagram-bridge`
- `pnpm --filter @mog-sdk/kernel test -- text-effects-bridge`
- `pnpm --filter @mog/charts typecheck`
- `pnpm --filter @mog/charts test`
- `pnpm --filter @mog-sdk/node typecheck`
- `pnpm --filter @mog-sdk/node test -- node-chart-image-exporter`
- `cargo test -p compute-chart-render`
- `cargo clippy -p compute-chart-render`
- `pnpm check:contracts-runtime-inventory`
- `pnpm check:declaration-rollups`
- `pnpm check:api-snapshots --update` when the public API surface intentionally changes, followed by review of the snapshot diff and `pnpm check:api-snapshots`
- `pnpm check:external-fixtures -- --skip-build`
- Repo-wide `pnpm typecheck` after scoped gates pass, because this is a TypeScript contract surface that feeds many packages.

If chart paint behavior, pivot placement UI behavior, or schema validation UI behavior changes during implementation, also run the spreadsheet app dev server and exercise the real UI path for:

- Adding a pivot, moving placements, setting sort by value, and refreshing.
- Editing a cell that triggers Rust validation annotations and observing validation metadata/events.
- Rendering an embedded chart, exporting it through browser image export, and exporting through the Node SDK path.
- Creating/editing diagram and text-effect objects to verify runtime cache invalidation still occurs.

## Risks, edge cases, and non-goals

Risks:

- Public declaration rollup can accidentally inline or leak private package identities if the contracts facade imports runtime from `@mog/types-bridges`.
- Removing the private runtime export for `DEFAULT_RECOGNITION_THRESHOLDS` requires confirming no direct runtime imports remain from `@mog/types-bridges`.
- Tightening `string` to branded IDs can reveal broad call sites that pass unbranded strings. Fix those at the boundary by branding resolved IDs, not by weakening the bridge contract.
- Adding chart serializable request types can create false confidence if the Rust deserializer is not tested against the same shape. Keep Rust tests in the gate.
- Widening chart cache scope in `IChartBridge` may require updates in canvas/rendering consumers even if they currently ignore the scope.
- `ChartMark` should not add test-only variants such as `group` merely to satisfy cast-heavy tests. Tests should use valid production marks or explicit invalid-runtime inputs.
- Lifecycle unification can become over-abstracted. Add shared lifecycle aliases only where they make real teardown contracts clearer.

Edge cases to cover:

- Duplicate imported chart IDs on different sheets.
- Dirty chart with stale marks while compilation is pending.
- Native chart export with gradients, patterns, images, opacity, dash arrays, rich text, unsupported mark types, empty marks, and non-finite coordinates.
- Pivot calculated-field placements, value placements, sort by value, null reset operations, and placement ID preservation.
- Schema annotations with zero errors, multiple warnings/errors, required empty cells, and async validation completion after bridge stop.
- Locale parsing for decimal comma, thousands separator, negative parentheses, fractions, currency, percentage, and empty input.
- Ink threshold updates at 0, 1, below 0, above 1, and partial updates.
- Diagram/text-effect cache invalidation after batch events and stop/destroy.

Non-goals:

- No compatibility shims for old duplicate payload types.
- No separate test-only bridge interfaces.
- No TypeScript pivot store or chart export path that bypasses the production bridge.
- No broad algorithm rewrite in compute, chart rendering, diagram layout, or ink recognition.
- No private/internal planning content should be added to the public `mog` repo.

## Parallelization notes and dependencies on other folders, if any

This implementation should be split across parallel agents with explicit ownership:

- Agent A: `types/bridges/src` export policy, canonical payload types, lifecycle aliases, chart serializable schema types.
- Agent B: pivot/schema consumer alignment in `types/api/src/api/worksheet/pivots.ts`, `kernel/src/bridges/pivot-bridge.ts`, and `kernel/src/bridges/schema-bridge.ts`.
- Agent C: chart schema integration in `runtime/sdk/src/chart-export/node-chart-image-exporter.ts`, `charts/src/primitives/types.ts`, `kernel/src/domain/charts/*`, and `compute/core/crates/compute-chart-render`.
- Agent D: contracts facade cleanup in `contracts/src/bridges/*`, runtime inventory, declaration rollup, and external fixtures.
- Agent E: conformance tests, API snapshots, generated API spec updates, and final verification.

Dependencies on other folders:

- `contracts/src/bridges` and `contracts/scripts/rollup-public-dts.mjs` for public projection and runtime value ownership.
- `tools/contracts-runtime-inventory.json`, `tools/check-api-snapshots.mjs`, and declaration rollup checks for public contract enforcement.
- `types/api/src/kernel/kernel-context.ts` and `types/api/src/api/worksheet/pivots.ts` for API-level aliases and bridge exposure.
- `kernel/src/bridges` and `kernel/src/domain/*` for real implementation conformance.
- `types/rendering`, `canvas/grid-canvas`, and `canvas/drawing-canvas` for rendering bridge consumers.
- `charts/src` for canonical mark primitive aliases.
- `runtime/sdk/src/chart-export` and `compute/core/crates/compute-chart-render` for native chart export schema.

Integration order:

1. Land canonical type/export changes in `types/bridges/src`.
2. Update contracts facade and runtime inventory so public declarations remain clean.
3. Update production consumers to import canonical types and remove redeclarations.
4. Add conformance fixtures and behavior tests.
5. Regenerate and review public API artifacts.
6. Run scoped gates, then repo-wide typecheck.
