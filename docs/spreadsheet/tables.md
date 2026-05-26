# Excel-Style Tables

> **Status**: Living document
> **Scope**: All table-related code across 4+ packages and Rust crates
> **Test coverage**: ~1,235 tests (806 Rust in compute-table, 429 TS in table-engine)

## 1. Overview

Excel-style tables are named, structured data regions on a sheet. A table converts a
raw grid of cells into a first-class data object with:

- **Named columns** with stable IDs that survive renames
- **Structured references** in formulas (`Table1[Sales]`, `Table1[@Price]`)
- **Auto-filtering** with per-column filter dropdowns
- **Sorting** with multi-key, custom-order, and blanks-last semantics
- **Totals row** with aggregation functions (SUM, AVERAGE, COUNT, etc.)
- **Auto-expansion** when data is entered adjacent to the table
- **Calculated columns** that auto-fill formulas across all data rows
- **Banded rows/columns** and 67 built-in styles (Light 1-28, Medium 1-28, Dark 1-11)
- **Slicers** -- visual filter controls connected to table columns
- **Custom styles** -- user-defined table style definitions

Tables are non-overlapping: no two tables can occupy the same cell on a sheet.

---

## 2. Architecture

```
+------------------------------------------------------------------+
|  UI Layer (spreadsheet app)                                      |
|  - Table chrome, column headers, filter dropdown buttons         |
|  - Slicer controls, style picker                                 |
|  - Coordinator mutations (tables.ts)                             |
+-------------------------------+----------------------------------+
                                |
                                v
+------------------------------------------------------------------+
|  Kernel Domain Layer (kernel/src/domain/)                     |
|  - tables/core.ts          CRUD, validation, naming              |
|  - tables/operations.ts    resize, rename, delete column         |
|  - tables/auto-expansion.ts  auto-expand on adjacent edits       |
|  - tables/calculated-columns.ts  formula columns                 |
|  - tables/range-resolution.ts  resolve table -> CellRange        |
|  - tables/selection.ts     Ctrl+Space progressive selection      |
|  - tables/hit-testing.ts   click region detection                |
|  - tables/custom-styles.ts custom style CRUD                     |
|  - slicers/                slicer domain modules                 |
|  - table-bridge.ts         caching + type conversion bridge      |
+-------------------------------+----------------------------------+
                                |
                                v
+------------------------------------------------------------------+
|  TS Engine (@mog/table-engine)                              |
|  Pure stateless computation. No DOM, no Yjs, no React.           |
|  Delegates heavy work to Rust/WASM via wasm-backend.ts           |
|  - types.ts, table.ts, filter.ts, sort.ts, visibility.ts        |
|  - structured-refs.ts, slicer.ts, slicer-cache.ts, styles.ts    |
|  - filter-dropdown.ts, filter-resolve.ts, compare.ts            |
|  - convert.ts (contracts -> engine type conversion)              |
+-------------------------------+----------------------------------+
                                |
                                v
+------------------------------------------------------------------+
|  Rust Engine (compute-table crate)                               |
|  Pure stateless computation. No DOM, no Yjs, no React.           |
|  806 tests. Compiled to WASM for browser, native for Tauri.      |
|  - types.rs, table.rs, queries.rs, operations.rs                 |
|  - filter.rs, filter_resolve.rs, filter_dropdown.rs              |
|  - sort.rs, visibility.rs, compare.rs                            |
|  - structured_refs/ (resolution, adjustment, formatting)         |
|  - slicer.rs, slicer_cache.rs, timeline.rs                      |
|  - styles.rs, custom_styles.rs                                   |
|  - range_resolution.rs, calculated_columns.rs                    |
|  - auto_expansion.rs, selection.rs, events.rs                    |
+------------------------------------------------------------------+
```

### Design Principles

1. **Stateless engines**: Both `compute-table` (Rust) and `@mog/table-engine` (TS)
   are pure computation libraries. They receive data as arguments and return results.
   No internal state, no side effects.

2. **Bridge owns caching**: The `TableBridge` class in the kernel owns per-column bitmap
   caches, CellId translation, and EventBus subscriptions for cache invalidation.

3. **WASM acceleration**: The TS table-engine delegates heavy computation (filter
   evaluation, sort, slicer cache, structured ref resolution) to Rust via WASM exports.
   The `wasm-backend.ts` module manages this delegation.

4. **Contracts as boundary**: `@mog/spreadsheet-contracts` defines the persistence
   types (`TableConfig`, `ColumnFilterCriteria`). The bridge converts between contracts
   types and engine types.

---

## 3. Data Model

### TableConfig (Contracts -- Persistence Layer)

The `TableConfig` interface in `contracts/src/data/tables.ts` is the source of truth
stored in Yjs. Key fields:

