# 015 — Improve `mog/kernel/src/domain/charts` (chart domain bridge, ownership & resolved-spec)

## Source folder and scope

- **Folder:** `mog/kernel/src/domain/charts` (TypeScript; part of `@mog/kernel`, not Rust despite the `kernel` path).
- **Two halves of the folder:**
  1. **Ownership / CRUD / conversion layer (top level):** `index.ts`, `chart-crud.ts`, `chart-store.ts`, `chart-manager*.ts` (`-bounds`, `-conversion`, `-dimensions`, `-types`), `chart-position.ts`, `chart-z-order.ts`, `chart-table-links.ts`, `chart-range-references.ts`, `chart-point-cache.ts`, and the wire↔config converter family (`chart-type-converters.ts`, `chart-axis-converters.ts`, `chart-format-converters.ts`, `chart-annotation-converters.ts`, `chart-kind-converters.ts`, `chart-legend-converters.ts`, `chart-option-converters.ts`).
  2. **Render bridge (`bridge/`, ~50 files):** the `ChartBridge` facade (`chart-bridge.ts`) plus the data-resolution → compile → render-cache → paint pipeline, the `resolved-spec-*` snapshot/authority/diagnostics system, the `*-family-support` modules, and the subscription/invalidation handlers.
- **In scope:** the public render-bridge facade (`ChartBridge`/`createChartBridge`, implementing `IChartBridge`), the wire↔config conversion boundary, range-reference resolution, the resolved-spec snapshot/diagnostics machinery, render-cache keying and liveness, and import-status / authority classification.
- **Out of scope (do not edit; named only to describe coupling):** the `IChartBridge` contract in `mog/types/bridges/src/chart-bridge.ts` (folder 007); the contract data types in `@mog-sdk/contracts/data/charts`; the generated wire types `mog/kernel/src/bridges/compute/compute-types.gen.ts`; the Rust compute core and `ComputeBridge` (`createChart`/`updateChart`/`getChart`); the `@mog/charts` rendering library; consumers (`api/worksheet/charts.ts`, `api/document/document-factory.ts`, `context/kernel-context.ts`, `runtime/sdk` exporter). Changes that require touching these are flagged as cross-folder dependencies.

## Current role of this folder in Mog

This folder is the **TypeScript domain bridge between the persisted chart model (owned by the Rust compute core) and the renderer/SDK**. It is deliberately thin on persistence — `chart-store.ts` and `chart-crud.ts` delegate every mutation to `ComputeBridge` (`createChart`/`updateChart`/`deleteChart`); the Rust core owns CellId creation, data-range identity, and serialization. The TS layer's real responsibilities are:

- **Identity & geometry ownership** — `chart-manager*.ts` converts cell-based chart anchors (`anchorRow/Col`, `widthCells/heightCells`) to/from pixel bounds and floating-object positions; charts are stored in their own per-sheet map, *not* the floating-objects CRDT.
- **Reference resolution** — `chart-range-references.ts` resolves both `CellIdRange` identities and legacy A1 strings (with sheet-name and absolute-marker handling) into workbook-scoped `CellRange`s at render time, emitting structured `ChartRangeDiagnostic`s.
- **The wire↔config boundary** — `chart-type-converters.ts` and siblings are the *only sanctioned crossing* between Rust-generated `*Data` wire types (enum fields are bare `string`) and the hand-written `*Config` contract types (string-literal unions). The narrowing direction validates each enum against its union and drops unknown values; the widening direction re-types.
- **The resolved-spec render pipeline** — `ChartBridge` resolves data (`chart-data-resolver.ts`), compiles marks (`chart-compiler.ts`, WASM-or-TS), caches them (`chart-render-cache*.ts`), and paints **synchronously** from committed cache state (`renderCached`) while compilation runs off the paint path. The `resolved-spec-*` family builds a fully-resolved snapshot (geometry, series, axes, diagnostics) and an **authority** model that records whether imported-chart geometry is reproduced *exactly*, *approximately*, or *by fallback*.

