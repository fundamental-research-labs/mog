# Spreadsheet Engine Architecture

## Layer Diagram

```
┌──────────────────────────────────────────────────────────────────────────┐
│  APPLICATION: apps/spreadsheet (React + Canvas + systems)               │
├──────────────────────────────────────────────────────────────────────────┤
│  SHELL / RUNTIME: shell │ runtime/sdk │ runtime/embed │ spreadsheet-app │
├──────────────────────────────────────────────────────────────────────────┤
│  UNIFIED API: Workbook/Worksheet (kernel/src/api/) ← app data writes   │
├──────────────────────────────────────────────────────────────────────────┤
│  STATE: DocumentContext │ Workbook/Worksheet │ UIStore │ EventBus       │
├──────────────────────────────────────────────────────────────────────────┤
│  SERVICES: undo/checkpoints │ workbook links │ testing │ capabilities   │
├──────────────────────────────────────────────────────────────────────────┤
│  COMPUTE:  compute-core (Rust workspace) │ table-engine (TS)            │
│  GRAPHICS: charts │ canvas/* │ grid-canvas │ spatial │ math-engine     │
│  DRAWING:  canvas/drawing/ (engine│shapes│ink│diagram│text-effects│geometry)│
│  FILE I/O: xlsx/ (parser=Rust, bridge=TS) │ ooxml-types │ print-export │
├──────────────────────────────────────────────────────────────────────────┤
│  BASE: contracts + types/* packages                                      │
└──────────────────────────────────────────────────────────────────────────┘
```

## Key Packages

The system spans pnpm workspaces and Rust workspace crates declared in `pnpm-workspace.yaml` and `Cargo.toml`. The most important source packages are listed here; see [packages.md](packages.md) for the broader package map.

**Base & Types**

| Package | Purpose | Key File |
|---------|---------|----------|
| `contracts` | Shared TypeScript interfaces | `contracts/src/index.ts` |

**Compute**

| Package | Purpose | Key File |
|---------|---------|----------|
| `compute-core` | Rust compute engine and workspace facade: formula evaluation, dependency graph, recalc, tables, pivots, conditional formatting, storage, security, import/export | `compute/core/src/lib.rs` |
| `@mog-sdk/wasm` (`compute-core-wasm` crate) | WASM bindings for browser runtimes | `compute/wasm/src/lib.rs` |
| `compute-core-napi` | Node native bindings for the compute engine | `compute/napi/src/lib.rs` |
| `cell-types`, `value-types`, `formula-types`, `workbook-types`, `snapshot-types` | Rust foundation types for identities, values, formulas, workbook settings, and snapshots | `compute/core/crates/types/` |
| `compute-parser` | Formula parser (winnow): formula string → AST | `compute/core/crates/compute-parser/src/lib.rs` |
| `compute-functions` | 512+ Excel-compatible pure functions | `compute/core/crates/compute-functions/src/lib.rs` |
| `compute-formats` | Number format engine: locale, color, currency patterns | `compute/core/crates/compute-formats/src/lib.rs` |
| `compute-table` | Table engine: filters, sort, slicers, structured refs | `compute/core/crates/compute-table/src/lib.rs` |
| `compute-pivot` | Pivot table engine: aggregation, grouping, show-values-as | `compute/core/crates/compute-pivot/src/lib.rs` |
| `compute-cf` | Conditional formatting evaluation | `compute/core/crates/compute-cf/src/lib.rs` |
| `compute-stats` | Shared analytics: aggregation, sorting, value semantics, statistics, regression, KDE | `compute/core/crates/compute-stats/src/lib.rs` |
| `compute-wire` | Binary wire format for viewport and mutation transfer | `compute/core/crates/compute-wire/src/lib.rs` |
| `table-engine` | TS table filtering/sorting (bridges to kernel) | `table-engine/src/` |

**Graphics & Rendering**

