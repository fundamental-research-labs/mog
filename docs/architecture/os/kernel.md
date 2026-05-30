# Kernel

The kernel is Mog's TypeScript data and API layer. It owns document lifecycle wiring, the public Workbook/Worksheet API, low-level namespace APIs, app-facing API wrappers, system services, and the EventBus. Spreadsheet mutation and formula recalculation run in Rust compute-core through the `ComputeBridge`; the kernel adapts those results into TypeScript APIs, caches, services, and semantic events.

## Overview

```
kernel/
|-- src/
|   |-- api/                  # createWorkbook, Workbook/Worksheet APIs, namespaces, document, app API
|   |-- bridges/              # Compute bridge, binary wire protocol, feature bridges
|   |-- context/              # Document context factory, EventBus, context wiring
|   |-- document/             # Document lifecycle, providers, host storage/write gates
|   |-- domain/               # Domain helpers for cells, sheets, tables, formatting, objects, etc.
|   |-- services/             # Clipboard, undo, notifications, query, capabilities, filesystem, etc.
|   |-- selectors/            # Reactive state selectors
|   |-- keyboard/             # Keyboard shortcut processing
|   |-- errors/               # Error types and codes
|   |-- floating-objects/     # Document-scoped floating object management
|   |-- storage/              # Public storage subpath
|   `-- security/             # Public security/capability subpath
|-- host-internal/            # Host-only integration surface
`-- __tests__/                # Test suites
```

## API Surface

### Unified Workbook/Worksheet API

`createWorkbook()` is the stable, recommended entry point. It can bootstrap a blank workbook or XLSX source, or bind to an existing kernel context. `WorkbookImpl` and `WorksheetImpl` are implementation details; consumers use the contract interfaces returned by the factory.

```typescript
import { createWorkbook } from '@mog-sdk/kernel';

const wb = await createWorkbook({ userTimezone: 'America/Los_Angeles' });
const ws = wb.activeSheet;

await ws.setCell('A1', 42);
await ws.setCell(0, 1, '=A1*2');
const value = await ws.getCell('B1');

await wb.history.undo();
```

Workbook sub-APIs include sheet management, history, names, scenarios, styles, protection, notifications, theme/style catalogs, workbook links, and viewport regions. Worksheet sub-APIs cover cells/ranges plus charts, comments, filters, formatting, tables, validation, structure, layout, outline, pivots, slicers, sparklines, floating objects, print, view, settings, and related worksheet features.

All modern write operations are async because they call through `ComputeBridge` into Rust and return after mutation/recalculation results have been processed.

### Namespace API

`kernel/src/api/namespaces/` exposes experimental low-level functions for callers that need explicit context passing:

```typescript
import { Cells, Records, Sheets } from '@mog-sdk/kernel/api';

await Cells.setValue(ctx, sheetId, 0, 0, 'Hello');
const data = await Cells.getData(ctx, sheetId, 0, 0);
const name = await Sheets.getName(ctx, sheetId);
const rows = await Records.query(ctx, tableId);
```

These functions take an `IKernelContext`. `Sheets` is primarily metadata and view operations; sheet create/remove/rename/move operations live on the Workbook sheets API so cache updates, events, and receipts stay centralized.

### Document Lifecycle

`DocumentFactory` creates document handles and contexts for monorepo lifecycle code. Public SDK consumers should normally use `createWorkbook()`; document-first integrations can use the document APIs when they need explicit handle disposal.

```typescript
const handle = await DocumentFactory.create({ documentId });
const workbook = await handle.workbook();

await handle.dispose();
```

The context model has four tiers:

| Tier | Interface | Audience |
| ---- | --------- | -------- |
| 1 | `IDomainContext` | Domain modules: event bus and undo labeling |
| 2 | `IKernelContext` | General app code: services, session metadata, lifecycle |
| 3 | `ISpreadsheetKernelContext` | Spreadsheet shell/app: spreadsheet bridges and mirror |
| 4 | `DocumentContext` | Engine internals: compute bridge and viewport buffers |

### Capability-Gated App API

`kernel/src/api/app/` provides infrastructure for future third-party apps. It exposes database-like table, column, record, relation, event, clipboard, undo, and binding APIs over the spreadsheet kernel, then wraps them in capability-gated scoped APIs. The spreadsheet app itself uses the unified Workbook/Worksheet API directly as trusted OS-level code.

App-facing records use opaque IDs (`AppTableId`, `AppColumnId`, `RecordId`) and map internally to spreadsheet table IDs, `ColId`, and row identities or row indices as needed.

## System Services

`IKernelServices` currently exposes four cross-app services on the kernel context:

| Service | Purpose |
| ------- | ------- |
| `clipboard` | Cross-app copy/cut/paste state and canonical payloads |
| `undo` | Undo/redo state and commands backed by Rust compute-core |
| `notifications` | Toast/notification queue |
| `queryExecutor` | External query connection registry, execution, and cache |

Other service directories support capabilities, filesystem permissions, checkpointing, workbook links, security event relay, and table registry integration.

### Clipboard Service

The canonical clipboard payload always has a `cells` block with values and dimensions. Optional table context enables smart paste, and `text`/`html` support external clipboard interoperability.

```typescript
interface IClipboardService {
  getSnapshot(): KernelClipboardSnapshot;
  getPayload(): ClipboardPayload | null;
  copy(payload: ClipboardPayload): void;
  cut(payload: ClipboardPayload): void;
  startPaste(): void;
  completePaste(): void;
  errorPaste(message: string): void;
  clear(): void;
  markStale(): void;
  markFresh(): void;
  subscribe(listener: (snapshot: KernelClipboardSnapshot) => void): CallableDisposable;
  dispose(): void;
}
```

