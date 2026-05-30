# Identity Model (Cell, Row, Column)

## Overview

The identity model is the internal foundation for collaborative spreadsheets. It applies to three entity types:

| Entity | Identity Type | Canonical Position State | Properties Keyed By |
| ------ | ------------- | ------------------------ | ------------------- |
| Cell   | CellId        | GridIndex / CellMirror   | CellId              |
| Row    | RowId         | rowOrder / row axis      | RowId               |
| Column | ColId         | colOrder / column axis   | ColId               |

**Key Insight**: Entity movement is tracked by updating identity-to-position state, not by treating A1 formula text as the structural source of truth. Stable formula refs avoid rewriting identity references during row/column changes; current storage still refreshes cached A1 strings (`f`) where needed for display, search, export, and rebuild fallback.

## Cell Identity Model

Users type and see A1-style formulas. The live compute/mirror representation stores formulas as a template plus stable identity references; Yrs cell storage keeps an A1 body (`f`) and may also carry persisted identity fields (`ft`/`fr`) depending on the write path.

```text
User sees: =A1+B1
Stored as: template "{0}+{1}"
           refs: [IdentityCellRef(A1's CellId), IdentityCellRef(B1's CellId)]
```

Rust stores `CellId`, `SheetId`, `RowId`, and `ColId` as `u128` newtypes over UUID-compatible bytes. Serde emits compact 32-character lowercase hex strings, while parsers accept both compact hex and hyphenated UUID text. TypeScript exposes them as branded strings at public boundaries.

## Why Position-Based References Fail

### The Collaboration Problem

Consider two users editing simultaneously:

```text
Initial: Cell C1 has "=A1+B1"

User A: Insert column at A
User B: Insert column at B

User A's local rewrite: "=A1+B1" -> "=B1+C1"
User B's local rewrite: "=A1+B1" -> "=A1+C1"
```

If formula references are plain strings, the merged text cannot reliably represent both structure changes. Identity references avoid that conflict: the referenced cells keep their IDs, and A1 display is regenerated from the merged position state.

### Issues with Position-Based Model

| Problem               | Impact                                                       |
| --------------------- | ------------------------------------------------------------ |
| O(n) formula rewrites | Insert/delete may require parsing and rewriting many formulas |
| Concurrent conflicts  | Independent rewrites of the same formula text can conflict    |
| Undo atomicity        | Formula adjustment must be grouped with cell movement         |
| Complexity            | Absolute refs, ranges, deletes, and copy/fill all need rules  |

## How Cell Identity Solves It

Every materialized cell has a stable `CellId`. Formula references point at identities, while the grid, mirror, and Yrs identity maps track where those identities currently live.

### On Insert Column

| Model              | What Happens                                                        |
| ------------------ | ------------------------------------------------------------------- |
| A1 Model           | Parse formulas, shift affected refs, serialize updated formula text |
| Identity Model     | Update identity-position state, then refresh derived A1 views where needed |

### On Concurrent Insert Columns

| Model              | Result                                                        |
| ------------------ | ------------------------------------------------------------- |
| A1 Model           | Formula string rewrites can conflict                          |
| Identity Model     | Formula refs remain stable; display follows merged positions  |

## Core Types

**Public TypeScript surface:** `@mog-sdk/contracts/cell-identity` is the shipped public barrel. It re-exports the authored types from `types/core/src/cells/cell-identity.ts`, which is a workspace-internal type shard.

**Rust sources:** `compute/core/crates/types/cell-types/` defines ID newtypes and allocation, and `compute/core/crates/types/formula-types/src/identity_formula/types.rs` defines identity formula refs.

### CellId

```typescript
declare const __cellId: unique symbol;
export type CellId = string & { readonly [__cellId]: true };
```

Rust uses `cell_types::CellId`, a `u128` newtype serialized by serde as compact hex. Its parser accepts compact hex and hyphenated UUID text, and `Display` renders the hyphenated form.

### IdentityCellRef

```typescript
export interface IdentityCellRef {
  type: 'cell';
  id: CellId;
  rowAbsolute: boolean;
  colAbsolute: boolean;
}
```