| Package | Location | Purpose | Key File |
|---------|----------|---------|----------|
| `charts` | `charts/` | Chart rendering engine | `charts/src/core/chart-engine.ts` |
| `spatial` | `canvas/spatial/` | Spatial indexing and hit testing for canvas objects | `canvas/spatial/src/` |
| `math-engine` | `typeset/math-engine/` | Equation/math rendering (LaTeX/OMML) | `typeset/math-engine/src/` |

**Canvas packages** (5-package architecture under `canvas/` + composition facade):

| Package | Location | Purpose | Key File |
|---------|----------|---------|----------|
| `canvas-engine` | `canvas/engine/` | Generic multi-canvas render loop, priority scheduler, input capture | `canvas/engine/src/` |
| `grid-renderer` | `canvas/grid-renderer/` | Cell, background, selection, and header layers + viewports, coordinates, features | `canvas/grid-renderer/src/` |
| `drawing-canvas` | `canvas/drawing-canvas/` | Floating object scene graph and renderers | `canvas/drawing-canvas/src/` |
| `canvas-overlay` | `canvas/overlay/` | Screen-space UX chrome (handles, guides, ink) | `canvas/overlay/src/` |
| `grid-canvas` | `canvas/grid-canvas/` | Thin composition facade: GridRenderer + viewport layout + cell-style-bridge + CSS variables | `canvas/grid-canvas/src/` |

**Drawing packages** (all under `canvas/drawing/`):

| Package | Location | Purpose | Key File |
|---------|----------|---------|----------|
| `drawing-engine` | `canvas/drawing/engine/` | Drawing/rendering operations | `canvas/drawing/engine/src/` |
| `shape-engine` | `canvas/drawing/shapes/` | 2D shape manipulation | `canvas/drawing/shapes/src/` |
| `ink-engine` | `canvas/drawing/ink/` | Pen/ink input and rendering | `canvas/drawing/ink/src/` |
| `diagram` | `canvas/drawing/diagram/` | Diagram engine | `canvas/drawing/diagram/src/` |
| `text-effects-engine` | `canvas/drawing/text-effects/` | Text-effects styling/rendering | `canvas/drawing/text-effects/src/` |
| `geometry` | `canvas/drawing/geometry/` | Geometric calculations | `canvas/drawing/geometry/src/` |

**File I/O**

| Package | Purpose | Key File |
|---------|---------|----------|
| `xlsx/parser` | Rust/WASM high-perf XLSX parser (read + write) | `file-io/xlsx/parser/src/lib.rs` |
| `xlsx/bridge` | TS types, progress/cancellation helpers, and worker orchestration for XLSX workflows | `file-io/xlsx/bridge/src/index.ts` |
| `xlsx-api` | Rust XLSX bridge/API layer used by compute import/export | `file-io/xlsx-api/src/lib.rs` |
| `csv-parser` | Rust CSV parser feeding the same import hydration path | `file-io/csv-parser/src/lib.rs` |
| `ooxml-types` | Shared OOXML vocabulary (enums, structs) — zero-dep Rust leaf crate | `file-io/ooxml/types/src/lib.rs` |
| `print-export` | Print & PDF | `file-io/print-export/src/html/table-generator.ts` |

**Bridges** (kernel/src/bridges/)

| Bridge | Purpose | Key File |
|--------|---------|----------|
| `ComputeBridge` | Composition root for Rust compute transport, generated methods, lifecycle, mutation handling, and viewport fetches | `kernel/src/bridges/compute/compute-bridge.ts` |
| Domain bridges | Kernel integrations for schema, table, pivot, slicer, locale, and event relay concerns | `kernel/src/bridges/schema-bridge.ts`, `kernel/src/bridges/table-bridge.ts`, `kernel/src/bridges/pivot-bridge.ts` |
| `compute-wire` | Binary wire format for viewport & mutation transfer (Rust crate) | [README](../../../compute/core/crates/compute-wire/README.md), [Pipeline](renderer/binary-wire-pipeline.md) |

