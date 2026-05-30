# OS Architecture

The Spreadsheet OS is a layered system: shell hosts apps, apps own their user experience, kernel owns document state and services, and standalone packages provide compute, rendering, file I/O, and runtime surfaces.

## Layer Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  APPS                                                                        │
│  TypeScript/React app packages loaded by shell                               │
│  Each app owns its chrome (toolbar, navigation, panels, dialogs)             │
├─────────────────────────────────────────────────────────────────────────────┤
│  SHELL                                                                       │
│  ├── Host: Renders apps, provides AppSlot                                    │
│  ├── Components: Reusable UI primitives                                      │
│  ├── Machines: Shell-level focus state                                       │
│  ├── Services: Document, project, platform, and capability contexts          │
│  ├── App-Launcher: App discovery and switching                               │
│  └── Bootstrap: Shell initialization                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│  KERNEL                                                                      │
│  ├── Document: Rust/Yrs CRDT document lifecycle                              │
│  ├── Domain: Cells, sheets, tables, formatting, formulas, etc.               │
│  ├── Services: Clipboard, Undo, Notifications, and more                      │
│  ├── Context: EventBus, KernelContext                                        │
│  ├── Bridges: Connect to compute-core, locale, schema, pivots, slicers       │
│  ├── Selectors: Reactive state selectors                                     │
│  └── API: Workbook, Worksheet, and capability-gated app APIs                 │
├─────────────────────────────────────────────────────────────────────────────┤
│  HARDWARE / RUNTIME PACKAGES                                                 │
│  Standalone compute, rendering, file I/O, and runtime packages               │
│  Compute:   compute-core (Rust) │ compute-api │ compute/wasm │ compute/napi │
│             compute/pyo3 │ table-engine │ compute-formats                   │
│  Canvas:    canvas/engine │ canvas/grid-renderer │ canvas/grid-canvas        │
│             canvas/drawing-canvas │ canvas/overlay │ canvas/spatial           │
│  Drawing:   canvas/drawing (shapes, geometry, ink, diagram, text-effects)    │
│  Charts:    charts                                                           │
│  File I/O:  file-io                                                          │
│  Runtime:   runtime/sdk │ runtime/embed │ runtime/spreadsheet-app            │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Architectural Decisions

### 1. Kernel APIs by Consumer

External SDK and infrastructure code use the unified Workbook/Worksheet API:

```typescript
const wb = await createWorkbook(options);
const ws = await wb.getSheet("Sheet1");

// Workbook-level: sheets, styles, names, history
await wb.sheets.add("Sales");
await wb.history.undo();

// Worksheet-level: cells, tables, formatting, charts, pivots, etc.
await ws.setCell("A1", 42);
await ws.tables.add("A1:D10", options);
```

Shell-hosted apps receive a capability-gated app API through `AppProps.kernel`:

```typescript
if (kernel.tables?.list) {
  const tables = await kernel.tables.list();
}

if (kernel.records?.list) {
  const records = await kernel.records.list(tableId);
}
```

### 2. Apps Own Their Chrome

Shell provides hosting and reusable UI primitives. Apps compose them with their own chrome:

```typescript
// Spreadsheet app owns toolbar, formula bar, sheet tabs
function SpreadsheetApp() {
  return (
    <>
      <ToolbarContainer />   {/* App-owned */}
      <FormulaBarContainer />{/* App-owned */}
      <SpreadsheetGrid />    {/* App-owned grid over canvas packages */}
      <TabStrip />           {/* App-owned */}
      <StatusBar />          {/* App-owned */}
    </>
  );
}
```

### 3. System Services in Kernel

| Service       | Data                   | Location | Rendering              |
| ------------- | ---------------------- | -------- | ---------------------- |
| Clipboard     | Payload, state machine | Kernel   | Apps handle paste      |
| Undo          | Rust compute-core state | Kernel   | Apps show button       |
| Notifications | Toast queue            | Kernel   | App/shell UI renders   |

### 4. Machine Placement by Scope

| Scope         | Location               | Examples                                 |
| ------------- | ---------------------- | ---------------------------------------- |
| App-specific  | App (spreadsheet)      | selectionMachine, editorMachine, clipboardMachine, paneFocusMachine |
| Shell-level   | Shell (machines)       | focusMachine                             |
| Kernel-level  | Kernel (services)      | Clipboard, Undo, Notifications           |
| Focus/routing | Shell + app input systems | focusMachine, paneFocusMachine        |

**The test**: "Does this state need to survive switching apps?"

- Yes → Kernel service
- No → App or Shell

### 5. Configurable View Components

GridCanvas exposes preset and feature props for apps that embed the grid view:

```typescript
<GridCanvas
  workbook={workbook}
  config={viewConfig}
  preset="full" // also: "embedded", "readonly"
  features={{ contextMenu: false, keyboard: true }}
/>
```

## Data Flow

```
User Action (keyboard, click, etc.)
        │
        ▼
[1] Shell routes to focused app
        │
        ▼
[2] App handles action, calls Workbook/Worksheet or gated app API
        │
        ▼
[3] Kernel mutation calls compute bridge; Rust mutates Yrs and recalculates
        │
        ├──▶ [4] MutationResultHandler patches state and emits events
        │         │
        │         ├──▶ EventBus subscribers
        │         ├──▶ Bridges (validation, pivots, slicers, charts, etc.)
        │         └──▶ App hooks/views (re-render or invalidate)
        │
        └──▶ [5] RustDocument fans update_v1 to providers / collab sidecars
```

## Abstraction Levels

Not all data needs full typing. Users can work at any level:

| Level | What Exists     | Use Case                               | API         |
| ----- | --------------- | -------------------------------------- | ----------- |
| 0     | Sheet + Cells   | Quick calculations, scratch work       | `Worksheet.*` / gated `cells` |
| 1     | Table (untyped) | Data with headers, no type enforcement | `Worksheet.tables` / app `tables` |
| 2     | Table + Schema  | Typed columns with constraints         | App `columns` |
| 3     | Records         | Rows as entities, relations, views     | `Workbook.records` / app `records` |

Each level builds on the previous. You can always drop down.

## Cross-App Operations

### Clipboard

```typescript
// Copy selection
kernel.clipboard?.copy?.(payload);

// Read payload for the target view to paste
const payload = kernel.clipboard?.getPayload?.();
```

### Undo/Redo

```typescript
// Works across the application
await kernel.undo?.undo(); // Cmd+Z
await kernel.undo?.redo(); // Cmd+Shift+Z
```

## Detailed Documentation

| Document                               | Purpose                         |
| -------------------------------------- | ------------------------------- |
| [kernel.md](kernel.md)                 | Kernel APIs and system services |
| [shell.md](shell.md)                   | Shell views and UI components   |
| [apps.md](apps.md)                     | App structure (spreadsheet)     |
| [packages.md](packages.md)             | All packages                    |
