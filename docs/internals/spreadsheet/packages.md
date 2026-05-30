# Package Structure

## Dependency Graph

```
                                     collaboration-server (y-websocket)
                                                 │
                                         app-spreadsheet
                                                 │
             ┌───────────────────────────────────┼──────────────────────────────┐
             │                                   │                              │
           shell                            kernel                    spreadsheet-utils
             │                                   │
             └───────────────────────────────────┼──────────────────────────────┘
                                                 │
      ┌────────┬────────┬──────────┬─────────────┼──────────┬──────────┬────────┐
      │        │        │          │             │          │          │        │
   compute  charts   table     grid-canvas   print    xlsx-parser
    -core           -engine        │        -export   (file-io/xlsx/)
   (Rust)             │            │           │
      │               │            │           │
      └───────────────┼────────────┼───────────┤
                      │            │           │
                  drawing/* (under canvas/drawing/)    number-formats
                  ├─ engine (drawing-engine)
                  ├─ shapes (shape-engine)
                  ├─ ink    (ink-engine)
                  ├─ diagram
                  ├─ text-effects (text-effects-engine)
                  └─ geometry
                      │  math-engine (typeset/)
                      │            │
                      └────────────┼───────────┤
                                   │           │
                          kernel (domain modules)
                                   │
                              contracts ◄──── yjs
                                   │
                         ┌─────────┼─────────┐
                         │         │         │
                         │         │    number-formats
                         │         │
                         │  ┌──────┴──────┐
                            │             │
                   @mog-sdk/wasm (compute-core-wasm crate)  ooxml-types
                       (Rust/WASM)                   (Rust codegen)

    Rust workspace (Cargo.toml at repo root):
    ├── compute/core        ~303K lines
    ├── xlsx-parser         ~147K lines (file-io/xlsx/parser)
    ├── ooxml-types         ~45K lines  (file-io/ooxml/types)
    ├── domain-types        ~20K lines
    ├── rust-bridge         ~19K lines  (infra/rust-bridge/)
    ├── src-tauri           ~9K lines   (runtime/src-tauri)
    ├── pdf-core            ~5.7K lines (file-io/pdf/core)
    ├── compute/api         ~5K lines
    ├── xlsx-api            ~1.8K lines (file-io/xlsx-api)
    ├── compute/wasm        ~92 lines
    └── compute/napi        ~97 lines
```

## All Packages

### Base Layer (no external dependencies)

| Package          | LOC  | Purpose                             | Key Exports                       |
| ---------------- | ---- | ----------------------------------- | --------------------------------- |
| `contracts`      | ~38K | TypeScript interfaces, zero runtime | `core.ts`, `events.ts`, `ribbon/` |

### Core Domain Layer

| Package             | LOC  | Purpose                            | Key Exports                                                  |
| ------------------- | ---- | ---------------------------------- | ------------------------------------------------------------ |
| `shell`             | ~60K | View adapters, renderers, machines | `ShellCoordinator`, view adapters, XState machines, React components, hooks |
| `kernel`            | ~10K | Core runtime and APIs              | `SpreadsheetAPI`, `SheetAPI`, store context, bridges         |
| `spreadsheet-utils` | -    | Shared spreadsheet utilities       | Utility functions used across packages                       |

### Computation Layer