```typescript
interface TableConfig {
  id: string;                // Unique ID
  name: string;              // Used in structured references ("Table1")
  sheetId: string;           // Owning sheet
  range: CellRange;          // Position: { startRow, startCol, endRow, endCol }
  rangeIdentity?: CellIdRange; // CRDT-safe corners (P0-07)
  hasHeaderRow: boolean;     // Default: true
  hasTotalRow: boolean;      // Default: false
  columns: TableColumn[];    // Ordered column definitions
  style: TableStyle;         // Preset or custom style
  autoExpand: boolean;       // Default: true
  showFilterButtons: boolean; // Default: true
}

interface TableColumn {
  id: string;                // Stable across renames
  name: string;              // Header display name
  index: number;             // 0-based position within table
  totalFormula?: string;     // e.g., "=SUBTOTAL(109,[Sales])"
  totalFunction?: TotalFunction;
  calculatedFormula?: string; // Auto-fills entire column
}
```

### Table (Engine -- Computation Layer)

The engine `Table` type in both `compute-table/src/types.rs` and
`table-engine/src/types.ts` mirrors the contracts type with minor naming differences:

| Contracts (`TableConfig`)     | Engine (`Table`)             | Notes                         |
|-------------------------------|------------------------------|-------------------------------|
| `hasTotalRow`                 | `hasTotalsRow`               | Bridge maps between them      |
| `style.preset` (`'medium2'`) | `style` (`'TableStyleMedium2'`) | Bridge maps short -> full  |
| `style.showBandedRows`       | `bandedRows`                 | Flattened                     |
| `column.totalFunction`       | `column.totalsFunction`      | `'none'` -> `null`            |
| `column.totalFormula`        | `column.totalsLabel`         | Renamed                       |

The `convertTableConfig()` function in `table-bridge.ts` handles all mapping.

### Table Range Layout

```
         startCol             endCol
            |                    |
startRow -> +----+----+----+----+   <- Header row (if hasHeaderRow)
            | ID | Name | Sales|
            +----+----+----+----+
            |  1 | Foo  | 100  |   <- Data rows
            |  2 | Bar  | 200  |
            |  3 | Baz  | 150  |
            +----+----+----+----+
endRow   -> |    |      | 450  |   <- Totals row (if hasTotalsRow)
            +----+----+----+----+
```

Row regions:
- **Header**: `startRow` (single row, when `hasHeaderRow`)
- **Data**: `startRow + (hasHeader ? 1 : 0)` to `endRow - (hasTotals ? 1 : 0)`
- **Totals**: `endRow` (single row, when `hasTotalsRow`)

---

## 4. Rust compute-table Crate

**Location**: `compute/core/crates/compute-table/`
**Dependencies**: `formula-types`, `serde`, `serde_json`, `rustc-hash`, `chrono`
**Dev-only**: `compute-parser` (used only in tests for structured ref parsing)
**Tests**: 806

### Module Breakdown

| Module                | Visibility  | Purpose                                             |
|-----------------------|-------------|-----------------------------------------------------|
| `types`               | `pub`       | All wire-format types (Table, Filter, Sort, Slicer) |
| `table`               | `pub`       | Single-table CRUD (create, resize, rename, etc.)    |
| `queries`             | `pub`       | Collection queries (find, overlap, validate)         |
| `operations`          | `pub`       | Validated operations combining table + queries       |
| `filter`              | `pub`       | Per-column filter evaluation -> bitmap               |
| `filter_resolve`      | `pub(crate)` | Dynamic/top-bottom -> concrete filter resolution    |
| `filter_dropdown`     | `pub`       | Filter dropdown UI data                             |
| `sort`                | `pub`       | Sort permutation computation                         |
| `visibility`          | `pub`       | Bitmap composition (AND across columns)              |
| `slicer`              | `pub`       | Slicer CRUD (immutable, returns new instances)       |
| `slicer_cache`        | `pub`       | Slicer cache builder                                |
| `timeline`            | `pub`       | Timeline slicer date utilities                       |
| `structured_refs`     | `pub`       | Resolution, adjustment, formatting                   |
| `styles`              | `pub`       | 60 built-in Excel table styles                       |
| `custom_styles`       | `pub`       | Custom style CRUD                                   |
| `range_resolution`    | `pub`       | CellId-based range resolution                        |
| `calculated_columns`  | `pub`       | Calculated column formula helpers                    |
| `auto_expansion`      | `pub`       | Auto-expand on adjacent cell edit                    |
| `selection`           | `pub`       | Selection range helpers (Ctrl+Space, header click)   |
| `events`              | `pub`       | Table lifecycle events + diff                        |
| `compare`             | `mod`       | Private: shared comparison utilities                 |

### Filter System

The filter system is the most complex subsystem. It operates on **per-column bitmaps**
(`Vec<u8>`) where each byte represents one data row: `1` = visible, `0` = hidden.

**Filter types** (discriminated union via `#[serde(tag = "type")]`):

