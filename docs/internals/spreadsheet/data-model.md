# Data Model

## Overview

All persistent state lives in Rust compute-core, accessed via ComputeBridge (Tauri IPC on desktop, WASM on web). The Rust engine owns cell storage, formula evaluation, dependency tracking, and recalculation.

The spreadsheet uses the **Cell Identity Model** where cells are keyed by stable UUIDs (CellId) rather than positions. This enables O(1) structure changes (insert/delete row/col) and correct concurrent editing. See [Cell Identity](cell-identity.md) for the full design.

```
Rust compute-core (storage engine)
│
├── workbook
│   ├── sheetOrder: Array<SheetId>
│   ├── styles: Map<CellStyle>                    ◄── Custom cell styles
│   ├── workbookSettings: Map                     ◄── Workbook settings (culture, theme, protection)
│   └── definedNames: Map<DefinedName>            ◄── Named ranges (uses IdentityFormula)
│
├── sheets: Map<SheetId, SheetData>               ◄── UndoManager scope
│   └── {sheetId}: SheetData
│       ├── meta: SheetMeta
│       │
│       │   === Cell Identity Model Storage ===
│       ├── cells: Map<CellId, SerializedCellData>        ◄── Primary storage (stable keys)
│       ├── properties: Map<CellId, CellProperties>       ◄── Sparse formatting (stable keys)
│       ├── grid: Map<"sheet:row:col", CellId>            ◄── Position lookup (derived)
│       │
│       │   === Position-Keyed Metadata ===
│       ├── schemas: Map<colIndex, ColumnSchema>
│       ├── rangeSchemas: Map<schemaId, RangeSchema>
│       ├── rowHeights: Map<rowIndex, number>
│       ├── colWidths: Map<colIndex, number>
│       ├── rowFormats: Map<rowIndex, CellFormat>         ◄── Row formatting inheritance
│       ├── colFormats: Map<colIndex, CellFormat>         ◄── Column formatting inheritance
│       │
│       │   === Structural Features ===
│       ├── merges: Map<CellId, IdentityMergedRegion>     ◄── Merged cells (keyed by topLeftId)
│       ├── hiddenRows: Array<number>
│       ├── hiddenCols: Array<number>
│       ├── groupingConfig: Map<unknown>                  ◄── Row/column grouping
│       │
│       │   === Tables, Charts, Objects ===
│       ├── tables: Map<tableId, TableConfig>
│       ├── charts: Map<chartId, SerializedChart>
│       ├── floatingObjects: Map<objectId, FloatingObject>
│       ├── floatingObjectGroups: Map<groupId, FloatingObjectGroup>
│       ├── formControls: Map<controlId, FormControl>     ◄── Form controls
│       │
│       │   === Filtering & Slicing ===
│       ├── filters: Map<filterId, FilterState>           ◄── Auto/table filters
│       ├── slicers: Map<slicerId, SlicerConfig>          ◄── Table/pivot slicers
│       │
│       │   === Collaboration ===
│       ├── comments: Map<commentId, CellComment>         ◄── Threaded comments
│       ├── notes: Map<cellId, CellNote>                  ◄── Simple cell notes
│       └── dataBindings: Map<bindingId, SheetDataBinding>
│
├── conditionalFormats: Map<cfId, SerializedConditionalFormat>   ◄── Document-level CF rules
│
├── pivots_<sheetId>: Map<pivotId, PivotTableConfigSerialized>  ◄── Dynamic per-sheet
├── pivotExpansion_<pivotId>: Map<headerKey, boolean>            ◄── Pivot expansion state
│
├── versioning                                    ◄── Document-level
│   ├── branches: Map<name, Branch>
│   ├── currentBranch: string
│   └── snapshotIndex: Map<id, SnapshotMetadata>
│
├── testing                                       ◄── Document-level
│   ├── assertions: Map<id, CellAssertion>
│   ├── suites: Map<id, TestSuite>
│   └── config: Map<unknown>                      ◄── Test configuration
│
└── connections                                   ◄── Document-level
    ├── configs: Map<id, DataConnection>
    └── bindings: Map<CellId, CellBinding>        ◄── Keyed by CellId (stable identity)
```

