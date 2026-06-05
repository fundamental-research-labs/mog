# Package Structure

This page summarizes the package layout for the spreadsheet workspace. TypeScript
workspace membership comes from `pnpm-workspace.yaml`; Rust workspace membership
comes from the root `Cargo.toml`. Publication status and package boundary
disposition come from package manifests plus `tools/package-inventory.jsonc`.
Source import direction is enforced by
`tools/eslint-plugin-mog/import-boundaries.cjs`.

## Status Vocabulary

- **shipped public**: a package intended as an external setup path in the current
  package inventory.
- **public-experimental**: visible package or subpath surface that exists but
  does not yet carry a long-term compatibility promise.
- **public binary-wrapper**: a public package whose main job is to ship WASM or
  native runtime artifacts for a public facade.
- **workspace-internal**: a private package or Rust crate used inside this
  monorepo, not an external setup path.
- **reserved**: a private package or subpath kept for a possible future public
  surface.
- **not shipped**: a package or product surface that is absent from the current
  workspace.

## Dependency Graph

```text
Shipped public facades
  @mog-sdk/sdk
  @mog-sdk/embed
  @mog-sdk/spreadsheet-app
  @mog-sdk/contracts
  @mog-sdk/sheet-view
  @mog-sdk/wasm and @mog-sdk/* native binary wrappers

Runtime and app composition
  runtime/sdk, runtime/embed, runtime/spreadsheet-app
        |
  apps/spreadsheet, shell, ui
        |
  views/sheet-view
        |
  kernel (@mog-sdk/kernel, workspace-internal)
        |
  compute/*, file-io/*, canvas/*, charts, table-engine,
  spreadsheet-utils, typeset/math-engine, infra/*
        |
  contracts + types/*
```

Allowed imports point downward through the implementation layers. The public
runtime facades are packaging boundaries over lower-level code. In particular,
`runtime/spreadsheet-app` is a public bundle-composition package that imports
private app/shell/kernel code internally while using its own boundary check to
keep those private types and implementation imports out of public declarations.

The current workspace does not contain `runtime/server`, `runtime/src-tauri`, or
`canvas/lab` packages. Runtime integration is represented by the runtime
packages, `infra/transport`, and the Rust bridge crates listed below.

## TypeScript Workspace Packages

| Group | Current status | Packages | Purpose |
| --- | --- | --- | --- |
| Contracts and types | `@mog-sdk/contracts` is shipped public; type shards and runtime-service contracts are workspace-internal. | `@mog-sdk/contracts`, `@mog-sdk/runtime-service-contracts`, `@mog/types-*`, `@mog-sdk/types-*` | Public contract barrel plus private split type packages used by contracts, kernel, views, and runtimes. |
| Kernel and views | `@mog-sdk/kernel` and `@mog/kernel-host-internal` are workspace-internal; `@mog-sdk/sheet-view` is shipped public. | `@mog-sdk/kernel`, `@mog/kernel-host-internal`, `@mog-sdk/sheet-view` | Kernel implementation, trusted host adapter internals, and the public sheet-view substrate. |
| Runtime SDKs | `@mog-sdk/sdk`, `@mog-sdk/embed`, and `@mog-sdk/spreadsheet-app` are shipped public; embed subpaths are public-experimental; WASM/native binaries are public binary wrappers; `@mog/compute-core-napi` is private. | `@mog-sdk/sdk`, `@mog-sdk/embed`, `@mog-sdk/spreadsheet-app`, `@mog-sdk/wasm`, `@mog/compute-core-napi`, platform packages under `compute/napi/npm/` | Headless SDK, browser embed packages, browser WASM, private N-API binding package, and public platform binary wrappers. |
| App and shell | Private app, reserved shell/UI, and workspace-internal test helpers. | `@mog/app-spreadsheet`, `@mog/shell`, `@mog/ui`, `@mog/spreadsheet-testing`, `@mog/test-host` | Spreadsheet application composition, shell/UI code, test helpers, and deterministic test host wiring. |
| Rendering and drawing | Private/bundle-only or workspace-internal. | `@mog/canvas-engine`, `@mog/grid-renderer`, `@mog/drawing-canvas`, `@mog/canvas-overlay`, `@mog/grid-canvas`, `@mog/spatial`, `@mog/charts`, `@mog/drawing-engine`, `@mog/shape-engine`, `@mog/ink-engine`, `@mog/diagram-engine`, `@mog/text-effects-engine`, `@mog/geometry`, `@mog/math-engine`, `@mog/icons` | Canvas layers, grid rendering, floating-object rendering, charting, shape/ink/diagram/text-effect engines, equation layout, and generated icons. |
| File I/O | Workspace-internal, generated-asset, or dev-eval. | `@mog/xlsx-parser-wasm`, `@mog/xlsx-parser`, `@mog/xlsx-tooling`, `@mog/print-export`, `@mog/pdf-graphics`, `@mog/pdf-layout` | XLSX parser package scaffold and bridge, XLSX tooling, print/PDF export, and PDF layout/graphics helpers. |
| Infrastructure and tools | Workspace-internal or dev-eval. | `@mog/spreadsheet-utils`, `@mog/table-engine`, `@mog/platform`, `@mog/platform-memory`, `@mog/transport`, `@mog/culture`, `@mog/env`, `@mog/bridge-ts`, `@rust-bridge/client`, `@mog/devtools`, `eslint-plugin-mog` | Shared spreadsheet utilities, table operations, platform abstractions, transport selection, locale/env helpers, generated bridge bindings, devtools, and import-boundary linting. |

