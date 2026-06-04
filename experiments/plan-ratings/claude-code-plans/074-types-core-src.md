# 074 — Harden the `@mog/types-core` Foundation Type Surface

## Source folder and scope

- **Source folder:** `/Users/guangyuyang/Code/mog-all/mog/types/core/src`
- **Package:** `@mog/types-core` (`mog/types/core/package.json`), `private: true`, `version 0.1.0`. Self-described as the **Tier-0 foundation package**; its only dependency is `@mog/types-culture` (for the `NumberFormatType` string-literal union referenced by `CellFormat`).
- **In scope:** the 16 `.ts` source files under `src/`:
  - `core.ts` (1530 LOC — the monolith), `index.ts` (barrel), `disposable.ts`, `result.ts`, `formatted-text.ts`, `sheet-id.ts`
  - `cells/`: `cell-identity.ts` (445), `cell-style.ts` (85), `formula-string.ts` (42), `range-ref.ts` (95), `rich-text.ts` (82), `spill.ts` (167), `index.ts`
  - `document/protection.ts` (187)
  - `utils/a1.ts` (15), `utils/function-registry.ts` (53)
  - the `package.json` `exports` map (per-file subpaths) and the `tsconfig.json` insofar as they shape what is published.
- **Out of scope (non-goals):** changing runtime behavior in `mog/kernel`, the Rust `compute-core`, `@mog-sdk/contracts`, or `mog/spreadsheet-utils` (where the helpers this folder's JSDoc *references* — `errorDisplayString`, `resolveCellTextStyle`, `toPlainText` — actually live); renaming or un-privatizing the package; adding compatibility shims, test-only patches, or temporary workarounds in place of fixing the contract at its source.

This is a planning artifact in `mog-internal`. It references public source by path but introduces no internal terminology into `mog/types/core/src`.

## Current role of this folder in Mog

`types/core/src` is the canonical home of Mog's lowest-level spreadsheet primitives — the vocabulary every higher tier speaks. It is consumed (directly or transitively, re-exported through `@mog-sdk/contracts`) by **~126 TypeScript files** across the monorepo, and it owns:

- **Cell value model:** `CellValuePrimitive`, `CellValue`, `CellRawValue`, `CellError` / `ErrorVariant`, `CellControl`, `DetectedDataType`, `DataMatrix`.
- **Geometry & addressing:** `CellAddress`, `CellRange`, `ColumnInfo`, `RowInfo`, and the parser-output shapes `ParsedCellAddress` / `ParsedCellRange` (`utils/a1.ts`).
- **Branded identity:** `SheetId` (`sheet-id.ts`), `CellId` / `RowId` / `ColId` and their `RowData` / `ColData` position records, `RangeId`, plus the identity-formula reference union (`IdentityFormulaRef` and its seven variants), `IdentityFormula`, `IFormulaConverter`, `CellIdRange`, `IdentityMergedRegion`, `IdentityRangeSchemaRef` (`cells/cell-identity.ts`).
- **Formatting:** `CellFormat` (the ~50-property OOXML format surface), `ResolvedCellFormat`, `CellBorders` / `BorderStyle` / `BorderPresetMode`, `PatternType`, `GradientFill` / `GradientStop`, `CellStyle` / `StyleCategory`, `DEFAULT_CELL_STYLE` / `CellTextStyle` (`cells/cell-style.ts`), `TextFormat` / `RichText` / `RichTextSegment` (`cells/rich-text.ts`).
- **Workbook/sheet configuration:** `WorkbookSettings` (+ `WorkbookSettingsPatch`), `SheetSettings`, `SheetViewOptions`, `SheetInfo`, `CalculationSettings` / `CalcMode`, `AutomaticConversionPolicy` (+ patch/category/outcome types), `PrintSettings` / `PageMargins` / `HeaderFooter` / `PageSetupProperties`, protection types (`document/protection.ts`).
- **Rust-mirrored wire shapes:** `RangeKind`, `RangeAnchor`, `PayloadEncoding`, `AxisRunId` / `AxisIdentityRunRef` / `AxisIdentityRef` / `Row/ColAxisIdentityRef`. These are explicitly documented as "must match the Rust enum."
- **Cross-cutting primitives:** `IDisposable` / `CallableDisposable` (`disposable.ts`), `Result<T,E>` (`result.ts`), `FormattedText` branded type (declared in `core.ts`) and its `asFormattedText` / `displayString` adapters (`formatted-text.ts`), `FunctionMetadata` / `FunctionCategory` registry types (`utils/function-registry.ts`), `SpillResult` / `ProjectionInfo` / `SpillError` (`cells/spill.ts`).

The `package.json` `exports` map exposes a `development` condition pointing at `./src/**/*.ts` and `types`/`import` conditions pointing at `./dist/**/*.d.ts` and `.js`. So, as with the other `types/*` packages, the **emitted `dist` declarations are the published artifact**; source and emitted `.d.ts` must stay in lockstep, and a declaration rollup is required before consumers typecheck (cf. memory: contracts declaration rollup). The folder header notes much of it was recently **"absorbed from contracts/src"** — `core.ts` even carries an inline `import('./document/protection')` type ref that motivated absorbing the protection module. This recent consolidation is the seam where the defects below accumulated.

Observed facts from this pass:
- `core.ts` is a **1530-line single file** mixing ≥10 unrelated concerns (limits, value model, range identity, formatting, styles, workbook/sheet settings, print settings, copy/paste, branded display text). Every other module is small and cohesive; `core.ts` is the outlier.
- **Branded-identity types are not actually used at their own seams.** The package mints `SheetId`, `CellId`, `RowId`, `ColId`, `RangeId` brands and then immediately discards them in the very structures meant to carry them (enumerated under invariants). The brand's whole purpose — preventing accidental string interchange — is defeated at the foundation.
- **`cells/formula-string.ts` declares a `// Constructors` section header and then ends with zero constructors.** `FormulaA1` / `FormulaTemplate` are the only brands in the package with **no constructor function**, unlike `sheetId()`, `cellId()`, `rowId()`, `colId()`, `rangeId()`. Consumers therefore use raw `as` casts: **13 `as FormulaA1` and 2 `as FormulaTemplate`** casts exist across the codebase, none validating the defining `=`-prefix invariant.
- **`CellMetadata` and `CellProperties` are near-duplicate interfaces** (provenance, validation, live-data, formula-auditing, and `extensions` blocks are copy-pasted; `CellProperties` is `CellMetadata` + `format`). They will drift.
- **No drift guard for the Rust-mirrored types.** `RangeKind`, `RangeAnchor`, `PayloadEncoding`, `AxisIdentityRef` are hand-maintained against Rust with only a prose "must match" comment. Memory records a real production incident in this exact class (chart `seriesConfigToWire` emitting a non-`Option` field broke wasm serde deserialization), so silent TS↔Rust drift here is a known, costly failure mode.
- **`SheetPrintSettings` is a live `@deprecated` alias** of `PrintSettings`, still exported, with no removal anchor.
- **`extensions?: Record<string, unknown>`** appears three times (`CellFormat`, `CellMetadata`, `CellProperties`) as an untyped escape hatch on the published surface.

## Improvement objectives

1. **Make the brands load-bearing.** Use the existing `SheetId` / `CellId` / `RowId` / `ColId` brands at every seam in this package that currently weakens them back to `string`, so foundation types carry identity safety instead of merely advertising it.
2. **Give `FormulaA1` / `FormulaTemplate` real constructors + invariant guards**, completing the empty `Constructors` section and retiring the ~15 unchecked `as Formula*` casts in favor of validated, prefix-normalizing factories — matching the existing `sheetId()`/`cellId()` pattern.
3. **De-duplicate `CellMetadata` / `CellProperties`** behind one shared base so the provenance/validation/live-data/extension fields cannot drift.
4. **Decompose `core.ts`** into the cohesive modules the `exports` map already anticipates (value model, formatting, settings, print, copy/paste), keeping the barrel API byte-identical, so the foundation is maintainable and tree-shakeable.
5. **Install a TS↔Rust parity guard** for the Rust-mirrored enums/unions (`RangeKind`, `RangeAnchor`, `PayloadEncoding`, `AxisIdentityRef`), turning the "must match Rust" comments into a mechanically checked invariant — closing the drift class that already caused a serde incident.
6. **Establish a deprecation lifecycle** for `SheetPrintSettings` and any future deprecations, and **document/begin typing the `extensions` escape hatches**, so the published surface can narrow predictably.

## Production-path contracts and invariants to preserve or strengthen

- **Source ↔ dist declaration identity.** For every `exports` subpath, the `development` (`./src/*.ts`), `types` (`./dist/*.d.ts`), and `import` (`./dist/*.js`) targets must describe the same shape. Any source change must be matched by a declaration rollup so `dist` does not lag (memory: contracts declaration rollup — the `@mog-sdk/contracts` build is required before consumers typecheck; do **not** run builds here, but the verification gate depends on one being run downstream).
- **Tier-0 dependency purity.** The package must keep depending only on `@mog/types-culture`. No new runtime dependency, no import of `@mog-sdk/*` or `mog/kernel`. New constructors/guards must be zero-dependency pure functions.
- **Brand single-ownership.** `SheetId`, `CellId`, `RowId`, `ColId`, `RangeId`, `FormulaA1`, `FormulaTemplate`, `FormattedText` each have exactly one declaration owner here. Strengthening seams must **reuse** these brands, never mint parallel definitions, and must keep the `unique symbol` brand technique intact.
- **Brand-tightening seams to fix (the core of objective 1).** Each below currently types an identity field as bare `string`; the brand already exists and should be applied:
  - `CellAddress.sheetId: string` → `SheetId`
  - `CellRange.sheetId?: string` → `SheetId`
  - `IDataProvider.getSheetInfo(sheetId: string)` and `getSheetIds(): string[]` → `SheetId`
  - `CellIdRange.topLeftCellId / bottomRightCellId: string` → `CellId`
  - `IdentityMergedRegion.topLeftId / bottomRightId: string` → `CellId`
  - `IdentityRangeSchemaRef.startId / endId: string`, `sheetId?: string` → `CellId` / `SheetId`
  - `AxisRunId = number` and `AxisIdentityRef<Id extends string = string>` Explicit ids — confirm whether these should carry `RowId`/`ColId` brands rather than loose `string`.
  Tightening a field from `string` to a branded subtype is **source-compatible for producers that pass branded values and a narrowing for everyone else**; because brands are structural `string & {…}`, existing branded call sites keep compiling, and raw-string call sites surface exactly the unsafe seams we want flagged. Each tightening must be landed with the matching consumer updates (the kernel/bridge sites that pass raw strings), not behind a shim.
- **The `=`-prefix invariant for `FormulaA1`.** `FormulaA1` is defined as "WITH the `=` prefix"; `FormulaTemplate` as "WITHOUT." The new constructors must encode this (e.g. `formulaA1()` asserts/normalizes a leading `=`; `formulaTemplate()` asserts/strips it), so the "double-equals" bug class the brands were created to kill is actually prevented at construction, not just at assignment.
- **`ResolvedCellFormat` density contract.** `formats.get()` and `FormatCellsDialog` (9 consumers) rely on `ResolvedCellFormat = { [K in keyof CellFormat]-?: CellFormat[K] | null }` meaning "every key present, `null` when unset." Any `CellFormat` field added/renamed automatically flows into this mapped type — that coupling must be preserved, and the nested-object behavior (`borders`, `gradientFill`, `extensions` resolve to `T | null`, **not** deeply-resolved) must be documented as the contract, since consumers branch on it.
- **Rust-mirror fidelity.** `RangeKind` (enum string values), `RangeAnchor` (externally-tagged, PascalCase variants / camelCase fields), `PayloadEncoding`, and `AxisIdentityRef` must remain byte-compatible with their serde counterparts in `compute-core`. This is the invariant objective 5 mechanizes; it must be **strengthened, never relaxed**.
- **Barrel API stability.** `index.ts` re-exports must continue to export the identical set of names after any `core.ts` decomposition. The decomposition is an internal file move; the published name set is frozen.
- **No behavior in a types package — except validated constructors.** This package is overwhelmingly declarations plus a handful of pure brand constructors and `Result`/`FormattedText` adapters. New code is limited to pure, side-effect-free constructors/guards in the same spirit; no stateful logic enters Tier 0.

## Concrete implementation plan

### Phase 1 — Brand the identity seams (read-mostly worklist + mechanical edits)
1. Enumerate every `string`/`number` field on an exported type that semantically holds a `SheetId`/`CellId`/`RowId`/`ColId`/`RangeId` (the seam list above is the confirmed set; sweep for stragglers in `cell-identity.ts`, `core.ts`, `spill.ts`).
2. Replace each with the branded type. Add `import type { SheetId } from '../sheet-id'` / `CellId` where modules don't already import them (`spill.ts` already imports both; `cell-identity.ts` imports `SheetId`).
3. For each tightened field, locate the producing call sites (kernel bridges, store, importers) and update them to brand via the existing constructors. Land producer fixes in the same change set — no `as any` bridging.

### Phase 2 — Formula-string constructors (close the empty section)
1. In `cells/formula-string.ts`, implement under the existing `// Constructors` header:
   - `formulaA1(s: string): FormulaA1` — normalize/assert leading `=`.
   - `formulaTemplate(s: string): FormulaTemplate` — assert/strip leading `=`.
   - predicates `isFormulaA1` / type guards, and a `toTemplate(a1)` / `toA1(template)` pair of pure converters mirroring the documented prefix relationship.
2. Export them from the module (and thus the barrel).
3. Replace the 13 `as FormulaA1` and 2 `as FormulaTemplate` casts across the repo with the constructors, removing the unchecked-cast hazard at the seams.

### Phase 3 — De-duplicate cell metadata/properties
1. Introduce a shared base interface (e.g. `CellMetadataBase`) in `core.ts`'s value/metadata module holding the provenance + validation + live-data + formula-auditing + `extensions` fields.
2. Redefine `CellMetadata = CellMetadataBase` and `CellProperties = CellMetadataBase & { format?: CellFormat }` (or `extends`). Verify no consumer relied on the duplicated declarations being nominally distinct.

### Phase 4 — Decompose `core.ts`
1. Split into cohesive sibling modules that map onto the existing/anticipated `exports` subpaths, e.g.:
   - `values.ts` — `CellValue*`, `CellError`/`ErrorVariant`, `CellControl`, `DetectedDataType`, `DataMatrix`, `CellData`, `CellMetadata*`, `CellProperties`, `IDataProvider`.
   - `geometry.ts` — `CellAddress`, `CellRange`, `ColumnInfo`, `RowInfo`.
   - `range-identity.ts` — `RangeId`, `RangeKind`, `RangeAnchor`, `PayloadEncoding`, `AxisIdentity*` (the Rust-mirrored cluster, colocated for the Phase 5 guard).
   - `format.ts` — `CellFormat`, `ResolvedCellFormat`, borders, fill/gradient, pattern, `CellStyle`/`StyleCategory`.
   - `settings.ts` — `WorkbookSettings*`, `SheetSettings`, `SheetViewOptions`, `CalculationSettings`, `AutomaticConversion*`, `EnterKeyDirection`, `CalcMode`.
   - `print.ts` — `PrintSettings`, `PageMargins`, `HeaderFooter`, `PageSetupProperties`, `HfImage*`, `SheetPrintSettings` (deprecated).
   - `copy-paste.ts` — `CopyType`, `CopyFromOptions`.
   - `formatted-text` brand → consider colocating the `FormattedText` declaration with its adapters in `formatted-text.ts` (resolves the current `formatted-text.ts → core.ts` back-import).
2. `core.ts` becomes a thin re-export barrel (or is removed in favor of the split modules, with `core` subpath repointed). **`index.ts` must re-export the identical name set**; add `exports` subpaths for any newly file-addressable module only if a consumer needs deep-import, otherwise keep them barrel-only.
3. This is a pure move; no signatures change in this phase.

### Phase 5 — TS↔Rust parity guard
1. Establish a mechanism that fails CI when `RangeKind` / `RangeAnchor` / `PayloadEncoding` / `AxisIdentityRef` drift from their `compute-core` serde definitions. Preferred order: (a) generate these TS types from the Rust source (as `NumberFormatType` is already generated from Rust per the `@mog/types-culture` note), or (b) a checked-in fixture/round-trip test that serializes each Rust variant and asserts the TS union covers it.
2. Co-locate a doc-comment pointer from each type to its Rust source path so future edits are anchored.

### Phase 6 — Deprecation & extension hygiene
1. Tag `SheetPrintSettings` with a `@deprecated since`/removal target and inventory its remaining consumers; schedule the swap to `PrintSettings`.
2. Document the three `extensions?: Record<string, unknown>` bags as the explicit, namespaced escape hatch they are, and evaluate introducing a typed extension-key registry so first-party features (e.g. `ignoreError`) get real types instead of `unknown`.

## Tests and verification gates

- **Type-level regression:** add `*.test-d.ts` (or `tsd`/`expectTypeError` style) assertions inside the package proving: (a) a raw `string` is **not** assignable to a brand-tightened field (`CellAddress.sheetId`, `CellIdRange.topLeftCellId`, etc.); (b) `formulaA1('=A1')` is a `FormulaA1` and a `FormulaTemplate` is not assignable to it; (c) `ResolvedCellFormat` has every `CellFormat` key required and `| null`.
- **Constructor unit tests:** `formulaA1`/`formulaTemplate` normalize/validate the `=` prefix; round-trip `toA1(toTemplate(x)) === x`.
- **Rust-parity gate:** the Phase-5 generator/fixture test runs in CI and fails on drift (covers the serde-incident class from memory).
- **Whole-repo typecheck as the real gate:** because brand-tightening is a deliberate narrowing, the binding signal is that the **monorepo typechecks after the declaration rollup** (`@mog-sdk/contracts` build → downstream `tsc`). Every newly-surfaced raw-string seam must be fixed at its producer, not suppressed. (Per task constraints these commands are *not* run in this planning pass; they are the acceptance gates for the implementing change.)
- **Barrel-stability check:** diff the exported name set of `index.ts` before/after Phase 4 — it must be identical.
- **No-new-dependency check:** `package.json` dependencies remain `{ @mog/types-culture }` only.

## Risks, edge cases, and non-goals

- **Brand-tightening surfaces real breakage downstream.** This is intended — it converts silent unsafe interchange into compile errors — but the blast radius spans ~126 consumer files. Mitigation: land per-seam, each with its producer fixes; expect the largest churn at kernel bridges and importers that today brand via `as`.
- **`AxisRunId`/`AxisIdentityRef` branding may be a genuine widening risk** if those ids are intentionally cross-axis. Verify against the Rust definition before branding; if ambiguous, leave as `string`/`number` and document why (avoid a false-precision brand).
- **`core.ts` decomposition can perturb `export *` ordering / circular imports.** `formatted-text.ts` already back-imports from `core.ts`; the split must not introduce a cycle (resolve by moving the `FormattedText` brand). Keep the move mechanical and barrel-frozen.
- **Generated-from-Rust parity (Phase 5)** depends on the `compute-core` build pipeline and the existing Rust→TS generation used for `NumberFormatType`; if generation isn't feasible for tagged unions, fall back to the fixture round-trip test rather than dropping the guard.
- **Non-goals:** no relocation of `errorDisplayString`/`resolveCellTextStyle`/`toPlainText` into this package (they belong to `spreadsheet-utils`; this folder only references them in JSDoc — fixing the duplicate `errorDisplayString` in `spreadsheet-utils` is a separate folder's plan); no un-privatizing/publishing the package; no compatibility shims for the brand narrowing; no behavior/logic beyond pure constructors and the parity guard.

## Parallelization notes and dependencies on other folders

- **Independent, parallelizable within this folder:** Phase 2 (formula constructors), Phase 3 (metadata de-dup), and Phase 6 (deprecation/extensions) touch disjoint modules and can proceed concurrently.
- **Serialize Phase 4 (decomposition) before or cleanly around Phase 1/3 edits** to avoid move-vs-edit conflicts in `core.ts`; alternatively land Phase 4 first since it is a pure move, then apply Phase 1/3 to the new modules.
- **Cross-folder dependencies:**
  - Phase 1 brand-tightening requires coordinated edits in **`mog/kernel`** (bridges, store, importers) and anything routing through **`@mog-sdk/contracts`** — those are separate folders’ change sets that must merge together with this one.
  - Phase 2 cast-removal touches the ~15 `as Formula*` call sites repo-wide (formula bar, search, bridge to Rust `process_input`), outside this folder.
  - Phase 5 depends on the **`compute-core`** Rust definitions and the existing Rust→TS generation toolchain (shared with `@mog/types-culture`).
- **Downstream verification dependency:** every gate that runs `tsc` requires the `@mog-sdk/contracts` declaration rollup to be built first (memory: contracts declaration rollup); sequence accordingly in the implementing change.