| Type          | Struct           | Description                                  |
|---------------|------------------|----------------------------------------------|
| `"values"`    | `ValueFilter`    | Set of allowed values + blanks flag          |
| `"condition"` | `ConditionFilter`| 1+ conditions combined with AND/OR           |
| `"topBottom"` | `TopBottomFilter`| Top/bottom N items, percent, or sum          |
| `"dynamic"`   | `DynamicFilter`  | Data-dependent rules (aboveAverage, thisMonth)|
| `"color"`     | `ColorFilter`    | Cell/font color (evaluated by bridge layer)  |

**Filter evaluation pipeline** (in `filter.rs`):

1. TopBottom filters use `evaluate_top_bottom_direct()` -- index-based to handle ties
2. Color filters return all-visible (bridge evaluates them separately)
3. Dynamic filters are resolved to concrete ValueFilter/ConditionFilter first
4. ValueFilter uses pre-computed `HashSet` for O(1) per-row lookup
5. ConditionFilter pre-computes lowercased string for single-condition string operators

**14 condition operators**: `equals`, `notEquals`, `greaterThan`, `greaterThanOrEqual`,
`lessThan`, `lessThanOrEqual`, `beginsWith`, `endsWith`, `contains`, `notContains`,
`between`, `notBetween`, `isBlank`, `isNotBlank`

**17 dynamic filter rules**: `aboveAverage`, `belowAverage`, `today`, `yesterday`,
`tomorrow`, `thisWeek`, `lastWeek`, `nextWeek`, `thisMonth`, `lastMonth`, `nextMonth`,
`thisQuarter`, `lastQuarter`, `nextQuarter`, `thisYear`, `lastYear`, `nextYear`

### Sort System

**Location**: `sort.rs`

The sort engine computes a **permutation array** `Vec<usize>` where
`result[new_position] = original_row_index`. The bridge applies this permutation to
reorder actual cell data.

Key semantics:
- **Type ordering**: numbers < text < booleans < errors < blanks
- **Blanks always sort last**, regardless of ascending/descending direction
- **Case-insensitive** string comparison
- **Stable sort** -- equal elements preserve original order
- **Custom order** -- values in the custom list sort by their list position; values not
  in the list sort after all custom values using normal comparison
- **Error sub-ordering**: #NULL! < #DIV/0! < #VALUE! < #REF! < #NAME? < #NUM! < #N/A <
  #GETTING_DATA < #SPILL! < #CALC!

### Edge Value Semantics

The crate includes an authoritative reference at
`compute/core/crates/compute-table/src/EDGE_VALUE_SEMANTICS.md` defining behavior
for edge cases (NaN, Infinity, Error, Null, Array, Lambda) across all subsystems.

Key rules:
- **NaN** sorts last, fails positive filter ops, passes negative ops, NaN == NaN for equality
- **Blank (Null, Array, Lambda)** all have rank 4, always sort last
- **Empty string** (`""`) is NOT blank -- it is a Text value with rank 1
- **Infinity (+/-)** treated as normal numbers for sort, excluded from TopBottom/Average

---

## 5. TypeScript table-engine Package

**Location**: `table-engine/`
**Package**: `@mog/table-engine`
**Dependency**: `@mog/spreadsheet-contracts` (types only)
**Tests**: 429

### Module Breakdown

| Module              | Purpose                                                |
|---------------------|--------------------------------------------------------|
| `types.ts`          | All type definitions (Table, Filter, Sort, Slicer, etc.) |
| `table.ts`          | Pure table CRUD functions (create, resize, rename, etc.) |
| `filter.ts`         | Filter state CRUD + per-column evaluation              |
| `filter-dropdown.ts`| Build filter dropdown UI data                          |
| `filter-resolve.ts` | Resolve dynamic/top-bottom filters                     |
| `sort.ts`           | Sort permutation computation                           |
| `visibility.ts`     | Bitmap composition + RowVisibility creation             |
| `structured-refs.ts`| Parse, resolve, adjust, format structured references   |
| `slicer.ts`         | Slicer CRUD + selection operations                     |
| `slicer-cache.ts`   | Build slicer cache from column data                    |
| `styles.ts`         | Built-in table styles + cell format resolution          |
| `compare.ts`        | Value comparison, equality, formatting utilities        |
| `convert.ts`        | Contracts -> engine type conversion                    |
| `wasm-backend.ts`   | WASM delegation layer                                  |
| `index.ts`          | Public API surface (re-exports)                        |

### WASM Backend

The `wasm-backend.ts` module provides a thin delegation layer. The kernel initializes it
by calling `initTableWasm(exports)` with the compute-core WASM module's exported functions.
After initialization, heavy computation functions in `structured-refs.ts`, `filter.ts`,
`sort.ts`, `slicer-cache.ts`, etc., delegate to Rust/WASM via `getWasm()`.

