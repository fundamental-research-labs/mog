# State Management

## Architecture Overview

The state layer uses a domain-driven design with explicit separation of reads and writes:

```
┌─────────────────────────────────────────────────────────────┐
│  Consumers (Hooks, Components, API)                         │
│  - Read operations go direct: Cells.getData(ctx, ...)       │
│  - Write operations go through Mutations layer              │
└─────────────────────────────────┬───────────────────────────┘
                              │ mutations only
                              ▼
┌─────────────────────────────────────────────────────────────┐
│  Mutations Layer (coordinator/mutations/)                   │
│  - setCellValue, setCellValues, clearRange, etc.            │
│  - Composes: domain module + recalculation + events         │
│  - Single source of truth for "what happens on mutation"    │
└─────────────────────────────┬───────────────────────────────┘
                              │
              ┌───────────────┼───────────────┐
              ▼               ▼               ▼
┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐
│  Domain Modules │  │  Recalculation  │  │  Event Bus      │
│  (pure data)    │  │  (pure calc)    │  │  (notify)       │
└─────────────────┘  └─────────────────┘  └─────────────────┘
        │
        ▼
┌─────────────────┐
│  StoreContext   │
│  (Rust + refs)  │
└─────────────────┘
```

## StoreContext

**File:** `kernel/src/context/kernel-context.ts`
**Types:** `kernel/src/context/types.ts`

The dependency injection mechanism for all domain functions. Provides access to the Rust document (via ComputeBridge), event bus, undo manager, and various feature bridges.

### Ownership Rule

**DocumentHandle owns StoreContext completely.** Never create your own.

```typescript
// ✅ CORRECT - Use handle.storeContext
const handle = await DocumentFactory.create();
const ctx = handle.storeContext;

// ❌ WRONG - Creates duplicate context
const ctx = createStoreContext(handle.document); // Don't do this!
```

Creating duplicate contexts causes:

- Multiple UndoManagers tracking the same Rust document
- Duplicate bridge subscriptions (double event handlers)
- Memory leaks from orphaned contexts

The `createStoreContext` function will warn if you accidentally create a duplicate.

### Context Ownership Model

The ownership model follows a clear hierarchy:

```
DocumentFactory.create()
├── Creates RustDocument (internal, via ComputeBridge)
├── Creates StoreContext (owns: UndoManager, bridges, store refs)
├── Returns DocumentHandle { storeContext, dispose }
│
└── dispose() cleans up:
    ├── storeContext.destroy() (destroys bridges, undoManager)
    └── rustDocument.destroy() (destroys Rust document)

Spreadsheet component
├── Receives DocumentHandle
├── Uses handle.storeContext (never creates own)
├── Creates UIStore (ephemeral, not part of handle)
└── No StoreContext cleanup (handle owns lifecycle)
```

**Key Principles:**

1. **Creator is destroyer** - DocumentHandle creates StoreContext, so it destroys it
2. **Single owner** - Only one StoreContext per document, enforced at runtime
3. **Clean disposal** - `handle.dispose()` cleans up everything
4. **No leaky abstractions** - `document` is internal implementation detail

**When to use each API:**

| API                        | Use Case                                             |
| -------------------------- | ---------------------------------------------------- |
| `DocumentFactory.create()` | Most cases - creates ready handle with all resources |
| `handle.storeContext`      | Access StoreContext from handle                      |
| `handle.dispose()`         | Cleanup when done with document                      |
| `DocumentProvider`         | Alternative: let provider manage lifecycle via docId |

The ownership invariant is direct: the factory that creates a document handle also owns disposal of every resource attached to that handle.

