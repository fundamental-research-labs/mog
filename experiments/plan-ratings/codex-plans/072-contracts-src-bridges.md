# Improve `contracts/src/bridges`

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/contracts/src/bridges`

Scope for this plan is the public `@mog-sdk/contracts/bridges` bridge contract projection and its relationship to the workspace-internal `@mog/types-bridges` package. The folder currently contains:

- Aggregate export: `contracts/src/bridges/index.ts`
- Type re-export shims for chart, diagram, equation, locale, pivot, schema, and text-effect rendering bridges
- A full local duplicate of `ink-recognition-bridge.ts`, including the public runtime value `DEFAULT_RECOGNITION_THRESHOLDS`

Implementation work should stay in the public core repo (`mog`) and must not introduce any dependency from `mog` to `mog-internal`.

## Current role of this folder in Mog

`contracts/src/bridges` is the public bridge-facing contract surface for host/runtime adapters. Production consumers import `@mog-sdk/contracts/bridges` from kernel, canvas, charts, spreadsheet app, runtime SDK, and external package fixtures. The exported contracts describe cache-backed and runtime-sensitive bridge APIs for:

- Chart rendering/data/layout (`IChartBridge`, chart mark IR, layout snapshots, cache update callbacks)
- Pivot CRUD/computation/materialization/cache/subscription (`IPivotBridge`)
- Schema validation annotation processing driven by Rust recalc (`ISchemaBridge`)
- Locale-aware input normalization (`ILocaleBridge`)
- Ink shape/text recognition (`IInkRecognitionBridge`, `DEFAULT_RECOGNITION_THRESHOLDS`)
- Diagram layout/node operations (`IDiagramBridge`)
- Equation parsing (`IEquationBridge`)
- Text-effect rendering cache computation (`ITextEffectRenderingBridge`)

The actual type definitions are mostly owned by `types/bridges/src/*` and projected through contracts shims. The exception is ink recognition: `contracts/src/bridges/ink-recognition-bridge.ts` duplicates the same interfaces and constant that also exist in `types/bridges/src/ink-recognition-bridge.ts`. The runtime inventory marks `@mog-sdk/contracts/bridges` as a public runtime-value module with `DEFAULT_RECOGNITION_THRESHOLDS` sourced from `contracts/src/bridges/ink-recognition-bridge.ts`.

## Improvement objectives

1. Make bridge contract ownership unambiguous: one canonical type source, one public runtime-value owner, no duplicate interface bodies.
2. Preserve `@mog-sdk/contracts/bridges` as the public import path for product and SDK consumers while keeping `@mog/types-bridges` workspace-internal.
3. Strengthen declaration rollup guarantees so published `@mog-sdk/contracts` declarations do not leak private `@mog/types-*` imports and do not split nominal branded identities.
4. Add explicit external-fixture coverage for bridge type imports and the `DEFAULT_RECOGNITION_THRESHOLDS` runtime value.
5. Convert per-bridge shim files into a systematic, auditable projection layer with checks that catch future drift.
6. Keep production behavior untouched except where implementations must satisfy strengthened contract invariants.

## Production-path contracts and invariants to preserve or strengthen

- `@mog-sdk/contracts/bridges` remains the stable public package subpath for all bridge types and for `DEFAULT_RECOGNITION_THRESHOLDS`.
- `@mog/types-bridges` remains private/workspace-internal; external fixtures must continue to reject direct private type-shard imports.
- Chart rendering invariants:
  - `IChartBridge.renderCached()` stays synchronous and must not return or await a `Promise`.
  - Cache misses and dirty charts schedule background compilation through `ensureCompiled()` and notify via `onCacheUpdate()`.
  - `getMarksAtSize()` and `getRenderSnapshotAtSize()` stay one-off production compile paths for export/diagnostics and must not mutate normal render cache state.
  - `ChartLayoutSnapshot` remains normalized 0-1 layout data, distinct from richer point-based chart layout data.
- Pivot invariants:
  - `compute()` stays a pure read path and must not materialize output cells, clear dirty state, or notify subscribers.
  - `refresh()`/`refreshDependentPivots()` remain explicit materialization paths.
  - Pivot CRUD and placement mutation methods continue to delegate through the Rust-backed kernel path and return mutation receipts where specified.
- Schema invariants:
  - Rust compute remains the validation source during mutation/recalc.
  - `ISchemaBridge.processValidationAnnotations()` translates recalc annotations into metadata and validation events without inventing a parallel validation source.
- Locale invariants:
  - Normalization output remains locale-agnostic and format suggestions remain advisory, not persisted state.
- Ink invariants:
  - Recognition confidence thresholds stay complete for every recognized shape/text category.
  - The default threshold object is exported as a public runtime value from `@mog-sdk/contracts/bridges`.
- Diagram and text-effect invariants:
  - Computed layout/rendering outputs are runtime caches, not persisted storage.
  - `start()`/`stop()`/`destroy()` lifecycle contracts continue to clean up event subscriptions.
- Equation invariants:
  - OMML and LaTeX parsers keep returning the shared `Result<MathNode[], EquationParseError>` contract.

## Concrete implementation plan

1. Establish the bridge projection rule.
   - Treat `types/bridges/src/*` as the canonical source for bridge type definitions.
   - Treat `contracts/src/bridges` as the public projection and runtime-value ownership layer.
   - Document this rule in `contracts/src/bridges/index.ts` and, if the repo already has a contracts shim inventory convention, include this folder in that inventory rather than relying on comments alone.

2. Remove the ink duplicate as a category fix.
   - Replace the full interface body in `contracts/src/bridges/ink-recognition-bridge.ts` with a shim that `export type *` from `@mog/types-bridges/ink-recognition-bridge`.
   - Keep `DEFAULT_RECOGNITION_THRESHOLDS` contracts-owned by declaring the runtime constant in the contracts shim and typing it against `RecognitionThresholds` imported from `@mog/types-bridges/ink-recognition-bridge`.
   - Decide whether `types/bridges/src/ink-recognition-bridge.ts` should retain its internal runtime constant. If no internal production consumer imports that value from `@mog/types-bridges`, remove the private runtime export so there is one runtime owner. If internal consumers still need it, make the duplication explicit with a test that verifies equality and a comment that the private value is internal-only.

3. Make every per-bridge shim mechanically consistent.
   - Ensure all eight per-bridge files use the same minimal shape: source comment plus `export type * from '@mog/types-bridges/<bridge>'`.
   - Keep value exports only in the aggregate or value-owning shim where the runtime inventory declares them.
   - Fix misleading source comments in downstream code that still say canonical definitions live under `contracts/src/bridges/*` when the source is `types/bridges/src/*`.

4. Audit and preserve package exports.
   - Keep `@mog-sdk/contracts/bridges` as the only public bridge subpath unless there is a deliberate API decision to expose per-bridge public subpaths.
   - If per-bridge public subpaths are added, add all of them together with explicit package exports, declaration rollup checks, API snapshot entries, and external fixtures. Do not add a one-off subpath.
   - Confirm `contracts/package.json` still classifies `./bridges` as a public runtime-value module because of `DEFAULT_RECOGNITION_THRESHOLDS`.

5. Strengthen runtime inventory coverage.
   - Update `tools/contracts-runtime-inventory.json` only if ownership changes; otherwise keep the `@mog/types-bridges/bridges` entry pointing to `@mog-sdk/contracts/bridges` and `DEFAULT_RECOGNITION_THRESHOLDS`.
   - Add a fixture assertion that imports `DEFAULT_RECOGNITION_THRESHOLDS` from `@mog-sdk/contracts/bridges` at runtime and verifies all expected threshold keys exist.
   - Ensure the fixture does not import `@mog/types-bridges`, preserving the public/private boundary.

6. Add bridge external type fixture coverage.
   - Extend the positive contracts fixture to import representative bridge types from `@mog-sdk/contracts/bridges`: `IChartBridge`, `IPivotBridge`, `ISchemaBridge`, `ILocaleBridge`, `IInkRecognitionBridge`, `IDiagramBridge`, `IEquationBridge`, `ITextEffectRenderingBridge`, `ChartMark`, and `ChartLayoutSnapshot`.
   - Add assignability smoke checks that use those types without constructing fake production objects through direct state mutation.
   - Keep the negative private-shard fixture proving `@mog/types-bridges` is not externally resolvable.

7. Add drift detection for bridge shims.
   - Add or extend a lightweight contracts-shim inventory check that asserts each `contracts/src/bridges/*.ts` file either:
     - is a pure type re-export shim to the corresponding `@mog/types-bridges` file, or
     - is explicitly listed as a value-owning projection with its allowed runtime exports.
   - Include a check that the aggregate `contracts/src/bridges/index.ts` exports all public bridge types from `@mog/types-bridges/bridges` and exports only approved runtime values.

8. Reconcile implementation conformance where contract tightening exposes drift.
   - Compare `kernel/src/domain/charts/chart-bridge.ts`, `kernel/src/bridges/pivot-bridge.ts`, `kernel/src/bridges/schema-bridge.ts`, `kernel/src/bridges/locale-bridge.ts`, `kernel/src/domain/drawing/ink-recognition-bridge.ts`, `kernel/src/domain/diagram/diagram-bridge.ts`, `kernel/src/domain/equations/equation-bridge.ts`, and `kernel/src/domain/text-effects/text-effects-bridge.ts` against the final exported bridge interfaces.
   - Fix real implementation mismatches in the production implementations, not by weakening contracts or adding compatibility shims.

9. Update API snapshots and docs as part of the public surface change.
   - Regenerate or update `tools/api-snapshots/@mog-sdk__contracts.api.txt` only after the declaration rollup proves the public surface is correct.
   - Update chart and pivot internal docs only where they identify the wrong source-of-truth path.

## Tests and verification gates

Run these gates after implementation:

- `pnpm --filter @mog/types-bridges typecheck`
- `pnpm --filter @mog-sdk/contracts typecheck`
- `pnpm --filter @mog-sdk/contracts build`
- `pnpm check:contracts-runtime-inventory`
- `pnpm check:contract-runtime-imports`
- `pnpm check:contracts-declaration-identity`
- `pnpm check:declaration-rollups`
- `pnpm check:api-snapshots`
- `pnpm check:external-fixtures -- --skip-build`
- `pnpm --filter @mog-sdk/kernel typecheck`
- `pnpm --filter @mog-sdk/kernel test -- --runInBand kernel/src/bridges/__tests__/ink-recognition-bridge.test.ts kernel/src/bridges/__tests__/pivot-bridge.test.ts kernel/src/bridges/__tests__/schema-bridge.test.ts kernel/src/domain/charts/__tests__/chart-bridge.test.ts kernel/src/domain/charts/__tests__/chart-bridge-render-cache.test.ts`
- `pnpm --filter @mog/charts typecheck`
- `pnpm --filter @mog/canvas-grid-canvas typecheck`
- `pnpm --filter @mog-sdk/runtime-sdk typecheck`
- Final TypeScript gate: `pnpm typecheck`

If any bridge implementation behavior is changed, add the relevant package test for that production path rather than relying only on declaration/type gates.

## Risks, edge cases, and non-goals

- Risk: moving the ink constant incorrectly can remove the only runtime value from `@mog-sdk/contracts/bridges` or accidentally re-export a private package runtime value. Guard with runtime inventory and external runtime fixtures.
- Risk: declaration rollup can preserve type imports that work in the monorepo but leak private `@mog/types-*` packages in the published SDK. Guard with declaration identity, rollup, and external fixture gates.
- Risk: adding per-bridge public subpaths piecemeal creates an inconsistent public API. Either keep only `./bridges` or add all per-bridge subpaths as an intentional package-surface change.
- Risk: chart bridge types use DOM canvas types; declaration consumers without DOM libs may expose a broader SDK packaging issue. Treat that as a contracts packaging decision, not a local workaround.
- Risk: implementation classes may rely on narrower concrete return types or sync/async unions. Fix implementation conformance directly if tightened contracts reveal drift.
- Non-goal: no compatibility shims, deprecation layers, or alternate bridge import paths.
- Non-goal: no performance work outside the production bridge implementations.
- Non-goal: no changes to Rust compute semantics except where a bridge implementation already delegates through the Rust-backed production path and tests prove the contract requires it.

## Parallelization notes and dependencies on other folders, if any

This work parallelizes cleanly after the ownership rule is accepted:

- Agent A: `contracts/src/bridges`, `contracts/package.json`, runtime inventory, declaration rollup/API snapshot changes.
- Agent B: `types/bridges/src`, ensuring the canonical bridge type package has no unintended runtime exports and typechecks independently.
- Agent C: external fixtures and public/private package boundary checks under `fixtures/external` and `tools`.
- Agent D: production implementation conformance in `kernel/src/bridges`, `kernel/src/domain/charts`, `kernel/src/domain/diagram`, `kernel/src/domain/drawing`, `kernel/src/domain/equations`, and `kernel/src/domain/text-effects`.
- Agent E: downstream type consumers in `canvas/grid-canvas`, `canvas/drawing-canvas`, `charts`, `apps/spreadsheet`, and `runtime/sdk`.

Dependencies:

- `contracts/src/bridges` depends on `types/bridges` and projected private type shards; it must not depend on `kernel`, `apps`, `runtime`, or internal planning files.
- Kernel, canvas, charts, app, and SDK consumers should continue importing public bridge contracts from `@mog-sdk/contracts/bridges` unless they are workspace-internal type packages that intentionally depend on `@mog/types-bridges`.
- API snapshot and fixture updates should happen after the public export shape is finalized so reviewers can distinguish intended public-surface changes from accidental declaration churn.
