# 074 - Improve `mog/types/core/src`

## Source folder and scope

Source folder: `/Users/guangyuyang/Code/mog-all/mog/types/core/src`

Scope: the TypeScript authoring source for Mog's Tier 0 spreadsheet primitives. This folder is workspace-internal as `@mog/types-core`, but it backs the shipped public `@mog-sdk/contracts/core`, `@mog-sdk/contracts/cells`, and related contract subpaths. The plan covers the source files in `types/core/src`, the public projection path through `contracts`, and the production consumers that assume these primitives are canonical.

In-scope source groups:

- `core.ts`: spreadsheet limits, values/errors, ranges, formats, workbook/sheet/calculation/print settings, metadata, copy options, and `FormattedText`.
- `sheet-id.ts`, `cells/cell-identity.ts`: branded sheet/cell/row/column/range identity types and CRDT-safe identity references.
- `cells/formula-string.ts`, `formatted-text.ts`, `result.ts`, `disposable.ts`: branded and helper primitives used across API, kernel, and SDK surfaces.
- `cells/cell-style.ts`, `cells/rich-text.ts`, `cells/range-ref.ts`, `cells/spill.ts`, `document/protection.ts`, `utils/a1.ts`, `utils/function-registry.ts`: cell style, text, A1, spill/projection, protection, and formula metadata contracts.

Out-of-folder work required to complete this correctly: `contracts/src/**` public projections, `spreadsheet-utils/src/cells/**` duplicated runtime helpers, `kernel/src/**` branded/wire boundary consumers, generated SDK/API artifacts, and Rust schema owners in `compute/core/crates/types/**` and `domain-types/**`.

## Current role of this folder in Mog

`types/core/src` is the canonical TypeScript vocabulary for spreadsheet primitives consumed by nearly every public-facing package path. Direct consumers include `types/api`, `types/data`, `types/events`, `types/rendering`, `types/machines`, `types/viewport`, `types/objects`, `types/document`, `types/formatting`, `types/editor`, `types/commands`, `types/connections`, `types/bridges`, `contracts`, `kernel`, `runtime/sdk`, `runtime/embed`, and `views/sheet-view` through either `@mog/types-core` or the public `@mog-sdk/contracts` projection.

The folder is not just "types" in practice. It exports runtime values from built output, including `MAX_ROWS`, `MAX_COLS`, `RangeKind`, identity constructors, `DEFAULT_CELL_STYLE`, `FunctionCategory`, and protection default objects. Public contracts currently duplicate some runtime values in `contracts/src/**` to avoid leaking workspace-internal packages into public declarations. That makes this folder a contract source of truth, but not always the only runtime source of truth.

The most important production contracts are:

- `CellValue`, `CellRawValue`, `CellError`, `CellData`, and display text boundaries used by SDK APIs, kernel reads, compute bridge normalization, rendering, and generated API specs.
- `CellRange` as the flat 0-indexed JSON range shape used by UI, canvas, events, pivots, tables, filters, charts, and selection machines.
- Branded `SheetId`, `CellId`, `RowId`, `ColId`, and `RangeId`, plus identity formula/range/merge contracts used to make structure edits CRDT-safe.
- `CellFormat`, `CellBorders`, `ResolvedCellFormat`, rich text, and `DEFAULT_CELL_STYLE` as the source for rendering, in-cell editing, formatting, XLSX round trips, and public style APIs.
- Workbook/sheet/protection/print/calculation settings that mirror Rust snapshot and domain types.

## Improvement objectives

1. Make the TypeScript core value model match the production Rust/wire model, not a partial scalar subset. Rust `value-types::CellValue` serializes primitives, errors, arrays, controls, and images; `types/core/src/core.ts` currently exposes primitives plus errors while defining `CellControl` separately. The correct fix is a canonical TS value model for the full serde contract, with explicitly named scalar/public projection types where APIs intentionally collapse or reject arrays, controls, or images.

2. Enforce branded identities at every semantic field boundary. Fields documented as `SheetId`, `CellId`, `RowId`, `ColId`, or `RangeId` should use the branded type, not plain `string`, except for deliberate wire/raw DTOs. Current gaps include `CellAddress.sheetId`, `CellRange.sheetId`, `IdentityRangeSchemaRef`, `CellIdRange`, and `IdentityMergedRegion`.

3. Establish one source of truth for runtime contract values. `DEFAULT_CELL_STYLE`, identity constructors, formula string constructors, formatted-text helpers, protection defaults, and result/disposable helpers should be authored once and projected into public contracts without manual drift. Public packages must still emit declarations with no `@mog/types-*` imports.

