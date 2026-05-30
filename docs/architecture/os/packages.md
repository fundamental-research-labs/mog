# Package Structure

The Spreadsheet OS consists of packages organized in layers.

## Dependency Graph

```
                                  apps/spreadsheet
                                       │
                    ┌──────────────────┴──────────────────┐
                    │                                     │
                  shell                                kernel
                    │                                     │
                    └──────────────────┬──────────────────┘
                                       │
              ┌────────────────────────┼────────────────────────┐
              │                        │                        │
         domain-types              bridges                    ui
              │                        │
              │      ┌─────────────────┼──────────────────┐
              │      │                 │                  │
              │  compute-api        charts          compute-core
              │                                          │
              │                          @mog-sdk/wasm (wasm) / napi
              │                                          │
              │                   file-io           number-formats
              │                                          │
              └──────────────────────────────────────────┤
                                                         │
                                                    contracts

         ┌──────────────────────────────────────────────────────────────┐
         │                  Canvas Layer (canvas/)                       │
         │                                                              │
         │   engine ─── grid-renderer ─── grid-canvas                   │
         │                │                                             │
         │         drawing-canvas ─── overlay ─── spatial               │
         │                                                              │
         │   canvas/drawing/ (engine, shapes, geometry, ink,            │
         │                    diagram, text-effects)                    │
         │                                                              │
         │   canvas/lab (dev harness)                                   │
         └──────────────────────────────────────────────────────────────┘

         ┌──────────────────────────────────────────────────────────────┐
         │                  Standalone Engines                          │
         │                                                              │
         │   table-engine (TS filtering/sorting/slicers/visibility)     │
         └──────────────────────────────────────────────────────────────┘

         ┌──────────────────────────────────────────────────────────────┐
         │                  Rust/WASM & Desktop                         │
         │                                                              │
         │   compute-core ─── @mog-sdk/wasm ─── compute-core-napi        │
         │        │                                                     │
         │   runtime/src-tauri (desktop)                                 │
         └──────────────────────────────────────────────────────────────┘
```

## Package Categories

### Base Layer (No External Dependencies)

| Package          | Purpose                             | Key Exports                       |
| ---------------- | ----------------------------------- | --------------------------------- |
| `contracts`      | TypeScript interfaces, zero runtime | Types, events, schemas            |

### Core OS Packages

| Package          | Purpose                     | Key Exports                             |
| ---------------- | --------------------------- | --------------------------------------- |
| `kernel`         | Data layer, system services | APIs, EventBus, Clipboard, Undo         |
| `shell`          | App host, UI components     | ShellHost, AppSlot, AppLoader, machines |
| `ui`             | Radix-based UI primitives   | Button, Dialog, Popover, etc.           |

### Domain Layer

| Package               | Purpose                     | Key Exports                             |
| --------------------- | --------------------------- | --------------------------------------- |
| `domain-types`        | Shared domain type definitions | Domain types                         |
| `spreadsheet-utils`   | Spreadsheet utility functions  | Shared helpers                       |

### Computation Layer

| Package             | Purpose                                                                                                          | Key Exports                         |
| ------------------- | ---------------------------------------------------------------------------------------------------------------- | ----------------------------------- |
| `compute-core`      | Rust compute engine: formula parser, evaluator, 454 functions, dep graph, scheduler, CF, tables, pivots, storage, what-if | Full spreadsheet computation (IPC/WASM) |
| `compute-api`       | TypeScript API layer for compute-core                                                                            | Compute interfaces                  |
| `charts`            | Custom chart rendering                                                                                           | `ChartEngine`, chart types          |

### Canvas Layer

The canvas system uses a multi-package architecture under `canvas/`:

| Package                | Purpose                                                     | Key Exports                         |
| ---------------------- | ----------------------------------------------------------- | ----------------------------------- |
| `canvas/engine`        | Generic multi-canvas render loop, priority scheduler, input | `createCanvasEngine`, `CanvasLayer` |
| `canvas/grid-renderer` | Cell, background, selection, header, and UI layers         | `createGridLayers`                  |
| `canvas/drawing-canvas` | Floating object scene graph and type renderers            | `DrawingLayer`, `SceneGraph`        |
| `canvas/overlay`       | Screen-space UX chrome (handles, guides, rubber band)       | `OverlayLayer`                      |
| `canvas/grid-canvas`   | Thin composition facade wiring the canvas packages          | `GridRenderer` contract             |
| `canvas/spatial`       | Spatial indexing and hit testing                             | Spatial data structures             |
| `canvas/drawing`       | Drawing subsystem (shapes, geometry, ink, diagram, text-effects) | Drawing engine, renderers          |
| `canvas/lab`           | Interactive test harness for canvas development             | Dev harness                         |

### Drawing Subpackages (canvas/drawing/)

