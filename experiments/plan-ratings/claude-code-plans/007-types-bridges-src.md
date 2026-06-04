# 007 — Improve `mog/types/bridges/src` (cross-layer bridge contracts)

## Source folder and scope

- **Folder:** `mog/types/bridges/src`
- **Package:** `@mog/types-bridges` (Tier 2 type-only package; `"files": ["src"]`, `type: module`).
- **Files in scope (9):** `index.ts`, `chart-bridge.ts`, `pivot-bridge.ts`, `schema-bridge.ts`, `locale-bridge.ts`, `diagram-bridge.ts`, `equation-bridge.ts`, `ink-recognition-bridge.ts`, `text-effect-rendering-bridge.ts`.
- **In scope:** the public type/interface surface these files declare and re-export; the barrel (`index.ts`); doc comments that describe the contracts; consistency of error, async, and result shapes across bridges.
- **Out of scope (do not edit):** bridge *implementations* in `mog/kernel/src/bridges/**` and `mog/engine/src/state/bridges/**`; the re-export shims in `mog/contracts/src/bridges/**`; upstream type packages (`@mog/types-core`, `-commands`, `-culture`, `-data`, `-events`, `-objects`). Those are named here only to describe coupling and downstream ripple, not as edit targets of this plan's *folder*. Any change that requires touching them is called out as a cross-folder dependency.

## Current role of this folder in Mog

`@mog/types-bridges` defines the **adapter contracts between the host runtime and external engines** — the `I*Bridge` interfaces (chart, pivot, schema, locale, diagram, equation, ink-recognition, text-effect rendering) plus their associated data/result types. Each interface is the seam where the reactive engine (`ctx.chartBridge`, `ctx.equationBridge`, `ctx.diagram.*`, etc.) talks to a specialized subsystem, while the concrete implementation lives in `kernel`/`engine`. The package composes over the lower type tiers and is itself re-exported, type-only, through `mog/contracts/src/bridges/*` (`export type * from '@mog/types-bridges/...'`) and consumed by `@mog/types-api` and `@mog/types-rendering`.

The folder is therefore a **contract source of truth**: it has no runtime behavior (one value export, `DEFAULT_RECOGNITION_THRESHOLDS`), so improvements are about making the contracts complete, internally consistent, and accurately documented, without weakening the boundaries they encode.

## Improvement objectives

1. **Make the public surface complete and authoritative.** Every type that participates in an exported interface or union should itself be exported from `index.ts`, so downstream code names the canonical type instead of re-declaring a structural twin.
2. **Unify the cross-bridge result/error model.** Replace ad-hoc, per-bridge error conventions with one discriminated-result vocabulary so callers handle failures uniformly and `Array.isArray()`-style discrimination disappears.
3. **Make async-ness explicit.** Eliminate `T | Promise<T>` "sync-or-async" return unions so each method's contract states whether it is synchronous, forcing callers into a single, correct calling convention.
4. **Make the doc comments true.** Fix stale `@see` paths and package references, and de-duplicate re-exports, so the contract documentation matches the post-refactor module layout.

These are production-path contract improvements: they tighten the types the engine and SDK compile against, not test scaffolding.

## Evidence (observed in the current tree)

- **Missing barrel exports — chart IR.** `chart-bridge.ts` declares a full mark IR (`ChartPaintSpec`, `ChartLineStyleSpec`, `ChartShadowSpec`, `ChartEffectSpec`, `ChartTextRunSpec`, `ChartMarkStyle`, `ChartMarkClip`, `ChartBaseMark`, `ChartRectMark`, `ChartPathMark`, `ChartArcMark`, `ChartTextMark`, `ChartSymbolMark`, `ChartTextAlign`, `ChartTextBaseline`, `ChartSymbolShape`). `index.ts` exports the `ChartMark` union and the layout types but **not** these constituents — a consumer can hold a `ChartMark` but cannot name `ChartMarkStyle` or narrow to `ChartTextMark` via the package root.
- **Missing barrel exports — pivot placement.** `pivot-bridge.ts` declares `PivotBridgePlacementSpec` and `PivotBridgePlacementPatch` (used by `IPivotBridge.addPlacement`/`updatePlacement`), but `index.ts` re-exports neither. Consequence: `mog/kernel/src/bridges/pivot-bridge.ts` **re-declares both locally** (lines ~64–81: `type PivotBridgePlacementSpec = {…}`, `type PivotBridgePlacementPatch = Partial<Omit<…>>`) — a structural duplicate that can silently drift from the contract.
- **Inconsistent error models across bridges:**
  - `chart-bridge.ts`: untagged unions `Promise<ChartMark[] | ChartError>`, `Promise<ChartRenderSnapshot | ChartError>` — discriminated only by `Array.isArray()` / property probing; yet the same file already has a *clean* tagged result (`ChartDataResult = {success:true,…} | {success:false,error}`).
  - `equation-bridge.ts`: `Result<MathNode[], EquationParseError>` (ok/err tagged) from `@mog/types-objects/equation`.
  - `pivot-bridge.ts`: failure encoded as `Promise<… | null>`.
  - `schema-bridge.ts`: failures flow out-of-band into cell metadata + events.
  Four conventions for "this can fail" across one package.