4. Reconcile documented exports with actual exports. `formula-string.ts` has a "Constructors" section with no constructors; `result.ts` documents `ok`/`err` without exporting them; `disposable.ts` documents `DisposableBase` and `DisposableStore` without implementing them; `rich-text.ts` references runtime utilities that do not exist in this package; `spill.ts` labels old spill contracts as temporary while `ProjectionInfo` is the newer production model.

5. Make package exports and generated artifacts verifiable. Root vs subpath exports should be intentional for `./a1`, `./function-registry`, and `./sheet-id`; `package.json` should not point exports at artifacts excluded by `files`; generated SDK API reports should not contain stale or impossible imports such as `FormulaA1` from `@mog/types-core/cell-identity`.

6. Add contract tests and cross-language fixtures for the production path. The folder currently has no local test files and only a `typecheck` script. The improved package needs type-level, runtime helper, and Rust/TS JSON-shape gates that prove these primitives survive API extraction, declaration rollup, kernel bridge conversion, and public package packing.

## Production-path contracts and invariants to preserve or strengthen

- `MAX_ROWS = 1_048_576` and `MAX_COLS = 16_384` remain Excel-compatible hard limits.
- Coordinates are zero-indexed internally. A1 parser result types must continue to represent parsed row/column indexes, not user-facing 1-indexed addresses.
- `CellAddress` requires a sheet context. `CellRange` may remain sheet-optional only where active-sheet context is a real production input; all persisted or cross-sheet state should use branded `SheetId`.
- `CellRange` remains the canonical flat range shape for position-based UI/API operations. Identity range types remain separate and are used for CRDT-safe persisted references.
- Branded identifiers remain structurally strings at runtime and are only introduced at trusted wire/storage boundaries through explicit constructors or validation helpers.
- `FormulaA1` means a formula string with the leading `=`, while `FormulaTemplate` means a formula template without it. Conversions must reject or normalize through named functions, never by local casts in production code.
- `CellError.value` must continue to cover the Rust `CellError` variants: `Null`, `Div0`, `Value`, `Ref`, `Name`, `Num`, `Na`, `GettingData`, `Spill`, `Calc`, and `Circ`.
- `CellValue` JSON shape must match Rust serde for primitives, error objects, arrays as row-major nested arrays, controls as `{ type: "control", controlType: "checkbox", checked, value }`, and images as `{ type: "image", source, altText, sizing, height, width }`.
- `FormattedText` remains opaque for display-only text; semantic value logic must use `CellValue`, not formatted strings.
- `CellFormat` remains the exhaustive Excel/OOXML-facing cell-format contract. Any new format property must be mapped through import/export, renderer, public API, and resolved-format behavior rather than added as an isolated optional field.
- Public declaration rollups for `@mog-sdk/contracts`, `@mog-sdk/node`, `@mog-sdk/embed`, and `@mog-sdk/sheet-view` must not leak workspace-internal `@mog/types-*` imports.

## Concrete implementation plan

1. Build a contract inventory before editing.

   - Generate or update an inventory of every exported type and runtime value from `types/core/src/**`, mapped to `package.json` export subpaths and public `contracts/src/**` projections.
   - Classify each export as type-only, runtime value, wire DTO, public contract, internal helper, or legacy candidate.
   - Record the Rust owner for each cross-language type: `value-types` for `CellValue`/`CellError`, `cell-types` for range identity/payload contracts, `snapshot-types` for workbook/settings/projection contracts, and `domain-types` or `file-io/xlsx` for print settings.

2. Split `core.ts` into cohesive canonical modules without changing package ownership.

   - Move value/error/control/image/array definitions to a focused value module under `types/core/src/cells` or `types/core/src/value`, then re-export from `core.ts`.
   - Move settings and print contracts into focused modules if they continue to grow, then keep public subpaths and root exports deliberate.
   - Keep `core.ts` as a curated public barrel for the historically canonical `@mog/types-core/core` surface, not a dumping ground.

3. Align `CellValue` with the Rust serde contract.

   - Add TS interfaces/unions for `CellArrayValue`, `CellControlValue`, `CellImageValue`, and `ScalarCellValue`.
   - Make `CellValue` represent the full production value universe.
   - Introduce explicit `CellScalarValue` or `PublicCellValuePrimitive` names for API paths that intentionally return only primitives after normalization.
   - Update kernel/api normalization code so conversions from full compute values to public scalar returns are named production projections, not casts.
   - Add JSON fixtures shared with Rust serde tests for numbers, text, booleans, null, all error variants, arrays including jagged input normalization expectations, checkbox controls, and image values.