## Contracts and Type Packages

`@mog-sdk/contracts` is the shipped public contract package. Its `exports` field
contains the current subpath surface, including areas such as `./api`, `./core`,
`./events`, `./number-formats`, `./rendering`, `./ribbon`, `./views`,
`./diagram`, `./connections`, and `./security`. Most contract subpaths are
classified as public-experimental in `tools/package-inventory.jsonc`.

The `types/*` packages hold split type surfaces that contracts and higher layers
consume. Examples include `@mog/types-core`, `@mog/types-rendering`,
`@mog/types-formatting`, `@mog/types-events`, `@mog-sdk/types-document`,
`@mog-sdk/types-host`, and `@mog-sdk/types-app-platform`. These packages are
workspace-internal and `private: true`.

`@mog-sdk/runtime-service-contracts` is a workspace-internal contracts package
for runtime service envelopes, audit events, protocol versions, and deployment
types. It is not a public setup path.

## Core and Compute

| Package or source | Location | Current status | Purpose | Notable exports or entry points |
| --- | --- | --- | --- | --- |
| `@mog-sdk/kernel` | `kernel/` | workspace-internal; `private: true` | Canonical TypeScript workbook implementation, document lifecycle, services, app APIs, and compute bridge wiring. | Monorepo exports include `.`, `./api`, `./app-api`, `./security`, `./keyboard`, `./storage`, `./testing`, `./internal`, `./services/capabilities`, `./contracts/api`, and `./host-lifecycle-internal`. |
| `@mog/kernel-host-internal` | `kernel/host-internal/` | workspace-internal; `private: true` | Trusted host adapter entry for host-backed kernel document construction. | `.` |
| `@mog/transport` | `infra/transport/` | workspace-internal; `private: true` | Runtime transport selection for N-API, Tauri IPC, or WASM. | `createTransport`, transport-specific factories, N-API/WASM loaders, bridge errors, and transport helpers. |
| `@mog-sdk/wasm` | `compute/wasm/npm/` | public binary-wrapper | Browser package for the `compute-core-wasm` Rust crate. | `.`, `./wasm`. |
| `@mog/compute-core-napi` | `compute/napi/` | private; `private: true` | Local native binding package for `compute-core-napi`. It is not the public package users install. | Native addon entry point; N-API build metadata maps platform triples to public `@mog-sdk/*` packages. |
| `@mog-sdk/*` platform binaries | `compute/napi/npm/` | public binary-wrapper | Optional native platform packages used by `@mog-sdk/sdk`. | macOS arm64/x64, Linux arm64/x64 glibc/musl, and Windows x64 MSVC packages. |
| Python source (`mog-sdk`, import `mog`) | `compute/pyo3/` | public-experimental source; alpha in `pyproject.toml` | PyO3 binding layer over the compute engine. | `compute-core-pyo3` crate and Python package source under `compute/pyo3/python/mog`. |

