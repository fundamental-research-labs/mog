# Kernel

The kernel is the data layer of Spreadsheet OS. It provides storage, system services, events, recalculation, and the API that apps use to read and write data.

## Overview

```
kernel/
├── src/
│   ├── api/                  # Public API namespaces
│   │   ├── app/              # App-level kernel API
│   │   ├── workbook/         # Workbook operations (sheets, styles, history)
│   │   ├── worksheet/        # Worksheet operations (cells, tables, charts, pivots, etc.)
│   │   ├── document/         # Document factory
│   │   ├── internal/         # Internal utilities (address resolver, format utils)
│   │   └── namespaces/       # Namespace files (cells, sheets, records)
│   ├── context/              # KernelContext, EventBus
│   ├── document/             # Document lifecycle machine, Rust document bridge
│   ├── domain/               # Domain modules (cells, sheets, tables, formatting, etc.)
│   ├── services/             # System services
│   │   ├── clipboard/        # Clipboard service
│   │   ├── undo/             # Undo/redo manager
│   │   ├── notifications/    # Toast notifications
│   │   ├── capabilities/     # Capability system
│   │   ├── checkpoint/       # Checkpoint service
│   │   ├── filesystem/       # File system service
│   │   ├── protection/       # Sheet/workbook protection
│   │   ├── query-executor/   # Query execution
│   │   └── table-registry/   # Table registry
│   ├── bridges/              # Hardware package connections
│   ├── selectors/            # Reactive state selectors
│   ├── keyboard/             # Keyboard shortcut processing
│   ├── errors/               # Error types and codes
│   └── floating-objects/     # Charts, shapes, images, and other floating objects
├── __tests__/                # Test suites
```

## Kernel API

### Level 0: Sheets & Cells

```typescript
namespace Sheets {
  list(): SheetInfo[];
  create(name?: string): SheetId;
  delete(sheetId: SheetId): void;
  getActive(): SheetId;
  setActive(sheetId: SheetId): void;
}

namespace Cells {
  // By position (convenience)
  getAt(sheetId: SheetId, row: number, col: number): CellData | null;
  setAt(sheetId: SheetId, row: number, col: number, value: CellValue): void;

  // By identity (primary)
  get(sheetId: SheetId, rowId: RowId, colId: ColId): CellData | null;
  set(sheetId: SheetId, rowId: RowId, colId: ColId, value: CellValue): void;

  // By CellId (for formula system)
  getById(cellId: CellId): CellData | null;

  // Bulk
  getRange(sheetId: SheetId, range: Range): CellData[][];
  setRange(sheetId: SheetId, range: Range, values: CellValue[][]): void;
}
```

### Level 1: Tables

```typescript
namespace Tables {
  create(sheetId: SheetId, range: Range, options?: TableOptions): TableId;
  get(tableId: TableId): TableInfo | null;
  delete(tableId: TableId): void;
  listInSheet(sheetId: SheetId): TableInfo[];

  // Row operations
  insertRow(tableId: TableId, at?: number, data?: CellValue[]): RowId;
  deleteRow(tableId: TableId, rowId: RowId): void;
  moveRow(tableId: TableId, rowId: RowId, toIndex: number): void;

  // Column operations
  getHeaders(tableId: TableId): string[];
  setHeader(tableId: TableId, colIndex: number, name: string): void;
}
```

### Level 2: Columns (Schema)

```typescript
namespace Columns {
  get(tableId: TableId, colId: ColId): ColumnSchema | null;
  list(tableId: TableId): ColumnSchema[];
  create(tableId: TableId, schema: ColumnSchemaInput): ColId;
  update(tableId: TableId, colId: ColId, changes: Partial<ColumnSchemaInput>): void;
  delete(tableId: TableId, colId: ColId): void;
  reorder(tableId: TableId, colId: ColId, afterColId: ColId | null): void;
}

interface ColumnSchema {
  id: ColId;
  name: string;
  type: ColumnType;
  required: boolean;
  unique: boolean;
  defaultValue?: CellValue;
}
```

### Level 3: Records

```typescript
namespace Records {
  // Read
  get(tableId: TableId, rowId: RowId): Record | null;
  query(tableId: TableId, filter?: FilterExpression, sort?: SortConfig[]): Record[];
  count(tableId: TableId, filter?: FilterExpression): number;

  // Write (transactional, emits events)
  create(tableId: TableId, values: RecordValues): RowId;
  update(tableId: TableId, rowId: RowId, changes: Partial<RecordValues>): void;
  delete(tableId: TableId, rowId: RowId): void;
  move(tableId: TableId, rowId: RowId, afterRowId: RowId | null): void;
}
```

### Relations

```typescript
namespace Relations {
  link(tableId: TableId, rowId: RowId, relationCol: ColId, targetRowId: RowId): void;
  unlink(tableId: TableId, rowId: RowId, relationCol: ColId, targetRowId: RowId): void;
  getLinkedRecords(tableId: TableId, rowId: RowId, relationCol: ColId): RowId[];
}
```