4. Brand identity-bearing fields systematically.

   - Change semantic fields to branded types: `CellAddress.sheetId: SheetId`, `CellRange.sheetId?: SheetId`, `IdentityRangeSchemaRef.sheetId?: SheetId`, `IdentityRangeSchemaRef.startId/endId: CellId`, `CellIdRange.topLeftCellId/bottomRightCellId: CellId`, and `IdentityMergedRegion.topLeftId/bottomRightId: CellId`.
   - Keep raw wire equivalents in explicitly named `*Wire` types where JSON codegen or Rust serde requires plain strings.
   - Update consumers in `types/api`, `types/data`, `types/events`, `types/objects`, `types/viewport`, `kernel`, and `contracts` to brand at ingress boundaries and carry branded types internally.
   - Add type-level assertions that plain `string` is not assignable to these semantic fields without a constructor.

5. Make formula and formatted text helpers canonical.

   - Implement `asFormulaA1`, `toFormulaA1`, `asFormulaTemplate`, `toFormulaTemplate`, and `ensureFormulaA1` next to `FormulaA1`/`FormulaTemplate`.
   - Move production imports from `@mog/spreadsheet-utils/cells/formula-string` to the canonical contract helper path, then remove the duplicate utility implementation.
   - Change `CellData.formatted?: string` to use `FormattedText` where the field is display-only; keep plain strings only on explicit wire DTOs or user input.
   - Add `FormattedText` unwrap/brand tests and update API extraction so the opaque display contract appears consistently.

6. Reconcile runtime values between `types-core` and public `contracts`.

   - Choose one authoring source for `DEFAULT_CELL_STYLE`, identity constructors, `sheetId`, `rangeId`, protection defaults, formula helpers, formatted-text helpers, and `FunctionCategory`.
   - Generate or project public runtime modules in `contracts/src/**` from that source so `@mog-sdk/contracts` can emit public-safe runtime values without hand-maintained duplicates.
   - Add a drift test that imports both workspace-internal and public contract modules in-repo and asserts runtime equality for constants/default objects.
   - Ensure public declaration rollups inline or publicize the projected types without retaining `@mog/types-core` specifiers.

7. Decide and finish the spill/projection contract transition.

   - Audit production consumers of `SpillResult`, `SpillRangeInfo`, `ArrayFormulaState`, `SpillError`, and `ProjectionInfo`.
   - If the projection registry is the production model, update public and internal contracts to name projection as the canonical dynamic-array model and remove stale phantom-spill types from exported public surfaces.
   - If any old spill type is still required for CSE or UI diagnostics, rename it around that exact production role and prove it through kernel scheduler, compute wire, and UI selection tests.

8. Fix package export boundaries and generated reports.

   - Make root and subpath export policy explicit for `a1`, `function-registry`, and `sheet-id`.
   - Ensure `package.json` `files`, `exports`, and emitted `dist` artifacts describe a coherent package, even if the package remains private.
   - Regenerate API specs/reports after type movement and fix stale imports in SDK API reports.
   - Add package-boundary checks that fail on public declaration imports from `@mog/types-*`.

9. Add tests where the contracts live.

   - Add type assertion tests for brand non-interchangeability, formula string formats, result narrowing, range shapes, settings patches, and cell value projections.
   - Add runtime tests for formula constructors, formatted text helpers, protection defaults, cell style defaults, and any newly canonical helper objects.
   - Add cross-language fixture tests that compare TS accepted JSON shapes to Rust serde output for `CellValue`, `RangeKind`, `RangeAnchor`, `PayloadEncoding`, `CalculationSettings`, `WorkbookSettings`, and `PrintSettings`.
   - Add declaration/API snapshot gates so future changes to this Tier 0 surface require an intentional snapshot update.

## Tests and verification gates

Run these after implementation, in this order:

1. `pnpm --filter @mog/types-core typecheck`
2. `pnpm --filter @mog/types-core test` after adding the package test script
3. `pnpm --filter @mog-sdk/contracts typecheck`
4. `pnpm --filter @mog/spreadsheet-utils test` for removed or relocated formula/style helper ownership
5. `pnpm --filter @mog-sdk/kernel test` for branded ingress, compute bridge conversion, cell reads, formulas, projection, and settings behavior
6. `pnpm build:public-artifacts`
7. `pnpm check:contracts-declaration-identity`
8. `pnpm check:declaration-rollups`
9. `pnpm check:api-snapshots`
10. `pnpm check:external-fixtures -- --skip-build`
11. `pnpm check:publish-readiness:fast`
12. `cargo test -p value-types`
13. `cargo test -p cell-types`
14. `cargo test -p snapshot-types`
15. `cargo test -p compute-core`