`@mog/transport` treats compute and XLSX commands as a single runtime module per
platform: native compute addon for Node/headless, one Tauri IPC channel for
desktop hosts, and `@mog-sdk/wasm` for web hosts. Separate xlsx-specific runtime
modules are not part of the current runtime path.

## File I/O

| Package or crate | Location | Current status | Purpose |
| --- | --- | --- | --- |
| `@mog/xlsx-parser-wasm` / `xlsx-parser` | `file-io/xlsx/parser/` | generated-asset/private TS package plus workspace-internal Rust crate (`publish = false`) | Rust XLSX parser. The crate has native, parallel, CLI, corpus, and WASM-facing modes, but this TS package is not a public runtime dependency. |
| `@mog/xlsx-parser` | `file-io/xlsx/bridge/` | workspace-internal; `private: true` | TypeScript bridge for WASM lifecycle, progress/types exports, and worker orchestration around the parser. |
| `@mog/xlsx-tooling` | `file-io/xlsx/tooling/` | dev-eval; `private: true` | XLSX development tooling, benchmarks, and fixture generation. |
| `xlsx-api` | `file-io/xlsx-api/` | workspace-internal Rust crate | Rust API facade over the parser and bridge surface. |
| `xlsx-test-contracts` | `file-io/xlsx/test-contracts/` | workspace-internal Rust crate | Shared XLSX file I/O test contracts and report schemas. |
| `csv-parser` | `file-io/csv-parser/` | workspace-internal Rust crate | Rust CSV parser integrated with the same parse-output path. |
| `ooxml-types` | `file-io/ooxml/types/` | workspace-internal Rust crate | Rust OOXML vocabulary and generated/shared types. |
| `@mog/print-export` | `file-io/print-export/` | workspace-internal; `private: true` | Spreadsheet print and PDF export APIs. |
| `@mog/pdf-graphics` | `file-io/pdf/graphics/` | workspace-internal; `private: true` | PDF graphics primitives. |
| `@mog/pdf-layout` | `file-io/pdf/layout/` | workspace-internal; `private: true` | PDF pagination and layout helpers. |
| `pdf-core` | `file-io/pdf/core/` | workspace-internal Rust crate | Rust PDF core crate. |

`@mog/print-export` exports `SpreadsheetPdfExporter`, `createPdfExporter`, HTML
table/style generation helpers, print handling, and pagination types from
`@mog/pdf-layout`.

## Rendering

The canvas packages below are private implementation packages. Public consumers
normally reach this code through `@mog-sdk/sheet-view`, `@mog-sdk/embed`, or
`@mog-sdk/spreadsheet-app`.

```text
@mog/canvas-engine
  -> @mog/grid-renderer
  -> @mog/drawing-canvas
  -> @mog/canvas-overlay

@mog/grid-canvas composes grid-renderer, drawing-canvas, overlay, viewport
layout, and style bridges for SheetView and spreadsheet app packages.
```

| Package | Location | Current status | Purpose | Notable exports |
| --- | --- | --- | --- | --- |
| `@mog/canvas-engine` | `canvas/engine/` | workspace-internal private; bundle-only | Generic multi-canvas infrastructure, coordinate spaces, scheduling, dirty rects, input, and hit testing. | `createCanvasEngine`, canvas layer and geometry types. |
| `@mog/grid-renderer` | `canvas/grid-renderer/` | workspace-internal private; bundle-only | Spreadsheet cell, header, selection, UI, and specialized grid layers. | Layer factories, viewport/layout helpers, and renderer primitives. |
| `@mog/drawing-canvas` | `canvas/drawing-canvas/` | workspace-internal private; bundle-only | Floating object scene graph, bridge adapters, hit map, and drawing layer factory. | `SceneGraph`, `BridgeRegistry`, `HitMap`, `createDrawingLayer`. |
| `@mog/canvas-overlay` | `canvas/overlay/` | workspace-internal private; bundle-only | Screen-space handles, guides, rubber band, drag preview, and ink preview. | `OverlayLayer`, `createOverlayLayer`. |
| `@mog/grid-canvas` | `canvas/grid-canvas/` | workspace-internal private; bundle-only | Composition facade that wires grid-renderer, drawing-canvas, overlay, viewport layout, and cell-style/CSS-variable bridges. | `createGridRenderer`, `GridRenderScheduler`, `computeViewportLayout`. |
| `@mog/spatial` | `canvas/spatial/` | workspace-internal private; bundle-only | Spatial indexing and hit-test helpers. | `createSpatialIndex`, `GridSpatialIndex`, hit-test pipeline helpers. |