### IdentityRangeRef

```typescript
export interface IdentityRangeRef {
  type: 'range';
  startId: CellId;
  endId: CellId;
  startRowAbsolute: boolean;
  startColAbsolute: boolean;
  endRowAbsolute: boolean;
  endColAbsolute: boolean;
}
```

The public TypeScript formula ref union includes cell refs, rectangular range refs, full-row refs, row-range refs, full-column refs, and column-range refs. Rust also has external workbook reference variants.

### IdentityFormula

```typescript
export interface IdentityFormula {
  template: string;
  refs: IdentityFormulaRef[];
}
```

The authored public TypeScript contract is `template` plus `refs`. Rust carries the same fields plus precomputed flags such as dynamic-array, volatile, and aggregate status. The generated bridge wire type currently exposes the dynamic-array and volatile flags.

### Additional Identity Types

These types extend identity tracking to other spreadsheet features:

```typescript
export interface IdentityRangeSchemaRef {
  sheetId?: string;
  startId: string;
  endId: string;
}

export interface CellIdRange {
  topLeftCellId: string;
  bottomRightCellId: string;
}

export interface IdentityMergedRegion {
  topLeftId: string;
  bottomRightId: string;
}
```

## Data Flow

```text
USER INPUT
  User types: =SUM(A1:B10)+C1*2

FORMULA CONVERSION
  The workspace-internal kernel bridge exposes toIdentityFormula().
  Rust compute-parser parses the A1 formula, resolves referenced positions
  through an IdentityResolver, and emits:
    { template: "SUM({0})+{1}*2", refs: [...] }

RUST YRS STORAGE
  Cell payloads are keyed by CellId under each sheet's cells map.
  Formula A1 body text is stored under f, without the leading "=".
  Persisted identity formula data, when present, stores template/ref JSON
  under ft/fr and flags under fda/fv/fa.
  Direct cell write paths may persist f without ft/fr; observer rebuild
  reparses f into an in-memory IdentityFormula when identity fields are absent.
  gridIndex.posToId and gridIndex.idToPos track position <-> CellId.

DISPLAY / EXPORT
  toA1Display() walks the identity formula template and renders each ref
  through the current workbook lookup. Missing/deleted refs render as #REF!.
```

## Yrs Storage Structure

The field-level Rust Yrs document schema is defined by `compute/core/crates/compute-document/src/schema.rs`. Domain read/write helpers live under `compute/core/src/storage/`.

```text
Y.Doc
+-- workbook: Y.Map
+-- sheets: Y.Map<SheetIdHex, Y.Map>
    +-- cells: Y.Map<CellIdHex, Y.Map>
    |   +-- v   value
    |   +-- f   A1 formula body, without leading "="
    |   +-- ft  optional identity formula template
    |   +-- fr  optional serialized identity formula refs
    |   +-- fda/fv/fa formula flags when true
    |   +-- fm/ar OOXML formula metadata / CSE array range when present
    +-- cellProperties: Y.Map<CellIdHex, Y.Map>
    +-- gridIndex: Y.Map
    |   +-- posToId: Y.Map<"rowHex:colHex", CellIdHex>
    |   +-- idToPos: Y.Map<CellIdHex, "rowHex:colHex">
    |   +-- rowAxis / colAxis when compact axis stores are present
    +-- rowOrder: Y.Array<RowIdHex>
    +-- colOrder: Y.Array<ColIdHex>
    +-- rowHeights / colWidths / rowFormats / colFormats
    +-- merges / comments / filters / ranges / rangePayloads / ...
```

The TypeScript `SerializedCellData` and `SheetMaps` contracts are still available through `contracts/src/store/store-types.ts`, but that file is a re-export shim over `types/api/src/store/store-types.ts` and retains compatibility names such as `properties` / `grid`. The Rust Yrs schema above is the authoritative persisted storage shape: sparse cell properties are stored under `cellProperties`, and position mirrors are stored under `gridIndex`.

### Core Maps

