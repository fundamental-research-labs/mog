# OS Architecture

The Spreadsheet OS is a layered system where apps build on shell, shell builds on kernel, and kernel coordinates hardware packages.

## Layer Overview

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  APPS                                                                        │
│  TypeScript/React code importing kernel & shell as libraries                 │
│  Each app owns its chrome (toolbar, navigation, panels)                      │
├─────────────────────────────────────────────────────────────────────────────┤
│  WINDOW MANAGER                                                              │
│  ├── Focus: Which app/pane has keyboard focus                                │
│  ├── Keyboard: Route shortcuts to focused app                                │
│  └── Layout: Panel splits, tabs (future)                                     │
├─────────────────────────────────────────────────────────────────────────────┤
│  SHELL                                                                       │
│  ├── Host: Renders apps, provides AppSlot                                    │
│  ├── Components: Reusable UI primitives                                      │
│  ├── Machines: View-specific state (selection, editing)                      │
│  ├── App-Launcher: App discovery and switching                               │
│  └── Bootstrap: Shell initialization                                         │
├─────────────────────────────────────────────────────────────────────────────┤
│  KERNEL                                                                      │
│  ├── Document: Rust/Yrs CRDT document lifecycle                              │
│  ├── Domain: Cells, sheets, tables, formatting, formulas, etc.               │
│  ├── Services: Clipboard, Undo, Notifications, and more                      │
│  ├── Context: EventBus, KernelContext                                        │
│  ├── Bridges: Connect to compute-core, database, pivots, slicers             │
│  ├── Selectors: Reactive state selectors                                     │
│  └── API: App, Workbook, Worksheet namespaces                                │
├─────────────────────────────────────────────────────────────────────────────┤
│  HARDWARE                                                                    │
│  Standalone computation packages (no Yrs, no React)                          │
│  Compute:   compute-core (Rust) │ compute-api │ number-formats              │
│             table-engine                                                     │
│  Canvas:    canvas/engine │ canvas/grid-renderer │ canvas/grid-canvas        │
│             canvas/drawing-canvas │ canvas/overlay │ canvas/spatial           │
│  Drawing:   canvas/drawing (shapes, geometry, ink, diagram, text-effects)    │
│  Charts:    charts                                                           │
│  File I/O:  file-io                                                          │
│  Runtime:   runtime/server │ runtime/sdk                                     │
│  Desktop:   runtime/src-tauri (Rust/Tauri)                                   │
└─────────────────────────────────────────────────────────────────────────────┘
```

## Key Architectural Decisions

### 1. One Kernel API

No simplified "app API" vs "full kernel" split. Apps use the namespaces they need:

```typescript
// App kernel API exposes workbook and worksheet namespaces
const kernel = useKernel();

// Workbook-level: sheets, styles, names, history
kernel.workbook.sheets.list();

// Worksheet-level: cells, tables, formatting, charts, pivots, etc.
kernel.worksheet.setCell(sheetId, row, col, value);
```

### 2. Apps Own Their Chrome

Shell provides reusable view components. Apps compose them with their own chrome:

```typescript
// Spreadsheet app owns toolbar, formula bar, sheet tabs
function SpreadsheetApp() {
  return (
    <>
      <Toolbar />           {/* App-owned */}
      <FormulaBar />        {/* App-owned */}
      <GridCanvas {...} />  {/* From shell */}
      <SheetTabs />         {/* App-owned */}
    </>
  );
}
```

### 3. System Services in Kernel

| Service       | Data                   | Location | Rendering              |
| ------------- | ---------------------- | -------- | ---------------------- |
| Clipboard     | Payload, state machine | Kernel   | Apps handle paste      |
| Undo          | Yrs UndoManager        | Kernel   | Apps show button       |
| Notifications | Toast queue            | Kernel   | Shell renders          |

### 4. Machine Placement by Scope

| Scope         | Location               | Examples                                 |
| ------------- | ---------------------- | ---------------------------------------- |
| App-specific  | App (spreadsheet)      | GridSelectionMachine, GridEditorMachine, ClipboardMachine |
| Shell-level   | Shell (machines)       | FocusMachine                             |
| Kernel-level  | Kernel (services)      | Clipboard, Undo, Notifications           |
| Focus/routing | Shell (machines)       | FocusMachine                             |

**The test**: "Does this state need to survive switching apps?"

- Yes → Kernel service
- No → App or Shell

### 5. Configurable View Components

GridCanvas with feature flags enables different apps to use subsets:

```typescript
<GridCanvas
  kernel={kernel}
  sheetId={activeSheet}
  features={{
    editing: true,
    selection: true,
    formulas: true,      // Spreadsheet: true, Dashboard: false
    formatting: true,    // Spreadsheet: true, Slides: false
    resize: true,
    fill: true,
    collaboration: true,
  }}
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
[2] App handles action, calls Kernel API
        │
        ▼
[3] Kernel mutation writes to Rust/Yrs, emits event
        │
        ├──▶ [4] EventBus notifies subscribers
        │         │
        │         ├──▶ Recalc (formula dependencies)
        │         ├──▶ Bridges (validation, charts, etc.)
        │         └──▶ Shell views (re-render)
        │
        └──▶ [5] Yrs syncs to other clients / IndexedDB
```

## Abstraction Levels

Not all data needs full typing. Users can work at any level:

| Level | What Exists     | Use Case                               | API         |
| ----- | --------------- | -------------------------------------- | ----------- |
| 0     | Sheet + Cells   | Quick calculations, scratch work       | `Cells.*`   |
| 1     | Table (untyped) | Data with headers, no type enforcement | `Tables.*`  |
| 2     | Table + Schema  | Typed columns with constraints         | `Columns.*` |
| 3     | Records         | Rows as entities, relations, views     | `Records.*` |

Each level builds on the previous. You can always drop down.

## Cross-App Operations

### Clipboard

```typescript
// Copy selection
kernel.clipboard.copy(payload);

// Paste into target
kernel.clipboard.paste();
```

### Undo/Redo

```typescript
// Works across the application
kernel.undo.undo(); // Cmd+Z
kernel.undo.redo(); // Cmd+Shift+Z
```

## Detailed Documentation

| Document                               | Purpose                         |
| -------------------------------------- | ------------------------------- |
| [kernel.md](kernel.md)                 | Kernel APIs and system services |
| [shell.md](shell.md)                   | Shell views and UI components   |
| [apps.md](apps.md)                     | App structure (spreadsheet)     |
| [packages.md](packages.md)             | All packages                    |