It is therefore a **correctness-and-fidelity seam**: the place where untyped imported data, live cell values, and the public chart contract meet. Improvements here are about tightening that seam without weakening the boundaries it encodes.

## Improvement objectives

1. **Close the wire-serialization correctness gap.** Fix `seriesConfigToWire` (and any sibling converter) so that optional/`Option`-shaped fields are *omitted* rather than emitted as `undefined`, which currently breaks Rust serde deserialization and silently drops whole-series updates (see Evidence — this is a live product bug).
2. **Replace defensive `as { … }` import-data parsing with validated narrowing.** The render bridge reads loosely-typed surfaces (`config.extra`, `chart.importStatus`, `chart.rt`) via ~15 ad-hoc structural casts; route these through small, typed reader functions so an import-format change surfaces at one place instead of failing silently.
3. **Decompose the two monolithic modules** — `resolved-spec-plot-snapshot.ts` (~3.7k lines) and `chart-family-support.ts` (~3.4k lines) — into per-geometry / per-family submodules behind unchanged public entry points, so authority and snapshot logic become testable and modifiable in isolation.
4. **Make import-status classification structured, not string-tokenized.** `import-render-status.ts` decides terminal render failure by lowercasing and stripping whitespace/underscores from a status string and substring-matching `'unsupported'`/`'failed'`/`'placeholder'`. Replace with an explicit status mapping keyed off the typed import-status enum.
5. **Formalize the async-liveness / cancellation contract.** The bridge guards every async path with `isLive()` early-returns and an `acceptsCommits` cache gate. Make the invariant explicit and prove (by test) that a `stop()` mid-compile cannot mutate cleared cache state.
6. **Strengthen range-reference and cell-error diagnostics on the render path.** Cell errors are currently coerced to `null` in `chart-cell-accessor.ts` with no diagnostic; surface them so a chart with bad source cells renders a meaningful state instead of silent gaps.

All objectives are production-path: they tighten the types and behavior the SDK/renderer compile and render against, not test scaffolding.

## Evidence (observed in the current tree)

- **Serde-breaking optional field (live bug).** `chart-type-converters.ts:243` — `seriesConfigToWire` emits `projectionDiagnostics: c.projectionDiagnostics` unconditionally. When `undefined`, the wire object carries an explicit `undefined`/`null` where Rust serde expects an absent `Option`, which breaks deserialization of the whole series array. Matches the known symptom that `charts.update({ series })` drops the entire `series` array (the Rust core itself round-trips correctly). The reverse direction at `:174` (`wireToSeriesConfig`) just copies it back. This is the canonical case of objective 1; audit every `*ToWire` for the same pattern.
- **`update` casts away partiality.** `chart-store.ts:48` — `ctx.computeBridge.updateChart(sheetId, chartId, updates as ChartFloatingObject)` casts a `Partial<ChartFloatingObject>` to the full type; combined with the serde gap above, a partial update can ship malformed fields.
- **Monolithic snapshot/family modules.** `bridge/resolved-spec-plot-snapshot.ts` (~3,756 lines, 155+ functions covering bar/cartesian/pie/stock/radar geometry) and `bridge/chart-family-support.ts` (~3,385 lines, all chart families in one file). Both are imported only through small entry points (`buildResolvedChartSpecSnapshot`, `buildChartFamilySupportSnapshot`) — safe to split.
- **`combo-layer-authority.ts` (~918 lines)** implements a 9-check authority/status combiner (`exact|approximate|missing|verifiedDefault`) tightly coupled to `resolved-spec-snapshot.ts`.
- **Defensive structural casts at the import-data boundary** (objective 2), e.g. `bridge/import-render-status.ts:20,53`, `bridge/resolved-spec-package-authority.ts:66,72`, `bridge/chart-render-data-normalizer.ts:56`, multiple sites in `bridge/chart-family-support.ts`, `bridge/chart-config-normalizer.ts:208,362`, `bridge/source-linked-axis-formats.ts:151`, `bridge/chart-compiler.ts:326,336`. No schema validation; failures are silent.
- **String-tokenized import status** — `bridge/import-render-status.ts` `importStatusToTerminalRenderStatus()` (~line 62) classifies by normalized substring matching.
- **Silent cell-error coercion** — `bridge/chart-cell-accessor.ts:~41-44` detects a `CellError`-shaped object and returns `null` with no diagnostic.
- **Cache-key precedence is manual** — `chart-render-cache-keys.ts` plus `chart-render-frame.ts` build frame-suffixed keys (`…::frame=…::w=…::h=…::view=…`) and `chart-render-cache.ts` walks a hand-maintained precedence (`frame key` > `baseKey` > `chartId`); easy to desync.
- **Liveness is ad-hoc** — `isLive()` early returns appear across `chart-bridge-subscriptions.ts`, `chart-bridge-cell-events.ts`, `chart-reference-invalidation.ts`; the only hard gate against post-`stop()` mutation is `acceptsCommits` in the cache.
- **Cleanliness baseline:** zero `TODO`/`FIXME`/`HACK`/`eslint-disable`/` as any` in production files of this folder, and **25 existing test files** in `__tests__/` — a strong regression net to refactor against.