| Map / Index              | Contents                                      |
| ------------------------ | --------------------------------------------- |
| `cells`                  | Cell values and formula data keyed by CellId  |
| `cellProperties`         | Sparse cell formatting keyed by CellId        |
| `gridIndex.posToId`      | `"rowHex:colHex"` position key to CellId lookup |
| `gridIndex.idToPos`      | CellId to `"rowHex:colHex"` position key lookup |
| `rowOrder` / `colOrder`  | Ordered row/column identities                 |

**Benefits:**

- O(1)-style lookup through the in-memory `GridIndex` and `CellMirror`.
- Cell data and formatting remain keyed by stable identities.
- Structural changes update identity-position state instead of rewriting source identity references.
- The observer path can rebuild derived caches from the merged Yrs document.

## Key Operations

### Insert/Delete Columns

**TypeScript facade:** `kernel/src/domain/sheets/structures.ts`

```typescript
export async function insertColumns(ctx, sheetId, _maps, startCol, count) {
  if (count <= 0) return;
  return await ctx.computeBridge.structureChange(sheetId, {
    InsertCols: { at: startCol, count, new_col_ids: [] },
  });
}

export async function deleteColumns(ctx, sheetId, _maps, startCol, count) {
  if (count <= 0) return;
  return await ctx.computeBridge.structureChange(sheetId, {
    DeleteCols: { at: startCol, count, deleted_cell_ids: [] },
  });
}
```

**Rust implementation:** `compute/core/src/storage/sheet/structural/mod.rs`

Structural operations update:

- `GridIndex`, including row/column axes and sparse cell positions.
- Yrs `rowOrder` / `colOrder`, and removed cell entries for deletes.
- `CellMirror` via `apply_structure_change()`.
- Range cleanup when deleted rows or columns remove range-backed cells.
- Metadata ranges, named range refs, and cached A1 formula text (`f`) where structure changes make persisted display text stale.

### Range Expansion

For a formula like `=SUM(A1:A10)`, an identity range points at durable corner identities. After inserting a row between the corners, the corner identities are unchanged but their displayed positions differ, so the rendered formula can become `=SUM(A1:A11)`.

The structure path still updates position-derived caches, range extents, and persisted A1 display strings where needed. Deletes are pre-reanchored when possible; unresolved deleted endpoints render as `#REF!`. The source identity refs do not need to be rewritten for every formula.

## Dependency Graph

**Location:** `compute/core/crates/compute-graph/src/lib.rs`

The dependency graph is keyed by `CellId` and stores direct cell dependencies separately from range and external dependencies:

```rust
pub enum DepTarget {
    Cell(CellId),
    Range(RangePos, RangeAccess),
}

pub struct DependencyGraph {
    precedents: FxHashMap<CellId, Vec<DepTarget>>,
    dependents: FxHashMap<CellId, FxHashSet<CellId>>,
    range_deps: FxHashMap<RangePos, FxHashSet<CellId>>,
    external_deps: FxHashMap<ExternalRefKey, FxHashSet<CellId>>,
    external_precedents: FxHashMap<CellId, FxHashSet<ExternalRefKey>>,
}
```

Because graph nodes are identity keyed, structure changes do not require shifting graph keys. Position-aware range invalidation is handled through range positions and the current identity-position lookup.

## Grid Index

**Rust canonical implementation:** `compute/core/src/identity/` re-exports `compute_document::identity::GridIndex`.

**TypeScript facade:** `kernel/src/domain/grid-index.ts` delegates lookups to `ComputeBridge`.

The Rust `GridIndex` maintains:

```rust
cell_at_pos: FxHashMap<(u32, u32), CellId>;
cell_to_pos: FxHashMap<CellId, (u32, u32)>;
row_axis: AxisIdentityStore<RowId>;
col_axis: AxisIdentityStore<ColId>;
```

Key operations include:

- `ensure_cell_id(row, col)` for materializing a cell identity.
- `cell_id_at(row, col)` and `cell_position(cell_id)` for lookup.
- `register_cell(cell_id, row, col)` for import/sync and virtual IDs.
- `insert_rows`, `delete_rows`, `insert_cols`, and `delete_cols` for structural shifts.

The kernel bridge exposes the same responsibilities asynchronously through methods such as `getCellIdAt`, `getCellPosition`, and `getOrCreateCellId`.