## System Services

### Clipboard Service

Cross-app clipboard with canonical format:

```typescript
interface ClipboardService {
  copy(payload: ClipboardPayload): void;
  cut(payload: ClipboardPayload): void;
  paste(): ClipboardPayload | null;
  clear(): void;

  // State
  hasContent(): boolean;
  isCut(): boolean;
}

interface ClipboardPayload {
  cells: CellData[][]; // Universal format (always present)
  tableContext?: {
    // Optional smart paste context
    tableId: TableId;
    rowIds: RowId[];
    colIds: ColId[];
  };
}
```

### Undo Service

Wraps Yrs UndoManager:

```typescript
interface UndoService {
  undo(): void;
  redo(): void;
  canUndo(): boolean;
  canRedo(): boolean;

  // Scoped transactions
  startTransaction(description: string): void;
  endTransaction(): void;
}
```

### Notification Service

Toast notifications:

```typescript
interface NotificationService {
  toast(message: string, type?: 'info' | 'success' | 'warning' | 'error'): void;
  dismiss(id: string): void;
  dismissAll(): void;
}
```

## EventBus

Pub/sub for cross-system communication:

```typescript
interface EventBus {
  emit(event: KernelEvent): void;
  on<T extends KernelEvent>(type: T['type'], handler: (e: T) => void): Unsubscribe;
  once<T extends KernelEvent>(type: T['type'], handler: (e: T) => void): Unsubscribe;
}

// Event types
type KernelEvent =
  | { type: 'cell:changed'; sheetId: SheetId; cellId: CellId; ... }
  | { type: 'cells:batch-changed'; sheetId: SheetId; cellIds: CellId[]; ... }
  | { type: 'structure:rows-inserted'; sheetId: SheetId; ... }
  | { type: 'structure:cols-inserted'; sheetId: SheetId; ... }
  | { type: 'table:created'; tableId: TableId; ... }
  | { type: 'record:created'; tableId: TableId; rowId: RowId; ... }
  | { type: 'record:updated'; tableId: TableId; rowId: RowId; ... }
  | { type: 'record:deleted'; tableId: TableId; rowId: RowId; ... }
  | ...
```

## Identity System

Three orthogonal identity systems:

| Identity   | Answers                | Stable Across         | Used For                     |
| ---------- | ---------------------- | --------------------- | ---------------------------- |
| **CellId** | "Which specific cell?" | Cut/paste, drag-move  | Formula dependencies, recalc |
| **RowId**  | "Which row?"           | Insert/delete rows    | Row properties, records      |
| **ColId**  | "Which column?"        | Insert/delete columns | Column properties, schema    |

```typescript
// Branded types prevent mixing
type SheetId = string & { __brand: 'SheetId' };
type RowId = string & { __brand: 'RowId' };
type ColId = string & { __brand: 'ColId' };
type CellId = string & { __brand: 'CellId' };
type TableId = string & { __brand: 'TableId' };
```

## Bridges

Bridges connect kernel to hardware packages (optional external features):

| Bridge            | Purpose                           | File                         |
| ----------------- | --------------------------------- | ---------------------------- |
| Compute           | Formula eval via compute-core     | `compute/`                   |
| Locale            | Locale/culture settings           | `locale-bridge.ts`           |
| Schema            | Column validation                 | `schema-bridge.ts`           |
| Table             | Table sync                        | `table-bridge.ts`            |
| Pivot             | Pivot table computation           | `pivot-bridge.ts`            |
| Pivot-Event       | Pivot event forwarding            | `pivot-event-bridge.ts`      |
| Slicer-Table      | Slicer to table filter sync       | `slicer-table-bridge.ts`     |
| Slicer-Pivot      | Slicer to pivot filter sync       | `slicer-pivot-bridge.ts`     |
| Mutation-Result   | Handles mutation results          | `mutation-result-handler.ts` |

Bridges subscribe to kernel events and write results back via kernel API.

## React Integration

```typescript
// Hook for accessing kernel
const kernel = useKernel();

// Reactive hooks
const records = useRecords(kernel, tableId, filter);
const columns = useColumns(kernel, tableId);
const cell = useCell(kernel, sheetId, row, col);
```

## Recalculation

Formula evaluation is a kernel subsystem (not a bridge) because formulas are core functionality:

```
Cell value changes
        │
        ▼
[1] Mutation emits 'cell:changed' event
        │
        ▼
[2] Recalc subsystem gets evaluation order from dependency graph
        │
        ▼
[3] For each dependent cell:
    - Resolve IdentityFormula → A1 string
    - Evaluate via compute-core (Rust)
    - Write result via Cells.setComputed()
        │
        ▼
[4] EventBus emits 'cells:batch-changed' for all computed cells
```

The dependency graph uses CellIds (stable), so structure changes (insert/delete rows) never require graph rebuilding.
