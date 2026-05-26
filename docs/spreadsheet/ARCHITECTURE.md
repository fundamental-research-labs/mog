# Spreadsheet Engine Architecture

## Layer Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│  APPLICATION: engine (React + Canvas + Workers)                        │
├──────────────────────────────────────────────────────────────────────────┤
│  SHELL / KERNEL: shell │ kernel │ server                               │
├──────────────────────────────────────────────────────────────────────────┤
│  UNIFIED API: Workbook/Worksheet (kernel/src/api/) ← all writes here   │
├──────────────────────────────────────────────────────────────────────────┤
│  STATE: RustDocument │ SpreadsheetStore │ UIStore │ EventBus            │
├──────────────────────────────────────────────────────────────────────────┤
│  FOUNDATIONS: versioning │ testing │ connections                        │
├──────────────────────────────────────────────────────────────────────────┤
│  COMPUTE:  compute-core (Rust, 22 crates) │ table-engine (TS)           │
│  GRAPHICS: charts │ canvas/* │ grid-canvas │ math-engine                │
│  DRAWING:  canvas/drawing/ (engine│shapes│ink│diagram│text-effects│geometry)│
│  FILE I/O: xlsx/ (parser=Rust, bridge=TS) │ ooxml-types │ print-export │
│  OTHER:    number-formats                                              │
├──────────────────────────────────────────────────────────────────────────┤
│  BASE: contracts (types only)                                            │
└──────────────────────────────────────────────────────────────────────────┘
```

## Key Packages (80+ total)

The system spans 80+ packages (41 TS + 40+ Rust crates). The most important are listed here; see [packages.md](packages.md) for the full list.

**Base & Types**

| Package | Purpose | Key File |
|---------|---------|----------|
| `contracts` | Shared TypeScript interfaces | `src/index.ts` |

**Compute**

| Package | Purpose | Key File |
|---------|---------|----------|
| `compute-core` | Rust engine: 22 crates — types (4: cell-types, formula-types, snapshot-types, value-types), parser, functions, graph, formats, schema, stats, charts, CF, pivot, table, solver, collab, document, wire, fill, layout-index, text-measurement | `src/lib.rs` |
| `@mog-sdk/wasm` (`compute-core-wasm` crate) | WASM bindings for web (mirrors Tauri IPC API) | `src/lib.rs` |
| `compute-types` | Foundation types: CellValue, CellId, SheetId, RangePos | `src/lib.rs` |
| `compute-parser` | Formula parser (winnow): formula string → AST | `src/lib.rs` |
| `compute-functions` | 508+ Excel-compatible pure functions | `src/lib.rs` |
| `compute-formats` | Number format engine: locale, color, currency patterns | `src/lib.rs` |
| `compute-table` | Table engine: filters, sort, slicers, structured refs | `src/lib.rs` |
| `compute-pivot` | Pivot table engine: aggregation, grouping, show-values-as | `src/lib.rs` |
| `compute-cf` | Conditional formatting evaluation | `src/lib.rs` |
| `compute-stats` | Shared analytics: aggregation, sorting, value semantics, statistics, regression, KDE | `src/lib.rs` |
| `table-engine` | TS table filtering/sorting (bridges to kernel) | `src/` |

**Graphics & Rendering**

| Package | Location | Purpose | Key File |
|---------|----------|---------|----------|
| `charts` | `charts/` | Chart rendering engine | `src/core/chart-engine.ts` |
| `math-engine` | `typeset/math-engine/` | Equation/math rendering (LaTeX/OMML) | `src/` |

**Canvas packages** (5-package architecture under `canvas/` + composition facade):

| Package | Location | Purpose | Key File |
|---------|----------|---------|----------|
| `canvas-engine` | `canvas/engine/` | Generic multi-canvas render loop, priority scheduler, input capture | `src/` |
| `grid-renderer` | `canvas/grid-renderer/` | Cell, background, selection, and header layers + viewports, coordinates, features | `src/` |
| `drawing-canvas` | `canvas/drawing-canvas/` | Floating object scene graph and renderers | `src/` |
| `canvas-overlay` | `canvas/overlay/` | Screen-space UX chrome (handles, guides, ink) | `src/` |
| `grid-canvas` | `canvas/grid-canvas/` | Thin composition facade: GridRenderer + viewport layout + cell-style-bridge + CSS variables | `src/` |

**Drawing packages** (all under `canvas/drawing/`):

| Package | Location | Purpose | Key File |
|---------|----------|---------|----------|
| `drawing-engine` | `canvas/drawing/engine/` | Drawing/rendering operations | `src/` |
| `shape-engine` | `canvas/drawing/shapes/` | 2D shape manipulation | `src/` |
| `ink-engine` | `canvas/drawing/ink/` | Pen/ink input and rendering | `src/` |
| `diagram` | `canvas/drawing/diagram/` | Diagram engine | `src/` |
| `text-effects-engine` | `canvas/drawing/text-effects/` | Text-effects styling/rendering | `src/` |
| `geometry` | `canvas/drawing/geometry/` | Geometric calculations | `src/` |

**File I/O**

| Package | Purpose | Key File |
|---------|---------|----------|
| `xlsx/parser` | Rust/WASM high-perf XLSX parser (read + write) | `src/lib.rs` |
| `xlsx/bridge` | TS bridge: WASM lifecycle, XML/ZIP bridges, worker orchestration | `src/index.ts` |
| `ooxml-types` | Shared OOXML vocabulary (enums, structs) — zero-dep Rust leaf crate | `src/lib.rs` |
| `print-export` | Print & PDF | `src/html/table-generator.ts` |
| `number-formats` | Number formatting | `src/` |

**Bridges** (kernel/src/bridges/)

| Bridge | Purpose | Key File |
|--------|---------|----------|
| `XlsxBridge` | Abstracts Tauri IPC / WASM / N-API for XLSX import/export | `xlsx-bridge.ts` |
| `ComputeBridge` | Abstracts Tauri IPC / WASM / N-API for compute engine (auto-generated via `rust-bridge`) | `compute-bridge.ts` |
| `compute-wire` | Binary wire format for viewport & mutation transfer (Rust crate) | [README](../../compute/core/crates/compute-wire/README.md), [Pipeline](renderer/binary-wire-pipeline.md) |

**Runtime & Application**

| Package | Purpose | Key File |
|---------|---------|----------|
| `kernel` | Core runtime, domain modules, unified Workbook/Worksheet API | `src/api/workbook-impl.ts` |
| `shell` | View adapters, renderers, machines, React components | `src/` |
| `apps/spreadsheet` | Spreadsheet app (coordination, actions, systems, UI store) | `src/coordinator/sheet-coordinator.ts` |
| `runtime/server` | WebSocket collaboration | `src/server.ts` |
| `runtime/src-tauri` | Tauri desktop app shell | `src/main.rs` |

**Foundations**

| Package | Purpose | Key File |
|---------|---------|----------|
| `versioning` | Git-like snapshots & branches | `src/version-manager.ts` |
| `testing` | Spreadsheet unit tests | `src/testing-framework.ts` |
| `connections` | Live data & remote links | `src/connection-manager.ts` |


**Dev Tools**

| Package | Purpose | Key File |
|---------|---------|----------|
| `formula-eval` | Rust formula accuracy evaluator | `src/main.rs` |

## State Architecture

Three-tier state with event-driven reactivity:

```
┌──────────────────┐   ┌──────────────────┐   ┌─────────────┐
│  RustDocument    │   │ SpreadsheetStore │   │   UIStore   │
│  (Rust storage)  │──▶│ (business logic) │   │ (ephemeral) │
└──────────────────┘   └────────┬─────────┘   └─────────────┘
                               │
                        ┌──────▼──────┐
                        │  EventBus   │──▶ All listeners
                        └─────────────┘
```

**Key files:**

- `kernel/src/document/rust-document.ts` - Document lifecycle, ComputeBridge storage
- `apps/spreadsheet/src/ui-store/` - UI state slices (Zustand)
- `kernel/src/context/event-bus.ts` - Pub/sub for `cell:changed`, etc.

## Data Model

All persistent state lives in Rust compute-core, accessed via ComputeBridge (Tauri IPC on desktop, WASM on web). The Rust engine owns cell storage, formula evaluation, dependency tracking, and recalculation.

```
Rust compute-core (storage engine)
├── workbook: sheet order, styles, settings, named ranges
├── sheets: per-sheet storage
│   └── {sheetId}:
│       ├── cells (values, formulas, positions)
│       ├── formats, properties, schemas
│       ├── rowHeights, colWidths, charts
│       └── meta (name, dimensions)
├── versioning (branches, snapshots)
├── testing (assertions, suites)
└── connections (configs, bindings)
```

See: [data-model.md](data-model.md) for full schema.

## 6 Core Foundations

| Foundation    | Purpose                 | Enables                                  |
| ------------- | ----------------------- | ---------------------------------------- |
| Cell Metadata | Per-cell key-value data | Provenance, validation errors, staleness |
| Event Bus     | Pub/sub for changes     | Reactive UI, self-healing, webhooks      |
| Type System   | Schema validation       | Typed cells, API generation, Monte Carlo |
| Versioning    | Snapshots & branches    | Time travel, diff, merge, scenarios      |
| Testing       | Cell assertions         | Spreadsheet unit tests, CI/CD            |
| Connections   | External data sources   | Live data, cross-sheet references        |

## Data Flow

```
User Edit → dispatch() → Workbook/Worksheet API → ComputeBridge → Rust
                                    │
                                    ├─▶ EventBus.emit('cell:changed')
                                    │       │
                                    │       ├─▶ ComputeBridge → Rust (recalc)
                                    │       ├─▶ SchemaBridge (validate)
                                    │       └─▶ Canvas (re-render)
                                    │
                                    └─▶ Collaboration sync → Other clients
```

All data writes flow through the unified `Workbook`/`Worksheet` API, which enforces protection checks, undo grouping, recalculation, and event emission. Domain modules remain available for sync reads (rendering, UI state).

## Unified Spreadsheet API

All programmatic access to the spreadsheet engine — from headless agents, LLM-generated code, OS apps, and the browser app — goes through the unified `Workbook`/`Worksheet` API.

**Location**: `kernel/src/api/`

```
kernel/src/api/
├── app/                      # App-level kernel API (bindings, capabilities)
├── document/                 # Document factory
├── internal/                 # Shared internals (address-resolver, utils, introspection)
├── namespaces/               # Namespace helpers (cells, records, sheets)
├── workbook/                 # Workbook sub-API implementations (9 classes)
│   ├── workbook-impl.ts      #   WorkbookImpl — the one Workbook implementation
│   ├── sheets.ts             #   WorkbookSheetsImpl
│   ├── names.ts              #   WorkbookNamesImpl
│   ├── history.ts            #   WorkbookHistoryImpl
│   ├── styles.ts             #   WorkbookStylesImpl
│   ├── scenarios.ts          #   WorkbookScenariosImpl
│   ├── protection.ts         #   WorkbookProtectionImpl
│   ├── notifications.ts      #   WorkbookNotificationsImpl
│   ├── viewport.ts           #   WorkbookViewportImpl
│   ├── theme.ts              #   WorkbookThemeImpl
│   ├── operations/           #   Operation modules (2 files)
│   │   ├── sheet-crud-operations.ts
│   │   └── scenario-operations.ts
│   └── index.ts              #   Barrel export
├── worksheet/                # Worksheet sub-API implementations (23 classes)
│   ├── worksheet-impl.ts     #   WorksheetImpl — the one Worksheet implementation
│   ├── formats.ts            #   WorksheetFormatsImpl
│   ├── structure.ts          #   WorksheetStructureImpl
│   ├── charts.ts             #   WorksheetChartsImpl
│   ├── tables.ts             #   WorksheetTablesImpl
│   ├── filters.ts            #   WorksheetFiltersImpl
│   ├── comments.ts           #   WorksheetCommentsImpl
│   ├── hyperlinks.ts         #   WorksheetHyperlinksImpl
│   ├── layout.ts             #   WorksheetLayoutImpl
│   ├── objects.ts            #   WorksheetObjectsImpl
│   ├── outline.ts            #   WorksheetOutlineImpl
│   ├── pivots.ts             #   WorksheetPivotsImpl
│   ├── print.ts              #   WorksheetPrintImpl
│   ├── protection.ts         #   WorksheetProtectionImpl
│   ├── settings.ts           #   WorksheetSettingsImpl
│   ├── slicers.ts            #   WorksheetSlicersImpl
│   ├── diagrams.ts          #   WorksheetDiagramsImpl
│   ├── sparklines.ts         #   WorksheetSparklinesImpl
│   ├── validation.ts         #   WorksheetValidationImpl
│   ├── view.ts               #   WorksheetViewImpl
│   ├── bindings.ts           #   WorksheetBindingsImpl
│   ├── conditional-formats.ts#   WorksheetConditionalFormatsImpl
│   ├── form-controls.ts      #   WorksheetFormControlsImpl
│   ├── internal.ts           #   WorksheetInternalImpl (not public API)
│   ├── collections/          #   Collection impl classes (8 classes)
│   ├── handles/              #   Handle impl classes (12 classes)
│   ├── operations/           #   Operation modules (22 files)
│   │   ├── cell-operations.ts
│   │   ├── format-operations.ts
│   │   ├── filter-operations.ts
│   │   ├── ...               #   (22 operation modules total)
│   │   └── types.ts
│   └── index.ts              #   Barrel export
└── index.ts                  # Public exports: createWorkbook, WorkbookImpl, WorksheetImpl
```

**Factory**:

```typescript
import { createWorkbook, type WorkbookConfig } from '@mog/kernel/api';

const wb = createWorkbook({
  ctx,
  getActiveSheetId: () => activeSheetId,
  setActiveSheetId: (id) => { activeSheetId = id; },
  eventBus,
});
const ws = wb.getActiveSheet();
```

**Address overload pattern**: Every cell/range method accepts either A1 strings or numeric row/col. The `address-resolver.ts` utility discriminates at runtime:

```typescript
await ws.setCell("A1", "Hello");       // A1 string → parsed to (0, 0)
await ws.setCell(0, 0, "Hello");       // Numeric → zero-cost passthrough
await ws.getRange("A1:B2");            // A1 range string
await ws.getRange(0, 0, 1, 1);         // Numeric bounds
```

**Namespaced sub-APIs**: Domain-specific operations are grouped into readonly namespace accessors instead of flat methods. Core cell I/O stays on the root (`ws.setCell()`, `ws.getRange()`). Everything else moves to a namespace that matches its domain:

```typescript
// Worksheet namespaces (23 total, including internal)
ws.formats.setFormat("A1", { bold: true });     // was: ws.setFormat(...)
ws.structure.insertRows(0, 5);                   // was: ws.insertRows(...)
ws.charts.add(config);                           // was: ws.addChart(...)
ws.tables.list();                                // was: ws.listTables()
ws.filters.apply(range, criteria);               // was: ws.applyFilter(...)
ws.protection.protect("password");               // was: ws.protect(...)
ws.view.freezeRows(2);                           // was: ws.freezeRows(...)
ws.comments.add(0, 0, "Note");                   // was: ws.addNote(...)
ws.validation.set(range, rule);                  // was: ws.setValidation(...)
ws.layout.setColumnWidth(0, 120);                // was: ws.setColumnWidth(...)
ws.conditionalFormats.add(range, rule);          // was: ws.addConditionalFormat(...)
ws.hyperlinks.set("A1", { url: "..." });         // was: ws.setHyperlink(...)
ws.outline.groupRows(0, 5);                      // was: ws.groupRows(...)
ws.objects.delete(objectId);                     // was: ws.deleteFloatingObject(...)
ws.pivots.add(config);                           // was: ws.addPivotTable(...)
ws.slicers.add(config);                          // slicer operations
ws.sparklines.addGroup(config);                  // sparkline operations
ws.print.setPageSetup(config);                   // print configuration
ws.settings.getSheetSettings();                  // sheet-level settings
ws.bindings.isProjectedPosition(row, col);       // data projection bindings
ws.formControls.add(config);                     // form control operations
ws.diagram.add(config);                          // Diagram operations
// ws.internal (not public — bridge/formula-bar plumbing)

// Workbook namespaces (9 total)
wb.sheets.add("Sales");                          // was: wb.addSheet(...)
wb.names.add("total", "Sheet1!A1:A10");          // was: wb.addNamedRange(...)
wb.history.undo();                               // was: wb.undo()
wb.styles.createTableStyle(config);              // was: wb.createTableStyle(...)
wb.scenarios.add(name, config);                  // scenario management
wb.protection.protect("password");               // workbook-level protection
wb.notifications.send(config);                   // notification operations
wb.viewport.get();                               // viewport operations
wb.theme.get();                                  // theme operations
```

Sub-API objects are lazy — created on first property access via `get`. Zero cost if unused. Each sub-API class delegates to the same operation modules as before; the namespaces are a thin organizational layer.

**Interfaces** are in `contracts/src/api/worksheet/` and `contracts/src/api/workbook/`. **Implementations** are in `kernel/src/api/worksheet/` and `kernel/src/api/workbook/`.

**Delegation pattern**: Sub-API impl classes delegate to thin operation modules in `kernel/src/api/worksheet/operations/` (22 modules) and `kernel/src/api/workbook/operations/` (2 modules). Each module calls `ComputeBridge` and handles `RecalcResult` processing. Operation modules are kernel-internal — consumers never import them directly.

**Key design decisions**:

| Decision | Rationale |
|----------|-----------|
| Errors throw, not `OperationResult` | Simpler for LLM code generation (`try/catch` beats `.success` checks) |
| `getSheet()` is sync | Uses cached sheet metadata, refreshed after sheet mutations |
| `batch()` groups undo | Wraps operations in `beginUndoGroup/endUndoGroup` |
| No `OperationResult` at API boundary | Internal operation modules still return `OperationResult`; `WorksheetImpl` unwraps |

### Consumer Access Patterns

**In React components and hooks** (via action dependencies):

```typescript
// Action handlers receive workbook via deps
const deps = useActionDependencies();
const ws = deps.workbook.getActiveSheet();
await ws.setCell(0, 0, "Hello");

// Batch for multi-step operations (single undo step)
await deps.workbook.batch(async () => {
  await ws.setCell(0, 0, "Header");
  await ws.formats.setFormat(0, 0, { bold: true });
});
```

**In coordinator/system classes**: Add `workbook: Workbook` to the config interface and plumb from `CoordinatorProvider`.

**In headless/server contexts**:

```typescript
import { createWorkbook } from '@mog/kernel/api';

const wb = createWorkbook({ ctx, getActiveSheetId, setActiveSheetId, eventBus });
const ws = wb.getActiveSheet();
await ws.setRange(0, 0, [["Name", "Score"], ["Alice", 100]]);
```

### Approved Infrastructure Exceptions

A small set of app-layer call sites still use `ctx.computeBridge` directly. These are infrastructure concerns, not data operations, and are documented with local `eslint-disable` comments.

| Call Site | Reason |
|-----------|--------|
| viewportBuffer | Sync rendering cache — canvas reads need zero-async access to cell display data |
| CF bridge factory (`getCFStore()`) | Infrastructure wiring pattern, not a data operation |
| metadata cache (CellId resolution) | CellId→position lookup has no public API equivalent |
| sparkline manager | Specialized rendering pipeline, not a data write |
| formula bar A1 display | Sync rendering — must read formula text without async overhead |
| `worker.ts` | Bulk data pipeline: reads all sheet data for web worker init, applies results via batch `setCells`. Performance-critical path where `ws.*` async overhead is unjustified |
| `tables.ts` (`checkCalculatedColumnAutoFill` / `applyCalculatedFormulasToNewRow`) | Deep auto-fill infrastructure using CellId + computeBridge for batch formula writes. Deferred until Rust table engine has complete API |
| `comments.ts` (`createCellPositionLookup`) | Comment machine requires CellId-based operations not available via position-based `ws.*` API |

## Floating Objects / Canvas Object System

The floating objects system has been generalized into a universal canvas object layer:

- `core/` — Universal operations (z-order, selection, positioning, mutations, grouping, clipboard, events). Zero spreadsheet dependencies.
- `managers/` — General type managers (shape, picture, textbox, drawing). Accept IPositionResolver for pluggable positioning.
- `spreadsheet/` — Spreadsheet-specific (CellAnchorResolver, camera, chart, equation, diagram, ole-object managers).
- `CanvasObjectManager<TAnchor>` — Universal manager, parameterized by anchor type.
- `SpreadsheetObjectManager` — Composes CanvasObjectManager<CellAnchor> with spreadsheet-specific managers.

Key abstraction: `IPositionResolver<TAnchor>` converts app-specific anchors to pixel positions.
New apps (Slides, Whiteboard) implement their own IPositionResolver and use CanvasObjectManager directly.

## Adding Features

**New Excel function:** `compute/core/crates/compute-functions/src/{category}/` (Rust)
**New event type:** `contracts/src/events.ts`
**New foundation feature:** Create package, add Rust storage via ComputeBridge, integrate via bridge

## Detailed Documentation

- [README.md](README.md) - Architecture index
- [packages.md](packages.md) - All packages
- [state.md](state.md) - State management
- [data-model.md](data-model.md) - Data model structure
- [foundations.md](foundations.md) - 6 core foundations
- [renderer/binary-wire-pipeline.md](renderer/binary-wire-pipeline.md) - Binary wire: Rust → IPC → TS → canvas

## Related Docs