## Why This Works for CRDT

### Identity References Stay Stable

Formula refs point to `CellId`, `RowId`, or `ColId` values. Concurrent structure changes update the CRDT-backed row/column order and identity-position maps, while formula identity refs remain the source of truth.

### A1 Formula Text Is Derived

The live structural source is the `IdentityFormula` in compute/mirror state. The persisted `f` field stores an A1 formula body for compatibility, display, search, export, and rebuild fallback. Structural operations may regenerate and write this cached A1 text, while optional `ft`/`fr` identity formula fields preserve persisted stable references when present.

### Undo/Redo

Structural operations run as a single Yrs transaction with `ORIGIN_STRUCTURAL`, so undo treats the operation as one undoable step. When undo/redo or remote sync reaches the observer path, `rebuild_after_structural_observer_change()` in `compute/core/src/storage/engine/sync_pipeline.rs` rebuilds `GridIndex`, `CellMirror`, layout indexes, merge state, and position-derived formula data from Yrs. The TypeScript bridge then refreshes registered viewports after undo/redo in `kernel/src/bridges/compute/compute-core.ts`.

## What Doesn't Change

| Component      | Status                                                       |
| -------------- | ------------------------------------------------------------ |
| User input     | Users type A1 formulas and addresses                         |
| Public APIs    | Worksheet APIs accept A1 strings or numeric row/column input |
| Display/export | A1 text is rendered from identity formulas when needed        |
| XLSX format    | XLSX import/export remains A1-based at the file boundary     |

The identity model is internal. Public spreadsheet behavior stays A1-oriented.

## Implementation Files

| File | Purpose |
| ---- | ------- |
| `types/core/src/cells/cell-identity.ts` | Authored public TypeScript identity types |
| `contracts/src/cells/cell-identity.ts` | Public contracts barrel and branded constructors |
| `types/api/src/store/store-types.ts` | TypeScript `SerializedCellData` and `SheetMaps` contracts |
| `compute/core/crates/types/cell-types/` | Rust ID newtypes, allocator, virtual CellIds, axis identities |
| `compute/core/crates/types/formula-types/src/identity_formula/types.rs` | Rust identity formula refs and formula type |
| `compute/core/crates/compute-parser/` | Formula parsing and identity/A1 rendering |
| `compute/core/crates/compute-document/src/schema.rs` | Authoritative Yrs schema keys and cell payload field names |
| `compute/core/src/storage/cells/values.rs` | Cell value writes and persisted gridIndex position mirrors |
| `compute/core/src/storage/sheet/structural/mod.rs` | Rust insert/delete row/column operations |
| `compute/core/src/storage/engine/services/structural/formula_writeback.rs` | Cached A1 formula text refresh after structural changes |
| `compute/core/crates/compute-graph/src/lib.rs` | CellId-keyed dependency graph |
| `kernel/src/domain/sheets/structures.ts` | TypeScript structural-operation facade |
| `kernel/src/domain/grid-index.ts` | TypeScript cell-position facade over ComputeBridge |
| `kernel/src/bridges/compute/compute-bridge.gen.ts` | Generated bridge API for identity conversion and lookup |

## Success Criteria

1. **Insert/delete row/column**: Formula identity refs still point at the same logical identities; rendered A1 addresses update from current positions.
2. **Concurrent structure changes**: Merged row/column order and grid identity state drive formula display and recalculation.
3. **Range expansion**: Inserts between range boundary identities expand the rendered A1 range.
4. **Deleted references**: References to removed cells render as `#REF!` where the lookup cannot resolve a position.
5. **Absolute references**: Absolute flags round-trip for A1 display.
6. **XLSX round-trip**: Import/export uses A1 formulas at the file boundary while internal refs remain identity based.

## Cell Value Resolution

When reading cell values, distinguish formula cells from literal value cells.

### The Problem

The `computed` field can be:

- `undefined`: no computed value on a non-formula cell.
- `null`: a formula result that is intentionally empty/null.
- Any other `CellValue`: the formula's evaluated result.

Do not use `data.computed ?? data.raw` for value resolution. The nullish coalescing operator treats `null` as missing, but `null` can be the correct formula result.