| Package              | LOC    | Purpose                                                                                                                                              | Key Exports                                 |
| -------------------- | ------ | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `compute-core`       | ~303K  | Rust compute engine: formula parser, evaluator, 508+ Excel functions, dependency graph, recalc scheduler, conditional formatting, table engine, pivot engine, CRDT storage, what-if analysis | Full spreadsheet computation via WASM/Tauri IPC |
| `@mog-sdk/wasm` (`compute-core-wasm` crate) | ~92 | WASM bindings for compute-core | `wasm-bindgen` entry points for browser use |
| `compute-core-napi`  | ~97    | Node.js native bindings for compute-core                                                                                                             | N-API entry points for Node.js              |
| `compute-api`        | ~5K    | Rust API layer for compute-core                                                                                                                      | High-level compute API                      |
| `domain-types`       | ~20K   | Shared Rust domain types                                                                                                                             | Core type definitions used across Rust crates |
| `formula-eval`       | ~12K   | Rust formula accuracy evaluator                                                                                                                      | CLI: corpus run, diagnose, inspect, trace   |
| `table-engine`       | ~2K    | TS table filtering/sorting/visibility engine                                                                                                         | Filter, sort, slicer, visibility modules    |
| `charts`             | ~28K   | Custom chart rendering engine                                                                                                                        | `ChartEngine`, chart types, renderers       |
| `number-formats`     | ~1K    | Number formatting utilities                                                                                                                          | Excel number format parsing and rendering   |

### File I/O Layer (`file-io/`)

| Package              | Location                  | LOC    | Purpose                                    | Key Exports                                |
| -------------------- | ------------------------- | ------ | ------------------------------------------ | ------------------------------------------ |
| `xlsx-parser-wasm`   | `file-io/xlsx/parser/`    | ~147K  | High-performance Rust/WASM XLSX parser     | `parse_xlsx`, SIMD-optimized parsing       |
| `xlsx-parser`        | `file-io/xlsx/bridge/`    | -      | TypeScript bridge for xlsx-parser-wasm     | TS wrapper, types, worker                  |
| `xlsx-tooling`       | `file-io/xlsx/tooling/`   | -      | XLSX development tooling                   | Dev/debug tools for XLSX                   |
| `xlsx-api`           | `file-io/xlsx-api/`       | ~1.8K  | Rust XLSX API                              | High-level XLSX access API                 |
| `ooxml-types`        | `file-io/ooxml/types/`    | ~45K   | Rust OOXML type definitions                | Generated types matching OOXML spec        |
| `print-export`       | `file-io/print-export/`   | ~4K    | HTML/PDF generation                        | `generatePDF`, `TableGenerator`            |
| `pdf-graphics`       | `file-io/pdf/graphics/`   | -      | PDF graphics rendering                     | PDF graphics primitives                    |
| `pdf-layout`         | `file-io/pdf/layout/`     | -      | PDF layout engine                          | PDF page layout                            |
| `pdf-core`           | `file-io/pdf/core/`       | ~5.7K  | Rust PDF core engine                       | Core PDF generation in Rust                |

#### xlsx-parser-wasm

High-performance XLSX parser using Rust + WebAssembly with SIMD optimization:

- **SIMD-Accelerated Scanning**: Uses WASM SIMD instructions for byte scanning
- **Zero-Copy String Access**: Shared strings parsed without unnecessary allocations
- **Streaming Architecture**: Pre-allocated buffers for efficient memory usage
- **Pure Rust**: No external dependencies except wasm-bindgen

Performance target: Parse 500K cells in under 50ms.

Dependencies: Rust crates (`miniz_oxide`, `wasm-bindgen`)

### Rendering Layer

**Canvas packages** (under `canvas/` + composition facade):

```
canvas-engine (foundation, zero domain deps)
    ├── grid-renderer (cells, headers, selection, background, UI)
    ├── drawing-canvas (scene graph, object renderers)
    └── canvas-overlay (handles, guides, rubber band)
            ↓
        grid-canvas (composition facade)
            ↓
        spreadsheet app
```

