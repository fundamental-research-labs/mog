Rating: 8/10

# Review of 007 - types/bridges/src Bridge Contract Hardening Plan

## Summary judgment

This is a strong, evidence-dense plan that correctly identifies `@mog/types-bridges` as a contract shard whose value lies almost entirely in being the *single* source of truth — and then methodically catalogs every place that invariant is currently violated. I spot-checked the plan's factual claims against the live source tree and they hold up nearly verbatim:

- `pivot-bridge.ts` defines `PivotBridgePlacementSpec` / `PivotBridgePlacementPatch` (lines 49, 64) but `index.ts` does not re-export them — confirmed.
- `kernel/src/bridges/pivot-bridge.ts` locally redeclares both (`type PivotBridgePlacementSpec = {...}`, line 64) and adds `PivotBridgeInternalPlacementPatch` widening the public patch with `sortByValue` (lines 81–82), feeding it into `updatePlacement`'s `patch` param (line 183) — confirmed exactly as described.
- `types/api/src/api/worksheet/pivots.ts` carries a parallel `PivotPlacementSpec` / `PivotPlacementPatch` with the same shape (lines 69, 84) — confirmed.
- `kernel/src/bridges/schema-bridge.ts` redeclares `SchemaValidationOptions` (line 93) even though `types/bridges` already exports it — confirmed.
- `IChartBridge` exposes optional `sheetId` only on `renderCached`/`ensureCompiled` (lines 499, 533) while `invalidateChart`/`isChartDirty`/`clearDirtyFlag` take bare `chartId` (lines 546, 554, 561) — confirmed.
- `ChartMark` union is exactly `rect | path | arc | text | symbol` (line 186) — confirmed.
- The native raster request schema (`SerializableMark`, `SerializableRectMark`, …, `version: 1`) is local to `runtime/sdk/src/chart-export/node-chart-image-exporter.ts` (lines 56–181) — confirmed, including that the exporter already uses some `satisfies` checks.
- `contracts/src/bridges/*` are `export type *` shims (e.g. pivot-bridge.ts) **except** `ink-recognition-bridge.ts`, which fully duplicates `RecognitionThresholds`, `IInkRecognitionBridge`, and `DEFAULT_RECOGNITION_THRESHOLDS` (lines 63, 83, 103) — confirmed, and `types-bridges/index.ts` does export the runtime constant as a value, so the dual-ownership problem is real.

Because the diagnosis is accurate, the prescriptions land. The plan reasons at the right altitude: it treats this folder as a contract that ripples into kernel, types/api, charts, runtime SDK, and the Rust rasterizer, and it preserves the load-bearing behavioral invariants (synchronous `renderCached`, Rust-backed pivot/schema state, runtime-only caches not persisted to Yjs). The main reasons it is not a 9–10: a large blast radius for a "single folder" task with some under-specified migration mechanics, and a couple of contract decisions left as open choices rather than resolved.

## Major strengths

- **Verifiable, not hand-wavy.** Nearly every claim cites a concrete file and the asymmetry it creates. This is the difference between a plan that compiles and one that doesn't.
- **Correct ownership model.** The "types own shapes, contracts own public runtime values" split is the right architectural line, and the plan applies it consistently (e.g. preferring to make `types-bridges` type-only and keep `DEFAULT_RECOGNITION_THRESHOLDS` contracts-owned).
- **Behavioral guardrails are explicit.** The invariants section is the best part: it names the things that must NOT change (sync paint path, no TS pivot store, recalc annotations remain Rust-sourced, `[0,1]` threshold bounds). This pre-empts the most likely regressions.
- **Cross-runtime contract focus.** Elevating the chart raster request V1 to a shared TS type with an exhaustive `ChartMark['type']` → serializable-variant mapping, while keeping Rust as the runtime validator, is exactly the right way to make the TS serializer and Rust deserializer verify the same contract.
- **Strong verification gate.** The gate spans scoped typechecks, kernel/charts/node tests, `cargo test`/`clippy` for `compute-chart-render`, declaration-rollup and runtime-inventory checks, API snapshot review, external fixtures, and a repo-wide typecheck backstop — appropriate for a contract surface feeding many packages.

## Major gaps or risks