```typescript
// Base interface from @mog/spreadsheet-contracts
interface IStoreContext {
  doc: RustDocument;
  refs: StoreRefs; // Pre-resolved store references
  eventBus: IEventBus;
  undoManager: IUndoManager; // Backed by Rust yrs::undo::UndoManager
  computeBridge: ComputeBridge;

  // Bridge properties for feature integration
  pivot: IPivotBridge;
  schema: ISchemaValidationBridge;
  locale: ILocaleInputBridge;
  charts: IChartBridge;

  subscribe(callback: () => void): () => void;
  setPendingUndoDescription(description: string): void;
  getPendingUndoDescription(): string | null;
  clearPendingUndoDescription(): void;
  destroy(): void;
}

// Engine-specific extension
interface StoreContext extends IStoreContext {
  refs: StoreRefs;

  // Selection checkpoint methods for undo/redo
  setPendingSelectionCheckpoint(checkpoint: SelectionCheckpoint): void;
  getPendingSelectionCheckpoint(): SelectionCheckpoint | null;
  clearPendingSelectionCheckpoint(): void;
}

// Factory
function createStoreContext(rustDocument: RustDocument): StoreContext;
```

**Usage in React:**

```typescript
const ctx = useStoreContext(); // From DocumentContext
```

## Domain Modules

**Location:** `kernel/src/domain/`
**Re-exported:** `kernel/src/api/index.ts` (public API facade for consumers)

30+ domain modules containing pure functions that take `StoreContext` as their first parameter:

### Core Data Domains

| Module       | Purpose                         | Key Functions                                      |
| ------------ | ------------------------------- | -------------------------------------------------- |
| `Cells`      | Cell values, formulas, raw data | `getData`, `setValue`, `getRawValue`, `clearRange` |
| `GridIndex`  | Position ↔ CellId lookup        | `getCellIdAt`, `getPositionById`                   |
| `Properties` | Format, metadata, styles        | `getFormat`, `setFormat`, `getMetadata`            |
| `Spill`      | Dynamic array spill handling    | `getSpillParent`, `getSpillRange`                  |

### Structure Domains

| Module       | Purpose                      | Key Functions                                |
| ------------ | ---------------------------- | -------------------------------------------- |
| `Dimensions` | Row/column sizing, hide/show | `getRowHeight`, `setColumnWidth`, `hideRows` |
| `Merges`     | Merged regions               | `mergeRange`, `unmergeRange`, `getForCell`   |
| `Sheets`     | Sheet CRUD, settings         | `create`, `delete`, `rename`, `getMeta`      |
| `Structures` | Insert/delete rows/cols      | `insertRows`, `deleteRows`, `insertColumns`  |

### Feature Domains

| Module     | Purpose              | Key Functions                             |
| ---------- | -------------------- | ----------------------------------------- |
| `Comments` | Cell comments        | `add`, `update`, `delete`, `getForCell`   |
| `Filters`  | AutoFilter           | `setFilter`, `clearFilter`, `applyFilter` |
| `Grouping` | Row/column outlining | `addGroup`, `removeGroup`, `collapse`     |
| `Notes`    | Cell notes           | `add`, `update`, `delete`, `getForCell`   |
| `Slicers`  | Slicer objects       | `create`, `update`, `delete`              |
| `Sorting`  | Sort operations      | `sortRange`, `getSortState`               |

### Tables Domain (Sub-modules)

| Module                       | Purpose                         |
| ---------------------------- | ------------------------------- |
| `TablesCore`                 | Basic table CRUD operations     |
| `TablesAutoExpansion`        | Auto-expand on data entry       |
| `TablesCalculatedColumns`    | Calculated column formulas      |
| `TablesCustomStyles`         | Custom table styling            |
| `TablesEvents`               | Table event handling            |
| `TablesHitTesting`           | Position-to-table lookup        |
| `TablesOperations`           | Table operations (resize, etc.) |
| `TablesRangeResolution`      | Range resolution within tables  |
| `TablesSelection`            | Table selection handling        |
| `TablesStructuredReferences` | Structured reference parsing    |

### Extension Domains

| Module        | Purpose                     | Key Functions                           |
| ------------- | --------------------------- | --------------------------------------- |
| `Bindings`    | Data bindings               | `getBinding`, `setBinding`              |
| `Charts`      | Chart objects               | `create`, `update`, `delete`            |
| `NamedRanges` | Named range management      | `create`, `update`, `delete`, `resolve` |
| `Schemas`     | Column schemas + validation | `getColumnSchema`, `setColumnSchema`    |
| `Workbook`    | Workbook-level settings     | `getSettings`, `setSetting`             |