**Runtime & Application**

| Package | Purpose | Key File |
|---------|---------|----------|
| `kernel` | Core runtime, domain modules, unified Workbook/Worksheet API | `kernel/src/api/workbook/workbook-impl.ts` |
| `shell` | Shell host, app launcher, platform services, and React integration | `shell/src/` |
| `apps/spreadsheet` | Spreadsheet app (coordination, actions, systems, UI store) | `apps/spreadsheet/src/coordinator/sheet-coordinator.ts` |
| `runtime/sdk` | Node/headless SDK entry points and boot lifecycle | `runtime/sdk/src/boot.ts` |
| `runtime/embed` | Public embed/Web Component package | `runtime/embed/src/index.ts` |
| `runtime/spreadsheet-app` | Full spreadsheet app runtime package | `runtime/spreadsheet-app/src/index.tsx` |

**Supporting Areas**

| Area | Purpose | Key File |
|------|---------|----------|
| `kernel/src/services/checkpoint` | Workbook checkpoints and restore orchestration | `kernel/src/services/checkpoint/index.ts` |
| `kernel/src/services/undo` | Undo/redo service backed by Rust history | `kernel/src/services/undo/index.ts` |
| `runtime/spreadsheet-testing` | Spreadsheet assertion and test-runner framework | `runtime/spreadsheet-testing/src/testing-framework.ts` |
| `types/connections` / `contracts/src/connections` | Public connection/query contracts | `types/connections/src/index.ts`, `contracts/src/connections/index.ts` |


## State Architecture

Rust owns persistent workbook state. The TypeScript side wraps it with document lifecycle, public APIs, app coordination, and ephemeral UI state:

```
┌────────────────────┐   ┌────────────────────┐   ┌────────────────────┐
│ Rust compute-core  │◀─▶│   ComputeBridge    │◀─▶│  DocumentContext   │
│ (persistent state) │   │ (transport/events) │   │ (kernel services)  │
└────────────────────┘   └─────────┬──────────┘   └─────────┬──────────┘
                                   │                        │
                          ┌────────▼────────┐      ┌────────▼────────┐
                          │ Workbook /      │      │ UIStore +       │
                          │ Worksheet API   │      │ coordinator     │
                          └────────┬────────┘      └────────┬────────┘
                                   │                        │
                              ┌────▼────────────────────────▼────┐
                              │              EventBus             │
                              └───────────────────────────────────┘
```

**Key files:**

- `kernel/src/bridges/compute/compute-bridge.ts` - Compute transport composition root
- `kernel/src/document/rust-document.ts` - Provider protocol and document lifecycle integration
- `kernel/src/context/kernel-context.ts` - DocumentContext and services wiring
- `kernel/src/api/workbook/workbook-impl.ts` - Unified Workbook implementation
- `apps/spreadsheet/src/coordinator/sheet-coordinator.ts` - App system composition
- `apps/spreadsheet/src/ui-store/` - UI state slices (Zustand)
- `kernel/src/context/event-bus.ts` - Pub/sub for `cell:changed`, etc.

## Data Model

Persistent workbook state lives in Rust compute-core and is accessed through `ComputeBridge` transports (WASM in browser embeds, N-API/headless transports in Node, and bridge transports in hosted environments). The Rust engine owns cell storage, formula evaluation, dependency tracking, recalculation, workbook settings, sheet state, objects, tables, pivots, comments, filters, protection, and import/export state.

```
Rust compute-core (storage engine)
├── workbook: sheet order, styles, settings, properties, theme, named ranges
├── sheets: per-sheet storage
│   └── {sheetId}:
│       ├── cells (values, formulas, positions)
│       ├── formats, metadata, validation, schemas
│       ├── row/column dimensions, merges, filters, tables
│       ├── charts, drawings, comments, sparklines, pivots
│       └── sheet metadata (name, visibility, settings, print)
├── undo history, checkpoints, collaboration/provider sync state
└── XLSX/CSV import-export hydration and serialization paths
```