| Package             | Location                 | LOC  | Purpose                                                     | Key Exports                                       |
| ------------------- | ------------------------ | ---- | ----------------------------------------------------------- | ------------------------------------------------- |
| `canvas-engine`     | `canvas/engine/`         | ~3K  | Generic multi-canvas render loop, priority scheduler, input | `createCanvasEngine`, `CanvasLayer`, `RenderLoop` |
| `grid-renderer`     | `canvas/grid-renderer/`  | ~12K | Cell, background, selection, header, and UI layers          | `createGridLayers`, data source interfaces        |
| `drawing-canvas`    | `canvas/drawing-canvas/` | ~4K  | Floating object scene graph and type renderers              | `DrawingLayer`, `SceneGraph`, `HitMap`            |
| `canvas-overlay`    | `canvas/overlay/`        | ~2K  | Screen-space UX chrome (handles, guides, rubber band)       | `OverlayLayer`, handle hit testing                |
| `grid-canvas`       | `canvas/grid-canvas/`    | ~3K  | Thin composition facade wiring the canvas packages          | `GridRenderer` contract implementation            |
| `spatial`           | `canvas/spatial/`        | -    | Spatial indexing for canvas objects                         | Spatial queries, hit testing                      |
| `canvas-playground` | `canvas/lab/`            | ~1K  | Interactive test harness for canvas development             | Vite dev server for visual testing                |

### Drawing Layer (`canvas/drawing/`)

All drawing-related packages live under `canvas/drawing/` (6 packages). Package names are unchanged (e.g., `@mog/drawing-engine`).

| Package            | Location                   | LOC  | Purpose                                            | Key Exports                                |
| ------------------ | -------------------------- | ---- | -------------------------------------------------- | ------------------------------------------ |
| `drawing-engine`   | `canvas/drawing/engine/`   | ~2K  | Drawing/rendering operations engine                | Drawing operations, object management      |
| `shape-engine`     | `canvas/drawing/shapes/`   | ~2K  | 2D shape manipulation and geometry                 | Shape creation, transforms, path ops       |
| `ink-engine`       | `canvas/drawing/ink/`      | ~1K  | Pen/ink input and rendering engine                 | Ink stroke capture, smoothing, rendering   |
| `diagram`         | `canvas/drawing/diagram/` | ~3K  | Diagram engine                                    | Diagram parser, layout engine             |
| `text-effects-engine`   | `canvas/drawing/text-effects/`  | ~1K  | Text-effects styling/rendering                        | Text effects, transforms, gradient fills   |
| `geometry`         | `canvas/drawing/geometry/` | ~2K  | Geometric calculations (points, rects, transforms) | Points, rects, matrices, path math         |

### Typeset Layer (`typeset/`)

| Package            | Location                   | LOC  | Purpose                                    | Key Exports                                |
| ------------------ | -------------------------- | ---- | ------------------------------------------ | ------------------------------------------ |
| `math-engine`      | `typeset/math-engine/`     | ~1K  | Equation/math rendering engine             | Math formula layout, symbol rendering      |
| `typeset-lab`      | `typeset/lab/`             | ~1K  | Visual test harness for typeset rendering  | Vite dev server for visual testing         |

### Application Layer

| Package                | Location                      | LOC  | Purpose                                  | Key Components                                       |
| ---------------------- | ----------------------------- | ---- | ---------------------------------------- | ---------------------------------------------------- |
| `shell`                | `shell/`                      | ~60K | Coordination + React UI                  | Coordinator, components, hooks, actions, clipboard    |
| `app-spreadsheet`      | `apps/spreadsheet/`           | ~2K  | Default spreadsheet app (grid view)      | Classic grid view composition, app entry point        |
| `collaboration-server` | `runtime/server/`             | ~350 | WebSocket collaboration server           | `CollaborationServer`, y-websocket                    |
| `spreadsheet-utils`    | `spreadsheet-utils/`          | ~2K  | Shared spreadsheet utility functions     | Domain utilities used across packages                 |

#### shell

The shell package provides coordination and React integration:

- **Coordinator**: `ShellCoordinator`, `ActorManager`, mutations, keyboard handling
- **Components**: React UI components (grid, toolbar, dialogs, filters, charts, tables, and diagram/text-effects pickers)
- **Hooks**: React hooks for selection, editing, clipboard, charts, pivots, etc.
- **Actions**: Action handlers for all user interactions (formatting, fill, clipboard, charts, ink, tables)
- **Views**: Grid views, kanban views, view adapters
- **UI Store**: Zustand-based UI state slices (dialog stack, trace arrows, range selection, etc.)
- **Extensions**: Extension host, API, permissions, messaging, security
- **Editor**: Formula highlighting, rich text editing, name completion
- **Accessibility**: Screen reader announcements, keyboard navigation