### Other Domains

| Module                        | Purpose                                  |
| ----------------------------- | ---------------------------------------- |
| `Undo`                        | Undo/redo operations                     |
| `PowerQuery`                  | Power Query support                      |
| `FormulaStructuredRefUpdater` | Update structured references in formulas |
| `Sparklines`                  | Sparkline objects                        |
| `ConditionalFormat`           | Conditional formatting rules             |

**Example:**

```typescript
// Import from kernel/api (the public API facade)
import { Cells, Sheets } from '@mog/kernel/api';

// All domain functions are pure: (ctx, ...args) => result
const data = Cells.getData(ctx, sheetId, row, col);
const format = Properties.getFormat(ctx, sheetId, row, col);
const sheetName = Sheets.getName(ctx, sheetId);
```

## Mutations Layer

**Location:** `apps/spreadsheet/src/coordinator/mutations/`

The mutations layer is organized into specialized files:

```
coordinator/mutations/
├── equation.ts         # Equation mutations
├── index.ts            # Re-exports
├── diagram.ts          # Diagram mutations
├── tables.ts           # Table mutations
├── types.ts            # Shared types
└── text-effects.ts     # Text-effects mutations
```

The **single source of truth** for what happens when data changes. All write operations go through this layer.

```typescript
import { Mutations } from '../coordinator';

// Cell mutations (triggers recalculation)
Mutations.setCellValue(ctx, sheetId, row, col, value);
Mutations.setCellValues(ctx, sheetId, updates); // Batch - single recalc
Mutations.clearRange(ctx, sheetId, range);

// Structure mutations
Mutations.insertRows(ctx, sheetId, startRow, count); // No recalc (Cell Identity)
Mutations.deleteRows(ctx, sheetId, startRow, count); // Full recalc (#REF! check)

// Format mutations (no recalc - visual only)
Mutations.setFormat(ctx, sheetId, row, col, format);
Mutations.setFormats(ctx, sheetId, cells, format);

// Merge mutations (no recalc - visual only)
Mutations.mergeRange(ctx, sheetId, range);
Mutations.unmergeRange(ctx, sheetId, range);
```

**Key design decisions:**

1. **Centralized orchestration** - Only mutations layer knows about recalculation
2. **Domain modules stay pure** - Just data operations, no side effects
3. **Batching is explicit** - `setCellValues` = one recalc, not N
4. **Cell Identity aware** - Insert ops don't recalc, delete ops do (for #REF!)

## RustDocument

**File:** `kernel/src/document/rust-document.ts`

Manages the Rust compute-core document lifecycle via ComputeBridge.

```typescript
class RustDocument {
  readonly docId: string;

  // Persistence
  syncFullState(): Promise<Uint8Array>; // Serialize for IndexedDB
  loadFromState(data: Uint8Array): Promise<void>;

  // Status: 'connecting' | 'syncing' | 'ready' | 'error'
  readonly status: DocumentStatus;
  onStatusChange(cb: (status) => void): void;

  // Cleanup
  destroy(): void;
}
```

**Responsibilities:**

- Create/own the Rust compute-core document (via ComputeBridge)
- Manage offline persistence (explicit `syncFullState()` to IndexedDB)
- Manage WebSocket-based collaboration sync
- Track sync status for loading states

## UIStore

**Location:** `apps/spreadsheet/src/ui-store/`

Ephemeral UI state via Zustand, split into feature slices. Not persisted or synced.