### Undo Service

Undo no longer wraps a Yjs/Yrs undo manager. The service delegates undo/redo to `ComputeBridge`, keeps cached undo state, labels forward mutations, and returns typed `Result<void, UndoError>` values for undo and redo commands.

```typescript
interface IUndoService {
  getState(): UndoServiceState;
  canUndo(): boolean;
  canRedo(): boolean;
  undo(): Promise<Result<void, UndoError>>;
  redo(): Promise<Result<void, UndoError>>;
  clear(): void;
  setNextDescription(description: string): void;
  stopCapturing(): void;
  listDescriptions(): string[];
  notifyForwardMutation(): Promise<void>;
  subscribe(listener: (event: UndoStateChangeEvent) => void): CallableDisposable;
  dispose(): void;
}
```

### Notification Service

Notifications expose direct severity helpers and a subscription API:

```typescript
interface INotificationsService {
  getAll(): Notification[];
  getCount(): number;
  notify(message: string, options?: NotificationOptions): NotificationId;
  info(message: string, options?: Omit<NotificationOptions, 'type'>): NotificationId;
  success(message: string, options?: Omit<NotificationOptions, 'type'>): NotificationId;
  warning(message: string, options?: Omit<NotificationOptions, 'type'>): NotificationId;
  error(message: string, options?: Omit<NotificationOptions, 'type'>): NotificationId;
  dismiss(id: NotificationId): void;
  dismissAll(): void;
  subscribe(listener: (notifications: Notification[]) => void): CallableDisposable;
  dispose(): void;
}
```

## EventBus

The kernel EventBus implements the shared `IEventBus` contract from the event contracts package. It is a typed pub/sub layer over the `SpreadsheetEvent` union:

```typescript
interface IEventBus<TEvent extends { type: string } = SpreadsheetEvent> {
  on<T extends TEvent>(type: T['type'], handler: EventHandler<T>): () => void;
  onMany(types: TEvent['type'][], handler: EventHandler<TEvent>): () => void;
  onAll(handler: AllEventsHandler<TEvent>): () => void;
  emit(event: TEvent): void;
  emitBatch(events: TEvent[]): void;
  clear(): void;
}
```

`MutationResultHandler` is the main gateway from Rust mutation results into semantic events such as `cell:changed`, `cells:batch-changed`, table events, chart events, validation events, structure events, and other domain-specific event families.

## Identity System

The spreadsheet model uses stable identities so references survive structural edits:

| Identity | Answers | Used For |
| -------- | ------- | -------- |
| `CellId` | Which specific cell? | Formula references, comments, validation/filter/table ranges, object anchors |
| `RowId` | Which row? | Row properties, row identity in stable ranges |
| `ColId` | Which column? | Column properties, schema/filter/sort references |
| `SheetId` | Which sheet? | Workbook sheet identity |

The public constructors live in contracts:

```typescript
import { cellId, colId, rowId } from '@mog-sdk/contracts/cell-identity';
import { sheetId } from '@mog-sdk/contracts/core';
```

Formula cell storage keeps both display/export formula text and an `identityFormula` with stable identity references. Rust compute-core owns dependency tracking, formula rewriting, and recalculation from those identities.

## Bridges

Bridges connect the TypeScript kernel to Rust compute-core and other spreadsheet engines/features:

| Bridge area | Purpose | Location |
| ----------- | ------- | -------- |
| Compute | Rust compute-core lifecycle, mutations, queries, recalculation, undo, viewport sync | `bridges/compute/` |
| Wire | Binary viewport and mutation readers for render hot paths | `bridges/wire/` |
| Mutation result | Applies Rust mutation/recalc results, updates caches/mirror, emits EventBus events | `bridges/mutation-result-handler.ts` |
| Locale | Locale-aware input normalization | `bridges/locale-bridge.ts` |
| Schema | Data validation bridge | `bridges/schema-bridge.ts` |
| Table | Table integration and cache invalidation | `bridges/table-bridge.ts` |
| Pivot | Pivot computation and event integration | `bridges/pivot-bridge.ts`, `bridges/pivot-event-bridge.ts` |
| Slicer | Slicer-to-table and slicer-to-pivot filter sync | `bridges/slicer-table-bridge.ts`, `bridges/slicer-pivot-bridge.ts` |

The document context also creates spreadsheet-specific bridges for charts, diagrams, equations, ink recognition, text effects, and the floating object manager from their domain modules.

## React Integration

The spreadsheet app uses the document context hooks in `apps/spreadsheet/src/infra/context`:

```typescript
const wb = useWorkbook();
const ws = useWorksheet();
const eventBus = useEventBus();
```

Shell/app-platform code has separate capability-gated hooks:

```typescript
const { api } = useAppKernel({ appId, fullApi, registry });
const records = useRecords(api, tableId, options);
const columns = useColumns(api, tableId);
```

`useRecords`, `useTables`, `useColumns`, and `useRecord` wrap the gated app API and subscribe to app-level event APIs. They are shell app-data hooks, not the primary spreadsheet UI data path.

## Recalculation

Formula evaluation is Rust-backed through `ComputeBridge`; it is not a separate TypeScript subsystem.

```
Worksheet/API write
        |
        v
ctx.computeBridge.* mutation
        |
        v
Rust compute-core mutates storage and recalculates dirty formulas
        |
        v
MutationResult / RecalcResult returns to ComputeCore
        |
        v
MutationResultHandler updates mirror/caches and emits EventBus events
        |
        v
Workbook, worksheet, shell, bridges, and React hooks observe typed events
```

Identity formulas store stable cell/row/column references, while Rust compute-core remains the source of truth for dependency graph maintenance, formula rewrites, recalculation scheduling, and computed values.