## Drawing and Typeset

Drawing-related packages live under `canvas/drawing/`. Their package names are
current workspace names, but the manifests mark them private; they are not
public setup paths.

| Package | Location | Current status | Purpose | Notable exports |
| --- | --- | --- | --- | --- |
| `@mog/drawing-engine` | `canvas/drawing/engine/` | workspace-internal private; bundle-only | Pure floating-object operations: z-order, grouping, anchors, layout, rendering primitives, and diagnostics. | Z-order helpers, grouping helpers, anchor resolution, canvas/SVG renderers. |
| `@mog/shape-engine` | `canvas/drawing/shapes/` | workspace-internal private; bundle-only | Shape path generation and OOXML custom geometry. | `generateShapePath`, custom geometry helpers, preset registry. |
| `@mog/ink-engine` | `canvas/drawing/ink/` | workspace-internal private; bundle-only | Ink stroke creation, smoothing, spatial indexing, intersections, erasing, and pressure mapping. | Stroke, eraser, spatial, and pressure helpers. |
| `@mog/diagram-engine` | `canvas/drawing/diagram/` | workspace-internal private; bundle-only | Diagram models, layouts, styles, gallery, and partial OOXML layout engine. | `createDiagram`, `computeLayout`, style/theme helpers, `DataModel`. |
| `@mog/text-effects-engine` | `canvas/drawing/text-effects/` | workspace-internal private; bundle-only | OOXML text warp presets, path text layout, effects, and drawing-object output. | `warpText`, preset registry, effect helpers. |
| `@mog/geometry` | `canvas/drawing/geometry/` | workspace-internal private; bundle-only | 2D geometry primitives and path/transform utilities. | `Matrix`, `Transform`, `PathOps`, `Rect`, connector routing. |
| `@mog/math-engine` | `typeset/math-engine/` | workspace-internal; `private: true` | OMML and LaTeX parsing/conversion, equation layout, templates, render plans, and diagnostics. | `parseOMML`, `parseLatex`, `latexToOmml`, `layoutEquation`, `layoutToRenderPlan`. |

## Application and Runtime Packages

| Package | Location | Current status | Purpose | Notable exports |
| --- | --- | --- | --- | --- |
| `@mog/shell` | `shell/` | reserved private package | Shell UI, app registry, context, hooks, capabilities, host/app integration, and styling. | Bootstrap/context/component/hook/style/platform/app registry subpaths for monorepo use. |
| `@mog/app-spreadsheet` | `apps/spreadsheet/` | private workspace app | Default spreadsheet app, command chrome, formula bar, dialogs, app state, and grid workflow. | `.`, `./manifest`, `./register`, `./embed-runtime`, `./services`, and chrome/hook/dev entries. |
| `@mog-sdk/sheet-view` | `views/sheet-view/` | shipped public | Public view-layer substrate for sheet rendering with a data-source boundary. | `createSheetView`, `createSheetViewDataSourceFromWorkbook`, skin helpers, public view/event/capability types. |
| `@mog-sdk/embed` | `runtime/embed/` | shipped public package; root/react/web-component/config are public-experimental | Read-only same-page embeddable component. | `MogSheetElement`, `@mog-sdk/embed/react`, `@mog-sdk/embed/web-component`, config types, and config validators. |
| `@mog-sdk/spreadsheet-app` | `runtime/spreadsheet-app/` | shipped public | Full spreadsheet app embed for trusted same-origin hosts. | `createSpreadsheetRuntime`, `MogSpreadsheetApp`, `mountSpreadsheetApp`, `./styles.css`, `./mog-embed.css`. |
| `@mog-sdk/sdk` | `runtime/sdk/` | shipped public | Unified headless SDK. Root import resolves to native N-API in Node and WASM in Workers/web-standard runtimes; explicit `./node`, `./wasm`, and `./workerd` entries force a binding when needed. | `createWorkbook`, `createHeadlessEngine`, `MogDocumentFactory`, SDK errors/events, API introspection. |
| `@mog/spreadsheet-testing` | `runtime/spreadsheet-testing/` | workspace-internal; `private: true` | Spreadsheet testing utilities. | `.`, `./fixtures`. |
| `@mog/test-host` | `runtime/test-host/` | workspace-internal; `private: true` | Deterministic trusted test host. | `.` |