```
ui-store/
├── slices/
│   ├── accessibility.ts         # Accessibility settings
│   ├── active-sheet.ts          # Active sheet ID
│   ├── advanced-filter-dialog.ts
│   ├── autofill-options.ts
│   ├── backstage.ts
│   ├── cell-binding-dialog.ts
│   ├── cf-dialog.ts             # Conditional format dialog
│   ├── chart-clipboard.ts
│   ├── chart-ui.ts
│   ├── comments.ts
│   ├── connection-manager.ts
│   ├── consolidate-dialog.ts
│   ├── context-menu.ts
│   ├── corner-rotation.ts
│   ├── ctrl-a-state.ts
│   ├── custom-autofilter-dialog.ts
│   ├── custom-lists-dialog.ts
│   ├── data-tools.ts
│   ├── drag-drop-overwrite-dialog.ts
│   ├── dv-dialog.ts             # Data validation dialog
│   ├── error-checking-dialog.ts
│   ├── evaluate-formula-dialog.ts
│   ├── fill-context-menu.ts
│   ├── fill-merge-conflict-dialog.ts
│   ├── fill-series-dialog.ts
│   ├── filter-dropdown.ts
│   ├── flash-fill.ts
│   ├── floating-objects.ts
│   ├── format-cells-dialog.ts
│   ├── format-painter.ts
│   ├── formula-bar.ts
│   ├── formulas.ts
│   ├── function-arguments-dialog.ts
│   ├── goal-seek-dialog.ts
│   ├── goto-dialog.ts
│   ├── goto-special-dialog.ts
│   ├── hyperlink-dialog.ts
│   ├── insert-cells-dialog.ts
│   ├── insert-chart-wizard-dialog.ts
│   ├── large-fill-dialog.ts
│   ├── merge-warning-dialog.ts
│   ├── misc.ts
│   ├── missing-fonts-dialog.ts
│   ├── more-colors-dialog.ts
│   ├── mru-functions.ts
│   ├── named-ranges-dialog.ts
│   ├── notes-ui.ts
│   ├── paste-mismatch-dialog.ts
│   ├── paste-options.ts
│   ├── paste-preview.ts
│   ├── paste-validation.ts
│   ├── pdf-export-dialog.ts
│   ├── picture-dialogs.ts
│   ├── pivot-dialog.ts
│   ├── protect-sheet-dialog.ts
│   ├── protect-workbook-dialog.ts
│   ├── qat.ts
│   ├── range-selection-mode.ts
│   ├── repeat-action.ts
│   ├── resize-dialogs.ts
│   ├── ribbon.ts
│   ├── select-data-dialog.ts
│   ├── selection-checkpoint.ts
│   ├── selection-modes.ts
│   ├── settings.ts
│   ├── shape-clipboard.ts
│   ├── sheet-binding-dialog.ts
│   ├── sheet-operations.ts
│   ├── sheet-view-state.ts
│   ├── slicer-connections-dialog.ts
│   ├── slicer-dialog.ts
│   ├── sort-dialog.ts
│   ├── sparkline-dialogs.ts
│   ├── spelling-dialog.ts
│   ├── subtotal-dialog.ts
│   ├── table-autocorrect-options.ts
│   ├── table-click-selection.ts
│   ├── table-design.ts
│   ├── table-dialogs.ts
│   ├── table-progressive-selection.ts
│   ├── total-row-dropdown.ts
│   ├── trace-arrows.ts
│   ├── transient-visual-feedback.ts
│   ├── undo.ts
│   ├── validation-circles.ts
│   ├── validation-tooltip.ts
│   ├── watch-window.ts
│   └── zoom.ts
├── types.ts
└── index.ts                  # Combined store
```

Each slice is independently testable and tree-shakeable.

## Reactive Hooks

**File:** `apps/spreadsheet/src/hooks/settings/use-cell-properties.ts`

React hooks that provide reactive access to document state via the coordinator pattern.

```typescript
// Reactively subscribes to property changes for a cell
function useCellProperties(
  sheetId: string,
  row: number,
  col: number
): {
  properties: CellProperties | undefined;
  format: CellFormat | undefined;
  metadata: CellMetadata | undefined;
};
```

**Architecture:** Following the coordinator pattern, hooks go through `SheetCoordinator`, NOT directly to EventBus.

```
React Component
      │
      ▼
useCellProperties(sheetId, row, col)
      │
      ▼
SheetCoordinator.subscribeToCellPropertyChanges()
      │
      ▼
EventBus (cell:format-changed, cell:metadata-changed)
      │
      ▼
MutationResultHandler (Rust mutation results → EventBus)
```