See: [data-model.md](data-model.md) for full schema.

## Current Foundation Surfaces

| Foundation    | Purpose                 | Enables                                  |
| ------------- | ----------------------- | ---------------------------------------- |
| Cell Metadata | Per-cell key-value data | Provenance, validation errors, staleness |
| Event Bus     | Pub/sub for changes     | Reactive UI, self-healing, webhooks      |
| Type System   | Schema validation       | Typed cells, API generation, Monte Carlo |
| Undo / Checkpoints | Rust-backed history and checkpoint restore | Undo/redo, restore points, selection recovery |
| Testing       | Cell assertions         | Spreadsheet unit tests, CI/CD            |
| Connections   | Connection and query contracts | External data integration surfaces       |

## Data Flow

```
User Edit → dispatch() → Workbook/Worksheet API → ComputeBridge → Rust
                                    │
                                    ├─▶ MutationResultHandler → EventBus events
                                    │       │
                                    │       ├─▶ ComputeBridge → Rust (recalc)
                                    │       ├─▶ SchemaBridge (validate)
                                    │       └─▶ Viewport binary buffers → Canvas
                                    │
                                    └─▶ Collaboration sync → Other clients
```

App data writes flow through the unified `Workbook`/`Worksheet` API, which enforces write gates, protection checks, undo grouping, recalculation, and event emission. Render paths use explicit synchronous read surfaces such as `Worksheet.viewport`; kernel internals and domain bridges may call `ComputeBridge` directly.

## Unified Spreadsheet API

All programmatic access to the spreadsheet engine — from headless agents, LLM-generated code, shell-hosted apps, and the browser app — goes through the unified `Workbook`/`Worksheet` API.

**Location**: `kernel/src/api/`

```
kernel/src/api/
├── app/                      # App-level kernel API (bindings, capabilities)
├── document/                 # Document factory
├── internal/                 # Shared internals (address-resolver, utils, introspection)
├── namespaces/               # Namespace helpers (cells, records, sheets)
├── workbook/                 # Workbook implementation and sub-APIs
│   ├── workbook-impl.ts      #   WorkbookImpl — the one Workbook implementation
│   ├── create-workbook.ts    #   Public async createWorkbook() dispatcher
│   ├── sheets.ts, names.ts, history.ts, scenarios.ts
│   ├── protection.ts, security.ts, properties.ts
│   ├── table-styles.ts, cell-styles.ts, pivot-styles.ts
│   ├── slicers.ts, slicer-styles.ts, timeline-styles.ts
│   ├── functions.ts, notifications.ts, theme.ts, viewport.ts
│   ├── changes.ts, diagnostics.ts
│   ├── operations/
│   │   ├── sheet-crud-operations.ts
│   │   └── scenario-operations.ts
│   └── index.ts              #   Barrel export
├── worksheet/                # Worksheet implementation and sub-APIs
│   ├── worksheet-impl.ts     #   WorksheetImpl — the one Worksheet implementation
│   ├── formats.ts, layout.ts, view.ts, structure.ts
│   ├── charts.ts, objects.ts, diagrams.ts
│   ├── tables.ts, filters.ts, pivots.ts, slicers.ts
│   ├── comments.ts, hyperlinks.ts, sparklines.ts
│   ├── validation.ts, conditional-formats.ts, form-controls.ts
│   ├── changes.ts, custom-properties.ts, names.ts, styles.ts
│   ├── print.ts, protection.ts, settings.ts, bindings.ts, what-if.ts
│   ├── collections/          #   Typed object collection implementations
│   ├── handles/              #   Floating object handle implementations
│   ├── operations/           #   Shared worksheet operation modules
│   └── index.ts              #   Barrel export
└── index.ts                  # Public exports: createWorkbook, types, namespace APIs
```