`@mog-sdk/embed/package.json` also contains `./internal/views-host`; package
inventory classifies it as a workspace-private friend surface, not a public
setup path.

## OS and Infrastructure Packages

| Package | Location | Current status | Purpose |
| --- | --- | --- | --- |
| `@mog/ui` | `ui/` | reserved private package | Kernel-agnostic UI components for data views, records, table controls, and fields. |
| `@mog/spreadsheet-utils` | `spreadsheet-utils/` | workspace-internal; `private: true` | Shared A1/range/rich-text/protection/number-format helpers and the function catalog/registry. |
| `@mog/table-engine` | `table-engine/` | workspace-internal; `private: true` | Pure TypeScript table filtering, sorting, slicers, structured refs, visibility, and styles. |
| `@mog/platform` | `infra/platform/` | workspace-internal; `private: true` | Browser/Tauri platform abstraction, filesystem/path errors, identity, menus, keyboard layout, and secure invoke helpers. |
| `@mog/platform-memory` | `infra/platform/memory/` | workspace-internal; `private: true` | In-memory filesystem implementation. |
| `@mog/culture` | `infra/culture/` | workspace-internal; `private: true` | Culture and locale helpers. |
| `@mog/env` | `infra/env/` | workspace-internal; `private: true` | Environment detection/config helpers. |
| `@mog/icons` | `infra/icons/` | generated-asset private package | React SVG icon components and `./svg/*` icon asset subpaths. |
| `@mog/bridge-ts` | `infra/rust-bridge/bridge-ts/` | workspace-internal; `private: true` | Generated TypeScript bindings for Rust bridge surfaces. |
| `@rust-bridge/client` | `infra/rust-bridge/client/` | workspace-internal; `private: true` | TypeScript bridge client interfaces. |
| `@mog/devtools` | `tools/devtools/` | workspace-internal; `private: true` | Development tooling package. |
| `eslint-plugin-mog` | `tools/eslint-plugin-mog/` | dev-eval; `private: true` | Repository ESLint rules, including import-boundary enforcement. |

## Rust Workspace

The root `Cargo.toml` workspace currently contains these crate groups. These are
workspace implementation crates unless a public package facade above publishes
their artifacts.

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

Shared workspace dependencies include `serde`, `serde_json`, `uuid`, `chrono`,
`thiserror`, `tracing`, and `yrs`. The release profile uses `opt-level = 3`,
LTO, and a single codegen unit.

## Excel Functions

Formula evaluation lives in the Rust compute workspace. `compute-core` depends
on `compute-functions`, which is documented in `compute/core/Cargo.toml` as the
function library for 512+ Excel-compatible pure functions.

Function registration is centralized in
`compute/core/crates/compute-functions/src/registry.rs`. Its `register_all`
path registers math, text, logical, lookup, statistical, datetime, financial,
engineering, database, information, and web functions. Static UI metadata for
function names, categories, descriptions, and arity lives in
`spreadsheet-utils/src/function-catalog.ts`; the `FunctionCategory` enum in
`@mog-sdk/contracts` also reserves Web and Testing categories.

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

Add Rust crates to the root `Cargo.toml` workspace. If the package participates
in public or workspace boundary checks, also update `tools/package-inventory.jsonc`
and, where relevant, `tools/eslint-plugin-mog/import-boundaries.cjs`.

Keep dependencies aligned with the import-boundary layers and avoid adding
dependencies on private or workspace-internal packages from public package
surfaces.
