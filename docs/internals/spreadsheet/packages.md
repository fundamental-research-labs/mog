# Package Structure

This page summarizes the package layout for the spreadsheet workspace. The
source of truth for TypeScript packages is `pnpm-workspace.yaml`; individual
public entry points live in each package's `package.json` `exports` field. The
source of truth for Rust crates is the root `Cargo.toml` workspace.

## Dependency Graph

```text
@mog-sdk/contracts + types/*
        |
        v
spreadsheet-utils, table-engine, culture, env, platform, transport
        |
        v
@mog-sdk/kernel <---------------------- compute-core Rust workspace
        |                                      |
        |                         @mog-sdk/wasm, @mog/compute-core-napi
        v                                      |
views/sheet-view, canvas/*, drawing/*, charts, print-export, xlsx bridge
        |
        v
@mog/shell + @mog/app-spreadsheet
        |
        v
@mog-sdk/embed, @mog-sdk/spreadsheet-app, @mog-sdk/node
```

The current workspace no longer contains a `runtime/server` package or a
`runtime/src-tauri` Rust crate. Runtime integration is represented by the
runtime packages, transport package, and Rust bridge crates listed below.

## TypeScript Workspace Packages

| Group | Packages | Purpose |
| --- | --- | --- |
| Contracts and types | `@mog-sdk/contracts`, `@mog-sdk/runtime-service-contracts`, `@mog/types-*`, `@mog-sdk/types-*` | Public contract surface and split type packages used by contracts, kernel, views, and runtimes. |
| Kernel and views | `@mog-sdk/kernel`, `@mog/kernel-host-internal`, `@mog-sdk/sheet-view` | Kernel APIs, trusted host adapter internals, and the public sheet-view substrate. |
| Runtime SDKs | `@mog-sdk/embed`, `@mog-sdk/spreadsheet-app`, `@mog-sdk/node`, `@mog-sdk/wasm`, `@mog/compute-core-napi`, platform native packages under `compute/napi/npm/` | Public embedding, full app embedding, Node SDK, browser WASM, and native Node bindings. |
| App and shell | `@mog/shell`, `@mog/app-spreadsheet`, `@mog/spreadsheet-testing`, `@mog/test-host` | Spreadsheet application composition, shell UI, workspace-private testing helpers, and test host wiring. |
| Rendering | `@mog/canvas-engine`, `@mog/grid-renderer`, `@mog/drawing-canvas`, `@mog/canvas-overlay`, `@mog/grid-canvas`, `@mog/spatial`, `@mog/charts`, `@mog/ui`, `@mog/icons` | Canvas engine layers, grid rendering, floating-object rendering, charting, UI components, and icons. |
| Drawing and typeset | `@mog/drawing-engine`, `@mog/shape-engine`, `@mog/ink-engine`, `@mog/diagram-engine`, `@mog/text-effects-engine`, `@mog/geometry`, `@mog/math-engine` | Floating-object operations, shape geometry, ink, diagrams, text effects, geometry primitives, and equation layout. |
| File I/O | `@mog/xlsx-parser-wasm`, `@mog/xlsx-parser`, `@mog/xlsx-tooling`, `@mog/print-export`, `@mog/pdf-graphics`, `@mog/pdf-layout` | XLSX parser package and bridge, XLSX tooling, print/PDF export, and PDF layout/graphics helpers. |
| Infrastructure | `@mog/spreadsheet-utils`, `@mog/table-engine`, `@mog/platform`, `@mog/platform-memory`, `@mog/transport`, `@mog/culture`, `@mog/env`, `@mog/bridge-ts`, `@rust-bridge/client` | Shared utilities, table operations, platform abstractions, transport selection, locale helpers, environment helpers, and generated bridge bindings. |
| Tooling | `@mog/devtools`, `eslint-plugin-mog` | Development tools and import-boundary linting. |

## Contracts and Type Packages

`@mog-sdk/contracts` is the public contract package. Its `exports` field
contains the current sub-path surface, including areas such as `./api`,
`./core`, `./events`, `./number-formats`, `./rendering`, `./ribbon`, `./views`,
and `./diagram`.