- **Sync-or-async return unions.** `diagram-bridge.ts` has 11 methods typed `T | Promise<T>` (e.g. `getDiagram(): Diagram | undefined | Promise<Diagram | undefined>`, `addNode(): NodeId | Promise<NodeId>`); `schema-bridge.ts` has 2 (`getCellsWithErrors`, `getErrorSummary`). Callers must defensively `await` and cannot tell from the type whether the call blocks.
- **Stale doc references.** `schema-bridge.ts` `@see contracts/src/schema.ts` and `pivot-bridge.ts` `@see contracts/src/pivot.ts` point at files that **no longer exist** (the types now live in `@mog/types-commands/schema` and `@mog/types-data/data/pivot`, as the imports themselves show). `equation-bridge.ts` says "Interface defined in contracts (this file)" — the file is now in `types/bridges`. `@see` implementation paths drift between `engine/src/state/bridges/…`, `kernel/src/bridges/…`, and `contracts/…` with no single convention.
- **Duplicate re-export.** `schema-bridge.ts` re-exports `ISchemaRegistry`/`ISchemaValidator`/`ColumnSchema`/`ValidationResult` at the bottom of the file *and* `index.ts` re-exports `ISchemaRegistry`/`ISchemaValidator` from the same upstream — two paths to the same symbols.

## Production-path contracts and invariants to preserve or strengthen

- **Type-only, side-effect-free package.** Keep the package emitting only types plus the single intentional value export (`DEFAULT_RECOGNITION_THRESHOLDS`). The `contracts/src/bridges/index.ts` shim uses `export type *` and then *separately* re-exports that value — any new value export would need the same dual treatment, so **prefer not to add value exports**; keep new additions type-only.
- **Boundary direction.** Bridge contracts may depend on lower type tiers (`-core`, `-commands`, `-culture`, `-data`, `-events`, `-objects`) but must not import from `kernel`/`engine`/`contracts`. Preserve this; the eslint import-boundaries plugin (`mog/tools/eslint-plugin-mog/import-boundaries.cjs`) enforces tiering.
- **Re-export compatibility.** `mog/contracts/src/bridges/*` re-exports each module by subpath (`@mog/types-bridges/chart-bridge`, etc.) and the barrel via `/bridges`. New exports added to `index.ts` propagate automatically through `export type *`; **do not rename or remove existing exported symbols** without updating the contracts shim and api-extractor configs (cross-folder).
- **`renderCached` synchronous invariant.** `IChartBridge.renderCached` must remain `: void` (its doc forbids `await`/Promise — it runs inside the synchronous canvas dispatch loop). Any async-cleanup pass must **not** touch this method.
- **Pure read vs. materialization split.** `IPivotBridge.compute` (pure read, no materialization/notify) vs. `refresh` (materialization path) is a real semantic invariant — preserve the distinction and its doc wording.
- **Strengthen:** the result/error contract and async contract become *part of* the type, narrowing what implementations may legally return.

## Concrete implementation plan

Sequenced so the low-risk, additive steps land first and the contract-shape changes (which ripple into implementations) come later behind explicit cross-folder coordination.

### Step 1 — Complete the `index.ts` barrel (additive, low risk)

- Export the chart IR constituents from `index.ts`: `ChartPaintSpec`, `ChartLineStyleSpec`, `ChartShadowSpec`, `ChartEffectSpec`, `ChartTextRunSpec`, `ChartMarkStyle`, `ChartMarkClip`, `ChartBaseMark`, `ChartRectMark`, `ChartPathMark`, `ChartArcMark`, `ChartTextMark`, `ChartSymbolMark`, `ChartTextAlign`, `ChartTextBaseline`, `ChartSymbolShape`.
- Export `PivotBridgePlacementSpec` and `PivotBridgePlacementPatch` from `index.ts`.
- These are purely additive `export type` lines; no existing symbol changes. Risk: only that more symbols enter the rolled-up public `.d.ts` — acceptable since they are already reachable transitively via the exported interfaces.

### Step 2 — Retire the kernel's duplicate placement types (cross-folder, enabled by Step 1)

- After Step 1, file a follow-up to change `mog/kernel/src/bridges/pivot-bridge.ts` to `import type { PivotBridgePlacementSpec, PivotBridgePlacementPatch } from '@mog/types-bridges/pivot-bridge'` and delete the local re-declarations. **This edit is outside this plan's folder** and must be done in the kernel-bridges work item; this plan's deliverable is making the canonical types importable.

### Step 3 — Introduce one shared result vocabulary (contract shape)

- Add a small discriminated-result type local to the package (e.g. in a new `result.ts` re-exported from `index.ts`), or adopt the existing `Result<T,E>` shape already used by `equation-bridge.ts` for consistency across the package. Decide one and apply it.
- Convert chart's untagged unions to the chosen tagged form:
  - `getMarks`/`getMarksAtSize`: `Promise<ChartMark[] | ChartError>` → tagged result carrying `ChartMark[]` or `ChartError`.
  - `getRenderSnapshotAtSize`: same treatment with `ChartRenderSnapshot`.
  - Keep `ChartDataResult` as-is (already tagged) or migrate it to the shared shape so all chart results read identically.
