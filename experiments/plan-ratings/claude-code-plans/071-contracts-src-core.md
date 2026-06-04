# Plan 071 — Harden the foundational identity/range/command contracts in `mog/contracts/src/core`

## Source folder and scope

- **Folder:** `mog/contracts/src/core` (package `@mog-sdk/contracts`, public import path `@mog-sdk/contracts/core`; also surfaced through the package root barrel `@mog-sdk/contracts`).
- **In scope (the 11 files in this folder):**
  - `core.ts` — locally-authored runtime values: `MAX_ROWS`, `MAX_COLS`, the `RangeKind` enum, and the `sheetId()` / `rangeId()` branded constructors (plus `export type * from '@mog/types-core/core'`).
  - `formatted-text.ts` — runtime brand helpers `asFormattedText` / `displayString` / `displayStringOrNull` over the `FormattedText` brand.
  - `execution.ts` — locally-authored AI code-execution contract (`ExecutionStatus`, `ChangeType`, `DirtyCell`, `CodeExecutionResult`, `CodeExecutionOptions`, `DEFAULT_EXECUTION_TIMEOUT`, `API_CALL_TIMEOUT`).
  - `schema.ts` — locally-authored 470-line data-type/data-validation contract (`CellSchemaType` family, `DistributionConfig`, `SchemaConstraints`, `ColumnSchema`, `CellSchema`, `RangeSchema`, `ISchemaValidator`, `ISchemaRegistry`, `ValidationErrorCodes`, `EnforcementLevel`).
  - `index.ts` — the public `@mog-sdk/contracts/core` barrel; re-exports the above plus pulls in `../cells/cell-identity`, `../cells/cell-style`, `../document/protection`.
  - Re-export shims (one-liners): `commands.ts` (`@mog/types-commands/commands`), `event-base.ts` (`@mog/types-commands/event-base`), `result.ts` (`@mog/types-core/result`), `disposable.ts` (`@mog/types-core/disposable`), `testing.ts` (`@mog/types-commands/testing`).