Sub-path exports:

- `@mog/shell/coordinator`, `/coordinator/mutations`, `/coordinator/features`
- `@mog/shell/components`, `/components/dialogs`, `/components/pickers`, `/components/text-effects`
- `@mog/shell/hooks`
- `@mog/shell/actions`, `/actions/handlers`
- `@mog/shell/views`, `/views/grid`
- `@mog/shell/ui-store`
- `@mog/shell/extensions`
- `@mog/shell/styles`

Dependencies: `@mog/charts`, `@mog/icons`, `@mog/kernel`, `@mog/platform`, `@mog/print-export`, `@mog/diagram`, `@mog/spreadsheet-contracts`, `@mog/spreadsheet-utils`, `@mog/ui`, `react`, `xstate`, `zustand`

### OS / Platform Layer

| Package           | Location                    | LOC  | Purpose                                  | Key Exports                                 |
| ----------------- | --------------------------- | ---- | ---------------------------------------- | ------------------------------------------- |
| `ui`              | `ui/`                       | ~4K  | Data views and record components         | Kanban, Calendar, Timeline, Gallery, DataGrid |
| `platform`        | `infra/platform/`           | -    | Platform abstraction layer               | Platform-specific utilities                 |
| `platform-memory` | `infra/platform/memory/`    | ~1K  | Platform memory management               | Memory utilities                            |

### Infrastructure Layer (`infra/`)

| Package           | Location                          | LOC  | Purpose                                  | Key Exports                                 |
| ----------------- | --------------------------------- | ---- | ---------------------------------------- | ------------------------------------------- |
| `icons`           | `infra/icons/`                    | ~440 | SVG icon library for UI                  | React icon components                       |
| `culture`         | `infra/culture/`                  | -    | Locale/culture settings                  | Culture-aware formatting, locale data       |
| `transport`       | `infra/transport/`                | -    | Communication/transport layer            | Transport abstractions                      |
| `bridge-ts`       | `infra/rust-bridge/bridge-ts/`    | -    | TypeScript bindings for Rust bridge      | Generated TS types                          |

### Runtime Layer (`runtime/`)

| Package                | Location                        | LOC  | Purpose                                  | Key Exports                                 |
| ---------------------- | ------------------------------- | ---- | ---------------------------------------- | ------------------------------------------- |
| `src-tauri`            | `runtime/src-tauri/`            | ~9K  | Tauri desktop application shell (Rust)   | IPC commands, window management, plugins    |
| `collaboration-server` | `runtime/server/`               | ~350 | WebSocket collaboration server           | y-websocket server                          |
| `sdk`                  | `runtime/sdk/`                  | -    | Headless spreadsheet SDK for Node.js     | Programmatic spreadsheet API                |

## Rust Workspace

The Rust workspace at `Cargo.toml` (repo root) contains the following crate groups:

### Core Crates

| Crate              | Location              | Lines  | Purpose                                                                                 |
| ------------------ | --------------------- | ------ | --------------------------------------------------------------------------------------- |
| `compute-core`     | `compute/core/`       | ~303K  | Formula parser, evaluator, 508+ Excel functions, dependency graph, recalc scheduler, conditional formatting, table engine, pivot engine, CRDT storage, what-if analysis |
| `@mog-sdk/wasm` (`compute-core-wasm` crate) | `compute/wasm/` | ~92 | `wasm-bindgen` entry points exposing compute-core to the browser |
| `compute-core-napi`| `compute/napi/`       | ~97    | N-API entry points exposing compute-core to Node.js                                     |
| `compute-api`      | `compute/api/`        | ~5K    | High-level Rust API for compute-core                                                    |
| `domain-types`     | `domain-types/`       | ~20K   | Shared domain type definitions                                                          |

