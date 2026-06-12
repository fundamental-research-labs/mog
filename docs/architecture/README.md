# Architecture

A data operating system built on spreadsheet primitives.

> Status: public architecture orientation. Package manifests, `tools/package-inventory.jsonc`, `pnpm-workspace.yaml`, root `Cargo.toml`, and source-level boundary checks are the source of truth for shipped/public vs workspace-internal surfaces.

## System Layers

```
Runtime         Public facades and host setup (@mog-sdk/sdk, @mog-sdk/embed, @mog-sdk/spreadsheet-app)
Apps            Workspace React apps own product chrome and workflows
Shell/UI        Workspace chrome, focus, session/app composition, and shared UI
Views           Reusable view packages (SheetView shipped; other view packages reserved)
Kernel          Workspace-internal document lifecycle, Workbook/Worksheet API, services, bridges
Hardware        Rust compute/storage, transport, canvas, charts, table/file engines, binary wire
Types           Public contracts plus workspace type shards
```

Allowed imports point downward through types/contracts -> hardware -> kernel -> views -> shell/UI -> apps. Runtime facades sit above that stack and choose host adapters. Lower layers must not import higher layers. `@mog-sdk/spreadsheet-app` is a public bundle-composition package: it uses app/shell/kernel code internally, and `runtime/spreadsheet-app/scripts/check-boundary.mjs` checks that those internals do not leak from public declarations.

**Views layer.** Reusable view components. `@mog-sdk/sheet-view` is the shipped public low-level grid view package. It mounts the canvas/grid stack and binds through a `SheetViewDataSource`, with `createSheetViewDataSourceFromWorkbook()` as the current adapter for Workbook-backed data. The public view boundary does not expose Yrs directly, and it avoids making the canonical kernel Workbook type part of the SheetView package contract.

Kanban, Timeline, Calendar, Gallery, and Chart views exist as workspace app/UI experiments or reserved directions, not as shipped public view packages. A future general `Dataset` abstraction is reserved but not defined; introduce it only when a second public view pressures the boundary. Form-like record input is an input surface, not currently a public dataset projection package.

**Dataset (reserved).** SheetView currently binds through its data-source interface. A general Dataset abstraction will be introduced only when another public view can validate it. Do not define Dataset prematurely.

In practice, apps may also import lower-level compute or canvas packages directly (e.g., the spreadsheet app imports canvas and drawing packages) when the views/shell layers don't provide a sufficient abstraction.

Details: [OS Overview](os/README.md)

---

## Core Design Decisions

### 1. Cell Identity Model

Cells are keyed by **stable UUIDs (CellId)**, not positions. Position is a mutable property.

- Insert/delete rows/cols update identity/order indexes instead of rewriting formula text across all cells
- Formulas are stored in identity-aware form (template plus references), with A1 display regenerated from current positions
- Display (A1 notation) is derived at render time, not stored
- Concurrent structure changes compose correctly under CRDT
- Range expansion is resolved from the current identity/position state, so inserting inside `=SUM(A1:A10)` displays as the expanded range after positions are derived

Details: [Cell Identity](../internals/spreadsheet/cell-identity.md) | [Data Model](../internals/spreadsheet/data-model.md)

### 1b. Range Storage

Bulk imported or deferred data can live as typed Range payloads in Yrs, not as N per-cell Y.Map entries. The compute engine already speaks Range fluently: ranges feed it faster data through the existing `get_column_slice` path.