If public API shape changes, also run the full `pnpm check:publish-readiness` gate and the relevant SDK/API extraction checks for `runtime/sdk` and `runtime/embed`.

## Risks, edge cases, and non-goals

Risks:

- Branding semantic fields will surface many existing plain-string casts. The fix is to brand at ingress and use explicit wire DTOs, not to weaken the brands.
- Aligning TS `CellValue` with Rust arrays/controls/images may expose mismatches in kernel normalization and public SDK return types. Those need explicit public projection contracts.
- Public contract declarations can accidentally retain `@mog/types-core` imports after refactors. Declaration rollup and publish-readiness gates must catch this.
- Moving runtime helpers out of `spreadsheet-utils` can create circular dependencies if helpers import implementation packages. The canonical helper modules must stay Tier 0.
- Removing stale spill contracts before auditing CSE and UI diagnostics could erase a real production path. Audit first, then delete or rename based on evidence.
- `CellFormat` is large and shared by rendering, import/export, and API surfaces. Any property tightening must update all consumers and fixtures together.

Edge cases to cover:

- Non-finite numeric input maps to `#NUM!` through Rust but TypeScript numbers can represent `NaN` and `Infinity`; TS boundary helpers must reject or normalize them consistently.
- Error object equality ignores optional diagnostic messages in Rust; TS helpers should not make message text part of semantic equality unless explicitly display-only.
- Arrays must preserve rectangular shape; jagged JSON arrays need either Rust-compatible padding semantics or TS-side rejection at boundary.
- Checkbox controls expose both `checked` and formula-facing `value`; TS types must preserve both fields.
- Image values need sizing modes `fit`, `fill`, `original`, and `custom`, optional dimensions, and accessible fallback text semantics.
- `CellRange` full-row/full-column flags must not conflict with start/end coordinates or sheet context.
- Formula string helpers must prevent double-`=` and missing-`=` bugs across worksheet APIs, compute bridge, formula bar, and generated SDK types.
- Public artifacts must keep single-owner brands after declaration bundling.

Non-goals:

- No test-only type facades or consumer-side casts to hide contract drift.
- No compatibility wrapper layer for old imports after production callers are updated.
- No changes to spreadsheet calculation semantics beyond making existing value contracts explicit.
- No private/internal planning text or implementation details in public packages or generated public docs.

## Parallelization notes and dependencies on other folders, if any

This work is naturally parallelizable with strict ownership boundaries:

- Agent A: `types/core/src` export inventory, module split proposal, type-level tests, and package export policy.
- Agent B: Rust/TS serde alignment for `CellValue`, `CellError`, `RangeKind`, `RangeAnchor`, `PayloadEncoding`, settings, and print fixtures across `compute/core/crates/types/**`, `domain-types/**`, and `types/core/src`.
- Agent C: identity branding migration across `types/api`, `types/data`, `types/events`, `types/objects`, `types/viewport`, `types/machines`, and `kernel`.
- Agent D: public projection and declaration rollup work in `contracts/src/**`, `contracts/scripts/**`, `tools/api-snapshots/**`, and SDK API extraction.
- Agent E: runtime helper ownership cleanup for formula strings, formatted text, cell style defaults, protection defaults, and `spreadsheet-utils`.
- Agent F: verification and fixture regeneration, including public artifact build, declaration identity, API snapshots, external fixtures, and Rust crate tests.

Dependencies:

- `contracts/src/**` is required because `@mog-sdk/contracts` is the shipped public owner even when source authoring lives in `@mog/types-core`.
- `spreadsheet-utils/src/cells/**` currently owns duplicated formula and style helper runtime behavior that should be unified with Tier 0 contracts.
- `kernel/src/bridges/compute/**` and generated `compute-types.gen.ts` are required to align full `CellValue` and identity wire DTOs.
- `compute/core/crates/types/value-types`, `compute/core/crates/types/cell-types`, and `compute/core/crates/types/snapshot-types` are the Rust owners for cross-language JSON contracts.
- `runtime/sdk`, `runtime/embed`, and `views/sheet-view` must be checked because public declaration and API-report drift is a primary failure mode for this folder.