The `types/*` packages hold split type surfaces that contracts and higher
layers consume. Examples include `@mog/types-core`, `@mog/types-rendering`,
`@mog/types-formatting`, `@mog/types-events`, `@mog-sdk/types-document`, and
`@mog-sdk/types-host`.

`@mog-sdk/runtime-service-contracts` is a workspace-private contracts package
for runtime service envelopes, audit events, protocol versions, and deployment
types.

## Core and Compute

| Package | Location | Purpose | Notable exports or entry points |
| --- | --- | --- | --- |
| `@mog-sdk/kernel` | `kernel/` | Kernel APIs and document/runtime integration. | `.`, `./api`, `./app-api`, `./security`, `./keyboard`, `./storage`, `./testing`, `./services/capabilities`, `./contracts/api`. |
| `@mog/kernel-host-internal` | `kernel/host-internal/` | Workspace-private trusted host adapter entry. | `.` |
| `@mog/transport` | `infra/transport/` | Runtime transport selection for NAPI, Tauri IPC, or WASM. | `createTransport` and transport helpers. |
| `@mog-sdk/wasm` | `compute/wasm/npm/` | Browser package for the `compute-core-wasm` Rust crate. | `.`, `./wasm`. |
| `@mog/compute-core-napi` | `compute/napi/` | Native Node binding package for `compute-core-napi`. | Native addon entry point plus platform packages under `compute/napi/npm/`. |

`@mog/transport` treats compute and XLSX commands as a single runtime module per
platform: native addon for Node, Tauri IPC for desktop hosts, and
`@mog-sdk/wasm` for web hosts.

## File I/O

| Package or crate | Location | Purpose |
| --- | --- | --- |
| `@mog/xlsx-parser-wasm` / `xlsx-parser` | `file-io/xlsx/parser/` | Rust XLSX parser package and crate. The crate has native, parallel, CLI, corpus, and WASM-facing modes. |
| `@mog/xlsx-parser` | `file-io/xlsx/bridge/` | TypeScript bridge for WASM lifecycle, progress/types exports, and worker orchestration. |
| `@mog/xlsx-tooling` | `file-io/xlsx/tooling/` | XLSX development tooling, benchmarks, and fixture generation. |
| `xlsx-api` | `file-io/xlsx-api/` | Rust API facade over the parser. |
| `csv-parser` | `file-io/csv-parser/` | Rust CSV parser integrated with the same parse-output path. |
| `ooxml-types` | `file-io/ooxml/types/` | Rust OOXML vocabulary and generated/shared types. |
| `@mog/print-export` | `file-io/print-export/` | Spreadsheet print and PDF export APIs. |
| `@mog/pdf-graphics` | `file-io/pdf/graphics/` | PDF graphics primitives. |
| `@mog/pdf-layout` | `file-io/pdf/layout/` | PDF pagination and layout helpers. |
| `pdf-core` | `file-io/pdf/core/` | Rust PDF core crate. |

`@mog/print-export` exports `SpreadsheetPdfExporter`, `createPdfExporter`,
HTML table/style generation helpers, print handling, and pagination types from
`@mog/pdf-layout`.

## Rendering

**Canvas packages**:

```text
@mog/canvas-engine
    -> @mog/grid-renderer
    -> @mog/drawing-canvas
    -> @mog/canvas-overlay
        -> @mog/grid-canvas
            -> views/sheet-view and spreadsheet app packages
```