### The Correct Pattern

Use the `formula` field as the discriminator:

```typescript
// Wrong: treats null formula results as missing.
const value = data.computed ?? rawToCellValue(data.raw);

// Correct: formula presence determines source.
if (data.formula !== undefined) {
  return data.computed ?? null;
}
return rawToCellValue(data.raw) ?? null;
```

Or use the workspace-internal kernel helper:

```typescript
import { Cells } from '@mog-sdk/kernel/api';

const value = Cells.getEffectiveValueFromData(data);
```

### Invariants

1. For cells with `data.formula !== undefined`, use `data.computed ?? null`.
2. For cells without a formula, use `rawToCellValue(data.raw) ?? null`.
3. `null` is a valid computed value, not an instruction to fall back to raw input.
4. Use `Cells.getEffectiveValueFromData()` or `Cells.getEffectiveValueAt()` when possible.

## Row/Column Identity Model

Rows and columns use the same stable-identity pattern. Rust owns canonical row/column identity tracking through `GridIndex` axes, `rowOrder` / `colOrder`, and optional compact axis stores.

| Property Map | Key   | Value      |
| ------------ | ----- | ---------- |
| `rowHeights` | RowId | number     |
| `rowFormats` | RowId | CellFormat |
| `colWidths`  | ColId | number     |
| `colFormats` | ColId | CellFormat |
| `schemas`    | ColId | ColumnSchema |

`kernel/src/domain/row-col-identity.ts` contains workspace-internal compatibility helpers, but the canonical identities and index maintenance live in Rust. Older TypeScript store contracts may still mention index-keyed schema maps; canonical Yrs column schemas are keyed by `ColId` hex.

## Virtual Identity for Range-Resident Cells

Large imported or deferred data can live in `ranges` / `rangePayloads` instead of one Yrs cell entry per cell. Range-resident cells still need identities for formulas, formatting, and dependency tracking.

### Virtual CellIds

A virtual `CellId` is derived deterministically from structural identity:

```rust
CellId::virtual_at(sheet_id: SheetId, row_id: RowId, col_id: ColId) -> CellId
```

The derivation uses `siphasher::sip128::SipHasher`, and virtual IDs are disjoint from allocator-produced real IDs because the upper 64 bits are set to the reserved `VIRTUAL_CELL_SENTINEL`.

### Properties

| Property | Guarantee |
| -------- | --------- |
| Deterministic | Same `(SheetId, RowId, ColId)` gives the same `CellId` |
| Range-independent | Identity depends on structural position, not the range payload ID |
| Disjoint | Real allocator IDs cannot use the virtual sentinel namespace |
| Editable | Edit paths can register the same virtual ID as a sparse cell override |

### Resolution

`CellMirror::resolve_cell_id()` checks anchored `pos_to_id` first. If no anchored cell exists, it queries the range spatial index and synthesizes `CellId::virtual_at(sheet, row_id, col_id)` for positions inside a range.

### Value Read Path

```text
get_cell_value_at(sheet, row, col):
  1. pos_to_id -> cells for sparse overrides or real cells
  2. range spatial index confirms range coverage
  3. col_data returns materialized range/projection values
  4. real-cell Null fallback
```

Sparse `cells` entries shadow range payload values at the same position. That is how editing a range-resident cell overrides the imported/deferred payload without changing the cell's identity.

## References

- `types/core/src/cells/cell-identity.ts`
- `compute/core/crates/types/cell-types/src/identity/virtual_cell.rs`
- `compute/core/crates/types/cell-types/src/id_alloc.rs`
- `compute/core/crates/types/formula-types/src/identity_formula/types.rs`
- `compute/core/crates/compute-document/src/schema.rs`
- `compute/core/src/mirror/read.rs`
- `compute/core/src/storage/cells/values.rs`
- `compute/core/src/storage/sheet/structural/mod.rs`
- `compute/core/src/storage/engine/services/structural/formula_writeback.rs`
- `compute/core/src/storage/engine/sync_pipeline.rs`
- `compute/core/src/storage/sheet/schemas/columns.rs`