**WASM-accelerated operations**:
- `table_evaluate_column_filter` -- filter bitmap computation
- `table_compute_sort_order` -- sort permutation
- `table_build_slicer_cache` -- slicer cache from column data
- `table_build_filter_dropdown` -- dropdown UI data
- `table_resolve_dynamic_filter` / `table_evaluate_top_bottom` -- filter resolution
- `table_resolve_cell_format` -- style resolution
- `table_parse_structured_ref` / `table_resolve_structured_ref` -- structured refs
- `table_compose_bitmaps` / `table_create_row_visibility` -- visibility
- Slicer operations (toggle, select, clear, sort)

### The convert.ts Module

This is the single source of truth for converting contracts `ColumnFilterCriteria` to
engine `FilterCriteria`. Used by both `table-bridge.ts` and `filters.ts`.

Key conversions:
- `type: 'value'` -> `ValueFilter` (strips null from included list, derives `includeBlanks`)
- `type: 'condition'` -> `ConditionFilter` (maps operator names, e.g., `startsWith` -> `beginsWith`)
- `type: 'condition'` with `aboveAverage`/`belowAverage` -> `DynamicFilter`
- `type: 'top10'` -> `TopBottomFilter`
- `type: 'color'` -> `null` (bridge evaluates color filters separately)

---

## 6. Kernel Domain Layer

**Location**: `kernel/src/domain/tables/`

The kernel domain layer provides the application-level API for table operations. All
modules are async and delegate to `ComputeBridge` (Rust compute-core) for reads and
mutations.

### core.ts -- CRUD Operations

Core table lifecycle operations:

- `createTable(ctx, sheetId, range, options?)` -- validates name uniqueness and range
  overlap, builds column definitions, delegates to ComputeBridge
- `getTable(ctx, tableId)` / `getTableByName(ctx, name)` -- async lookups
- `getTablesInSheet(ctx, sheetId)` / `getAllTables(ctx)` -- collection queries
- `updateTable(ctx, tableId, updates)` -- delegates targeted updates to ComputeBridge
- `deleteTable(ctx, tableId, propagateRefErrors?)` -- deletes associated filters,
  propagates `#REF!` errors to formulas referencing the table
- `convertToRange(ctx, tableId)` -- converts structured references to A1 before deleting
- `isValidTableName(ctx, name)` -- rejects cell-reference-like names (e.g., "A1", "XFD1")
- `validateTableResize(ctx, tableId, newRange)` -- checks overlap, minimum rows/columns

### operations.ts -- Mutations

Higher-level operations that compose core functions:

- `resizeTable(ctx, tableId, newRange)` -- validates then applies
- `setTotalRow(ctx, tableId, enabled)` -- toggles totals row via ComputeBridge
- `setColumnTotalFunction(ctx, tableId, colIndex, fn)` -- generates SUBTOTAL formula
  (e.g., `=SUBTOTAL(109,[Sales])` for SUM)
- `renameTable(ctx, tableId, newName)` -- updates all formulas referencing the table
- `renameColumn(ctx, tableId, colIndex, newName)` -- updates all formulas referencing the column
- `deleteTableColumn(ctx, tableId, colIndex)` -- propagates `#REF!` errors first

**SUBTOTAL function numbers** (hidden-row-aware variants, 101-110):

| Function | Number |
|----------|--------|
| AVERAGE  | 101    |
| COUNT    | 102    |
| COUNTA   | 103    |
| MAX      | 104    |
| MIN      | 105    |
| STDEV    | 107    |
| SUM      | 109    |
| VAR      | 110    |

### auto-expansion.ts -- Auto-Expansion

Detects when a cell edit is adjacent to a table and triggers expansion:

- `getAdjacentTable(ctx, sheetId, row, col)` -- checks for tables with `autoExpand: true`
  where the cell is immediately below or to the right of the table
- `autoExpandTableRow(ctx, tableId)` -- extends `endRow` by 1
- `autoExpandTableColumn(ctx, tableId, name?)` -- extends `endCol` by 1, renames new column
- `checkAutoExpansion(ctx, sheetId, row, col)` -- entry point: returns expansion info
  only if the cell is NOT already inside a table

### calculated-columns.ts -- Calculated Columns

Excel parity P0-A feature. When a formula is set on a calculated column, every data cell
in that column gets the same formula.

- `setCalculatedColumnFormula(ctx, tableId, colIndex, formula)`
- `clearCalculatedColumnFormula(ctx, tableId, colIndex)` -- clears by setting empty formula
- `getCalculatedFormulaForCell(ctx, sheetId, row, col)` -- returns formula for a data cell
  in a calculated column (used when evaluating cells)
- `getColumnDataCells(ctx, tableId, colIndex)` -- enumerates all `{ row, col }` pairs
  for data cells in a column

### range-resolution.ts -- Range Resolution

In the ComputeBridge world, the table config already contains the resolved range, so
resolution is a simple field access:

```typescript
function resolveTableRange(_ctx, table): CellRange | null {
  return table.range ?? null;
}
```

