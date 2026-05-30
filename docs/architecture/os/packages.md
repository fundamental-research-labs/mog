# Package Structure

The Spreadsheet OS consists of packages organized in layers. Package membership
is defined by `pnpm-workspace.yaml`, the root `Cargo.toml`, package manifests,
and the import-boundary rule in `tools/eslint-plugin-mog/import-boundaries.cjs`.

## Dependency Graph

```
Public SDK/runtime surfaces
  @mog-sdk/node
  @mog-sdk/embed
  @mog-sdk/spreadsheet-app
       |
  @mog-sdk/contracts, @mog-sdk/wasm, @mog-sdk/sheet-view

Workspace app
  apps/spreadsheet
       |
  shell, ui
       |
  views/sheet-view
       |
  kernel
       |
  contracts + types/*

Hardware and engine layer
  compute/*, file-io/*, canvas/*, charts, table-engine,
  spreadsheet-utils, typeset/math-engine, infra/*
```

Lower layers provide contracts, engines, adapters, and primitives. Higher layers
compose those pieces into the shell, app, embed, and SDK surfaces.

## Package Categories

### Type and Contract Layer

| Package | Purpose | Key Exports |
| --- | --- | --- |
| `contracts` (`@mog-sdk/contracts`) | Public contract barrel and pure runtime constants | Core types, API contracts, event types, schemas |
| `contracts/runtime-services` | Runtime service boundary contracts | Error envelopes, audit events, protocol/version types |
| `types/*` | Workspace type shards used by `contracts` and implementation packages | `@mog/types-core`, `@mog/types-data`, `@mog/types-rendering`, etc. |

### Core OS Packages

| Package | Purpose | Key Exports |
| --- | --- | --- |
| `kernel` (`@mog-sdk/kernel`) | Workbook API, document factory, data services, undo/checkpoint/clipboard service types | `createWorkbook`, `DocumentFactory`, workbook API types |
| `views/sheet-view` (`@mog-sdk/sheet-view`) | Public sheet rendering/view contract surface | Sheet view host and event types |
| `shell` (`@mog/shell`) | App host, shell bootstrap, Radix-based UI primitives, focus machine | `ShellHost`, `AppSlot`, `createShell`, `focusMachine` |
| `ui` (`@mog/ui`) | Kernel-agnostic data-view and record/table UI components | Kanban, calendar, gallery, timeline, table and field components |

### Runtime and SDK Packages

| Package | Purpose | Key Exports |
| --- | --- | --- |
| `runtime/sdk` (`@mog-sdk/node`) | Headless Node.js SDK with formula compute and XLSX file I/O | Node SDK entry point |
| `runtime/embed` (`@mog-sdk/embed`) | Read-only embed package | Core embed, React, web-component, config exports |
| `runtime/spreadsheet-app` (`@mog-sdk/spreadsheet-app`) | Full spreadsheet app embed for trusted same-origin hosts | App embed entry point and CSS assets |
| `runtime/spreadsheet-testing` | Workspace-private spreadsheet testing helpers | Fixtures and test helpers |
| `runtime/test-host` | Workspace-private deterministic host for host-contract integration tests | Trusted test host |

### Apps

| Package | Purpose |
| --- | --- |
| `apps/spreadsheet` (`@mog/app-spreadsheet`) | Default spreadsheet app and classic grid view |

### Computation Layer

| Package | Purpose | Key Exports |
| --- | --- | --- |
| `compute/core` | Rust compute engine: parser, evaluator, dependency graph, scheduler, CF, tables, pivots, storage, what-if, and file I/O integration | `compute-core` crate |
| `compute/core/crates/compute-functions` | Rust spreadsheet function implementations | Function registry and pure functions |
| `compute/core/crates/compute-formats` | Rust number-format engine | Locale, color, currency, and format logic |
| `compute/core/crates/compute-table` | Rust table engine | Filters, sort, slicers, structured refs, styles |
| `compute/core/crates/compute-cf` | Conditional-format evaluation | CF evaluation engine |
| `compute/core/crates/compute-pivot` | Pivot-table computation | Pivot engine |
| `compute/core/crates/compute-schema` | Schema validation and inference | Validation/coercion engine |
| `compute/api` | Rust API facade over `compute-core` | `compute-api` crate |
| `compute/wasm` and `compute/wasm/npm` | WASM binding layer and published browser package | `compute-core-wasm`, `@mog-sdk/wasm` |
| `compute/napi` and `compute/napi/npm/*` | Node native binding layer and platform binary wrappers | `compute-core-napi`, `@mog-sdk/*` binary packages |
| `compute/pyo3` | Python binding layer | `compute-core-pyo3` crate |