## Production-path contracts and invariants to preserve or strengthen

- **`renderCached` stays synchronous and side-effect-light.** It must remain `: void`, read only committed cache state, and schedule compilation off the paint path (the canvas dispatch loop restores viewport/rotation/flip immediately after each painter). Do not re-async it.
- **The wire↔config boundary stays the *only* crossing.** Outside `chart-type-converters.ts` and its focused submodules, kernel code must not import both a `*Data` and a `*Config` type in the same file. Narrowing (`wire*ToConfig`) keeps validating enum strings against the contract union and dropping unknowns; widening (`config*ToWire`) keeps re-typing — but must now also **omit absent optionals** (strengthening).
- **Rust core owns persistence and identity.** Keep all CRUD delegating to `ComputeBridge`; do not move identity/serialization into TS. `create` must keep returning the engine-assigned id (`change.objectId ?? change.data?.id ?? config.id`).
- **Range resolution is render-time, never stored.** `resolveCellIdRange`/`resolveChartRangeReferences` resolve identities and A1 at extraction time; preserve the diagnostic codes (`MISSING_REF | MALFORMED_A1 | UNKNOWN_SHEET | DELETED_CELLS | NO_CHART_SHEET`) and the unqualified-A1-resolves-to-owning-sheet rule.
- **`IChartBridge` shape is fixed by the contract package.** All method signatures consumed by `api/worksheet/charts.ts`, the SDK exporter, and `render-context.ts` must remain compatible; any signature change is a folder-007 cross-folder change, out of scope here.
- **Authority semantics are load-bearing for import fidelity.** The `exact/approximate/missing/verifiedDefault` vocabulary and "native charts default to verifiedDefault, imported charts get evidence-based assessment" rule must survive decomposition unchanged.
- **Strengthen:** post-decomposition, each geometry/family submodule should have a typed public entry; import-data reads should go through validated narrowers; optional-field omission becomes part of the converter contract.

## Concrete implementation plan

Sequenced low-risk-first; the serde fix lands immediately because it is a live bug, then type-safety, then the structural decomposition behind unchanged entry points.

### Step 1 — Fix optional-field serialization (live bug, surgical)

- In `chart-type-converters.ts` `seriesConfigToWire`, stop emitting `projectionDiagnostics` (and any other `Option`-shaped field) when it is `undefined`. Prefer a small `omitUndefined`-style helper or explicit conditional spread so absent optionals are *absent* on the wire, not `undefined`.
- Audit every `*ConfigToWire`/`*ToWire` in `chart-type-converters.ts`, `chart-annotation-converters.ts`, `chart-axis-converters.ts`, `chart-format-converters.ts`, `chart-option-converters.ts`, `chart-legend-converters.ts` for the same pattern; fix each Option-typed field.
- Tighten `chart-store.ts` `update` so the partial is mapped through the converter boundary (which now omits absent fields) rather than blanket-cast to the full wire type.
- This is the only step that should change observable persistence behavior; gate it carefully with converter tests (Step 6).