Legacy CellIdRange/migration functions are no-ops (Rust handles this).

### selection.ts -- Progressive Selection

Implements Ctrl+Space progressive column selection (Excel behavior):

| Stage | Selection                          | Function                    |
|-------|------------------------------------|-----------------------------|
| 0     | Column data only (no header/total) | `getColumnDataRange()`      |
| 1     | Column data + header               | `getColumnWithHeaderRange()`|
| 2     | Full column (header + data + total) | `getFullColumnRange()`     |

Also provides:
- `getTableRowRange()` -- single data row across all columns (left-edge click)
- `getTableDataRange()` -- all data cells (corner click stage 0)
- `getFullTableRange()` -- entire table (corner click stage 1)

### hit-testing.ts -- Click Region Detection

Determines which region of a table was clicked for UI interaction:

**Table regions**:

| Region                | Description                                      |
|-----------------------|--------------------------------------------------|
| `header`              | Header row cell                                  |
| `data`                | Data area cell                                   |
| `total`               | Total row cell                                   |
| `header-left-edge`    | Left 4px of header cell (row-like selection)     |
| `data-left-edge`      | Left 4px of data row (row selection)             |
| `total-left-edge`     | Left 4px of total row cell                       |
| `corner`              | Top-left 6px of first header cell (table select) |
| `column-resize-edge`  | Right 4px of header cell (auto-fit double-click) |
| `outside`             | Not in any table                                 |

The `getTableHitRegion()` function accepts optional sub-cell coordinates
(`clickXInCell`, `clickYInCell`) for edge detection.

### custom-styles.ts -- Custom Style CRUD

Workbook-level custom table style management:

- `createCustomTableStyle(ctx, name, config)` -- generates ID, validates name uniqueness
- `updateCustomTableStyle(ctx, styleId, updates)` -- partial updates
- `duplicateCustomTableStyle(ctx, sourceId, newName?)` -- copies style definition
- `deleteCustomTableStyle(ctx, styleId)`
- `getAllCustomTableStyles(ctx)` -- sorted by name

Style elements: `headerRow`, `totalRow`, `firstColumn`, `lastColumn`, `rowStripes`,
`columnStripes`, `wholeTable`. Row/column stripes support configurable stripe sizes (1-9).

---

## 7. Table Bridge

**Location**: `kernel/src/bridges/table-bridge.ts`

The `TableBridge` class is the central connector between the stateless `@mog/table-engine`
and the reactive Store/EventBus system.

### Responsibilities

1. **Type conversion**: `convertTableConfig()` maps `TableConfig` (contracts) to `Table`
   (engine), including style preset mapping (`'light1'` -> `'TableStyleLight1'`)

2. **Per-column bitmap caching**: Two-level `Map<tableId, Map<columnId, Uint8Array>>`.
   Each column's filter bitmap is evaluated once and cached.

3. **Incremental recomposition**: When a single column filter changes, only that column's
   bitmap is re-evaluated. The composed RowVisibility is rebuilt from all cached bitmaps.

4. **CellId -> columnId translation**: Converts header CellIds to table column indices.

5. **EventBus subscriptions**: Automatic cache invalidation:

   | Event               | Action                                        |
   |---------------------|-----------------------------------------------|
   | `cells:batch-changed` | Clear all column bitmaps for affected tables |
   | `filter:cleared`    | Clear all bitmap caches                        |
   | `table:deleted`     | Remove cache entry for deleted table           |
   | `columns:deleted`   | Clear all caches (indices changed)             |
   | `rows:inserted`     | Clear all caches (bitmap lengths wrong)         |
   | `rows:deleted`      | Clear all caches (bitmap lengths wrong)         |

### Key Methods

```typescript
class TableBridge {
  // Convert contracts TableConfig to engine Table
  getEngineTable(config: TableConfig, range: CellRange): Table;

  // Evaluate filter and cache bitmap (returns cached if available)
  evaluateAndCacheColumnFilter(tableId, columnId, criteria, columnData): Uint8Array;

  // Compose all cached bitmaps into RowVisibility
  getRowVisibility(tableId): RowVisibility | null;

  // Build filter dropdown data with cross-column awareness
  getFilterDropdownData(table, sheetId, colIndex, currentFilter): FilterDropdownData;

  // Compute sort permutation
  computeSortOrder(table, sheetId, specs): readonly number[];

  // Build slicer cache for a column
  buildSlicerCacheForColumn(table, sheetId, colIndex, slicer, otherBitmaps?): SlicerCache;

  // Resolve table cell format (styles)
  resolveTableCellFormat(table, row, col): TableCellFormat | null;

  // Resolve structured reference
  resolveStructuredRef(ref, table, currentRow?): readonly CellRange[];

  // Lifecycle
  destroy(): void;
}
```

---

## 8. Structured References