**Factory**:

```typescript
import { createWorkbook, type WorkbookConfig } from '@mog-sdk/kernel/api';

const wb = await createWorkbook({
  ctx,
  stateProvider,
  eventBus,
} satisfies WorkbookConfig);
const ws = wb.getActiveSheet();
```

**Address overload pattern**: Cell/range methods that accept addresses support A1 strings and numeric row/col overloads. The `address-resolver.ts` utility discriminates at runtime:

```typescript
await ws.setCell("A1", "Hello");       // A1 string → parsed to (0, 0)
await ws.setCell(0, 0, "Hello");       // Numeric → zero-cost passthrough
await ws.getRange("A1:B2");            // A1 range string
await ws.getRange(0, 0, 1, 1);         // Numeric bounds
```

**Namespaced sub-APIs**: Domain-specific operations are grouped into readonly namespace accessors instead of flat methods. Core cell I/O stays on the root (`ws.setCell()`, `ws.getRange()`). Other operations live in namespaces that match their domain:

```typescript
// Worksheet namespaces and sync read surfaces
ws.formats.set("A1", { bold: true });
ws.structure.insertRows(0, 5);
ws.charts.add(config);
ws.tables.list();
ws.filters.apply(range, criteria);
ws.protection.protect("password");
ws.view.freezeRows(2);
ws.comments.add(0, 0, { text: "Note" });
ws.validations.set(range, rule);
ws.layout.setColumnWidth(0, 120);
ws.conditionalFormats.add([range], [rule]);
ws.hyperlinks.set("A1", "https://example.com");
ws.outline.groupRows(0, 5);
ws.objects.remove(objectId);
ws.shapes.add(config);
ws.pictures.add(config);
ws.pivots.add(config);
ws.slicers.add(config);
ws.sparklines.addGroup(config);
ws.print.setSettings(config);
ws.settings.getSheetSettings();
ws.bindings.isProjectedPosition(row, col);
ws.formControls.add(config);
ws.diagrams.add(config);
ws.whatIf.goalSeek("B5", 0, "B1");
ws.changes.track();
ws.viewport.getCellData(row, col);

// Workbook namespaces and workbook-level services
wb.sheets.add("Sales");
wb.names.add("total", "Sheet1!A1:A10");
wb.history.undo();
wb.tableStyles.add("CustomTableStyle", config);
wb.cellStyles.add("Input", format);
wb.functions.invoke("SUM", "A1:A10");
wb.scenarios.add(config);
wb.protection.protect("password");
wb.security.addPolicy(policy);
wb.notifications.info("Saved");
wb.viewport.createRegion(sheetId, bounds);
wb.theme.getWorkbookTheme();
wb.changes.track();
wb.diagnostics.getFormulaReferences();
wb.links.list();
wb.records.query(tableId);
```

Sub-API objects are lazy — created on first property access via `get`. Zero cost if unused. Each sub-API class delegates to operation modules or directly to `ComputeBridge`/kernel services as appropriate; the namespaces are an organizational layer over the same Rust-owned state.

**Interfaces** are re-exported from `contracts/src/api/worksheet/` and `contracts/src/api/workbook/`; source interface definitions live in `types/api/src/api/`. **Implementations** are in `kernel/src/api/worksheet/` and `kernel/src/api/workbook/`.

**Delegation pattern**: Sub-API impl classes delegate to shared operation modules in `kernel/src/api/worksheet/operations/` and `kernel/src/api/workbook/operations/`, or to focused kernel services. Operation modules are kernel-internal — consumers never import them directly.

**Key design decisions**:

| Decision | Rationale |
|----------|-----------|
| Errors throw, not `OperationResult` | Simpler for LLM code generation (`try/catch` beats `.success` checks) |
| `getSheetById()` is sync; `getSheet()`/`getSheetByIndex()` are async | ID-based callers get referentially stable worksheet instances; name/index lookups read Rust-backed sheet metadata |
| `undoGroup()` groups undo | Wraps operations in `beginUndoGroup/endUndoGroup` |
| No `OperationResult` at API boundary | Public methods throw mapped SDK errors instead of returning success envelopes |