```
┌──────────────────────────────────────────────────────────────────┐
│  Yrs (ground truth, sparse, CRDT)                                │
│                                                                  │
│   cells           <── per-cell edits, anchor cells, overrides    │
│   ranges          <── Range metadata (extent, kind, name)        │
│   rangePayloads   <── opaque typed bytes (f64-le | i64-le | cbor)│
│   rangeFormats    <── per-Range format Y.Maps                    │
│   rangeBindings   <── per-sheet CF/validation attachment refs    │
│   workbook.tables <── canonical table catalog                    │
└────────────────────────────────┬─────────────────────────────────┘
                                 │  hydrate / mutation handler
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│  CellMirror (derived, compute-shaped)                            │
│                                                                  │
│   SheetMirror.cells           (sparse per-cell entries)          │
│   SheetMirror.col_data        (dense per-col Vec<CellValue>)  <──┐
│   SheetMirror.range_views     (FxHashMap<RangeId, RangeView>) <──┤
│   DenseColumnCache            (lazy SIMD-friendly Vec<f64>)   <──┘
│                                                                  │
│   resolve_identity(sheet, pos/id)  ── virtual CellId aware      │
│   get_column_slice(sheet, col)     ── projects Range natively   │
└────────────────────────────────┬─────────────────────────────────┘
                                 │  unchanged DataSource trait
                                 ▼
┌──────────────────────────────────────────────────────────────────┐
│  Compute (unchanged)                                             │
│                                                                  │
│   DepTarget::Range / RangeIntervalTree / find_by_range_contain.  │
│   RangeStore: pre_materialize / invalidate_dirty_ranges          │
│   DenseColumnCache: SIMD aggregation                             │
│   materialize_range: 3-tier (dense col, multi-col, sparse)       │
└──────────────────────────────────────────────────────────────────┘
```

Range-resident cells get **virtual CellIds** derived deterministically from `(SheetId, RowId, ColId)` — no per-cell allocation, byte-identical across peers. The dependency graph cannot distinguish virtual from real CellIds.