**Why this matters:** The toolbar uses `useCellProperties` to reactively update when cell formatting changes. Previously, it used `useMemo` with selection as dependency, which only updated on selection changes—not format changes.

## EventBus

**File:** `kernel/src/context/event-bus.ts`

Pub/sub system translating Rust mutation results to semantic events.

```typescript
class EventBus {
  // Subscribe
  on<T>(event: string, handler: (payload: T) => void): () => void;
  onMany(events: string[], handler): () => void;
  onAll(handler: (event: SpreadsheetEvent) => void): () => void;

  // Publish
  emit<T>(event: string, payload: T): void;
  emitBatch(events: Array<{ event: string; payload: unknown }>): void;
}
```

The `onAll` method allows subscribing to all events regardless of type. This is useful for debugging, logging, or features that need to react to any state change.

**Key events:**

| Event                   | Payload                               | Triggered By              |
| ----------------------- | ------------------------------------- | ------------------------- |
| `cell:changed`          | sheetId, row, col, oldValue, newValue | setCellValue              |
| `cell:format-changed`   | sheetId, cells: CellRef[]             | MutationResultHandler |
| `cell:metadata-changed` | sheetId, cells: CellRef[]             | MutationResultHandler |
| `sheet:created`         | sheetId, name                         | createSheet               |
| `sheet:deleted`         | sheetId                               | deleteSheet               |
| `recalc:completed`      | cellsUpdated, errors                  | Calculator bridge         |
| `validation:failed`     | sheetId, row, col, errors             | Schema bridge             |

**Note:** Both `cell:format-changed` and `cell:metadata-changed` are emitted by the MutationResultHandler when Rust mutation results are processed. This ensures consistent reactivity for all non-computational cell data.

## Bridges

**Location:** `kernel/src/bridges/`

Bridges integrate engines without tight coupling.

### Core Bridges

**Compute Bridge** (`compute/`):

- Connects to the Rust compute core (via Tauri IPC on desktop, WASM on web)
- Triggers recalculation using **IdentityDependencyGraph** (CellId-based, stable across structure changes)
- Updates computed values in Rust storage

**Mutation Result Handler** (`mutation-result-handler.ts`):

- Translates Rust mutation results into EventBus events
- Ensures consistent reactivity for all cell data changes

**Schema Bridge** (`schema-bridge.ts`):

- Listens for cell changes
- Validates against column schemas
- Emits validation events

**Pivot Bridge** (`pivot-bridge.ts`):

- Listens for data changes
- Recomputes pivot results

### Feature Bridges

**Table Bridge** (`table-bridge.ts`):

- Integrates table operations with spreadsheet data
- Manages table data source updates

**Locale Input Bridge** (`locale-bridge.ts`):

- Provides locale-aware input normalization
- Handles decimal separators, date formats by culture

### Object Bridges

**Slicer Pivot Bridge** (`slicer-pivot-bridge.ts`):

- Connects slicers to pivot tables
- Handles slicer filtering for pivot data

**Slicer Table Bridge** (`slicer-table-bridge.ts`):

- Connects slicers to tables
- Handles slicer filtering for table data

**Pivot Event Bridge** (`pivot-event-bridge.ts`):

- Event coordination for pivot table operations

## Dependency Graph

**File:** `compute/core/crates/compute-graph/src/lib.rs`

The dependency graph tracks formula relationships for efficient recalculation. Dependencies are keyed by stable CellIds (not positions), so the graph never needs rebuilding on structure changes.

```typescript
class IdentityDependencyGraph {
  // CellId keys are stable - never change on structure operations
  private precedents = new Map<CellId, Set<CellId>>(); // what this cell depends on
  private dependents = new Map<CellId, Set<CellId>>(); // what depends on this cell

  updateFormula(cellId: CellId, formula: IdentityFormula | null): void;
  getEvaluationOrder(changedCellId: CellId): CellId[];
  getPrecedents(cellId: CellId): CellId[];
  getDependents(cellId: CellId): CellId[];
}
```

**Key properties:**