| Subpackage                | Purpose                       | Key Exports                    |
| ------------------------- | ----------------------------- | ------------------------------ |
| `canvas/drawing/engine`   | Drawing/rendering operations  | Drawing engine, renderers      |
| `canvas/drawing/shapes`   | 2D shape manipulation         | Shape types, geometry          |
| `canvas/drawing/geometry` | Geometric calculations        | Points, rects, transforms      |
| `canvas/drawing/ink`      | Pen/ink input and rendering   | Ink renderer, input handlers   |
| `canvas/drawing/diagram`      | Diagram compatibility engine  | OOXML diagram parser, layout   |
| `canvas/drawing/text-effects` | Text-effects styling          | OOXML text-effects renderer    |

### Formatting

| Package          | Purpose                       | Key Exports                    |
| ---------------- | ----------------------------- | ------------------------------ |
| `number-formats` | Number formatting             | Format engine                  |
| `typeset`        | Text typesetting              | Typeset engine                 |

### Standalone Engines

| Package          | Purpose                                         | Key Exports                    |
| ---------------- | ----------------------------------------------- | ------------------------------ |
| `table-engine`   | TS table filtering/sorting/visibility            | Filter, sort, slicer           |

### Rust/WASM Layer

| Package              | Purpose                          | Key Exports                    |
| -------------------- | -------------------------------- | ------------------------------ |
| `@mog-sdk/wasm` (`compute-core-wasm`) | WASM bindings for compute-core | JS/WASM bridge |
| `compute-core-napi`  | Node.js native bindings          | N-API bridge                   |

### File I/O Layer

| Package         | Purpose                          | Key Exports                             |
| --------------- | -------------------------------- | --------------------------------------- |
| `file-io`       | XLSX/CSV import/export           | `importXlsx`, `exportXlsx`, `importCsv` |

### Runtime Layer (runtime/)

| Package                  | Purpose                          | Key Exports                        |
| ------------------------ | -------------------------------- | ---------------------------------- |
| `runtime/server`         | WebSocket collaboration server   | `CollaborationServer`, y-websocket |
| `runtime/sdk`            | Runtime SDK                      | SDK exports                        |
| `runtime/src-tauri`      | Tauri desktop app shell          | Desktop framework                  |

### Infrastructure (infra/)

| Package              | Purpose                 | Key Exports                        |
| -------------------- | ----------------------- | ---------------------------------- |
| `infra/icons`        | SVG icon library        | React icon components              |
| `infra/culture`      | Locale/culture support  | Culture data                       |
| `infra/platform`     | Platform abstractions   | Platform APIs                      |
| `infra/transport`    | Network transport       | Transport layer                    |
| `infra/rust-bridge`  | Rust bridge utilities   | Rust interop                       |

### Apps

| Package             | Purpose                       |
| ------------------- | ----------------------------- |
| `apps/spreadsheet`  | Spreadsheet app with XLSX import/export and formula compatibility |

## Deprecated Packages

Legacy directories that have been removed or consolidated.

## Package Import Rules

### Dependency Direction

Lower layers cannot import higher layers:

```
kernel can import domain-types, contracts
shell can import kernel
apps can import shell and kernel

kernel cannot import shell
domain-types cannot import kernel
contracts cannot import anything except yjs types
```

### Cross-Layer Communication

Use events, not imports:

```typescript
// WRONG - kernel importing shell
import { GridCanvas } from '@mog/shell';

// CORRECT - shell subscribes to kernel events
kernel.eventBus.on('cell:changed', (event) => {
  view.invalidateCell(event.cellId);
});
```

## Adding a New Package

```bash
my-package/
  src/
    index.ts          # Public exports
  __tests__/
    my-package.test.ts
  package.json          # @mog/my-package
  tsconfig.json
  jest.config.cjs
```

Dependencies should only point to packages in lower layers.

## Contracts Sub-paths

The `contracts` package exports types via sub-paths:

```typescript
import { CellValue, CellFormat } from '@mog/spreadsheet-contracts/core';
import { CellChangedEvent } from '@mog/spreadsheet-contracts/events';
import { ColumnSchema } from '@mog/spreadsheet-contracts/schema';
import { PivotTableConfig } from '@mog/spreadsheet-contracts/pivot';
import { Snapshot, Branch } from '@mog/spreadsheet-contracts/versioning';
import { CellAssertion } from '@mog/spreadsheet-contracts/testing';
import { DataConnection } from '@mog/spreadsheet-contracts/connections';
import { CommandBarConfig } from '@mog/spreadsheet-contracts/command-bar';
```

## Shell Sub-paths

Shell exports host components, machines, hooks, and contexts:

```typescript
import { ShellHost, AppSlot } from '@mog/shell';
import { FocusMachine } from '@mog/shell/machines';
```

## Excel Functions (Rust compute-core)

454 spreadsheet formula functions implemented in Rust across 10 categories, with compatibility tests for Microsoft Excel behavior where applicable:

| Category           | Count |
| ------------------ | ----- |
| Statistical        | 143   |
| Math               | 74    |
| Financial          | 52    |
| Text               | 44    |
| Engineering        | 37    |
| Lookup & Reference | 36    |
| Date/Time          | 25    |
| Logical            | 17    |
| Information        | 14    |
| Database           | 12    |