### Consumer Access Patterns

**In React components and hooks** (via action dependencies):

```typescript
// Action handlers receive workbook via deps
const deps = useActionDependencies();
const ws = deps.workbook.getActiveSheet();
await ws.setCell(0, 0, "Hello");

// Group multi-step operations into one undo entry
await deps.workbook.undoGroup(async () => {
  await ws.setCell(0, 0, "Header");
  await ws.formats.set(0, 0, { bold: true });
});
```

**In coordinator/system classes**: Add `workbook: Workbook` to the config interface and plumb from `CoordinatorProvider`.

**In headless Node contexts**:

```typescript
import { createWorkbook } from '@mog-sdk/kernel/api';

const wb = await createWorkbook({ userTimezone: "UTC" });
const ws = wb.getActiveSheet();
await ws.setRange(0, 0, [["Name", "Score"], ["Alice", 100]]);
```

### Approved Infrastructure Exceptions

A small set of infrastructure paths intentionally bypass the high-level data-write API. These are render, bridge, lifecycle, or kernel-service concerns rather than ordinary app data operations.

| Surface | Reason |
|---------|--------|
| `Worksheet.viewport` / binary viewport readers | Sync rendering and chrome reads need zero-async access to visible cell data |
| `Worksheet._internal` and active-cell caches | Formula bar and edit-entry plumbing need scoped synchronous read models |
| Kernel domain bridges (`schema`, `table`, `pivot`, `slicer`, `locale`) | Bridge integration, type conversion, and event relay around Rust state |
| Document lifecycle and import/export hydration | Startup, provider attachment, XLSX/CSV hydration, and durability barriers |
| Floating-object stores and mutators | Object persistence and spatial mutations are backed by ComputeBridge stores |

## Floating Objects / Canvas Object System

The floating objects system separates app-agnostic canvas-object hosting from spreadsheet-specific persistence and anchoring:

- `kernel/src/floating-objects/core/` — Universal hosting operations (z-order, selection, positioning, mutations, grouping, clipboard, events). Zero spreadsheet dependencies.
- `kernel/src/floating-objects/canvas-object-manager.ts` — Generic manager parameterized by `IObjectStore`, `IPositionResolver`, and event bus dependencies.
- `kernel/src/floating-objects/spreadsheet-object-manager.ts` — Spreadsheet facade that delegates writes to `SpreadsheetObjectMutator`, persistence to `ComputeBridgeObjectStore`, and grouping to `core/grouping`.
- `kernel/src/floating-objects/spreadsheet/` — Spreadsheet-specific adapters, including cell-anchor resolution and group/selection bounds.
- `kernel/src/floating-objects/managers/` — Small type-specific factories/utilities for picture and textbox objects.

Key abstraction: `IPositionResolver<TAnchor>` converts app-specific anchors to pixel positions.
New canvas-hosted apps can provide their own `IPositionResolver` and object store to use `CanvasObjectManager` without spreadsheet cell anchors.

## Adding Features

**New Excel function:** `compute/core/crates/compute-functions/src/{category}/` (Rust)
**New event type:** `contracts/src/events.ts`
**New persistent spreadsheet feature:** add Rust storage/commands, expose through `ComputeBridge`, then surface it through kernel API namespaces or services.

## Detailed Documentation

- [README.md](README.md) - Architecture index
- [packages.md](packages.md) - All packages
- [state.md](state.md) - State management
- [data-model.md](data-model.md) - Data model structure
- [foundations.md](foundations.md) - Foundation surfaces
- [renderer/binary-wire-pipeline.md](renderer/binary-wire-pipeline.md) - Binary wire: Rust → IPC → TS → canvas

## Related Docs