### Step 2 — Typed readers for import-data surfaces (replaces structural casts)

- Add a small internal module (e.g. `bridge/imported-data-readers.ts`) exposing typed, validated accessors for the loosely-typed surfaces: `config.extra` keys, `chart.importStatus`, `chart.rt`, package-authority metadata. Each reader returns a narrow typed value or a typed "absent/invalid" result.
- Replace the ~15 `as { … }` cast sites (listed in Evidence) with calls to these readers. No behavior change intended — same fallbacks, but centralized and named, so an import-format change fails in one place.

### Step 3 — Structured import-status classification

- Replace `import-render-status.ts` string tokenization with an explicit mapping from the typed import-status enum (consumed via the Step-2 reader) to `{ renderable | terminal(message) }`. Keep the same terminal-failure messages so the UI is unchanged. If the underlying status is genuinely a free string, normalize once at the reader and map known values explicitly, logging unknowns as a diagnostic rather than guessing by substring.

### Step 4 — Decompose `resolved-spec-plot-snapshot.ts`

- Split by geometry family into `bridge/plot/` submodules (e.g. `bar-geometry.ts`, `cartesian-geometry.ts`, `pie-doughnut-geometry.ts`, `stock-glyph-geometry.ts`, `radar-projection` already separate). Keep `resolved-spec-plot-snapshot.ts` as a thin re-export/dispatcher so `resolved-spec-snapshot.ts` and tests keep their import paths.
- Pure code movement — no logic edits in this step — so the existing snapshot tests act as the equivalence oracle.

### Step 5 — Decompose `chart-family-support.ts` and clarify authority coupling

- Split per family (bar, pie, scatter/bubble already partly in `xy-family-support.ts`, surface, radar) into `bridge/family/` submodules, with `buildChartFamilySupportSnapshot` remaining the single entry that composes them.
- Extract the shared authority-status combiner used by `combo-layer-authority.ts` and family support into one small `bridge/authority-status.ts` so the `exact/approximate/missing/verifiedDefault` algebra lives in one place; have combo + family import it instead of duplicating combination logic.

### Step 6 — Formalize liveness/cancellation and cell-error diagnostics

- Document and centralize the liveness contract: a single `LivenessGate` abstraction (wrapping `isLive()` + `acceptsCommits`) used by subscriptions, the reference-invalidation scan, and the orchestrator, so "no mutation after stop" is one checked invariant rather than scattered guards.
- In `chart-cell-accessor.ts`, when a cell value is a `CellError`, record a typed diagnostic (surfaced through the existing resolved-spec diagnostics channel) in addition to producing the data gap, so broken source cells are explainable rather than silent.

### Step 7 — (Optional, only if Steps 1–6 reveal need) cache-key consolidation

- Move the frame-suffixed key construction and the precedence walk into one `chart-render-cache-keys.ts` API (`buildKey`, `resolvePreferredKey`) so `chart-render-cache.ts` no longer hand-rolls precedence. Keep the exact key string format to avoid invalidating warm caches. Behavior-preserving.

## Tests and verification gates

> Per task constraints this plan does not run any build/test commands; this section specifies the gates a future implementer must satisfy.