### File I/O Layer

| Package | Purpose | Key Exports |
| --- | --- | --- |
| `file-io/xlsx/parser` | Rust XLSX parser and WASM parser package scaffold | `xlsx-parser`, `@mog/xlsx-parser-wasm` |
| `file-io/xlsx-api` | Rust API facade for the XLSX parser | `xlsx-api` crate |
| `file-io/xlsx/bridge` | TypeScript bridge/types for the Rust XLSX parser | `@mog/xlsx-parser` |
| `file-io/csv-parser` | Rust CSV parser feeding the same hydration path | `csv-parser` crate |
| `file-io/ooxml/types` | OOXML vocabulary for lossless round-tripping | `ooxml-types` crate |
| `file-io/print-export` | HTML/print/PDF export package | `@mog/print-export`, `createPdfExporter` |
| `file-io/pdf/graphics` | PDF graphics primitives | `@mog/pdf-graphics` |
| `file-io/pdf/layout` | PDF pagination/layout primitives | `@mog/pdf-layout` |
| `file-io/pdf/core` | Rust PDF core crate | `pdf-core` crate |

### Canvas Layer

The canvas system uses a multi-package architecture under `canvas/`:

| Package | Purpose | Key Exports |
| --- | --- | --- |
| `canvas/engine` (`@mog/canvas-engine`) | Generic multi-canvas render loop, layer management, scheduler, input, hit testing | `createCanvasEngine`, `CanvasLayer` |
| `canvas/grid-renderer` (`@mog/grid-renderer`) | Cell, background, selection, header, and UI layers | `createGridLayers`, layer factories |
| `canvas/drawing-canvas` (`@mog/drawing-canvas`) | Floating object scene graph and render bridges | `SceneGraph`, `createDrawingLayer` |
| `canvas/overlay` (`@mog/canvas-overlay`) | Screen-space UX chrome such as handles, guides, and rubber band | `OverlayLayer`, `createOverlayLayer` |
| `canvas/grid-canvas` (`@mog/grid-canvas`) | Thin composition facade wiring the grid renderer and viewport layout | `createGridRenderer`, `computeViewportLayout` |
| `canvas/spatial` (`@mog/spatial`) | Spatial indexing and hit testing | `createSpatialIndex`, hit-test helpers |

### Drawing Subpackages

| Subpackage | Purpose | Key Exports |
| --- | --- | --- |
| `canvas/drawing/engine` (`@mog/drawing-engine`) | Floating-object composition, z-ordering, grouping, anchoring, rendering helpers | Drawing operations and renderers |
| `canvas/drawing/shapes` (`@mog/shape-engine`) | OOXML shape path generation and shape metadata | Shape path generation, preset registry |
| `canvas/drawing/geometry` (`@mog/geometry`) | Pure 2D geometry primitives | Matrix, transform, path, rect, connector routing helpers |
| `canvas/drawing/ink` (`@mog/ink-engine`) | Ink stroke creation, smoothing, erasing, and spatial indexing | Ink stroke and pressure helpers |
| `canvas/drawing/diagram` (`@mog/diagram-engine`) | Diagram layout, styles, gallery, and OOXML diagram parsing/layout engine | Diagram model, layout, styles, OOXML engine |
| `canvas/drawing/text-effects` (`@mog/text-effects-engine`) | OOXML text effects and text warp engine | Warp presets, effects, drawing-object output |

### Supporting Engines and Utilities

| Package | Purpose | Key Exports |
| --- | --- | --- |
| `charts` (`@mog/charts`) | Excel-compatible charting and custom rendering | `ChartEngine`, chart builders, grammar/primitives |
| `table-engine` (`@mog/table-engine`) | Pure TypeScript table filtering, sorting, slicers, structured refs, visibility, styles | Table, filter, sort, slicer helpers |
| `spreadsheet-utils` (`@mog/spreadsheet-utils`) | Shared spreadsheet helpers and UI metadata | A1 helpers, number-format helpers, function catalog/registry |
| `typeset/math-engine` (`@mog/math-engine`) | OMML/LaTeX equation parsing, conversion, layout, diagnostics | `parseOMML`, `parseLatex`, `layoutEquation` |
| `infra/culture` (`@mog/culture`) | Locale/culture support | Culture registry and normalization helpers |
| `infra/icons` (`@mog/icons`) | Generated SVG icon components | React icon components |
| `infra/platform` (`@mog/platform`) | Platform abstraction for desktop and web hosts | `createPlatform`, `isTauri`, platform identity/errors |
| `infra/platform/memory` (`@mog/platform-memory`) | In-memory platform implementation | Memory filesystem/platform helpers |
| `infra/env` (`@mog/env`) | Environment detection/config helpers | Environment APIs |
| `infra/transport` (`@mog/transport`) | Rust bridge transport for WASM, NAPI, and Tauri | `createTransport`, transport implementations |
| `infra/rust-bridge/*` | Rust bridge code generation and runtime support | Bridge macros, generated TS types, N-API/WASM/Tauri helpers |

