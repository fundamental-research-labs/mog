Rating: 8/10

# Review — 007 `mog/types/bridges/src`


## Summary judgment

This is a strong, evidence-grounded plan for a type-only contract package. Every concrete claim in the "Evidence" section is verifiable against the current tree, and the sequencing (additive first, contract-shape changes behind explicit cross-folder coordination) is exactly right for a source-of-truth type package whose symbols ripple through a `export type *` shim into `@mog/types-api`, `@mog/types-rendering`, and the public `.d.ts` rollup. The plan correctly understands what this folder *is* (contracts, not behavior) and scopes its deliverables accordingly. The main limitation is structural, not authorial: the genuinely high-value changes (unified result model, async unification) are inherently cross-folder, so the in-folder deliverable is mostly Step 1 (additive exports) plus Step 5 (doc truth pass). The plan is honest about this rather than overclaiming.

I verified the following claims directly:
- `index.ts` exports the `ChartMark` union and layout types but **not** the IR constituents (`ChartMarkStyle`, `ChartTextMark`, `ChartPaintSpec`, etc.) — confirmed; all 16 are declared `export`ed in `chart-bridge.ts` but absent from the barrel.
- `index.ts` re-exports neither `PivotBridgePlacementSpec` nor `PivotBridgePlacementPatch`, and `mog/kernel/src/bridges/pivot-bridge.ts:64,78` **re-declares both locally** — confirmed structural duplicate.
- Chart untagged unions `Promise<ChartMark[] | ChartError>` (lines 432, 452, 466) coexist with the clean tagged `ChartDataResult` (line 63) — confirmed.
- `equation-bridge.ts` uses `Result<MathNode[], EquationParseError>`; `pivot-bridge.ts` uses `Promise<… | null>` (lines 116, 141) — confirmed four divergent failure conventions.
- `diagram-bridge.ts` has the `T | Promise<T>` unions (10+ methods, lines 123–245); `schema-bridge.ts` has two (lines 165, 173) — confirmed.
- Stale `@see contracts/src/schema.ts` (schema:22), `@see contracts/src/pivot.ts` (pivot:14), and equation's "defined in contracts (this file)" (equation:13) — confirmed.
- Duplicate re-export: `index.ts:44` and `schema-bridge.ts:180` both re-export `ISchemaRegistry`/`ISchemaValidator` from `@mog/types-commands/schema` — confirmed.
- `DEFAULT_RECOGNITION_THRESHOLDS` is the single value export and the contracts shim handles it separately (`export type * ... ; export { DEFAULT_RECOGNITION_THRESHOLDS }`) — confirmed.

The factual accuracy here is unusually high; nothing in the evidence section is invented or stale.

## Major strengths

- **Evidence is real and specific.** File-and-line citations are accurate. This is the difference between a plan that can be executed and one that will dissolve on contact with the tree.
- **Correct risk gradient and sequencing.** Step 1 (additive `export type`) and Step 5 (docs) are correctly identified as zero-ripple and parallelizable; Steps 3–4 are flagged as the changes that must land *atomically* with their implementations to keep the tree green.
- **Boundary awareness.** The plan respects the tiering invariant (no upward imports into kernel/engine/contracts), names the import-boundaries eslint plugin as the enforcement, and is disciplined about not editing out-of-folder targets — only naming them as coupling.
- **Preserves real semantic invariants.** It explicitly carves out `renderCached: void` from the async pass and preserves the `compute` (pure read) vs `refresh` (materialization) distinction. These are the kind of invariants a naive "make it consistent" pass would destroy.
- **Honest about API-surface consequences.** It notes that exporting the chart IR widens the published surface and argues (correctly) that these types are already transitively public via `ChartMark`/`IChartBridge`, so this is formalization, not new exposure.

## Major gaps or risks

- **Step 3 defers the key decision.** "Add a small discriminated-result type … *or* adopt the existing `Result<T,E>` … Decide one and apply it." The single most consequential design choice in the plan — which result vocabulary becomes canonical — is left open. Since `equation-bridge.ts` already imports `Result<T,E>` from `@mog/types-objects/equation`, the plan should commit to that (reuse over invention) or justify a new local type. As written, the implementer inherits the hard call.
- **In-folder value is thin.** Steps 2, 3, and 4 all bottom out in cross-folder work items. The portion executable *within this folder's mandate* is Step 1 + Step 5 + the type-shape declarations of Steps 3–4 (which cannot merge without their implementations). The plan is honest about this, but a reader should understand that "improve this folder" here largely means "make additive exports and fix docs, then hand off."
- **Async audit is asserted, not performed.** Step 4 says to "audit the kernel/engine implementations to determine, per method, whether it is synchronous or asynchronous." The plan does not record the result of that audit even partially, so the actual per-method target type is unknown until implementation. A stronger plan would have sampled at least the diagram-bridge implementation to confirm whether standardizing on `Promise<T>` is viable or whether some methods are truly sync-only.
- **`PivotResultCallback` null contract untouched.** `pivot-bridge.ts:45` types the callback `result: PivotTableResult | null` and `getPivot`/`updatePlacement` return `Promise<… | null>`. The plan's "unify failure model" objective logically implicates these too, but Step 3 only addresses chart. Pivot's null-as-failure is named in the evidence but never assigned to a step — a small completeness gap.

## Contract and verification assessment

The contract reasoning is sound. The plan correctly treats the package as the narrowing point: tightening `T | Promise<T>` → `Promise<T>` and untagged unions → discriminated results genuinely constrains what implementations may legally return, and the plan leans on the compiler as the safety net for the async change (non-awaited `Promise<T>` becomes a type error). The mitigation logic for the riskiest step (atomic type+impl landing for chart results) is the right call.

Verification gates are appropriate and well-chosen for a type package: `tsc -b` across the barrel and all `export type *` dependents, the public-dts rollup diff to confirm Step 1's additions are intentional and Steps 3–4 don't silently drop/rename a public symbol, the import-boundaries lint, and kernel typecheck after Step 2 as a structural-equivalence proof. Naming the rollup script and the api-extractor configs as re-validation targets shows the author understands the blast radius. The only soft spot is that the eval coverage (chart render/export, pivot placement) is explicitly delegated to the implementing work items — reasonable given the no-run constraint, but it means this plan contains no behavioral gate it can itself own.

## Concrete changes that would raise the rating

1. **Commit to the result vocabulary in Step 3.** Pick `Result<T,E>` from `@mog/types-objects/equation` (reuse, single import root) or a new `result.ts`, and state the tradeoff. Show the target signatures for `getMarks`/`getMarksAtSize`/`getRenderSnapshotAtSize` and whether `ChartDataResult` migrates or stays.
2. **Fold pivot's null-failure into the unification.** Either add a step migrating `getPivot`/`updatePlacement`/`PivotResultCallback` to the chosen tagged result, or explicitly justify why `| null` is the intended "not found" (not "failed") signal and is therefore out of scope.
3. **Record the async audit findings.** Even a partial table — method → observed impl sync/async in kernel/engine — would convert Step 4 from "audit then decide" into a concrete diff and de-risk the silent-missing-`await` failure mode.
4. **State the canonical `@see` convention explicitly** (e.g. always `kernel/src/bridges/<name>.ts` for impls, upstream package path for types) and confirm each rewritten path exists, so Step 5 is mechanically checkable.
5. **Quantify the diagram method count** precisely (the plan says 11; I count ~10 `| Promise<` methods plus possibly an edge method) so the implementer has an exact checklist rather than an approximate one.