| Package | Location | Purpose | Notable exports |
| --- | --- | --- | --- |
| `@mog/canvas-engine` | `canvas/engine/` | Generic multi-canvas infrastructure, coordinate spaces, scheduling, dirty rects, input, and hit testing. | `createCanvasEngine`, canvas layer and geometry types. |
| `@mog/grid-renderer` | `canvas/grid-renderer/` | Spreadsheet cell, header, selection, UI, and specialized grid layers. | Layer factories, `createGridLayers`, viewport/layout helpers. |
| `@mog/drawing-canvas` | `canvas/drawing-canvas/` | Floating object scene graph, bridge adapters, hit map, and drawing layer factory. | `SceneGraph`, `BridgeRegistry`, `HitMap`, `createDrawingLayer`. |
| `@mog/canvas-overlay` | `canvas/overlay/` | Screen-space handles, guides, rubber band, drag preview, and ink preview. | `OverlayLayer`, `createOverlayLayer`. |
| `@mog/grid-canvas` | `canvas/grid-canvas/` | Composition facade that wires grid-renderer, drawing-canvas, overlay, and viewport layout. | `createGridRenderer`, `GridRenderScheduler`, `computeViewportLayout`. |
| `@mog/spatial` | `canvas/spatial/` | Spatial indexing and hit-test helpers. | `createSpatialIndex`, `GridSpatialIndex`, hit-test pipeline helpers. |

## Drawing and Typeset

Drawing-related packages live under `canvas/drawing/`; package names keep their
published names.

| Package | Location | Purpose | Notable exports |
| --- | --- | --- | --- |
| `@mog/drawing-engine` | `canvas/drawing/engine/` | Pure floating-object operations: z-order, grouping, anchors, layout, rendering primitives, and diagnostics. | Z-order helpers, grouping helpers, anchor resolution, canvas/SVG renderers. |
| `@mog/shape-engine` | `canvas/drawing/shapes/` | Shape path generation and OOXML custom geometry. | `generateShapePath`, custom geometry helpers, preset registry. |
| `@mog/ink-engine` | `canvas/drawing/ink/` | Ink stroke creation, smoothing, spatial indexing, intersections, erasing, and pressure mapping. | Stroke, eraser, spatial, and pressure helpers. |
| `@mog/diagram-engine` | `canvas/drawing/diagram/` | Diagram models, layouts, styles, gallery, and partial OOXML layout engine. | `createDiagram`, `computeLayout`, style/theme helpers, `DataModel`. |
| `@mog/text-effects-engine` | `canvas/drawing/text-effects/` | OOXML text warp presets, path text layout, effects, and drawing-object output. | `warpText`, preset registry, effect helpers. |
| `@mog/geometry` | `canvas/drawing/geometry/` | 2D geometry primitives and path/transform utilities. | `Matrix`, `Transform`, `PathOps`, `Rect`, connector routing. |
| `@mog/math-engine` | `typeset/math-engine/` | OMML and LaTeX parsing/conversion, equation layout, templates, render plans, and diagnostics. | `parseOMML`, `parseLatex`, `latexToOmml`, `layoutEquation`, `layoutToRenderPlan`. |

## Application and Runtime Packages

| Package | Location | Purpose | Notable exports |
| --- | --- | --- | --- |
| `@mog/shell` | `shell/` | Shell UI, app registry, context, hooks, capabilities, host/app integration, and styling. | `.`, `./bootstrap`, `./context`, `./components`, `./components/ui`, `./capabilities`, `./hooks`, `./hooks/keyboard`, `./hooks/app-data`, `./styles`, `./platform`, `./host/app-registry`, `./apps`, `./apps/types`. |
| `@mog/app-spreadsheet` | `apps/spreadsheet/` | Workspace-private default spreadsheet app. | `.`, `./manifest`, `./register`, `./embed-runtime`, `./services`, chrome/hook entries. |
| `@mog-sdk/sheet-view` | `views/sheet-view/` | Public view-layer substrate for sheet rendering. | `createSheetView`, `createSheetViewDataSourceFromWorkbook`, skin helpers, public view types. |
| `@mog-sdk/embed` | `runtime/embed/` | Public read-only embeddable component. | `.`, `./react`, `./web-component`, `./config`. |
| `@mog-sdk/spreadsheet-app` | `runtime/spreadsheet-app/` | Public full spreadsheet app embed for trusted same-origin hosts. | `.`, CSS exports. |
| `@mog-sdk/node` | `runtime/sdk/` | Public headless Node.js SDK. | `.` |
| `@mog/spreadsheet-testing` | `runtime/spreadsheet-testing/` | Workspace-private spreadsheet testing utilities. | `.`, `./fixtures`. |
| `@mog/test-host` | `runtime/test-host/` | Workspace-private deterministic trusted test host. | `.` |

