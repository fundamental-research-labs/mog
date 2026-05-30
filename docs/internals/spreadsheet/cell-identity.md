# Identity Model (Cell, Row, Column)

## Overview

The Identity Model is the architectural foundation for collaborative spreadsheets. It applies to three entity types:

| Entity | Identity Type | Position Storage       | Properties Keyed By |
| ------ | ------------- | ---------------------- | ------------------- |
| Cell   | CellId (UUID) | `cell.row`, `cell.col` | CellId              |
| Row    | RowId (UUID)  | `rowData.position`     | RowId               |
| Column | ColId (UUID)  | `colData.position`     | ColId               |

**Key Insight**: Entity movement is tracked by updating position data, not by rewriting references or shifting property keys. This eliminates O(n) operations on structure changes and makes concurrent edits compose correctly under CRDT.

## Cell Identity Model

Instead of using A1-style positional references (`=A1+B1`), formulas internally reference cells by **stable UUID identities**. This is the same approach Google Sheets uses.

```
User sees:     =A1+B1           (A1-style display)
Stored as:     {0}+{1}          (template with placeholders)
               refs: [abc..., def...]   (stable cell IDs)
```

## Why Position-Based References Fail

### The Collaboration Problem

Consider two users editing simultaneously:

```
Initial: Cell C1 has "=A1+B1"

User A: Insert column at A (concurrent)
User B: Insert column at B (concurrent)

User A's edit: "=A1+B1" → "=B1+C1"
User B's edit: "=A1+B1" → "=A1+C1"

CRDT merge: String conflict - neither result is correct
Correct answer: "=C1+D1" (shifted twice)
```

**A1 reference adjustment doesn't compose under concurrent structure changes.**

### Issues with Position-Based Model