## Cell Identity Model

**Key architectural decision**: Cells are keyed by stable UUIDs (`CellId`), not by position.

### Why UUIDs, Not Positions?

| Position Keys (`row:col`)          | Identity Keys (`CellId`)                                  |
| ---------------------------------- | --------------------------------------------------------- |
| Insert column = O(n) key remapping | Insert column = O(n) position updates, **no key changes** |
| Concurrent inserts conflict        | Concurrent inserts compose correctly                      |
| Formula strings must be rewritten  | Formula refs are stable (by CellId)                       |
| Dependency graph keys shift        | Dependency graph keys never change                        |

### Three Maps Per Sheet

| Map          | Key               | Value                | Purpose              |
| ------------ | ----------------- | -------------------- | -------------------- |
| `cells`      | `CellId` (UUID)   | `SerializedCellData` | Primary cell storage |
| `properties` | `CellId` (UUID)   | `CellProperties`     | Sparse formatting    |
| `grid`       | `"sheet:row:col"` | `CellId`             | Position → ID lookup |

**The `grid` map is derived state** - it's rebuilt from `cells` after structure operations. The source of truth for cell position is inside each cell's data.

For the full design, see [Cell Identity](cell-identity.md).

## Design Decisions

### Per-Sheet vs Document-Level

**Per-sheet** (under `sheets/{sheetId}/`):

- `cells` - computational data (values, formulas, positions)
- `properties` - non-computational data (format, provenance, validation)
- `schemas` - column-level schema definitions
- `merges` - merged cell regions
- `filters`, `slicers` - filtering controls
- `comments`, `notes` - cell annotations
- Cascading delete: removing a sheet removes all its data

**Document-level** (at root):

- `workbook` - sheet order, styles, settings, named ranges
- `conditionalFormats` - CF rules (can reference multiple sheets)
- `pivots_<sheetId>` - pivot tables (dynamic keys per sheet)
- `versioning` - snapshots span entire document
- `testing` - test suites can reference multiple sheets
- `connections` - data sources are document-wide

### UndoManager Scope

Sheet-level operations are tracked by the undo system:

- User edits (cell values, formats) are undoable
- Versioning/testing/connections changes are NOT undoable

## Sheet Structure

### SheetMeta

**Location:** `contracts/src/store/sheet-meta-schema.ts`

```typescript
interface SheetMeta {
  id: SheetId;
  name: string;
  defaultRowHeight: number;
  defaultColWidth: number;
  frozenRows: number;
  frozenCols: number;
  tabColor?: string | null; // Hex color (e.g., "#4285f4")
  hidden?: boolean;
}
```

**Note:** Extended sheet settings (showGridlines, showRowHeaders, isProtected, showZeroValues, gridlineColor, rightToLeft) are stored in the `SheetSettings` interface in `contracts/src/core.ts`, not in SheetMeta.

### SerializedCellData (Cell Identity Model)

**Location:** `contracts/src/store/store-types.ts`

```typescript
/**
 * Cell data stored in Rust compute-core (compact keys for efficiency).
 * Position is stored IN the cell, enabling O(1) structure changes.
 */
interface SerializedCellData {
  // === Identity & Position ===
  id: CellId; // Stable UUID (never changes)
  row: number; // Current row (updates on insert/delete)
  col: number; // Current col (updates on insert/delete)

  // === Values ===
  r: CellRawValue; // Raw value (user input, can be RichText)
  c?: CellValue; // Computed value (formula result)

  // === Formulas ===
  f?: string; // A1-style formula (e.g., "SUM(A1:B10)")
  idf?: IdentityFormula; // Identity formula (stable refs)

  // === Metadata ===
  n?: string; // Note/comment
  h?: string; // Hyperlink URL

  // === Array Formula (Spill) Support ===
  spillRange?: { rows: number; cols: number }; // For spill anchor cells
  spillAnchor?: CellId; // For spill member cells
  isCSE?: boolean; // Legacy CSE array formula
}
```