- **Stable keys** - Insert/delete row/col never touches the graph
- **CRDT-compatible** - Structure changes compose correctly under concurrent edits
- **Same approach as Google Sheets**

**See:** [Cell Identity Model](cell-identity.md) for full architecture

## Data Flow Example

### Cell Value Change Flow

```
User types "100" in A1
        │
        ▼
UIStore.commitEdit()
        │
        ▼
Mutations.setCellValue(ctx, 'sheet1', 0, 0, '100')
        │
        ├──▶ Cells.setValue(ctx, sheetId, row, col, value, calcCtx)
        │           │
        │           ├──▶ Grid index lookup: (sheet1, 0, 0) → CellId (or create new UUID v7)
        │           │
        │           └──▶ ComputeBridge → Rust: setCell(cellId, { ...data, r: 100 })
        │
        └──▶ Recalculation.recalculateDependents(ctx, [cellRef])
                    │
                    ├──▶ IdentityDependencyGraph.getEvaluationOrder(cellId)
                    │           │
                    │           └──▶ Returns CellId[] (stable, no shifting!)
                    │
                    └──▶ For each dependent CellId:
                            1. Get IdentityFormula from Rust storage
                            2. Resolve to A1 string (CellId → current position)
                            3. Evaluate formula
                            4. Store result in Rust storage
                            │
                            └──▶ EventBus emits, canvas re-renders
```

### Recalculation Flow

```
Cell "abc" (at A1) changes
        │
        ▼
IdentityDependencyGraph.getEvaluationOrder("abc")
        │
        └──▶ Returns: ["def", "ghi"]  (CellIds of dependent cells)
                │
                ▼
        For each CellId in order:
                │
                ├──▶ lookup.getPosition("def") → { row: 0, col: 1 } (B1)
                │
                ├──▶ Get IdentityFormula: { template: "{0}+10", refs: [{id:"abc"}] }
                │
                ├──▶ resolveFormulaForEval() → "A1+10"
                │
                └──▶ evaluator.evaluate("A1+10") → store result
```

**Key insight:** Dependencies use CellIds (stable), display uses positions (current). The graph never needs rebuilding on structure changes.

## Recalculation Triggers

Recalculation is triggered by the EventBus. The Calculator Bridge listens for events and decides what needs recalculating.