| Problem               | Impact                                                           |
| --------------------- | ---------------------------------------------------------------- |
| O(n) formula rewrites | Insert column requires parsing/rewriting ALL formulas            |
| Concurrent conflicts  | Two users inserting columns = unresolvable conflicts             |
| Undo atomicity        | Formula adjustment must be same transaction as cell movement     |
| Complexity            | Reference shifting logic (absolute refs, range expansion, #REF!) |

## How Cell Identity Solves It

Every cell gets a **stable UUID** when created. Formulas reference cells by UUID, not position. Position becomes a mutable property of the cell.

### On Insert Column

| Model              | What Happens                                                       |
| ------------------ | ------------------------------------------------------------------ |
| **A1 Model**       | Parse all formulas, find refs >= position, increment, re-serialize |
| **Identity Model** | Update `cell.col` for affected cells. Done.                        |

### On Concurrent Insert Columns

| Model              | Result                                                   |
| ------------------ | -------------------------------------------------------- |
| **A1 Model**       | Formula string conflicts                                 |
| **Identity Model** | Position numbers merge correctly (both increments apply) |

## Core Types

**Location:** `contracts/src/cells/cell-identity.ts`

### CellId

```typescript
/**
 * Stable cell identifier - never changes even when cell moves.
 * UUID v7 (time-sortable) for uniqueness without coordination.
 */
export type CellId = string;
```

### IdentityCellRef

```typescript
/**
 * Reference to a cell by identity (for formula storage).
 * Absolute flags preserve user intent for A1 display ($A$1 vs A1).
 */
export interface IdentityCellRef {
  type: 'cell';
  id: CellId;
  rowAbsolute: boolean; // $1 syntax
  colAbsolute: boolean; // $A syntax
}
```

### IdentityRangeRef

```typescript
/**
 * Reference to a range by corner cell identities.
 * Ranges expand automatically when rows/cols are inserted
 * between corners - no special logic needed.
 */
export interface IdentityRangeRef {
  type: 'range';
  startId: CellId; // Top-left corner
  endId: CellId; // Bottom-right corner
  startRowAbsolute: boolean;
  startColAbsolute: boolean;
  endRowAbsolute: boolean;
  endColAbsolute: boolean;
}
```

### IdentityFormula

```typescript
/**
 * Formula stored with identity references.
 * Template + refs pattern separates structure from references.
 *
 * @example
 * User types: =SUM(A1:B10)+C1*2
 * Stored as:
 * {
 *   template: "SUM({0})+{1}*2",
 *   refs: [
 *     { type: 'range', startId: 'abc...', endId: 'def...' },
 *     { type: 'cell', id: 'ghi...' }
 *   ]
 * }
 */
export interface IdentityFormula {
  template: string; // "SUM({0})+{1}*2"
  refs: IdentityFormulaRef[]; // Ordered refs for placeholders
}
```

### Additional Identity Types

These types extend the identity model for specialized features:

```typescript
/**
 * Range reference with schema validation support.
 * Used for data validation rules that apply to cell ranges.
 */
export interface IdentityRangeSchemaRef {
  startId: CellId;
  endId: CellId;
  // Schema validation metadata
}

/**
 * Range of cell IDs for features that track rectangular regions.
 * Used by: charts, tables, grouping.
 */
export interface CellIdRange {
  topLeftCellId: CellId;
  bottomRightCellId: CellId;
}

/**
 * Merged cell region tracked by identity.
 * Top-left cell ID determines the merge region; other cells reference it.
 */
export interface IdentityMergedRegion {
  topLeftId: CellId; // Top-left cell of merged region
  bottomRightId: CellId; // Bottom-right cell of merged region
}
```

## Data Flow

```
┌────────────────────────────────────────────────────────────────────┐
│                          USER INPUT                                 │
│  User types: =SUM(A1:B10)+C1*2                                     │
└─────────────────────────────┬──────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│                       FORMULA PARSER                                │
│  toIdentityFormula() in kernel (Rust compute-parser)               │
│                                                                     │
│  1. Parse A1 string to AST                                         │
│  2. For each cell/range ref:                                       │
│     - Resolve position to CellId (getOrCreateCellId)               │
│     - Create IdentityCellRef/IdentityRangeRef                      │
│     - Replace in template with {n} placeholder                     │
│                                                                     │
│  Output: { template: "SUM({0})+{1}*2", refs: [...] }               │
└─────────────────────────────┬──────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│                        YRS STORAGE                                  │
│  kernel/src/domain/grid-index.ts (imports from contracts)           │
│                                                                     │
│  SerializedCellData {                                              │
│    id: CellId;       // Stable identity (UUID v7)                  │
│    row: number;      // Current position (mutable)                 │
│    col: number;      // Current position (mutable)                 │
│    r: raw;           // User input string                          │
│    idf?: IdentityFormula;  // Parsed formula                       │
│    c?: computed;     // Evaluation result                          │
│    f?: string;       // Backward-compatible A1 formula             │
│    n?: string;       // Note/comment                               │
│    h?: string;       // Hyperlink                                  │
│    spillRange?: ...  // Array formula spill range                  │
│    spillAnchor?: ... // Array formula anchor cell                  │
│    isCSE?: boolean;  // Is array formula (Ctrl+Shift+Enter)        │
│  }                                                                  │
│                                                                     │
│  Three Yrs Maps per sheet:                                         │
│  - cells: Map<CellId, SerializedCellData>  (primary)               │
│  - properties: Map<CellId, CellProperties> (sparse formatting)     │
│  - grid: Map<"sheet:row:col", CellId>      (position lookup)       │
└─────────────────────────────┬──────────────────────────────────────┘
                              │
                              ▼
┌────────────────────────────────────────────────────────────────────┐
│                         DISPLAY                                     │
│  toA1Display() in kernel (Rust compute-parser)                     │
│                                                                     │
│  1. For each ref in formula.refs:                                  │
│     - Look up current position via ICellPositionLookup             │
│     - Convert position to A1 string (with absolute markers)        │
│     - If cell deleted → #REF!                                      │
│  2. Replace {n} placeholders with A1 strings                       │
│                                                                     │
│  Output: "=SUM(A1:B10)+C1*2"                                       │
└────────────────────────────────────────────────────────────────────┘
```

## Yrs Storage Structure

```typescript
// Per-sheet structure
sheet: Y.Map {
  meta: Y.Map<SheetMeta>,

  // Primary cell storage - keyed by stable CellId
  cells: Y.Map<CellId, SerializedCellData>,

  // Sparse properties - only cells with custom formatting
  properties: Y.Map<CellId, CellProperties>,

  // Position index - enables O(1) "what's at row,col?"
  grid: Y.Map<"sheet:row:col", CellId>,

  // Other sheet data...
  rowHeights: Y.Map<number>,
  colWidths: Y.Map<number>,
  charts: Y.Map<SerializedChart>,
}
```

### Why Three Maps?

| Map          | Contents                    | Density                           |
| ------------ | --------------------------- | --------------------------------- |
| `cells`      | Values, formulas, positions | Every cell with data              |
| `properties` | Formatting, metadata        | Only cells with custom formatting |
| `grid`       | Position → CellId lookup    | Derived, kept in sync             |

**Benefits:**

- **O(1) position lookup**: `grid.get("sheet:5:3")` → CellId
- **O(1) cell data lookup**: `cells.get(cellId)` → SerializedCellData
- **O(1) properties lookup**: `properties.get(cellId)` → CellProperties | undefined
- **Sparse property storage**: No wasted space for default-formatted cells
- **Clean CRDT merging**: Value changes and format changes don't conflict

## Key Operations

### Insert Column

**Location:** `kernel/src/domain/sheets/structures.ts`

```typescript
function insertColumns(sheet: SheetId, startCol: number, count: number): void {
  doc.transact(() => {
    // Step 1: Shift positions of affected cells
    cells.forEach((cell, id) => {
      if (cell.col >= startCol) {
        cells.set(id, { ...cell, col: cell.col + count });
      }
    });

    // Step 2: Rebuild grid index
    rebuildGridIndex(sheet);

    // Step 3: Shift column widths, schemas (position-keyed)
    shiftColumnWidths(sheet, startCol, count);
  });

  // No formula parsing. No reference adjustment. Just position updates.
}
```

### Delete Column

```typescript
function deleteColumns(sheet: SheetId, startCol: number, count: number): void {
  doc.transact(() => {
    // Step 1: Delete cells in range (formulas referencing these → #REF!)
    deleteCellsInRange(sheet, 'col', startCol, startCol + count - 1);

    // Step 2: Shift remaining cells left
    cells.forEach((cell, id) => {
      if (cell.col > startCol + count - 1) {
        cells.set(id, { ...cell, col: cell.col - count });
      }
    });

    // Step 3: Rebuild grid index
    rebuildGridIndex(sheet);
  });
}
```

### Range Expansion (Automatic!)

The identity model gives correct range expansion for free:

```
Before: =SUM(A1:A10)
  - startId → cell at (row: 0, col: 0)
  - endId → cell at (row: 9, col: 0)

Insert row at row 5:
  - Cell at (0,0) stays at (0,0)    → startId still valid
  - Cell at (9,0) moves to (10,0)  → endId position updated

Display: =SUM(A1:A11) ✓
```

No special range expansion logic needed. Position updates handle it.

## Dependency Graph

**Location:** `compute/core/crates/compute-graph/src/lib.rs`

The dependency graph uses CellIds directly - no key shifting ever needed:

```typescript
class IdentityDependencyGraph {
  // CellId keys are stable - never change on structure operations
  private precedents = new Map<CellId, Set<CellId>>();
  private dependents = new Map<CellId, Set<CellId>>();

  updateFormula(cellId: CellId, formula: IdentityFormula | null): void {
    // Extract referenced CellIds from formula
    // Update graph relationships
    // Check for circular references
  }

  getEvaluationOrder(changedCellId: CellId): CellId[] {
    // Topological sort for recalculation order
  }
}
```

## Grid Index

**Location:** `kernel/src/domain/grid-index.ts`

The grid index enables O(1) position lookups for rendering:

```typescript
interface ICellPositionLookup {
  // Position → CellId
  getCellId(sheet: SheetId, row: number, col: number): CellId | null;

  // CellId → Position
  getPosition(cellId: CellId): { row: number; col: number; sheet: SheetId } | null;

  // Get or create (for formula parsing - referenced cells may not exist yet)
  getOrCreateCellId(sheet: SheetId, row: number, col: number): CellId;

  // Sheet name → SheetId (for cross-sheet references like Sheet2!A1)
  getSheetIdByName?(name: string): SheetId | undefined;
}
```

### Key Utilities

```typescript
// Create grid key
createGridKey(sheet, row, col) → "sheet:5:3"

// Parse grid key
parseGridKey("sheet:5:3") → { sheet, row: 5, col: 3 }

// Shift positions after insert/delete
shiftCellPositions(maps, sheet, axis, startIndex, delta)

// Rebuild entire grid index after bulk operations
rebuildGridIndex(maps, sheet)
```

## Why This Works for CRDT

### Position Updates Compose

When two users insert columns concurrently:

```
User A: Insert at column 2 → shift cells at col≥2 by +1
User B: Insert at column 5 → shift cells at col≥5 by +1

CRDT merge: Both shifts apply correctly
- Cell at col 3 → col 5 (shifted twice: +1 from A, +1 from B)
- Cell at col 6 → col 8 (shifted twice)
```

Numbers merge correctly. Strings conflict.

### Formula Strings Never Change

Since formulas store CellId references (not A1 strings), there are no string conflicts:

```
User A: Insert column (no formula change)
User B: Edit formula value (changes computed, not refs)

CRDT merge: Clean - different fields modified
```

### Undo/Redo

Formula refs are stable CellId UUIDs — they never change on structure operations, so Yrs undo doesn't need to track "what formulas were affected".

**Structural undo** (undo of insert/delete rows/cols) requires rebuilding the in-memory caches (GridIndex, CellMirror, ComputeCore) from the CRDT. Structural operations only modify `meta.rows`/`meta.cols` in yrs — they don't update the yrs `idToPos` grid index. So after undo, the yrs grid index naturally contains correct pre-structural positions. The observer detects the meta change and triggers a per-sheet cache rebuild from yrs, followed by a full ComputeCore re-initialization. This is collaboration-safe: interleaved structural changes from multiple users are resolved by the CRDT, and the cache is rebuilt from the merged state. See `rebuild_after_structural_observer_change()` in `compute/core/src/storage/engine/mod.rs`.

## What Doesn't Change

| Component         | Status                                               |
| ----------------- | ---------------------------------------------------- |
| Calculator engine | **Unchanged** - receives A1 strings after conversion |
| Renderer          | **Unchanged** - displays A1 strings                  |
| User input        | **Unchanged** - types A1 references                  |
| XLSX format       | **Unchanged** - stores A1 strings                    |

The identity model is **internal only**. The user experience is identical.

## Implementation Files

| File                                                        | Purpose                                                              |
| ----------------------------------------------------------- | -------------------------------------------------------------------- |
| `contracts/src/cells/cell-identity.ts`                      | Type definitions (CellId, IdentityFormula, etc.)                     |
| `contracts/src/store/store-types.ts`                        | SerializedCellData type definition                                   |
| `kernel/src/domain/grid-index.ts`                           | Cell position lookup and reverse index                               |
| `kernel/src/domain/sheets/structures.ts`                    | Insert/delete row/col                                                |
| `compute/core/crates/compute-parser/`                       | Formula parsing, A1 ↔ Identity conversion (Rust)                     |
| `compute/core/crates/compute-graph/src/lib.rs`              | Stable dependency graph (Rust)                                       |
| `kernel/src/bridges/compute/compute-bridge.ts`              | Evaluation integration                                               |

**Note on Type Naming:** The canonical type definition is `SerializedCellData` in `contracts/src/store/store-types.ts`. The kernel imports this from `@mog/spreadsheet-contracts/store`.

## Success Criteria

1. **Insert/delete row/column**: Formulas reference same logical cells, display shows updated A1 addresses, no formula string modification
2. **Concurrent structure changes**: Both changes apply correctly, formulas still correct after merge
3. **Range expansion**: Insert row inside `=SUM(A1:A10)` → `=SUM(A1:A11)` automatically
4. **Deleted references**: Delete column containing referenced cell → formula shows `#REF!`
5. **Absolute references**: `=$A$1` displays correctly after structure changes
6. **XLSX round-trip**: Import → edit → export preserves formulas

## Cell Value Resolution

When reading cell values, you must correctly distinguish between formula cells and value cells.

### The Problem

The `computed` field can be:

- `undefined` - No computed value (non-formula cell)
- `null` - Formula evaluated to null/empty (e.g., `=A1` where A1 is empty)
- Other - Formula's actual result

**NEVER use `data.computed ?? data.raw`** - the `??` operator treats `null` as missing, which is semantically wrong.

### The Correct Pattern

Use the `formula` field as the discriminator:

```typescript
// WRONG - treats null as missing
const value = data.computed ?? rawToCellValue(data.raw);

// CORRECT - formula presence determines source
if (data.formula !== undefined) {
  return data.computed; // Formula cell: trust computed, even if null
}
return rawToCellValue(data.raw); // Value cell: use raw
```

Or use the helper function:

```typescript
import { getEffectiveValue } from '@mog/kernel/api';
const value = getEffectiveValue(data);
```

### Why null is Valid

Formula cells can legitimately evaluate to `null`:

- `=A1` where A1 is empty → `null`
- `=IF(FALSE, 1)` → `null` (no else branch)
- `=MATCH(...)` when not found → `null`

These should display as empty cells, NOT as the formula text.

### Invariants

1. For cells with `data.formula !== undefined`: ALWAYS use `data.computed`
2. For cells without formula: ALWAYS use `rawToCellValue(data.raw)`
3. `null` is a valid computed value, not an error condition
4. Use `getEffectiveValue()` when you need the effective cell value

## Row/Column Identity Model

The same identity pattern extends to rows and columns. Properties are keyed by stable RowId/ColId, not position strings.

| Property Map | Key   | Value        |
| ------------ | ----- | ------------ |
| `rowHeights` | RowId | number       |
| `rowFormats` | RowId | CellFormat   |
| `colWidths`  | ColId | number       |
| `colFormats` | ColId | CellFormat   |
| `schemas`    | ColId | ColumnSchema |

**Two-tier lookups** (same as CellId):

- `getRowIdAt()` / `getColIdAt()` - read-only, returns null for virtual rows/columns
- `getOrCreateRowId()` / `getOrCreateColId()` - materializes if needed

**Implementation:** `kernel/src/domain/row-col-identity.ts`

Row and column identity follows the same invariant as cell identity: stable IDs are the persisted reference, and positional labels are derived views.

## Virtual Identity for Range-Resident Cells

When bulk data is imported (e.g., a 1M-row XLSX column), it is stored as a **Range** — a single typed payload in Yrs (`rangePayloads`) rather than N individual per-cell Y.Map entries. Cells inside a Range don't have per-cell Yrs entries until edited. They need identities for the dependency graph, but minting real CellIds for 1M cells at import time would recreate the problem Ranges solve.

### Virtual CellIds

A **virtual CellId** is derived deterministically from the cell's structural position:

```rust
CellId::virtual_at(sheet_id: SheetId, row_id: RowId, col_id: ColId) -> CellId
```

The derivation uses SipHash-2-4 with a fixed seed, producing the same `u128` on every peer, every platform, every Rust version. Virtual CellIds are disjoint from real CellIds by construction: the upper 64 bits are set to a reserved sentinel value (`0xFFFF_FFFF_FFFF_FFFE`), which is formally excluded from the `IdAllocator` partition space.

### Properties

| Property | Guarantee |
|----------|-----------|
| Deterministic | Same `(SheetId, RowId, ColId)` always produces the same CellId |
| RangeId-independent | Identity is a function of position, not of which Range contains the cell |
| Peer-identical | No per-document seed, no allocator state — byte-identical across peers |
| Stable across transitions | First edit writes the same CellId to `cells` — identity is continuous |
| Stable across compaction | Compaction re-encodes payload but preserves RowId/ColId |
| Stable across Range deletion | Deletion folds payload into `cells` keyed by the same virtual CellIds |

### Resolution

`resolve_cell_id(sheet, pos)` checks `pos_to_id` first (anchored/edited cells), then queries the Range spatial index. If the position falls inside a Range, it returns `CellId::virtual_at(sheet_id, row_id, col_id)`. The dependency graph cannot distinguish virtual from real CellIds — they participate identically in topological sort, cycle detection, and invalidation.

### Value Read Path

```
get_cell_value_at(sheet, row, col):
  1. pos_to_id → cells         (sparse override or real cell — highest priority)
  2. Range spatial index → payload  (Range-resident value from payload bytes)
  3. col_data                  (projections, spills)
  4. Null fallback
```

Sparse `cells` entries unconditionally shadow Range payload at the same position. This is the override mechanism: editing a Range-resident cell writes to `cells` with the virtual CellId, and subsequent reads return the override.

### On First Edit

When a user edits a Range-resident cell for the first time:
1. The virtual CellId is derived from `(SheetId, RowId, ColId)` — the same id formulas already reference
2. The value is written to Yrs `cells` keyed on this CellId
3. `posToId`/`idToPos` entries are created (for sub-256 Ranges, these already exist from hydration)
4. The owning RangeView's `overrides` index is updated
5. The column's `col_data` is rebuilt and `col_version` is bumped

Two peers concurrently editing the same Range-resident cell mint the same CellId on both sides; standard Yrs LWW resolves the value.

## References

- Google Sheets architecture (uses same approach)
- Yrs CRDT documentation
- UUID v7 specification