compute-core sub-crates (under `compute/core/crates/`):
`compute-parser`, `compute-stats`, `compute-pivot`, `compute-table`, `compute-functions`, `compute-cf`, `compute-formats`, `compute-schema`, `compute-graph`, `compute-fill`, `compute-charts`, `compute-solver`, `compute-collab`, `compute-document`, `compute-wire`, `compute-layout-index`, `compute-text-measurement`, `value-types`, `cell-types`, `formula-types`, `snapshot-types`

### File I/O Crates

| Crate              | Location                | Lines  | Purpose                                                                              |
| ------------------ | ----------------------- | ------ | ------------------------------------------------------------------------------------ |
| `xlsx-parser`      | `file-io/xlsx/parser/`  | ~147K  | SIMD-optimized XLSX parsing, ZIP decompression, XML scanning, shared strings, styles |
| `xlsx-api`         | `file-io/xlsx-api/`     | ~1.8K  | High-level XLSX access API                                                           |
| `ooxml-types`      | `file-io/ooxml/types/`  | ~45K   | Code-generated type definitions from OOXML spec                                      |
| `pdf-core`         | `file-io/pdf/core/`     | ~5.7K  | PDF generation core                                                                  |

### Infrastructure Crates

| Crate              | Location                          | Lines  | Purpose                                                |
| ------------------ | --------------------------------- | ------ | ------------------------------------------------------ |
| `bridge-types`     | `infra/rust-bridge/bridge-types/` | -      | Shared types for Rust bridge                           |
| `bridge-derive`    | `infra/rust-bridge/bridge-derive/`| -      | Derive macros for bridge                               |
| `bridge-core`      | `infra/rust-bridge/bridge-core/`  | -      | Core bridge logic                                      |
| `bridge-wasm`      | `infra/rust-bridge/bridge-wasm/`  | -      | WASM transport for bridge                              |
| `bridge-delegate`  | `infra/rust-bridge/bridge-delegate/` | -   | Delegate transport for bridge                          |
| `bridge-tauri`     | `infra/rust-bridge/bridge-tauri/` | -      | Tauri transport for bridge                             |
| `bridge-napi`      | `infra/rust-bridge/bridge-napi/`  | -      | N-API transport for bridge                             |
| `bridge-ts`        | `infra/rust-bridge/bridge-ts/`    | -      | TypeScript codegen for bridge                          |

### Runtime Crates

| Crate              | Location              | Lines  | Purpose                                                |
| ------------------ | --------------------- | ------ | ------------------------------------------------------ |
| `spreadsheet-os`   | `runtime/src-tauri/`  | ~9K    | Tauri desktop app shell, IPC commands, plugins         |

Shared workspace dependencies: `serde`, `serde_json`, `uuid`, `chrono`, `thiserror`, `tracing`, `yrs`

Release profile: `opt-level = 3`, LTO enabled, single codegen unit.

## Contracts Sub-paths

The `contracts` package exports types via sub-paths for tree-shaking. The full list of sub-path exports can be found in `contracts/package.json` under the `exports` field.

## Excel Functions (Rust compute-core)

508+ Excel-compatible functions implemented in Rust across 10 categories:

| Category             | Count |
| -------------------- | ----- |
| Statistical          | 143   |
| Math                 | 77    |
| Engineering          | 54    |
| Financial            | 52    |
| Text                 | 44    |
| Lookup & Reference   | 25    |
| Date/Time            | 23    |
| Information          | 13    |
| Database             | 12    |
| Logical              | 10    |

Function modules are organized under `compute/core/crates/compute-functions/src/` with sub-modules for each category (e.g., `statistical/`, `financial/`, `text/`, `math/`).

## Adding a New Package

```bash
{package-name}/
├── src/
│   └── index.ts          # Public exports
├── __tests__/
│   └── {name}.test.ts
├── package.json          # @mog/{name}
├── tsconfig.json
└── jest.config.cjs
```

Dependencies should only point to `contracts` and packages in lower layers.