- **Existing suite is the primary net.** All 25 `__tests__/` specs must keep passing unchanged — especially `chart-type-converters.test.ts`, `chart-compiler.test.ts`, `chart-render-cache.test.ts`, `chart-bridge-render-cache.test.ts`, `resolved-spec-*` snapshot tests, `chart-range-resolver.test.ts`, `chart-renderer.test.ts`, `import-render-status.test.ts`.
- **Step 1 (serde):** add converter tests asserting that `seriesConfigToWire` output for a series with `projectionDiagnostics: undefined` has *no own property* `projectionDiagnostics` (not `=== undefined`), and a round-trip test `config → wire → config` preserving the series array. Extend coverage to every Option-typed field touched.
- **Step 1 regression at the seam:** an api/app-eval scenario covering `charts.update({ series })` actually persisting the new series array (the previously-dropped case) — coordinated as a cross-folder addition under the existing eval harnesses, not edited here.
- **Steps 4–5 (decomposition):** treat existing `resolved-spec-plot-snapshot.test.ts`, `resolved-spec-structure-snapshot.test.ts`, `resolved-spec-series-snapshot.test.ts`, and family/authority tests as equivalence oracles — output must be byte-for-byte identical to pre-split (snapshot hashing via `hashJson` makes this checkable). Add a focused test per new submodule entry.
- **Step 3 (import status):** parametrized test mapping each known import-status enum value to its terminal/renderable verdict and message, including the unknown-value path.
- **Step 6 (liveness):** a test that starts a compile, calls `stop()` before the compile resolves, and asserts the cache has no committed marks and no listener notification afterward.
- **Gates:** `pnpm --filter @mog/kernel typecheck` and the kernel unit suite must pass; if contract/declaration types are touched, `pnpm --filter @mog-sdk/contracts build` first (declaration rollup). Lint/import-boundary plugin must stay green (no new `*Data`+`*Config` co-imports outside the converter boundary).

## Risks, edge cases, and non-goals

- **Risk — serde fix changes payload shape.** Omitting fields could surface a *different* Rust-side bug if any field was relied upon as explicit-`null`. Mitigate by auditing the Rust serde `Option` expectations for each field before omitting, and by round-trip tests. Treat the Rust core as out-of-scope (it round-trips correctly today per known diagnosis).
- **Risk — decomposition import churn.** Splitting two ~3.5k-line files touches many import paths; keep the original file as a re-export shim so external importers and tests are unaffected, and do logic-free moves separated from any behavior edits.
- **Edge cases to preserve:** imported charts with stale package authority; combo charts with mixed bar/non-bar layers; percent-stacked auto-`0%` axis formats; trailing-blank trimming gated on `displayBlanksAs`; duplicate chartIds across sheets (the `chart-sheet-index` bidirectional map); unqualified A1 with no owning sheet; hidden-series filtering when `plotVisibleOnly` is set.
- **Non-goals:** no change to the `IChartBridge` contract surface (folder 007); no change to `@mog/charts` rendering math or to the Rust compute core; no reduction of authority fidelity; no reformatting of untouched files; no test-only or shim "fixes" for the serde bug (the converter must emit correct wire data, not a downstream patch).

## Parallelization notes and dependencies on other folders

- **Independent, can start immediately:** Steps 1 (serde), 2 (typed readers), 3 (import status), and 6 (cell-error diagnostics) are internal to this folder and parallelizable across implementers.
- **Sequence within folder:** Step 2 should precede Step 3 (the structured status reader consumes the typed accessor). Steps 4 and 5 are independent of each other but both should land *after* Step 2 (so casts inside those files are already centralized) to avoid re-touching the same lines twice.
- **Cross-folder dependencies (coordinate, do not edit here):**
  - **Folder 007 (`mog/types/bridges/src`)** owns `IChartBridge`; if the serde fix or diagnostics work suggests a contract addition (e.g. a typed import-status enum or a cell-error diagnostic field), that change belongs there.
  - **`@mog-sdk/contracts/data/charts`** owns `SeriesConfig`/`ChartConfig`; Option-typed fields drive the converter audit — confirm which contract fields are genuinely optional before omitting on the wire.
  - **`mog/kernel/src/bridges/compute`** (`compute-types.gen.ts`, `floating-object-mapper.ts`, `chart-import-normalization.ts`) is the wire side of the boundary; the serde-omission fix must agree with what the Rust serde structs expect.
  - **api-eval / app-eval harnesses** are the home for the `charts.update({ series })` persistence regression scenario.