Details: [Cell Identity — Virtual Identity](../internals/spreadsheet/cell-identity.md#virtual-identity-for-range-resident-cells)

### 2. Rust as Single Source of Truth

Canonical persistent spreadsheet state and computation live in Rust `compute-core` and `compute-document`. TypeScript owns API/lifecycle adapters, event routing, view caches, and UI/session state; it does not own canonical persisted cell data.

```
Cell Edit (TS) -> ComputeBridge -> Rust compute-core
                                    -> Parser (winnow) -> AST
                                    -> DependencyGraph -> topological levels
                                    -> Scheduler (rayon parallel on native, single-thread WASM)
                                    -> Evaluator (512+ pure functions)
                                    -> RecalcResult
                                    -> Binary wire (compute-wire)
                                  -> TypeScript (DataView reads) -> Canvas
```

**31 compute-core workspace crates** organized in four architectural layers:

```
Layer 4 — Orchestration
  compute-core          Root crate: document model, scheduler, evaluator, bridge descriptors

Layer 3 — Domain
  compute-parser        Formula string -> AST (winnow)
  compute-functions     512+ Excel-compatible pure functions
  compute-table         Table engine: filters, sort, slicers
  compute-pivot         Pivot table engine
  compute-cf            Conditional formatting rules
  compute-stats         Aggregation, regression, statistics
  compute-graph         Dependency graph, topological sort
  compute-schema        Column-level type validation
  compute-formats       Number formatting
  compute-charts        Chart data extraction
  compute-chart-render  Chart raster/render helpers
  compute-solver        Goal-seek / optimization
  compute-collab        CRDT collaboration primitives
  compute-wire          Binary serialization (viewport, mutations)
  compute-document      CRDT document layer (Yrs schema, cell serde, undo, observe, identity)
  compute-fill          Autofill engine (pattern detection, series generation, formula ref adjustment)
  compute-layout-index  Spatial layout index: Fenwick tree for O(log k) cell-to-pixel mapping
  compute-text-measurement  Server-side text measurement for layout
  compute-relational    GROUP BY, aggregation, and window functions over tabular data
  compute-coordinator   Multi-participant sync coordination
  compute-screenshot    Headless sheet screenshot rasterization
  compute-security      Privacy policy types and access-control engine

Layer 2 — Type Bridge
  formula-types         CellRef, StructuredRef, IdentityFormula   re-exports value-types + cell-types
  pivot-types           Pivot table contracts shared by pivot/domain/file-IO code
  snapshot-types        RecalcResult, MutationResult IPC contracts

Layer 1 — Leaf Types (zero internal deps)
  value-types           CellValue, CellError, FiniteF64, Color
  cell-types            CellId, SheetId, RowId, ColId, CellPos, RangePos
  workbook-types        Workbook identity and external workbook reference types
  finite-at-boundary    Proc attribute for intentional bare-f64 boundary fields
  finite-at-boundary-walker  Test walker for finite numeric boundary contracts
```

Type DAG: `value-types + cell-types + workbook-types (independent leaves) -> formula-types`; `snapshot-types` depends on `value-types`, `cell-types`, `formula-types`, and `domain-types`; `pivot-types` depends on `value-types`, `cell-types`, and `domain-types`.

`domain-types` lives outside compute-core (at `domain-types/`) and provides shared domain types (cell formats, styles, canonical pivot config/format shapes). It is a direct dependency of compute-core and several domain crates. Using `domain-types` for canonical pivot config at snapshot/IPC boundaries is intentional; do not duplicate those shapes inside `snapshot-types`.

Domain crates depend on the type layer they need and on narrowly scoped peer domain crates when the manifest requires it, never on the root crate. This enables independent compilation and parallel development.

Details: [Compute-Core](../../compute/core/README.md) | [Compute Wire](../../compute/core/crates/compute-wire/README.md)

### 3. Rust-to-TypeScript Bridge

The `rust-bridge` proc-macro framework generates bridge descriptors and bindings for WASM, Tauri, N-API, and PyO3 targets from Rust `#[bridge::api]` surfaces. This page focuses on the TypeScript transports:

| Annotation | Purpose |
|------------|---------|
| `#[bridge::api]` | Define RPC methods |
| `#[bridge::service]` | Stateful service (keyed by instance) |
| `#[bridge::read]` | Read-only query |
| `#[bridge::write]` | Mutating command |
| `#[bridge::pure]` | Stateless function |
| `#[bridge::lifecycle]` | Init/destroy |

Transport implementations live in `infra/transport/` (`@mog/transport`, private workspace package). The factory auto-detects platform at startup:
- **Desktop**: `createTauriTransport()` — Tauri IPC via `@tauri-apps/api/core` `invoke()`
- **Web**: `createWasmTransport()` — `@mog-sdk/wasm` loaded by the transport factory, with direct WASM function calls
- **Server/headless**: `createNapiTransport()` and lazy/headless variants — N-API bindings for Node.js

The transport is created once via `createTransport(config?)` and injected into the `ComputeBridge`. Auto-detection prefers N-API, then Tauri, then WASM; callers can also request an explicit runtime. All callers use the same async API regardless of platform. Middleware functions handle platform-specific concerns, including `createTimeInjectingTransport()`, `createNapiTimeInjectingTransport()`, `createBytesTupleNormalizingTransport()`, and `createCaseNormalizingTransport()`.

**Type generation**: The `bridge-ts` crate (in `infra/rust-bridge/bridge-ts/`) parses Rust structs/enums with serde attributes (`#[serde(rename_all = "camelCase")]`, `#[serde(tag = "type")]`, etc.) and emits TypeScript interfaces. Generated types live in `kernel/src/bridges/compute/compute-types.gen.ts`. Culture data is also codegen'd: `bridge-ts/tests/generate_culture_data.rs` serializes the 10 `CultureInfo` structs from `compute-formats` into `infra/culture/src/cultures.gen.ts`. This is the single source of truth for cross-language type and data safety — types and data are defined once in Rust and consumed in both languages.

Details: [Compute Bridge](compute-bridge.md)

### 4. Two-Protocol IPC

Communication between Rust and TypeScript uses two protocols:

| Protocol | Format | Used For |
|----------|--------|----------|
| **Control plane** | JSON | RPC commands such as `compute_batch_set_cells_by_position`, `compute_undo`, and schema queries |
| **Data plane** | Binary (`Uint8Array`) | Viewport data, mutation results |

The binary data plane enables 60 FPS rendering:
- **Viewport**: 36B header + N x 32B cell records (dense row-major) + UTF-8 string pool + merge/dimension sections + binary format palette + conditional-format extras + row/column position arrays
- **Mutations**: Compact mutation buffers carry patch records and optional spill/palette sections; structural changes trigger the viewport refresh/overlay pipeline
- **Hot path**: `DataView` reads directly from the blob without per-cell object deserialization
- **Format palette**: Append-only interning deduplicates `CellFormat` to `u16` indices in a binary palette section
- **ViewportCoordinator**: Single owner per viewport region. Both mutation and viewport-fetch pipelines write through the coordinator, which uses an epoch-based overlay model: mutation patches are stored as overlays with an epoch stamp, and when a fresh viewport fetch arrives, the coordinator filters overlays, keeps only entries newer than the fetch epoch, and re-applies them on top of the new buffer. This keeps stale-detection/retry logic out of callers.

Details: [Binary Wire Pipeline](../internals/spreadsheet/renderer/binary-wire-pipeline.md) | [Compute Wire Spec](../../compute/core/crates/compute-wire/README.md) | [Compute Bridge](compute-bridge.md)


### 5. Document Lifecycle & Three-Tier State

Public Node consumers create workbooks through `@mog-sdk/sdk`, which wraps kernel bootstrap and host/runtime setup:

```ts
import { createWorkbook } from '@mog-sdk/sdk';

const wb = await createWorkbook({ userTimezone: 'UTC' });
const ws = wb.activeSheet;
await ws.setCell('A1', 'Hello');
await wb.close('skipSave');
```

`@mog-sdk/kernel` is a workspace-internal package. Inside the monorepo, the kernel provides a zero-ceremony async `createWorkbook()` and a document-first `DocumentFactory` for advanced integration. `DocumentFactory` encapsulates kernel bootstrap (ComputeBridge, RustDocument, context wiring) and returns a `DocumentHandle`; it is not the primary public package setup path. Apps never instantiate `RustDocument` or call `createDocumentContext` directly.

**Four-tier context architecture** controls what each layer can access:

```
IDomainContext              (Tier 1)  eventBus + undo labeling              — domain modules
IKernelContext              (Tier 2)  + services, destroy()                 — any app type
ISpreadsheetKernelContext   (Tier 3)  + all spreadsheet bridges             — spreadsheet app, shell
DocumentContext             (Tier 4)  + computeBridge, viewport buffer      — engine internals only
```

All generic interfaces default to `SpreadsheetEvent`, so existing code works unchanged. Future app types (CRM, kanban, docs) extend `IKernelContext<CustomEvent>` with their own bridges.

`DocumentHandle` exposes `eventBus`, `undoService`, provider registration, lifecycle methods, and `workbook()`. Raw `DocumentHandleInternal.context` access is Tier 3 and kernel-internal only; internal kernel code casts when engine access is needed.

**Three-tier state** flows downward:

```
RustDocument (Rust storage via ComputeBridge)     -- persistent, collaborative
  -> DocumentContext (kernel context, bridges)     -- derived, event-driven
    -> UIStore (ephemeral, Zustand)                -- selection, viewport, UI
       EventBus (pub/sub)                          -- cross-system reactivity
```

- **Domain modules** (21): Pure functions taking context as first parameter (cells, charts, comments, diagram, drawing, equations, fill, form-controls, formatting, formulas, grouping, pivots, schemas, shapes, sheets, slicers, sorting, sparklines, tables, text-effects, workbook)
- **Mutations layer**: Coordinator mutation helpers and action handlers define app-side mutation behavior; kernel mutations route through the Workbook/Worksheet API and ComputeBridge
- **Unified Action System**: All inputs (keyboard, toolbar, context menu, AI) -> `dispatch()` -> `HANDLER_MAP`

Details: [State Management](../internals/spreadsheet/state.md)

### 6. XState Machines + Coordinator Pattern

Complex app interactions are modeled as **explicit XState state machines** where the workflow benefits from inspectable, testable state transitions.

**21+ machines**: selection, editor, clipboard, renderer, input, focus, pane-focus, chart, find-replace, object-interaction, slicer, comment, draw-border, page-break, diagram, ink, calendar, gallery, kanban, timeline, document-lifecycle.

**Coordinator** is the composition root that wires them together via a **5-system architecture**:

```
SheetCoordinator
├── GridEditingSystem    (selection, editor, clipboard, find-replace, draw-border, page-break)
├── RenderSystem         (renderer, grid-renderer lifecycle, canvas creation)
├── ObjectSystem         (object-interaction, chart, slicer, diagram, comment)
├── InputSystem          (input, focus, pane-focus, keyboard routing)
└── InkSystem            (ink machine, pen/touch input)
```

**Key rule**: Machines own state, systems own coordination, coordinator owns composition.

**Interaction flow**: User input -> Coordinator -> XState events -> Machine transitions -> Side effects (canvas, recalc, EventBus)

Details: [XState Patterns](../internals/spreadsheet/renderer/xstate.md) | [State Management](../internals/spreadsheet/state.md)

### 7. Unified Spreadsheet API

All programmatic access — browser, headless, LLM-generated code, OS apps — goes through `Workbook`/`Worksheet`:

```typescript
import { createWorkbook } from '@mog-sdk/sdk';

const wb = await createWorkbook();
const ws = wb.activeSheet;
await ws.setCell('A1', 'Hello');          // A1 addressing
await ws.setCell(0, 1, 42);               // numeric row/column addressing
await ws.formats.set('A1', { bold: true });
await wb.history.undo();
```

Sub-APIs are typed namespace properties on `Workbook` and `Worksheet` (formats, layout, charts, tables, history, sheets, and others). They are lazy where implemented, errors throw, and `batch()` groups operations into a single undo step. The workspace-internal kernel power-user path accepts `{ ctx, eventBus, stateProvider? }`; public SDK consumers should prefer the runtime package for their host.

Details: [Spreadsheet Architecture](../internals/spreadsheet/ARCHITECTURE.md)

### 8. Handle-Based API Design

Every method on the Workbook/Worksheet API falls into exactly one of three categories:

| Category | Pattern | Lifecycle | Example |
|----------|---------|-----------|---------|
| **Stateless** | Method call | None | `ws.setCell("A1", 42)`, `wb.indexToAddress(0, 0)` |
| **Workbook-scoped** | `readonly` property | Bound to workbook lifecycle | `wb.history`, `wb.sheets` |
| **Consumer-scoped** | Handle via factory | `handle.dispose()` or `using` | `wb.viewport.createRegion(sheetId, bounds)` |

Three rules: (1) stateless operations are methods, (2) consumer-scoped state returns handles with an explicit cleanup path, (3) handles compose into a tree rooted at the workbook lifecycle. Public examples prefer `await wb.close()` or `await using`; `wb.dispose()` is synchronous local cleanup.

Infrastructure: `IDisposable` in `contracts/src/core/disposable.ts`; `DisposableBase` and `DisposableStore` in `spreadsheet-utils/src/disposable.ts` support idempotent `dispose()` plus TC39 `Symbol.dispose` for compatible handles. `Workbook` also exposes `close()` and `Symbol.asyncDispose`.

Details: [API Design Philosophy](../internals/spreadsheet/API-DESIGN-PHILOSOPHY.md)

### 9. Yrs/CRDT Document Structure

All persistent data is stored in a Yrs (Rust port of Yjs) document. The Cell Identity Model makes this work — because cells are keyed by stable UUIDs, concurrent structure changes (two users inserting columns simultaneously) compose correctly without conflict.

Core per-sheet storage includes:

| Map | Key | Value | Purpose |
|-----|-----|-------|---------|
| `cells` | `CellId` | Compact nested cell map | Primary storage: raw value, computed value, identity formula, notes, hyperlinks, array formula metadata |
| `cellProperties` | `CellId` | `CellProperties` | Sparse formatting, provenance (modifiedBy/At), validation errors, live data connections |
| `gridIndex.posToId` / `gridIndex.idToPos` | position / `CellId` | `CellId` / position | Authoritative Yrs-side identity index |
| `rowOrder` / `colOrder` | ordered IDs | `RowId` / `ColId` | CRDT-safe row/column order |
| `ranges` / `rangePayloads` / `rangeFormats` / `rangeBindings` | `RangeId` | metadata/bytes/format/binding | Bulk range storage |

Additional sheet-level maps: `properties`, schemas, row/column dimensions and formats, merges, filters, slicers, comments, sparklines, conditional formatting, bindings, grouping/sorting, and floating objects — all keyed by CellId, range, object ID, or position as appropriate. TypeScript `SerializedCellData` shapes are compatibility/store views; the literal persisted Yrs cell map uses compact Rust schema keys.

**Undo scope** is per-sheet and collaborative: user edits and structural changes are undoable via the Yrs UndoManager. UI state (selection, scroll, editor buffer), formula recalculation, and remote sync are not undoable. **Structural undo** (insert/delete rows/cols) is observed through `rowOrder`, `colOrder`, and `gridIndex` changes, then GridIndex, CellMirror, and compute state are rebuilt or refreshed from the CRDT source of truth. This approach is collaboration-safe — interleaved structural changes from multiple users are resolved by the CRDT, and derived caches follow the merged state.

**Collaboration support** is exposed through Yrs state-vector/update APIs in compute-core (`compute-collab`, `compute-coordinator`, and the sync bridge); host/runtime layers are responsible for routing those updates between clients.

Details: [Data Model](../internals/spreadsheet/data-model.md) | [Cell Identity](../internals/spreadsheet/cell-identity.md)

---

## Key Subsystems

### Canvas Rendering (12 workspace packages)

```
canvas-engine       Generic multi-canvas render loop, priority scheduler, input capture
grid-renderer       Cell, background, selection, header layers + viewports
drawing-canvas      Floating object scene graph
overlay             Screen-space UX chrome (handles, guides, ink)
grid-canvas         Composition facade
spatial             Spatial indexing + hit-test pipeline (`@mog/spatial` private package)
drawing/*           Six drawing subpackages: engine, shapes, geometry, ink, diagram, text-effects
```

Details: [Renderer](../internals/spreadsheet/renderer/README.md) | [Binary Wire Pipeline](../internals/spreadsheet/renderer/binary-wire-pipeline.md) | [Canvas](../internals/spreadsheet/renderer/canvas.md)

### Hit Testing Architecture

Three-layer system for all spatial queries across the canvas stack:

```
Layer 3: HitTestProvider Dispatch     (canvas-engine/input-capture.ts)
           ↓ delegates to registered providers
Layer 2: Spatial Index + Pipeline     (@mog/spatial private package, part of canvas packages above)
           ↓ candidates to
Layer 1: Geometry Primitives          (@mog/geometry private package)
```

- **`@mog/geometry`** (`canvas/drawing/geometry/`): Pure math. `pointInRect`, `pointInCircle`, `pointInArc`, `pointInDiamond`, `rectContains`, `rectIntersects`, `distanceToRect`, `distanceToCircle`. Zero Canvas2D/DOM dependencies.
- **`@mog/spatial`** (`canvas/spatial/`): `GridSpatialIndex` (bit-packed grid, O(1) average), `hitTestPipeline` (broad→narrow with z-order), `selectInRect`, `findNearby`, `testPointInPath`. Used by drawing-canvas, charts, ink, drawing-engine.
- **Layer 3**: `canvas-engine` InputCapture provider dispatch (unchanged, already correct).

Consumers: drawing-canvas (shapes), charts (marks), ink (strokes), drawing-engine (spatial queries), canvas-overlay (handles), grid-renderer (floating objects).

### Drawing (6 sub-packages under `canvas/drawing/`)

Engine, shapes, ink, diagrams, text effects, geometry.

### File I/O (XLSX Pipeline)

```
.xlsx file -> Rust xlsx-parser/xlsx-api -> ParseOutput / ParsedWorkbook
          -> compute-core import hydration -> Yrs document
```

- **xlsx-parser** (`file-io/xlsx/parser/`): Rust parser for OOXML ZIP structure.
- **xlsx-api** (`file-io/xlsx-api/`): Ergonomic Rust API and bridge surface included in the shared WASM/N-API bridge targets.
- **xlsx-bridge** (`file-io/xlsx/bridge/`): TypeScript package managing parser lifecycle and consumer-facing API.
- **csv-parser** (`file-io/csv-parser/`): Rust CSV parser that outputs the same import payload shape for compute hydration.
- **ooxml-types** (`file-io/ooxml/types/`): Shared OOXML vocabulary — Rust crate with `from_ooxml()`/`to_ooxml()` enum conversions. Zero deps; serde behind feature flag.
- Additional file-io packages: `file-io/pdf/core/`, `file-io/pdf/graphics/`, `file-io/pdf/layout/`, and `file-io/print-export/`.

### Table Engine (`table-engine/`)

Standalone TypeScript package for table computation: filtering, sorting, slicers, slicer-cache, visibility bitmaps, structured references, styles, and WASM-backed helpers. Used by the kernel TableBridge and slicer/table bridges. The Rust `compute-table` crate mirrors this for server-side computation.

### Collaboration

Yrs (Rust port of Yjs) provides the collaborative document substrate. Cell Identity Model ensures concurrent structure changes compose correctly: two users inserting columns simultaneously both apply because row/column identity order and grid indexes merge under CRDT, while formula display is derived from the merged identity/position state.

### Floating Objects

Dual-path architecture: **scene graph for sync reads**, **Rust compute-core for async writes**.

- `SpreadsheetObjectManager` is the composition facade. It delegates to `SpreadsheetObjectMutator` (writes via `IObjectMutator`), `ComputeBridgeObjectStore` (persistence), and `core/grouping` directly — no intermediate `CanvasObjectManager`.
- **Reads**: `IObjectBoundsReader` queries the drawing-canvas scene graph for pixel bounds synchronously (needed for hit-testing, selection, rendering).
- **Writes**: `IObjectMutator` routes create/update/delete through `SpreadsheetObjectMutator`, which calls Rust compute-core via `ComputeBridge`.
- `wb.floatingObjects` is no longer on the public `Workbook` interface — it moved to `WorkbookInternal` (kernel-internal only).
- `IPositionResolver<TAnchor>` still converts app-specific anchors to pixel positions. Spreadsheet uses `CellAnchor`; future apps (Slides, Whiteboard) implement their own resolver.

### Dual Formula Parsers

| Parser | Language | Location | Purpose |
|--------|----------|----------|---------|
| `compute-parser` | Rust (winnow) | `compute/core/crates/compute-parser/` | Production: formula -> AST for evaluation in Rust |

The Rust parser handles both evaluation and the primary parsing path. TypeScript-side formula editing support (syntax highlighting, autocomplete) is handled at the application layer.

### Undo/Redo

Two independent systems matching the state tiers:

| System | Owns | Undoable? |
|--------|------|-----------|
| Rust/Yrs UndoManager | Cell values, formulas, formatting, structure | Yes (collaborative) |
| XState machines | Selection, clipboard, editor buffer, scroll | No (session-only) |

Structure changes (insert row) update positions only — no formula rewriting, CellIds are stable.

### Schema Validation (Rust-owned)

Column-level type validation lives entirely in Rust (`compute/core/crates/compute-schema/`). Validation runs automatically as part of every mutation in `prepare_recalc_for_flush()`. Results flow to TypeScript via `MutationResult.recalc.validationAnnotations`. The kernel's `schema-bridge.ts` is a thin adapter that stores results in cell metadata and emits EventBus events.

Details: [Foundations](../internals/spreadsheet/foundations.md)

### Runtime

- **sdk** (`runtime/sdk/`): Published as `@mog-sdk/sdk` — unified public headless SDK. The root import resolves to native N-API in Node and WASM in Workers/web-standard runtimes, with explicit `./node`, `./wasm`, and `./workerd` subpaths.
- **embed** (`runtime/embed/`): Published as `@mog-sdk/embed` — public embed facade with React, web component, and config entry points.
- **spreadsheet-app** (`runtime/spreadsheet-app/`): Published as `@mog-sdk/spreadsheet-app` — public full-app composition package; its internal use of app/shell/kernel code is declaration-boundary checked.
- **wasm** (`compute/wasm/npm/`): Published as `@mog-sdk/wasm` — public WebAssembly binary wrapper used by browser transports.

`kernel/`, `shell/`, and `apps/spreadsheet/` are workspace-internal implementation packages, even when runtime packages compose them into public bundles.

---

## Performance

Performance-sensitive paths are covered by targeted benches and regression suites under `compute/core/`, compute-wire benches/tests, and renderer binary-wire docs. Current architectural targets:

| Area | Target |
|------|--------|
| Interactive edits | <16ms frame budget |
| Recalc bursts | <100ms for 10K-formula-scale workloads |
| Large range storage | <500MB for 500K-cell-scale workloads |
| Rendering | 60fps viewport updates |

---

## Documentation Index

### Architecture
| Topic | Document |
|-------|----------|
| This document | [README.md](README.md) |
| OS layers | [os/README.md](os/README.md) |
| Spreadsheet engine | [internals/spreadsheet/ARCHITECTURE.md](../internals/spreadsheet/ARCHITECTURE.md) |
| API design philosophy | [internals/spreadsheet/API-DESIGN-PHILOSOPHY.md](../internals/spreadsheet/API-DESIGN-PHILOSOPHY.md) |

### Core Concepts
| Topic | Document |
|-------|----------|
| API layer (kernel API, rust-bridge, transport) | [api-layer.md](api-layer.md) |
| Cell Identity Model | [internals/spreadsheet/cell-identity.md](../internals/spreadsheet/cell-identity.md) |
| Data model & storage | [internals/spreadsheet/data-model.md](../internals/spreadsheet/data-model.md) |
| State management | [internals/spreadsheet/state.md](../internals/spreadsheet/state.md) |
| XState patterns | [internals/spreadsheet/renderer/xstate.md](../internals/spreadsheet/renderer/xstate.md) |
| Compute bridge (Rust <-> TS) | [compute-bridge.md](compute-bridge.md) |
| Binary wire protocol | [internals/spreadsheet/renderer/binary-wire-pipeline.md](../internals/spreadsheet/renderer/binary-wire-pipeline.md) |
| Access control (principals, policies, redaction) | [security/ACCESS-CONTROL.md](../security/ACCESS-CONTROL.md) |

### Subsystems
| Topic | Document |
|-------|----------|
| Compute-core (Rust) | [compute/core/README.md](../../compute/core/README.md) |
| Compute wire spec | [compute/core/crates/compute-wire/README.md](../../compute/core/crates/compute-wire/README.md) |
| Canvas rendering | [internals/spreadsheet/renderer/README.md](../internals/spreadsheet/renderer/README.md) |
| Drawing system | [canvas/drawing/README.md](../../canvas/drawing/README.md) |
| Tables | [internals/spreadsheet/tables.md](../internals/spreadsheet/tables.md) |
| Pivot tables | [internals/spreadsheet/pivot-tables.md](../internals/spreadsheet/pivot-tables.md) |
| 6 foundations | [internals/spreadsheet/foundations.md](../internals/spreadsheet/foundations.md) |
| Formula discrepancies | [internals/spreadsheet/known-formula-discrepancies.md](../internals/spreadsheet/known-formula-discrepancies.md) |

### Design
| Topic | Document |
|-------|----------|
| UI design system | [internals/ui-design/README.md](../internals/ui-design/README.md) |