- **Blast radius vs. folder framing.** Although titled a `types/bridges/src` plan, the bulk of the work edits kernel, types/api, charts, runtime/sdk, and a Rust crate. That is justified for contract hardening, but it means "land canonical type changes first" (Integration order step 1) will not typecheck cleanly until consumers are migrated in the same change set. The plan should state that steps 1–3 are effectively a single atomic landing, not independently mergeable, or the intermediate states break `tsc -b`.
- **Canonical-name resolution left ambiguous.** Step 2 offers "rename to `PivotPlacementSpec`/`PivotPlacementPatch`, OR provide exact type aliases." But `types/api` already owns those names. The plan does not decide whether the canonical declaration lives in `types-bridges` (with api aliasing) or whether the public-facing name stays in api. Since `kernel` is told to import from `@mog-sdk/contracts/bridges`, the resolution matters for the dependency graph and should be pinned down, not offered as a choice.
- **`void | Promise<void>` schema-bridge decision deferred.** Step 3 says make fire-and-forget explicit "if keeping `void | Promise<void>` is intentional… encode it consistently." That is the actual contract question and it is left open. A reviewer cannot tell what the resulting signatures will be.
- **Conformance-test mechanism is named but not specified.** Step 8 ("type-only conformance fixtures in kernel") is the plan's primary new safety net, but it does not say where these files live, how they are wired into `tsc -b` so CI fails on drift, or what a fixture looks like (e.g. `const _c: IChartBridge = new ChartBridge(...)` plus `satisfies`). Given this is the gate that prevents the redeclaration problem from recurring, it deserves more than a paragraph.
- **Type-only conversion is a public-surface change.** Removing the runtime `DEFAULT_RECOGNITION_THRESHOLDS` export from `types-bridges/index.ts` changes the root barrel. The plan flags the risk of stray runtime importers but does not commit to an audit command/result, and the "preferred direction" wording leaves it possible to ship the rename without the cleanup.

## Contract and verification assessment

Contract clarity is high where it matters: the invariants section reads like an acceptance spec, and the chart IR / raster-request ownership is the standout. The verification gate is comprehensive and includes the Rust side, which is essential — the plan itself notes that TS-only serializable types create "false confidence" without the Rust deserializer in the gate, and keeps `cargo test -p compute-chart-render` in scope. The risk register is genuinely useful (declaration-rollup leaking private package identities, branding revealing unbranded call sites, cache-scope changes rippling to canvas/rendering, not adding a test-only `group` mark). 

The gaps are in *decision closure* rather than coverage: three contract questions (pivot canonical name, schema async signature, whether to drop the runtime export) are posed as alternatives. A plan this detailed should resolve them so implementation agents don't each pick differently — especially since the parallelization section hands these surfaces to different agents (A defines types, B/C/D consume), and divergent choices would collide at integration.

## Concrete changes that would raise the rating

1. **Resolve the open contract decisions.** State the canonical home and final name for the pivot placement types; decide the schema-bridge async signatures (fire-and-forget vs. promise per method); and commit to whether `types-bridges` becomes type-only with the runtime constant removed. Each "OR" in the plan is a future merge conflict.
2. **Mark steps 1–3 as one atomic change set.** Note explicitly that canonical type changes + consumer migration must land together because intermediate states fail `tsc -b`, and adjust the Integration order to reflect that.
3. **Specify the conformance fixtures concretely.** File locations, the `satisfies`/assignment pattern, and how they are included in each package's `tsconfig` so CI fails on narrowing/widening/cast drift. This is the durable defense against re-divergence and is currently the thinnest critical step.
4. **Add a one-line audit gate for the type-only conversion.** Include the exact ripgrep (e.g. importers of `DEFAULT_RECOGNITION_THRESHOLDS` from `@mog/types-bridges`) as a precondition to removing the runtime export, so the breaking change is demonstrably safe.
5. **Pin the exhaustiveness mechanism for `ChartMark` → serializable variants.** Describe the compile-time check (e.g. a `Record<ChartMark['type'], …>` or a `never`-fallthrough in `serializeMark`) so adding a mark type provably fails the build until Node export and Rust raster are updated — the plan asserts this outcome but doesn't name the construct that enforces it.