Structured references allow formulas to reference table data by name instead of cell
coordinates. They survive column renames, table resizes, and row insertions.

### Syntax

| Reference                            | Meaning                                |
|--------------------------------------|----------------------------------------|
| `Table1[Column1]`                    | Data cells in Column1                  |
| `Table1[@Column1]`                   | Current row, Column1 (@ = #This Row)   |
| `Table1[#Headers]`                   | Entire header row                      |
| `Table1[#Data]`                      | All data rows (no header/totals)       |
| `Table1[#Totals]`                    | Entire totals row                      |
| `Table1[#All]`                       | Entire table                           |
| `Table1[#This Row]`                  | Current row of data                    |
| `Table1[[#Headers],[Column1]]`       | Header cell of Column1                 |
| `Table1[[#Totals],[Col1]:[Col3]]`    | Totals row, columns 1-3               |
| `Table1[[Col1]:[Col3]]`             | Data range across columns 1-3          |

### Resolution Flow

1. **Parsing**: `compute-parser` crate parses the formula text and produces a
   `StructuredRef` AST node containing:
   - `tableName: string`
   - `specifiers: StructuredRefSpecifier[]` -- column refs, special items, thisRow

2. **Resolution**: `compute-table/src/structured_refs/resolution.rs` resolves the AST to
   concrete grid ranges:
   - Finds the table by name (case-insensitive)
   - Resolves **row bounds** from special items (#Headers, #Data, #Totals, #All, #This Row)
   - Resolves **column bounds** from column name specifiers
   - Cross-products row bounds with column bounds to produce `TableRange` results

3. **Adjustment**: When tables are structurally changed (column renamed, table renamed,
   column added/removed, table resized), `adjustment.rs` rewrites structured references
   in affected formulas.

4. **Formatting**: `formatting.rs` converts a `StructuredRef` back to display text
   (e.g., for the formula bar).

### Special Item Resolution

| Special Item | Row Range                                           |
|--------------|-----------------------------------------------------|
| `#All`       | `startRow` to `endRow` (entire table)               |
| `#Headers`   | `startRow` to `startRow` (if `hasHeaderRow`)        |
| `#Data`      | `startRow + 1` to `endRow - 1` (adjusted for header/totals) |
| `#Totals`    | `endRow` to `endRow` (if `hasTotalsRow`)            |
| `#This Row`  | `currentRow` to `currentRow` (requires context)     |

When no special items are present, the default is the data rows only.

### Formula Rewriting on Structure Changes

The `TableStructureChange` enum drives formula updates:

```rust
enum TableStructureChange {
    ColumnRenamed { old_name, new_name },
    TableRenamed { old_name, new_name },
    ColumnRemoved { name },
    ColumnAdded { name, index },
    TableResized { old_range, new_range },
}
```

The kernel's `formula-structured-ref-updater` module walks all formulas in the workbook
and applies adjustments. For example, renaming column "Sales" to "Revenue" rewrites
`Table1[Sales]` to `Table1[Revenue]` in all formulas.

---

## 9. Slicers

Slicers are visual filter controls that connect to table columns. They provide a
button-based UI for selecting/deselecting values.

### Architecture

```
  User clicks slicer button
          |
          v
  Slicer Selection (kernel/domain/slicers/selection.ts)
          |
          v
  slicer_to_filter_criteria() -> FilterCriteria (ValueFilter)
          |
          v
  Filter Pipeline (same as column filters)
          |
          v
  Row Visibility (bitmap)
```

### Slicer Data Model

```typescript
interface Slicer {
  id: string;
  name: string;
  sourceType: 'table' | 'pivot';
  sourceId: string;          // Table ID
  sourceColumnId: string;    // Table column ID (not CellId)
  selectedValues: CellValue[]; // Empty = all selected
  multiSelect: boolean;
  showItemsWithNoData: boolean;
  sortOrder: 'ascending' | 'descending' | 'dataSource';
}
```

### Slicer Cache

The slicer cache (`SlicerCache`) pre-computes the items for display:

```typescript
interface SlicerCacheItem {
  value: CellValue;
  displayText: string;
  count: number;             // How many rows have this value
  selected: boolean;         // Is this value currently selected
  hasData: boolean;          // False when ALL rows hidden by OTHER filters
}
```

The `hasData` flag enables cross-filtering: items that would show zero results (because
other filters hide all matching rows) are visually distinguished in the UI.

### Kernel Slicer Modules

**Location**: `kernel/src/domain/slicers/`

| Module              | Purpose                                           |
|---------------------|---------------------------------------------------|
| `crud.ts`           | Create, update, delete slicers                    |
| `selection.ts`      | Get/set slicer selection values                   |
| `table-binding.ts`  | Connect slicers to table columns via Cell Identity |
| `cache.ts`          | Slicer cache management                           |
| `timeline.ts`       | Timeline slicer date handling                     |
| `slicer-utils.ts`   | Shared slicer utility functions                   |
| `types.ts`          | Local type definitions                            |
| `index.ts`          | Public exports                                    |

The `table-binding.ts` module bridges slicers to the table-engine:
1. Resolves the slicer's column position via CellId lookup
2. Extracts column data from the sheet
3. Creates an engine Slicer with current selection state
4. Delegates to `buildSlicerCache()` for pure computation
5. Maps `SlicerCacheItem[]` to contracts `SlicerItem[]`

---

## 10. Filter Pipeline

End-to-end flow from user clicking a filter dropdown through to rows being hidden.

### Step-by-Step Flow

```
1. USER ACTION
   User clicks filter dropdown button in table header cell
                    |
                    v
2. DROPDOWN DATA
   TableBridge.getFilterDropdownData(table, sheetId, colIndex, currentFilter)
     - Extracts column data from sheet
     - Gets cross-filter bitmap (other columns' bitmaps, excluding current column)
     - Calls buildFilterDropdownData(columnData, currentFilter, otherVisibility)
     - Returns FilterDropdownData { items[], hasBlank, blankCount, totalRowCount }
                    |
                    v
3. UI SELECTION
   User selects/deselects values in the dropdown
   UI builds FilterCriteria (e.g., ValueFilter with selected values)
                    |
                    v
4. CONTRACTS CONVERSION
   convertContractsFilter(criteria: ColumnFilterCriteria) -> FilterCriteria
   (Maps contracts types to engine types via convert.ts)
                    |
                    v
5. BITMAP EVALUATION
   TableBridge.evaluateAndCacheColumnFilter(tableId, columnId, criteria, columnData)
     - Checks bitmap cache first
     - If miss: calls evaluateColumnFilter(criteria, columnData) -> Uint8Array
     - Caches the result
                    |
                    v
6. BITMAP COMPOSITION
   TableBridge.getRowVisibility(tableId) -> RowVisibility
     - Collects all cached column bitmaps for the table
     - composeBitmaps(bitmaps) -> AND across all columns (row must pass ALL filters)
     - createRowVisibility(composed) -> { bitmap, visibleCount, totalCount,
                                          firstVisibleRow, lastVisibleRow }
                    |
                    v
7. ROW HIDING
   Renderer uses RowVisibility.bitmap to show/hide rows
   bitmap[i] == 1 -> row visible, bitmap[i] == 0 -> row hidden
```

### Cross-Column Filtering

When building filter dropdown data for column A, the bridge composes bitmaps from all
OTHER columns (B, C, D, ...) to determine which values in column A actually have visible
rows. This prevents showing values that would produce zero results.

### Cache Invalidation

The TableBridge subscribes to EventBus events for automatic invalidation:
- Cell data changes -> clear affected table's bitmaps
- Row/column insert/delete -> clear all bitmaps (lengths changed)
- Filter cleared -> clear all bitmaps
- Table deleted -> remove cache entry

---

## 11. Coordinator Mutations

**Location**: `apps/spreadsheet/src/coordinator/mutations/tables.ts`

The coordinator layer orchestrates table-specific write operations, focusing on
calculated columns. It bridges the gap between the UI layer and the kernel domain.

### Calculated Column Auto-Fill

When a formula is entered in a table data cell:

1. `checkCalculatedColumnAutoFill(ctx, sheetId, row, col, value)` -- detects if the cell
   is in a table data row and the value starts with `=`
2. `setCalculatedColumn(ctx, tableId, colIndex, formula)` -- sets the column metadata
   and fills all data cells via `computeBridge.setCells()` (fire-and-forget)
3. `applyCalculatedFormulasToNewRow(ctx, tableId, rowIndex)` -- called after table
   auto-expansion to apply calculated formulas to the new row

---

## 12. Table Styles

### Built-in Styles (67 total)

Three families of styles, matching Excel:

| Family | Count | ID Pattern                | Example               |
|--------|-------|---------------------------|-----------------------|
| Light  | 28    | `TableStyleLight{1-28}`   | `TableStyleLight1`    |
| Medium | 28    | `TableStyleMedium{1-28}`  | `TableStyleMedium2`   |
| Dark   | 11    | `TableStyleDark{1-11}`    | `TableStyleDark1`     |

Default style: `TableStyleMedium2`

### Style Resolution

`resolveTableCellFormat(table, row, col)` computes the effective formatting for a cell
based on:
- Table style definition (colors, borders, font)
- Cell position (header, data, totals)
- Banding (odd/even rows and columns)
- Emphasis flags (first column, last column)

The result is a `TableCellFormat` with fill color, font color, bold flag, and borders.

### Style Preset Mapping

Contracts stores short forms (`'light1'`, `'medium2'`), while the engine uses full
Excel-compatible names. The bridge maps between them:

```typescript
'light1'  -> 'TableStyleLight1'
'medium2' -> 'TableStyleMedium2'
'dark5'   -> 'TableStyleDark5'
'none'    -> 'TableStyleMedium2' (fallback)
```

---

## 13. Events

**Location**: `compute-table/src/events.rs`

Table lifecycle events are pure data structures (no I/O, no observers). The storage/bridge
layer is responsible for detecting changes and emitting them.

### Event Types

| Event                     | Fields                                           |
|---------------------------|--------------------------------------------------|
| `table:created`           | timestamp, sheetId, tableId, source              |
| `table:deleted`           | timestamp, sheetId, tableId, source              |
| `table:resized`           | timestamp, sheetId, tableId, oldRange, newRange, source |
| `table:renamed`           | timestamp, sheetId, tableId, oldName, newName, source |
| `table:totalRowChanged`   | timestamp, sheetId, tableId, hasTotalRow, source |
| `table:columnRenamed`     | timestamp, sheetId, tableId, columnId, oldName, newName, source |
| `table:updated`           | timestamp, sheetId, tableId, source (catch-all)  |

### Diff Helper

`diff_table_events(old, new, timestamp, source)` compares two table states and produces
the minimal set of events describing the changes. Includes a catch-all `table:updated`
event whenever any field differs.

### Event Sources

`StructureChangeSource`: `user`, `import`, `api`, `remote`

---

## 14. Key File Reference

### Rust (compute-table crate)
- Types: [`compute/core/crates/compute-table/src/types.rs`](../../compute/core/crates/compute-table/src/types.rs)
- Table CRUD: [`compute/core/crates/compute-table/src/table.rs`](../../compute/core/crates/compute-table/src/table.rs)
- Filter: [`compute/core/crates/compute-table/src/filter.rs`](../../compute/core/crates/compute-table/src/filter.rs)
- Sort: [`compute/core/crates/compute-table/src/sort.rs`](../../compute/core/crates/compute-table/src/sort.rs)
- Structured Refs: [`compute/core/crates/compute-table/src/structured_refs/`](../../compute/core/crates/compute-table/src/structured_refs/)
- Visibility: [`compute/core/crates/compute-table/src/visibility.rs`](../../compute/core/crates/compute-table/src/visibility.rs)
- Slicer: [`compute/core/crates/compute-table/src/slicer.rs`](../../compute/core/crates/compute-table/src/slicer.rs)
- Styles: [`compute/core/crates/compute-table/src/styles.rs`](../../compute/core/crates/compute-table/src/styles.rs)
- Events: [`compute/core/crates/compute-table/src/events.rs`](../../compute/core/crates/compute-table/src/events.rs)
- Edge Semantics: [`compute/core/crates/compute-table/src/EDGE_VALUE_SEMANTICS.md`](../../compute/core/crates/compute-table/src/EDGE_VALUE_SEMANTICS.md)

### TypeScript (table-engine)
- Package: [`table-engine/`](../../table-engine/)
- Types: [`table-engine/src/types.ts`](../../table-engine/src/types.ts)
- Index (public API): [`table-engine/src/index.ts`](../../table-engine/src/index.ts)
- Convert: [`table-engine/src/convert.ts`](../../table-engine/src/convert.ts)
- WASM Backend: [`table-engine/src/wasm-backend.ts`](../../table-engine/src/wasm-backend.ts)

### Kernel Domain
- Core: [`kernel/src/domain/tables/core.ts`](../../kernel/src/domain/tables/core.ts)
- Operations: [`kernel/src/domain/tables/operations.ts`](../../kernel/src/domain/tables/operations.ts)
- Auto-Expansion: [`kernel/src/domain/tables/auto-expansion.ts`](../../kernel/src/domain/tables/auto-expansion.ts)
- Calculated Columns: [`kernel/src/domain/tables/calculated-columns.ts`](../../kernel/src/domain/tables/calculated-columns.ts)
- Selection: [`kernel/src/domain/tables/selection.ts`](../../kernel/src/domain/tables/selection.ts)
- Hit Testing: [`kernel/src/domain/tables/hit-testing.ts`](../../kernel/src/domain/tables/hit-testing.ts)
- Custom Styles: [`kernel/src/domain/tables/custom-styles.ts`](../../kernel/src/domain/tables/custom-styles.ts)
- Range Resolution: [`kernel/src/domain/tables/range-resolution.ts`](../../kernel/src/domain/tables/range-resolution.ts)
- Slicers: [`kernel/src/domain/slicers/`](../../kernel/src/domain/slicers/)

### Bridge
- Table Bridge: [`kernel/src/bridges/table-bridge.ts`](../../kernel/src/bridges/table-bridge.ts)

### Contracts
- Table Types: [`contracts/src/data/tables.ts`](../../contracts/src/data/tables.ts)

### Coordinator
- Table Mutations: [`apps/spreadsheet/src/coordinator/mutations/tables.ts`](../../apps/spreadsheet/src/coordinator/mutations/tables.ts)