Number formatting is not a standalone workspace package. The current surfaces
are `@mog-sdk/contracts/number-formats`, `@mog/spreadsheet-utils/number-formats`,
`@mog/types-formatting`, and the Rust `compute-formats` crate.

## Deprecated or Removed Package Names

Legacy names that are not current workspace packages include:

| Legacy name | Current location |
| --- | --- |
| `@mog/spreadsheet-contracts` | `@mog-sdk/contracts` |
| `number-formats` | Contracts/utils/type shards plus `compute-formats` |
| `file-io` as a single TS package | Split under `file-io/xlsx`, `file-io/pdf`, and `file-io/print-export` |
| `canvas/lab` | Removed from the current workspace |
| `runtime/server` | Removed from the current workspace |
| `runtime/src-tauri` | Removed from the current workspace |

## Package Import Rules

### Dependency Direction

Lower layers cannot import higher layers:

```
types/contracts -> no implementation packages
hardware/engines -> types/contracts only, not kernel/views/shell/apps
kernel -> types/contracts/hardware, not views/shell/apps/kernel-host-internal
views -> lower layers, not shell/apps/kernel-host-internal
shell/ui -> lower layers, not apps/kernel-host-internal
apps -> lower layers, not kernel-host-internal
```

The import-boundary rule treats `types/` and `contracts/` as the bottom layer,
then `infra/`, `canvas/`, `charts`, `table-engine`, `spreadsheet-utils`,
`file-io`, `typeset`, and `compute` as the hardware layer.

### Cross-Layer Communication

Use public contracts and explicit APIs rather than importing across ownership
boundaries:

```typescript
// WRONG - kernel importing shell
import { GridCanvas } from '@mog/shell';

// CORRECT - shell or apps subscribe to kernel/API events
workbook.on('cellChanged', (event) => {
  view.invalidateCell(event.cellId);
});
```

## Adding a New Package

For a TypeScript workspace package:

```bash
my-package/
  src/
    index.ts
  __tests__/
    my-package.test.ts
  package.json
  tsconfig.json
  jest.config.cjs
```

Add TypeScript packages to `pnpm-workspace.yaml`. Add Rust crates to the root
`Cargo.toml` workspace. If the package participates in public boundary checks,
also update `tools/package-inventory.jsonc` and the import-boundary rule.

Dependencies should only point to packages in lower layers.

## Contracts Sub-paths

The `contracts` package exports types and pure values via sub-paths:

```typescript
import type { CellValue, CellFormat } from '@mog-sdk/contracts/core';
import type { CellChangedEvent, SpreadsheetEvent } from '@mog-sdk/contracts/events';
import type { ColumnSchema } from '@mog-sdk/contracts/schema';
import type { PivotTableConfig } from '@mog-sdk/contracts/pivot';
import type { CellAssertion } from '@mog-sdk/contracts/testing';
import type { ConnectionRef } from '@mog-sdk/contracts/connections';
import type { Workbook } from '@mog-sdk/contracts/api';
```

## Shell Sub-paths

Shell exports host components, bootstrap utilities, hooks, contexts, platform
helpers, and UI primitives:

```typescript
import { ShellHost, AppSlot, focusMachine } from '@mog/shell';
import { Button, Dialog, Popover } from '@mog/shell/components/ui';
import { createShell } from '@mog/shell/bootstrap';
```

## Excel Functions

Spreadsheet formula support is implemented by the Rust compute engine and its
function crates, with inline-dispatched primitives in the evaluator. The UI
metadata catalog lives in `spreadsheet-utils/src/function-catalog.ts` and is
populated into the lightweight registry in `spreadsheet-utils/src/function-registry.ts`.

The catalog currently groups functions into Math, Statistical, Text, Logical,
Date & Time, Lookup & Reference, Financial, Information, Database, and
Engineering categories. Because the function set changes with engine work, use
the source catalog and `compute/core/crates/compute-functions/src/` for current
totals instead of duplicating exact per-category counts here.