**Key insights**:

- The `idf` (IdentityFormula) contains references by CellId. When displaying, it's converted to A1-style (`f`) for the formula bar.
- `spillRange` marks cells containing dynamic array formulas (e.g., `=UNIQUE(A1:A10)`)
- `spillAnchor` marks cells that are part of a spill range but not the anchor
- `isCSE` marks legacy Ctrl+Shift+Enter array formulas that display as `{=formula}`

**Value Resolution**: When reading cell values, use the formula field (`f` or `idf`) to determine whether to use `c` (computed) or `r` (raw). Never use `c ?? r` because `null` is a valid computed result. See [Cell Identity - Cell Value Resolution](cell-identity.md#cell-value-resolution) for the correct pattern.

See [Cell Identity](cell-identity.md) for the conversion flow.

### CellProperties

```typescript
/**
 * All non-computational properties of a cell.
 * Stored in a single map in Rust/Yrs for unified reactivity.
 */
interface CellProperties {
  // === Visual Formatting ===
  format?: CellFormat;

  // === Provenance ===
  modifiedBy?: string;
  modifiedAt?: number;
  dataSource?: CellDataSource;

  // === Validation ===
  validationErrors?: ValidationError[];

  // === Live Data Connections ===
  connectionId?: string;
  staleness?: 'fresh' | 'stale' | 'error';
  lastFetched?: number;

  // === Formula Auditing ===
  isArrayFormula?: boolean; // CSE array formula display: {=FORMULA}

  // === Extensible ===
  extensions?: Record<string, unknown>;
}
```

### CellFormat (Complete)

**Location:** `contracts/src/core.ts`

```typescript
interface CellFormat {
  // === Number Format ===
  numberFormat?: string;
  numberFormatType?: NumberFormatType;

  // === Font Properties ===
  fontFamily?: string;
  fontSize?: number;
  fontTheme?: 'major' | 'minor'; // Theme font reference (+Headings/+Body)
  fontColor?: string; // Hex or theme reference (theme:accent1:0.4)
  bold?: boolean;
  italic?: boolean;
  underlineType?: 'none' | 'single' | 'double' | 'singleAccounting' | 'doubleAccounting';
  strikethrough?: boolean;
  superscript?: boolean;
  subscript?: boolean;
  fontOutline?: boolean;
  fontShadow?: boolean;

  // === Alignment ===
  horizontalAlign?:
    | 'general'
    | 'left'
    | 'center'
    | 'right'
    | 'fill'
    | 'justify'
    | 'centerContinuous'
    | 'distributed';
  verticalAlign?: 'top' | 'middle' | 'bottom' | 'justify' | 'distributed';
  wrapText?: boolean;
  textRotation?: number; // 0-90 CCW, 91-180 CW, 255=vertical
  indent?: number; // 0-15
  shrinkToFit?: boolean;
  readingOrder?: 'context' | 'ltr' | 'rtl';

  // === Fill Properties ===
  backgroundColor?: string; // Hex or theme reference
  patternType?: PatternType; // 18 Excel pattern types
  patternForegroundColor?: string; // Pattern color
  gradientFill?: GradientFill; // Linear or path gradient

  // === Border Properties ===
  borders?: CellBorders;

  // === Protection ===
  locked?: boolean; // Locked when sheet protected
  hidden?: boolean; // Formula hidden when protected
  forcedTextMode?: boolean; // Apostrophe prefix (text mode)
}
```

## Sheet-Level Maps Reference

| Map                    | Key                | Value                | Purpose                       |
| ---------------------- | ------------------ | -------------------- | ----------------------------- |
| `cells`                | CellId             | SerializedCellData   | Primary cell storage          |
| `properties`           | CellId             | CellProperties       | Sparse formatting             |
| `grid`                 | "sheet:row:col"    | CellId               | Position lookup               |
| `schemas`              | colIndex           | ColumnSchema         | Column type definitions       |
| `rangeSchemas`         | schemaId           | RangeSchema          | Data validation rules         |
| `rowHeights`           | rowIndex           | number               | Custom row heights            |
| `colWidths`            | colIndex           | number               | Custom column widths          |
| `rowFormats`           | rowIndex           | CellFormat           | Row formatting inheritance    |
| `colFormats`           | colIndex           | CellFormat           | Column formatting inheritance |
| `merges`               | CellId (topLeftId) | IdentityMergedRegion | Merged cell regions           |
| `groupingConfig`       | string             | GroupingSettings     | Row/column grouping           |
| `hiddenRows`           | -                  | Array<number>        | Hidden row indices            |
| `hiddenCols`           | -                  | Array<number>        | Hidden column indices         |
| `tables`               | tableId            | TableConfig          | Excel-style tables            |
| `charts`               | chartId            | SerializedChart      | Charts                        |
| `floatingObjects`      | objectId           | FloatingObject       | Pictures, shapes, text boxes  |
| `floatingObjectGroups` | groupId            | FloatingObjectGroup  | Grouped floating objects      |
| `formControls`         | controlId          | FormControl          | Form controls                 |
| `filters`              | filterId           | FilterState          | Auto/table filters            |
| `slicers`              | slicerId           | SlicerConfig         | Table/pivot slicers           |
| `comments`             | commentId          | CellComment          | Threaded comments             |
| `notes`                | cellId             | CellNote             | Simple cell notes             |
| `dataBindings`         | bindingId          | SheetDataBinding     | Sheet data bindings           |

**Note**: Many sheet-level maps are lazily created and may be `undefined` until first use. This includes: `filters`, `slicers`, `comments`, `notes`, `formControls`, `rowFormats`, and `colFormats`. Always check for existence before accessing these maps.

## Document-Level Structures

### Workbook

```typescript
// workbook storage
{
  sheetOrder: Array<SheetId>,
  styles: Map<string, CellStyle>,         // Custom cell styles
  workbookSettings: Map<string, unknown>,  // Settings (culture, theme, etc.)
  definedNames: Map<string, DefinedName>   // Named ranges
}
```

### DefinedName (Named Ranges)

```typescript
interface DefinedName {
  id: string;
  name: string;
  refersTo: IdentityFormula; // CRDT-safe, uses CellId refs
  scope?: SheetId; // undefined = workbook scope
  comment?: string;
  visible?: boolean;
}
```

### Connections & Bindings

```typescript
// connections storage
{
  configs: Map<string, DataConnection>,
  bindings: Map<CellId, CellBinding>     // Keyed by CellId for stable identity
}

interface CellBinding {
  connectionId: string;
  cellId: CellId;        // Stable cell identifier
  sheetId: SheetId;      // Sheet context for filtering
  query: string;         // JSONPath, SQL column, etc.
  transform?: string;    // Optional transform formula
}
```

**Important**: Cell bindings use `CellId` (not position) as the key. This ensures bindings survive row/column insert/delete operations and compose correctly under concurrent structure changes.

### FilterState

```typescript
interface FilterState {
  id: string;
  type: 'autoFilter' | 'tableFilter' | 'advancedFilter';

  // Range defined by CellIds (not positions)
  headerStartCellId: CellId;
  headerEndCellId: CellId;
  dataEndCellId: CellId;

  columnFilters: string; // JSON: Record<CellId, ColumnFilterCriteria>
  sortState?: string; // JSON: FilterSortState
  tableId?: string;
  createdAt?: number;
  updatedAt?: number;
}
```

### CellComment (Threaded Comments)

```typescript
interface CellComment {
  id: string;
  cellId: CellId; // Stable reference via CellId
  author: string;
  authorId?: string;
  createdAt: number;
  modifiedAt?: number;
  content: RichText; // Rich text formatting
  threadId?: string; // Thread root ID
  parentId?: string; // Parent comment for replies
  resolved?: boolean;
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
}
```

### Grid Key Format

Grid keys use a three-component format that includes the sheet ID:

```typescript
// Create grid key (includes sheet ID for uniqueness)
createGridKey(sheet, row, col) → "sheet-abc:5:3"

// Parse grid key
parseGridKey("sheet-abc:5:3") → { sheet: "sheet-abc", row: 5, col: 3 }
```

## Accessing Data

**SpreadsheetStore methods** (recommended):

```typescript
// Cell values (by position - uses grid index internally)
store.getCellData(sheetId, row, col);
store.setCellValue(sheetId, row, col, value);

// Cell values (by CellId - direct lookup)
store.getCellDataById(cellId);
store.setCellValueById(cellId, value);

// Unified properties
store.getCellProperties(sheetId, row, col); // Returns full CellProperties
store.setCellProperties(sheetId, row, col, partial);

// Convenience methods
store.getCellFormat(sheetId, row, col); // Returns properties.format
store.setCellFormat(sheetId, row, col, format);
```

**React hook** (for reactive UI):

```typescript
// Reactively subscribes to property changes via coordinator
const { properties, format } = useCellProperties(sheetId, row, col);
```

**Direct store access** (advanced, via StoreContext refs):

```typescript
const { cells, properties, grid } = ctx.refs.getSheetMaps(sheetId);

// Lookup by position (grid key includes sheet ID)
const gridKey = `${sheetId}:${row}:${col}`;
const cellId = grid.get(gridKey);
if (cellId) {
  const cellData = cells.get(cellId);
  const cellProps = properties.get(cellId);
}

// Lookup by CellId (when you have a formula reference)
const cellData = cells.get(someCellId);
const { row, col } = cellData; // Position is inside the cell
```

## Structure Operations

Insert/delete row/col updates positions without changing keys:

```typescript
function insertColumns(sheet: SheetId, startCol: number, count: number): void {
  // Step 1: Shift positions of affected cells (O(n) position updates)
  cells.forEach((cell, id) => {
    if (cell.col >= startCol) {
      cells.set(id, { ...cell, col: cell.col + count });
    }
  });

  // Step 2: Rebuild grid index (derived state)
  rebuildGridIndex(sheet);

  // Step 3: Shift column widths, schemas (position-keyed data)
  shiftColumnWidths(sheet, startCol, count);

  // No formula parsing. No reference adjustment. Just position updates.
}
```

**Key benefit**: Formulas like `=SUM(A1:B10)` don't change. Their `IdentityFormula` refs point to CellIds, which are stable. Only the A1 display changes when you view the formula.

## Syncing

### Local Persistence

Document state is persisted locally via the Rust storage engine. On desktop (Tauri), this uses native file I/O. On web, state is serialized through the WASM bridge.

### Remote (Collaboration)

Real-time collaboration uses a WebSocket-based sync protocol. The collaboration server routes document changes between connected clients.

## Snapshot Storage

Snapshots (versioning) are stored separately from the main document:

- **Metadata** in the document store (`versioning/snapshotIndex`)
- **Blob data** persisted locally

```typescript
// Snapshot metadata (synced)
interface SnapshotMetadata {
  id: string;
  message: string;
  timestamp: number;
  branch: string;
}

// Snapshot blob (local storage)
interface SnapshotBlob {
  id: string;
  data: Uint8Array; // Encoded state
}
```

## Related Documentation

- [Cell Identity](cell-identity.md) - Full design of the CellId model
- [State Management](state.md) - SpreadsheetStore, UIStore, EventBus
- [Packages](packages.md) - All packages and dependencies