- **Out of scope (referenced, not edited by this plan's investigation):** the canonical private authoring packages `mog/types/core/src` (`@mog/types-core`) and `mog/types/commands/src` (`@mog/types-commands`); the Rust source of truth `mog/compute/core/crates/types/cell-types/src/range_id.rs` and the generated `mog/kernel/src/bridges/compute/compute-types.gen.ts`; all consumers in `mog/kernel`, `mog/apps`, `mog/canvas`, `mog/shell`; and the contracts build/verify tooling under `mog/contracts/scripts` and `mog/tools`.

## Current role of this folder in Mog

`@mog-sdk/contracts/core` is the **foundational** public contract layer: the cell/range/sheet identity primitives, the semantic `RangeKind` taxonomy, the sheet dimension limits, the `FormattedText` brand, the AI code-execution result contract, and the typed-column / data-validation schema language. It sits below every other contracts sub-entry — `kernel/src/bridges/wire/range-metadata-cache.ts` imports `RangeKind`/`RangeId`/`SheetId`/`RangeAnchor`/`PayloadEncoding`/`AxisIdentityRef` from `@mog-sdk/contracts/core`, and the schema types feed `kernel/src/domain/schemas`, `kernel/src/api/worksheet`, the clipboard paste path, and the viewport/bridge layers.

The folder follows the same runtime-vs-type split the rest of `@mog-sdk/contracts` uses, dictated by the published-build constraint that **the public package must not import the private `@mog/types-*` packages at runtime** (stated explicitly in `../cells/cell-identity.ts`: *"the branded constructors are public runtime contract values and must be emitted by @mog-sdk/contracts without importing private packages"*):

- **Type-only surface is authored in the private packages** and surfaced via `export type * from '@mog/types-core/*'` / `'@mog/types-commands/*'` shims (`commands.ts`, `event-base.ts`, `result.ts`, `disposable.ts`, `testing.ts`, and the `export type *` lines at the top of `core.ts`).
- **Runtime-bearing values are re-authored locally** because they emit JavaScript, not just types: the `RangeKind` enum, `MAX_ROWS`/`MAX_COLS`, `sheetId()`/`rangeId()`, the `FormattedText` helpers, the execution defaults, and `ValidationErrorCodes`.

Because the build only ships `export type *`, the runtime `RangeKind` enum value that downstream code gets from `@mog-sdk/contracts/core` is the **local** copy in `core.ts:21`, not the one in the private package. (Per memory `mog-contracts-declaration-rollup`: contracts type edits require `pnpm --filter @mog-sdk/contracts build` before consumers typecheck, and canonical authoring lives in the private `types/*` shards.)

## Improvement objectives

1. **Close the unguarded multi-copy duplication of `RangeKind`.** The exact same string enum is hand-authored in **four** places that must stay byte-aligned with no enforcement:
   - `mog/contracts/src/core/core.ts:21` (the published runtime value),
   - `mog/types/core/src/core.ts:102` (private authoring copy),
   - `mog/kernel/src/bridges/compute/compute-types.gen.ts:3744` (generated Rust binding, a `type` union),
   - `mog/compute/core/crates/types/cell-types/src/range_id.rs:106` (the Rust source of truth).
   A new variant added in Rust silently fails to reach the contract until someone hand-edits two more TS files; nothing fails the build if they drift. The same applies, to a lesser degree, to the `rangeId()` / `sheetId()` branded constructors, which are also duplicated between `contracts/src/core/core.ts` and `types/core/src/core.ts:97`.

2. **Make `MAX_ROWS`/`MAX_COLS` the enforced single source of truth.** The contract constants exist (`core.ts:5,8`) but ~20+ production call sites hardcode the magic literals `1048576` / `16384` instead of importing them (`kernel/src/document/document-lifecycle-system.ts:2046`, `kernel/src/bridges/compute/viewport-fetch-manager.ts:312`, `canvas/grid-renderer/src/data/defaults.ts:104`, `canvas/grid-renderer/src/coordinates/viewport-merge-index.ts:47`, `apps/spreadsheet/src/components/grid/layout/ScrollContainer.tsx:46`, and more). Worse, `mog/apps/spreadsheet/src/domain/fill/types.ts:373` defines a **conflicting** `MAX_ROWS = 1_000_000` — a genuine off-by-48,576 inconsistency against the Excel limit the contract encodes.

3. **Bring the AI code-execution contract (`execution.ts`) onto the identity model the rest of `core` already uses.** `DirtyCell` (`execution.ts:29`) addresses cells by `sheet: string` (a sheet *name*) and `address: string` ("A1" notation), with `oldValue` / `value` typed `unknown`. This is stringly-typed and CRDT-unsafe while the sibling `schema.ts` (`RangeSchema`, line 447) and `cell-identity.ts` deliberately moved to branded `CellId` / `SheetId` corner references precisely so concurrent structure edits compose. The execution result is the public contract between the engine and the Platform; it should not be the one place that regresses to A1 strings.

4. **Type the loose holes in the published `schema.ts` surface.** `ISchemaRegistry` and `ISchemaValidator` take `sheetId: string` (`schema.ts:320,328,335,342,350`) and `ColumnSchema.id: string` / `RangeSchema.id: string` are unbranded, even though `@mog-sdk/contracts/core` already exports a branded `SheetId`. `SchemaValidationError.code: string` (`schema.ts:201`) is untyped despite the adjacent `ValidationErrorCodes` const + `ValidationErrorCode` union existing for exactly this. `DistributionConfig.params: Record<string, number>` (`schema.ts:78`) is an untyped bag in a published contract that the Monte Carlo feature must parse.

## Production-path contracts and invariants to preserve or strengthen

**Must preserve (no rename/removal — these are imported across the repo and potentially by external SDK users):**

- `@mog-sdk/contracts/core` keeps exporting, by the same names and shapes: `MAX_ROWS`, `MAX_COLS`, `RangeKind` (same string members `Data|Format|NamedRange|CondFormat|Validation|Protection|PrintArea|Table`, same order, same string values), `rangeId`, `sheetId`, `asFormattedText`, `displayString`, `displayStringOrNull`, `cellId`/`colId`/`rowId`/`toCellId`/`toColId`/`toRowId`, `DEFAULT_CELL_STYLE`, `DEFAULT_PROTECTION_OPTIONS`, `DEFAULT_WORKBOOK_PROTECTION_OPTIONS`, `API_CALL_TIMEOUT`, `DEFAULT_EXECUTION_TIMEOUT`, `ValidationErrorCodes`, plus the full `@mog/types-core` + `@mog/types-commands` type surface.
- The runtime constants' **values**: `MAX_ROWS = 1_048_576`, `MAX_COLS = 16_384`, `DEFAULT_EXECUTION_TIMEOUT = 30000`, `API_CALL_TIMEOUT = 10000`. These are behavioral contracts (sheet bounds, timeouts), not just types.
- The `RangeKind` string values must continue to match Rust serde output and the generated `compute-types.gen.ts` union exactly (the wire round-trips `kind as RangeKind` in `range-metadata-cache.ts:185`).
- The `FormattedText` brand stays a single brand owner (the `as unknown as` casts in `formatted-text.ts` are the sanctioned producer/consumer seam) — must not create a second owner under `check-contracts-declaration-identity`.
- The `package.json#exports` sub-entrypoints `./core`, `./core/commands`, `./core/event-base` remain.

**To strengthen:**

- **One enforced source of truth for `RangeKind`.** The published runtime value must remain local (the no-private-import rule forbids re-exporting the enum value from `@mog/types-core`), so close the gap with a **parity guard**, not a merge: a check that the local `core.ts` `RangeKind` members equal the Rust `range_id.rs` variants and the generated `compute-types.gen.ts` union — ideally by generating the local enum from the same source that produces `compute-types.gen.ts`, or failing that a test that asserts set-equality across all four definitions. Same guard discipline for `rangeId`/`sheetId` brand-constructor parity with `types/core`.
- **`MAX_ROWS`/`MAX_COLS` as the only definition.** Make the contract constants the import target; delete the conflicting `1_000_000` in `apps/spreadsheet/src/domain/fill/types.ts` and the scattered literals in favor of the contract import.
- **Identity-typed execution + schema surfaces** (objectives 3–4) without breaking existing field names where avoidable.

## Concrete implementation plan

> All *type-shape* edits land in the canonical private packages (`@mog/types-core`, `@mog/types-commands`) first; locally-authored runtime values land in `contracts/src/core` directly. After contracts edits, `pnpm --filter @mog-sdk/contracts build` must run before downstream typecheck sees changes (memory `mog-contracts-declaration-rollup`).

**Phase 0 — Confirm provenance (read-only).**
- Read `mog/contracts/scripts/*` and `mog/tools/check-contracts-*` to confirm how `core.ts`'s local runtime values flow into the published `.d.ts` + `.js`, and which gate (`verify-runtime-exports` / `check-contracts-runtime-inventory` / `check-contracts-declaration-identity`) owns the `RangeKind` enum and the brand constructors. This determines whether the parity guard belongs in contracts tooling or in the Rust→TS codegen.
- Confirm how `compute-types.gen.ts` is generated (which crate + generator) so the `RangeKind` parity check can hook the same generator rather than bolt on a second one.

**Phase 1 — `RangeKind` single-source parity (objective 1).**
- Keep the local `core.ts` enum as the published value, but add a generated/asserted parity gate so it cannot drift from `range_id.rs`. Preferred: extend the existing Rust→TS generator that already emits the `RangeKind` union in `compute-types.gen.ts` to also emit (or assert against) the contracts enum members. Fallback: a unit test that imports `RangeKind` from `@mog-sdk/contracts/core`, the union from `compute-types.gen.ts`, and the private copy, and asserts the member sets are identical.
- Add the same parity assertion for `rangeId`/`sheetId` vs `types/core/src/core.ts`.

**Phase 2 — `MAX_ROWS`/`MAX_COLS` consolidation (objective 2).**
- Fix the correctness bug first: replace `apps/spreadsheet/src/domain/fill/types.ts:373`'s `MAX_ROWS = 1_000_000` with the contract value (import from `@mog-sdk/contracts/core`), and audit fill call sites for any code that depended on the wrong 1,000,000 bound.
- Migrate the magic-literal call sites (kernel document-lifecycle, viewport-fetch-manager, grid-renderer defaults + viewport-merge-index, ScrollContainer, etc.) to import `MAX_ROWS`/`MAX_COLS` from `@mog-sdk/contracts/core`. Where a 0-indexed *max index* is needed (vs count), derive it as `MAX_ROWS - 1` at the call site rather than re-hardcoding.
- Leave genuinely unrelated `16384` usages (e.g. `MAX_REASONABLE_DIMENSION` canvas-pixel guard in `useRendererLifecycle.ts`) untouched — they are coincidental, not the sheet-bound contract.

**Phase 3 — Identity-model the execution contract (objective 3).**
- In the canonical authoring location, evolve `DirtyCell` so cells are addressed by branded identity: add a `SheetId` and a `CellId`-based address alongside (not silently replacing) the human-readable `sheet`/`address` fields the Platform UI needs for display. Type `oldValue`/`value` to the shared cell-value union already used elsewhere in the contracts (rather than `unknown`), keeping `displayValue` for formatted strings.
- Keep `CodeExecutionResult.editRanges` but consider an identity-range form (`IdentityRangeSchemaRef`-style, as `schema.ts` uses) so edit ranges survive concurrent structure edits.
- This is the highest-blast-radius change; sequence it last and gate on the engine/Platform consumers in `kernel` + the code-execution bridge.

**Phase 4 — Tighten `schema.ts` types (objective 4).**
- Replace `sheetId: string` in `ISchemaRegistry` / `ISchemaValidator` with the branded `SheetId`; brand `ColumnSchema.id` / `RangeSchema.id` with a dedicated `SchemaId` brand (or document why they stay raw).
- Type `SchemaValidationError.code` as `ValidationErrorCode` (the union already derived from `ValidationErrorCodes`) instead of `string`.
- Replace `DistributionConfig.params: Record<string, number>` with a discriminated, per-`DistributionType` parameter shape (e.g. `normal` → `{ mean; stddev }`, `uniform` → `{ min; max }`, `triangular` → `{ min; mode; max }`, …), so Monte Carlo consumers get a checkable contract.

**Phase 5 — Documentation.**
- Update the `index.ts` / `core.ts` header comments to state the runtime-vs-type split and the single-source rule for `RangeKind`/limits, so future contributors edit the generator/private package and never hand-fork the enum.

## Tests and verification gates

- **Full contracts build (owner-run, not this planning agent):** `pnpm --filter @mog-sdk/contracts build` — must pass `check-no-source-dts` → `tsc -p tsconfig.build.json` → `rollup-public-dts` → `fix-dts-extensions` → `check-contracts-declaration-identity` → `verify-runtime-exports` → `check-contracts-runtime-inventory` → `check-contract-runtime-imports`, confirming `RangeKind`, `MAX_ROWS`, `MAX_COLS`, `rangeId`, `sheetId`, the `FormattedText` helpers, the execution defaults, and `ValidationErrorCodes` all remain present as runtime exports with no new brand owner.
- **`RangeKind` parity test** (new): set-equality across the local enum, the private `types/core` enum, the `compute-types.gen.ts` union, and (via the generator fixture) the Rust `range_id.rs` variants. This is the gate that closes objective 1 permanently.
- **Constants test** (new): assert `MAX_ROWS === 1_048_576` and `MAX_COLS === 16_384`, and a repo-wide lint/check that flags fresh `1048576`/`16384` sheet-bound literals outside the contract.
- **Downstream typecheck:** `pnpm --filter @mog/kernel typecheck` (plus apps/spreadsheet, canvas/grid-renderer, shell) after the contracts build, to surface any latent errors the branded `SheetId`/`DirtyCell`/`schema` tightening exposes — those are bugs to fix in the consumer, not reasons to keep the loose types.
- **Targeted schema/validation tests:** the existing `kernel/src/api/worksheet/__tests__/validation-cache.test.ts` and schema consumers must still pass with the branded/`ValidationErrorCode`-typed surface.

## Risks, edge cases, and non-goals

- **No-private-import constraint.** `@mog-sdk/contracts` must not import `@mog/types-core`/`@mog/types-commands` at runtime, so `RangeKind` cannot simply be re-exported as a value — the fix is a parity guard, *not* a merge. Don't accidentally introduce a runtime import while consolidating.
- **`RangeKind` wire stability.** The string values cross the Rust serde boundary (`range-metadata-cache.ts:185` does `kind as RangeKind`). Reordering or renaming members would break deserialization — the parity guard must lock values, and any *new* variant must land in Rust first.
- **Execution-contract blast radius (Phase 3).** `DirtyCell`/`CodeExecutionResult` is consumed by the Platform UI and the AI code path; field changes ripple into the bridge serializer and the LLM-readable `formattedSummary`. Additive identity fields (keep `sheet`/`address` for display) are safer than replacement; sequence last and verify the engine↔Platform round-trip.
- **No-"Excel" rule (memory `no-excel-in-code`).** `core.ts:4,7` comments name "Excel limit" and `schema.ts` references "Excel parity"/"Excel's errorStyle". Any comment touched during this work must be rephrased to neutral wording (e.g. "the spreadsheet row/column limit"); run a final `rg -i excel` over edited files.
- **`fill/types.ts` MAX_ROWS fix is behavioral.** Code that fills to row 1,000,000 today will newly reach 1,048,576; confirm no fill path relied on the lower bound as an intentional cap (audit the fill engine, not just the constant).
- **Non-goals:** no new `RangeKind` variants or schema features; no change to enum values or constant values; no reorganization of the private `types/*` shards beyond what single-sourcing needs; no test-only stub, compatibility shim, or A1-string workaround in place of the real identity-model fix; no edits outside the production path.

## Parallelization notes and dependencies on other folders

- **Hard upstream dependency on the Rust source + codegen for Phase 1.** `RangeKind` parity must hook the same Rust→TS generator that emits `compute-types.gen.ts` from `compute/core/crates/types/cell-types/src/range_id.rs`. Coordinate with whoever owns that generator and the `mog/compute` crate; this plan supplies the parity requirement rather than rewriting the generator unilaterally.
- **Hard dependency on `mog/types/core` + `mog/types/commands` (plans 005–008 territory).** Type-shape edits for `DirtyCell` and the `schema.ts` branding land in those private packages first, then the contracts mirror/runtime is synced and rebuilt. Sequence after, or co-own with, the `types/core` worker.
- **Contracts build tooling dependency.** The new parity/constants gates touch `mog/contracts/scripts` / `mog/tools` (production tooling) — hand that requirement to whichever plan owns those scripts if folder ownership is split (cf. plan 001).
- **Downstream verification only** (no edits expected beyond fixing exposed latent errors): `mog/kernel` (bridges/wire, domain/schemas, api/worksheet), `mog/apps/spreadsheet` (fill, grid layout), `mog/canvas/grid-renderer`, `mog/shell`.
- **Internal parallelism:** Phase 2 (`MAX_ROWS`/`MAX_COLS` consolidation) and Phase 4 (`schema.ts` tightening) are independent and can run in parallel. Phase 1 (`RangeKind` parity) is independent but gated on the codegen owner. Phase 3 (execution identity model) is the largest and should land last.