| Event                       | Trigger             | Recalculation Scope                   |
| --------------------------- | ------------------- | ------------------------------------- |
| `cell:changed`              | User edit, API call | Dependents of changed cell            |
| `cells:batch-changed`       | Paste, import       | Dependents of all changed cells       |
| `structure:rows-inserted`   | Insert rows         | No recalc needed (CellIds stable!)    |
| `structure:columns-deleted` | Delete columns      | Re-render only (deleted refs → #REF!) |

### Why Structure Changes Don't Trigger Recalc

With the Cell Identity Model, **structure changes don't require recalculation**:

```
Insert column at B:
1. Position updates: cell.col += 1 for cells at col ≥ 1
2. Formula storage: unchanged (uses CellIds, not positions)
3. Dependency graph: unchanged (uses CellIds, not positions)
4. Display: resolves CellIds to new positions automatically

Result: Only rendering needs to update. No formulas change.
```

This is a major performance win. Structure operations are O(cells in affected range) instead of O(all formulas).

### Volatile Functions

Functions like `NOW()`, `TODAY()`, `RAND()` are marked as volatile and recalculated:

- On workbook open
- On any edit (not just their dependencies)
- On manual "Calculate Now"

## Feature-Based Coordinator Organization

**Location:** `apps/spreadsheet/src/coordinator/` and `apps/spreadsheet/src/systems/`

The coordinator is organized by **user feature**, not by technical abstraction. When "X is broken", look in the relevant feature directory.

```
apps/spreadsheet/src/coordinator/
├── sheet-coordinator.ts      # Slim orchestrator
├── shell-coordinator.ts      # Shell-level coordination
├── factory.ts                # Coordinator factory
├── mutations/                # Mutation files
├── features/                 # Feature coordination wiring
├── actor-access/             # Actor accessors + commands
├── sparklines/               # Sparkline coordination
└── types.ts

apps/spreadsheet/src/systems/           # State machines (XState), distributed by feature
├── grid-editing/             # Grid editing system
├── ink/                      # Ink/drawing system
├── input/                    # Input handling system
├── objects/                  # Floating object system
├── renderer/                 # Renderer system
├── shared/                   # Shared system utilities
└── testing-foundation/       # Testing foundation system
```

**Key insight:** When debugging, start from the feature folder. For example:

- Selection broken? → `features/selection/`
- Can't edit cells? → `features/editing/`
- Paste not working? → `features/clipboard/`

Each feature module exports a `setup*` function that wires up the feature's coordination logic.

## Actor Access Layer

**Location:** `contracts/src/actors/` (interfaces) + `apps/spreadsheet/src/coordinator/actor-access/` (implementations)

The Actor Access Layer provides symmetric access patterns for actor state (XState machines), mirroring the Data Layer (Domain Modules + Mutations):

|                       | READ                  | WRITE     |
| --------------------- | --------------------- | --------- |
| **Data** (Persistent) | Domain Modules        | Mutations |
| **Actor** (Ephemeral) | Accessors / Selectors | Commands  |

### Design Principle: Selectors as Single Primitive

To avoid duplication, **selectors are the single primitive** for extraction logic:

```
Selectors (defined ONCE in contracts)
    |
    +---> Snapshots (compose selectors) - for "give me everything"
    |
    +---> Accessors (wrap selectors + getSnapshot) - for handlers
    |
    +---> useSelector (pass selectors directly) - for hooks
```

### Handlers vs Hooks

| Consumer     | Reads                              | Writes   |
| ------------ | ---------------------------------- | -------- |
| **Handlers** | Accessors (point-in-time)          | Commands |
| **Hooks**    | Selectors + useSelector (reactive) | Commands |

**Handlers** execute once and finish. They ask: "What is the value RIGHT NOW?"

```typescript
export const MOVE_UP: ActionHandler = (deps) => {
  // Point-in-time read via accessor
  const activeCell = deps.accessors.selection.getActiveCell();
  const isEditing = deps.accessors.editor.isEditing();

  if (isEditing) {
    deps.commands.editor.commit('up');
  } else {
    deps.commands.selection.move('up');
  }

  return handled();
};
```

**Hooks** power React components. They ask: "What is the value, and TELL ME WHEN IT CHANGES?"

```typescript
function useSelection() {
  const coordinator = useCoordinator();

  // Reactive read via selector (triggers re-render on change)
  const activeCell = useSelector(coordinator.selectionActor, selectors.selection.activeCell);

  // Commands are same as handlers
  return {
    activeCell,
    setSelection: coordinator.commands.selection.setSelection
  };
}
```

### Scope

| Layer                  | Actor Access                                          |
| ---------------------- | ----------------------------------------------------- |
| Handlers               | MUST use `deps.accessors.*` + `deps.commands.*`       |
| Hooks                  | MUST use `useSelector` + `selectors.*` + `commands.*` |
| Components             | MUST use hooks only                                   |
| Coordinator (internal) | MAY access actors directly (it owns them)             |

### Key Files

| File                                         | Purpose                                  |
| -------------------------------------------- | ---------------------------------------- |
| `contracts/src/actors/selection.ts`          | Selection selectors + accessor interface |
| `contracts/src/actors/editor.ts`             | Editor selectors + accessor interface    |
| `contracts/src/actors/commands.ts`           | All command interfaces                   |
| `apps/spreadsheet/src/coordinator/actor-access/` | Accessor + command implementations       |

The actor access layer is the boundary between handlers and state-machine internals; handlers use commands/accessors instead of reaching into actors directly.

---

## Unified Action System

**Location:** `apps/spreadsheet/src/actions/`

All user actions (keyboard shortcuts, toolbar clicks, context menu, AI commands) flow through a single dispatch mechanism. This eliminates the duplicate implementations that previously existed across different input methods.

```
User Input (keyboard / toolbar / context menu / AI)
        │
        ▼
dispatch(actionType, deps)
        │
        ▼
HANDLER_MAP[actionType](deps)
        │
        ├── handlers/selection/       # Selection handlers (directory)
        ├── handlers/formatting/      # Formatting handlers (directory)
        ├── handlers/fill/            # Fill handlers (directory)
        ├── handlers/ui/              # UI handlers (directory)
        ├── handlers/editor.ts
        ├── handlers/structure.ts
        ├── handlers/clipboard.ts
        ├── handlers/workbook.ts
        ├── handlers/object.ts
        ├── handlers/charts.ts
        ├── handlers/comments.ts
        ├── handlers/conditional-formatting.ts
        ├── handlers/data-analysis.ts
        ├── handlers/drag-drop.ts
        ├── handlers/filter.ts
        ├── handlers/format-painter.ts
        ├── handlers/navigation.ts
        ├── handlers/paste-validation.ts
        ├── handlers/print-export.ts
        ├── handlers/repeat.ts
        ├── handlers/sheets.ts
        ├── handlers/slicer.ts
        ├── handlers/table.ts
        └── handlers/total-row.ts
```

**Usage:**

```typescript
import { dispatch } from '../actions';

// Same dispatch works from any input source
dispatch('TOGGLE_BOLD', { actors, ctx, getActiveSheetId, uiStore });
dispatch('INSERT_ROW_ABOVE', { actors, ctx, getActiveSheetId, uiStore });
dispatch('COPY', { actors, ctx, getActiveSheetId, uiStore });
```

**Benefits:**

1. **Single source of truth** - Action logic defined once
2. **Consistent behavior** - Same action behaves identically from any input
3. **Easy testing** - Test handlers in isolation
4. **Easy extension** - Add new input methods without duplicating logic

## Implementation Files

| File                                                           | Purpose                               |
| -------------------------------------------------------------- | ------------------------------------- |
| `kernel/src/context/kernel-context.ts`                         | DocumentContext factory                |
| `kernel/src/context/types.ts`                                  | DocumentContext interface & types      |
| `kernel/src/domain/`                                           | 30+ domain modules                    |
| `kernel/src/api/index.ts`                                      | Public API facade for consumers       |
| `apps/spreadsheet/src/coordinator/mutations/`                  | Mutations layer                       |
| `apps/spreadsheet/src/coordinator/factory.ts`                  | Coordinator factory                   |
| `kernel/src/document/rust-document.ts`                         | RustDocument lifecycle, ComputeBridge |
| `apps/spreadsheet/src/ui-store/`                               | UI state slices (Zustand)             |
| `kernel/src/context/event-bus.ts`                              | Pub/sub system                        |
| `kernel/src/bridges/mutation-result-handler.ts`                | Mutation results → EventBus integration |
| `kernel/src/bridges/compute/`                                  | Compute core integration              |
| `kernel/src/bridges/locale-bridge.ts`                          | Locale-aware input normalization      |
| `kernel/src/bridges/pivot-bridge.ts`                           | Pivot table computation               |
| `kernel/src/bridges/pivot-event-bridge.ts`                     | Pivot event coordination              |
| `kernel/src/bridges/schema-bridge.ts`                          | Schema validation                     |
| `kernel/src/bridges/slicer-pivot-bridge.ts`                    | Slicer-pivot integration              |
| `kernel/src/bridges/slicer-table-bridge.ts`                    | Slicer-table integration              |
| `kernel/src/bridges/table-bridge.ts`                           | Table integration                     |
| `apps/spreadsheet/src/actions/`                                | Unified Action System (handlers/)     |
| `apps/spreadsheet/src/systems/`                                | State machines (XState) by feature    |
| `compute/core/crates/compute-graph/src/lib.rs`                | CellId-based dependency tracking (Rust) |
| `contracts/src/kernel/kernel-context.ts`                       | IDomainContext, IKernelContext interfaces |
| `contracts/src/actions/`                                       | Action type definitions               |

## References

- [Cell Identity Model](cell-identity.md) - Why CellIds, not positions
- [Data Model](data-model.md) - Rust/Yrs storage structure