## OS and Infrastructure Packages

| Package | Location | Purpose |
| --- | --- | --- |
| `@mog/ui` | `ui/` | Kernel-agnostic UI components for data views, records, table controls, and fields. |
| `@mog/platform` | `infra/platform/` | Browser/Tauri platform abstraction, filesystem/path errors, identity, menus, keyboard layout, and secure invoke helpers. |
| `@mog/platform-memory` | `infra/platform/memory/` | In-memory filesystem implementation. |
| `@mog/culture` | `infra/culture/` | Culture and locale helpers. |
| `@mog/env` | `infra/env/` | Environment detection/config helpers. |
| `@mog/icons` | `infra/icons/` | React SVG icon components. |
| `@mog/bridge-ts` | `infra/rust-bridge/bridge-ts/` | Generated TypeScript bindings for Rust bridge surfaces. |
| `@rust-bridge/client` | `infra/rust-bridge/client/` | TypeScript bridge client interfaces. |

## Rust Workspace

The root `Cargo.toml` workspace currently contains these crate groups.

### Core Compute Crates

- Top-level crates: `compute-core`, `compute-api`, `compute-core-wasm`,
  `compute-core-napi`, `compute-core-pyo3`, and `domain-types`.
- Compute sub-crates under `compute/core/crates/`: `compute-parser`,
  `compute-stats`, `compute-pivot`, `compute-relational`, `compute-table`,
  `compute-functions`, `compute-cf`, `compute-formats`, `compute-schema`,
  `compute-graph`, `compute-fill`, `compute-charts`, `compute-chart-render`,
  `compute-solver`, `compute-collab`, `compute-coordinator`,
  `compute-document`, `compute-wire`, `compute-layout-index`,
  `compute-text-measurement`, `compute-screenshot`, and `compute-security`.
- Shared type crates under `compute/core/crates/types/`: `value-types`,
  `cell-types`, `workbook-types`, `formula-types`, `pivot-types`,
  `snapshot-types`, `finite-at-boundary`, and
  `finite-at-boundary-walker`.

### File I/O Crates

- `xlsx-parser`, `xlsx-api`, `xlsx-test-contracts`, `xml-derive`,
  `csv-parser`, `ooxml-types`, and `pdf-core`.

### Rust Bridge Crates

- `bridge-describe`, `bridge-types`, `bridge-derive`, `bridge-ir`,
  `bridge-core`, `bridge-wasm`, `bridge-wasm-macros`, `bridge-delegate`,
  `bridge-delegate-macros`, `bridge-tauri`, `bridge-tauri-macros`,
  `bridge-napi`, `bridge-napi-macros`, `bridge-pyo3`,
  `bridge-pyo3-macros`, and `bridge-ts`.

Shared workspace dependencies include `serde`, `serde_json`, `uuid`,
`chrono`, `thiserror`, `tracing`, and `yrs`. The release profile uses
`opt-level = 3`, LTO, and a single codegen unit.

## Excel Functions

Formula evaluation lives in the Rust compute workspace. `compute-core` depends
on `compute-functions`, which is documented in `compute/core/Cargo.toml` as the
function library for 512+ Excel-compatible pure functions.

Function registration is centralized in
`compute/core/crates/compute-functions/src/registry.rs`. The registered
categories are math, text, logical, lookup, statistical, datetime, financial,
engineering, database, information, and web. Static UI metadata for function
names, categories, descriptions, and arity lives in
`spreadsheet-utils/src/function-catalog.ts`.

## Adding a New Package

For a new TypeScript package, add the package directory, define its
`package.json` with explicit `exports`, add the package to `pnpm-workspace.yaml`,
and follow the existing `tsconfig` and test setup used by neighboring packages.

```text
{package-name}/
  src/
    index.ts
  __tests__/
    {name}.test.ts
  package.json
  tsconfig.json
  jest.config.cjs
```

Keep dependencies aligned with the import-boundary layers and avoid adding
dependencies on workspace-private packages from public package surfaces.