- This changes call sites in the chart bridge implementation — **gate behind cross-folder coordination with `engine/state/bridges` and any SDK consumer**; land the type and migrate implementations in the same change set so the tree stays green.

### Step 4 — Make async-ness explicit (contract shape)

- For `IDiagramBridge` and `ISchemaBridge`, collapse each `T | Promise<T>` return into the single form the implementation actually uses. Audit the kernel/engine implementations to determine, per method, whether it is synchronous or asynchronous, then type it as exactly that (`T` or `Promise<T>`).
- Where an interface is genuinely implemented both synchronously (in-process) and asynchronously (worker-backed), prefer standardizing on `Promise<T>` so the contract is uniform and callers always `await`, rather than leaving the union.
- Cross-folder: callers in `kernel`/`engine`/SDK that relied on the sync branch must add `await`. Coordinate as part of the diagram-bridge and schema-bridge implementation work items.

### Step 5 — Documentation truth pass (low risk, no type change)

- Fix stale `@see` paths: `schema-bridge.ts` → `@mog/types-commands/schema`; `pivot-bridge.ts` → `@mog/types-data/data/pivot`. Correct `equation-bridge.ts`'s "defined in contracts (this file)" to reflect `types/bridges`.
- Standardize implementation `@see` references to one current convention (e.g. `kernel/src/bridges/<name>.ts`), verifying each path exists before writing it.
- Remove the duplicate schema re-export: keep the re-export in exactly one place (prefer `index.ts` as the single barrel) and drop the redundant bottom-of-file block in `schema-bridge.ts`, or vice-versa — but not both.
- Tidy placeholder/awkward comment wording (e.g. "Diagram diagram") without changing meaning. Do **not** introduce references to other spreadsheet products in comments (house style).

## Tests and verification gates

This plan does not author tests (and per constraints does not run build/test commands here). The verification gates the implementing change must pass:

- **Typecheck the package and its dependents:** `tsc -b` for `@mog/types-bridges`, then the contracts shim, `@mog/types-api`, and `@mog/types-rendering` (they re-export the barrel). Steps 3–4 must compile cleanly across all consumers in one change set.
- **Public `.d.ts` rollup:** re-run the contracts public-dts rollup (`mog/contracts/scripts/rollup-public-dts.mjs`) and review the diff to confirm Step 1's new exports appear intentionally and Steps 3–4 don't accidentally drop/rename a previously public symbol.
- **Lint boundaries:** `eslint-plugin-mog/import-boundaries` must still pass — no new upward imports.
- **Kernel duplicate removal (Step 2):** kernel typechecks after swapping local placement types for the imported ones, proving structural equivalence.
- **Targeted eval coverage** for the behavior-touching steps: chart render/export scenarios (Step 3 chart result change) and pivot placement scenarios (Step 2) via the existing app-eval/api-eval suites — run by the implementing work items, not this plan.

## Risks, edge cases, and non-goals

- **Public API growth (Step 1):** exporting the chart IR widens the SDK's public type surface; once published it is harder to remove. Mitigation: these types are already transitively public via `ChartMark`/`IChartBridge`, so naming them is formalization, not new exposure.
- **Result-shape churn (Step 3):** the riskiest step — it touches every chart-result call site. Edge case: code currently doing `if (Array.isArray(x))` must migrate to the discriminant. Must land type + implementations atomically.
- **Async unification (Step 4):** missing an `await` at a previously-sync call site is a silent correctness bug. Mitigation: rely on the compiler — once the union collapses to `Promise<T>`, every non-awaited use becomes a type error or an obvious `Promise` misuse.
- **`renderCached` must stay sync** — explicitly excluded from Step 4.
- **Non-goals:** no reduction of scope, no test-only fixes, no compatibility shims that paper over the duplicate types instead of removing them, no behavioral change to compute/validation logic (that lives in Rust/kernel), no new runtime/value exports, no edits to implementations from within this folder's work item.

## Parallelization notes and dependencies on other folders

- **Step 1 (barrel completion)** and **Step 5 (doc pass)** are self-contained to this folder and can proceed immediately and in parallel.
- **Step 2** depends on Step 1 and lands in `mog/kernel/src/bridges` (folder item for kernel bridges) — hand off the canonical import once Step 1 merges.
- **Step 3** couples to chart bridge implementations in `engine/state/bridges` and any chart-consuming SDK surface; coordinate with the chart-bridge implementation folder item.
- **Step 4** couples to diagram-bridge and schema-bridge implementations in `kernel`/`engine`; coordinate with those folder items.
- **Downstream ripple for any renamed/removed symbol:** `mog/contracts/src/bridges/*` shim, `@mog/types-api`, `@mog/types-rendering`, and the `api-extractor.json` configs under `mog/runtime/{sdk,embed}` — these are not edited by this plan but must be re-validated by the implementing change.
