# Package Structure

> **Status: architecture package inventory.** Package membership, publication
> status, and import direction are defined by `pnpm-workspace.yaml`, the root
> `Cargo.toml`, package manifests, `tools/package-inventory.jsonc`, and
> `tools/eslint-plugin-mog/import-boundaries.cjs`.

The Spreadsheet OS consists of packages organized in layers. This page describes
the current public and workspace surfaces; it is not a replacement for the
manifests above.

## Status Vocabulary

- **shipped public**: public package target in the current package inventory.
- **public-experimental**: public or source-visible surface that exists but does
  not yet carry a long-term compatibility promise.
- **binary-wrapper**: public package that ships native or WASM runtime artifacts.
- **bundle-only**: private workspace package bundled into a public facade.
- **workspace-internal**: private package or Rust crate used inside this
  monorepo, not an external setup path.
- **reserved**: private package or subpath kept for a possible future public
  surface.
- **dev-eval** or **generated-asset**: development tooling or generated output,
  not a supported runtime dependency.

## Dependency Graph

```
Shipped public packages
  @mog-sdk/node
  @mog-sdk/embed
  @mog-sdk/spreadsheet-app
  @mog-sdk/contracts
  @mog-sdk/sheet-view

Public binary wrappers
  @mog-sdk/wasm
  @mog-sdk/darwin-arm64, @mog-sdk/darwin-x64
  @mog-sdk/linux-arm64-gnu, @mog-sdk/linux-arm64-musl
  @mog-sdk/linux-x64-gnu, @mog-sdk/linux-x64-musl
  @mog-sdk/win32-x64-msvc

Public-experimental source
  compute/pyo3 (Python package name: mog-sdk; import name: mog)

Workspace app and composition internals
  runtime/spreadsheet-app
  apps/spreadsheet
       |
  shell, ui (reserved private packages)
       |
  views/sheet-view
       |
  kernel (@mog-sdk/kernel, workspace-internal)
       |
  contracts + types/*

Hardware and engine packages
  compute/*, file-io/*, canvas/*, charts, table-engine,
  spreadsheet-utils, typeset/math-engine, infra/*
```

Lower layers provide contracts, engines, adapters, and primitives. Higher layers
compose those pieces into workspace UI or shipped public runtime facades.

## Package Categories

### Type and Contract Layer

| Package | Status | Purpose | Key exports |
| --- | --- | --- | --- |
| `contracts` (`@mog-sdk/contracts`) | shipped public; many subpaths public-experimental | Public contract barrel and small runtime-value surface | Core types, API contracts, event types, schemas, branded helpers |
| `contracts/runtime-services` (`@mog-sdk/runtime-service-contracts`) | workspace-internal | Runtime service boundary contracts | Error envelopes, audit events, protocol/version and deployment types |
| `types/*` | workspace-internal | Type shards used by `contracts` and implementation packages | `@mog/types-core`, `@mog/types-data`, `@mog/types-rendering`, `@mog-sdk/types-document`, `@mog-sdk/types-host`, etc. |
| `domain-types` | workspace-internal Rust crate | Shared Rust domain types used by compute and file I/O | Parse output and domain vocabulary types |

### Core OS Packages

| Package | Status | Purpose | Key exports |
| --- | --- | --- | --- |
| `kernel` (`@mog-sdk/kernel`) | workspace-internal; `private: true` | Canonical TypeScript workbook implementation, document lifecycle, services, app APIs, and compute bridge wiring | `createWorkbook`; internal/advanced `DocumentFactory`; workbook API types |
| `views/sheet-view` (`@mog-sdk/sheet-view`) | shipped public | Low-level sheet rendering/view package with a data-source boundary | `createSheetView`, `createSheetViewDataSourceFromWorkbook`, skin helpers, view/event/capability types |
| `shell` (`@mog/shell`) | reserved private package | App host, shell bootstrap, Radix-based UI primitives, focus machine | Monorepo shell exports such as `ShellHost`, `AppSlot`, `createShell`, `focusMachine` |
| `ui` (`@mog/ui`) | reserved private package | Kernel-agnostic data-view and record/table UI components | Kanban, calendar, gallery, timeline, table and field components |

### Runtime and SDK Packages

| Package | Status | Purpose | Key exports |
| --- | --- | --- | --- |
| `runtime/sdk` (`@mog-sdk/node`) | shipped public | Headless Node.js SDK with formula compute, optional native platform packages, and XLSX file I/O | `createWorkbook`, `createHeadlessEngine`, `MogDocumentFactory`, SDK errors/events, API introspection |
| `runtime/embed` (`@mog-sdk/embed`) | shipped public; React/web-component/config exports public-experimental | Same-page sheet/view embed package | `<mog-sheet>`, `MogSheetElement`, `@mog-sdk/embed/react`, `@mog-sdk/embed/web-component`, config validators |
| `runtime/spreadsheet-app` (`@mog-sdk/spreadsheet-app`) | shipped public | Full spreadsheet app embed for trusted same-origin hosts. This is a bundle-composition package that uses private app/shell/kernel code internally while keeping those packages out of public declarations and runtime deps. | `createSpreadsheetRuntime`, `MogSpreadsheetApp`, `mountSpreadsheetApp`, `styles.css`, `mog-embed.css` |
| `compute/wasm/npm` (`@mog-sdk/wasm`) | binary-wrapper | Browser WASM package for the Rust compute engine | Root package and `./wasm` export |
| `compute/napi/npm/*` (`@mog-sdk/*`) | binary-wrapper | Optional native platform packages used by `@mog-sdk/node` | Platform-specific N-API binaries for macOS, Linux, and Windows |
| `runtime/spreadsheet-testing` (`@mog/spreadsheet-testing`) | workspace-internal | Spreadsheet testing helpers | Fixtures and test helpers |
| `runtime/test-host` (`@mog/test-host`) | workspace-internal | Deterministic host for host-contract integration tests | Trusted test host |

### Apps

| Package | Status | Purpose |
| --- | --- | --- |
| `apps/spreadsheet` (`@mog/app-spreadsheet`) | private workspace app | Default spreadsheet app, command chrome, formula bar, dialogs, app state, and classic grid workflow |

### Computation Layer

| Package | Status | Purpose | Key exports |
| --- | --- | --- | --- |
| `compute/core` | workspace-internal Rust crate; `publish = false` | Rust compute engine: evaluator, scheduler, storage/document integration, formulas, tables, pivots, charts, conditional formatting, security, file I/O integration, and viewport wire data | `compute-core` crate |
| `compute/core/crates/compute-functions` | workspace-internal Rust crate | Rust spreadsheet function implementations | Function registry and pure functions |
| `compute/core/crates/compute-formats` | workspace-internal Rust crate | Rust number-format engine | Locale, color, currency, and format logic |
| `compute/core/crates/compute-table` | workspace-internal Rust crate | Rust table engine | Filters, sort, slicers, structured refs, styles |
| `compute/core/crates/compute-cf` | workspace-internal Rust crate | Conditional-format evaluation | CF evaluation engine |
| `compute/core/crates/compute-pivot` | workspace-internal Rust crate | Pivot-table computation | Pivot engine |
| `compute/core/crates/compute-schema` | workspace-internal Rust crate | Schema validation and inference | Validation/coercion engine |
| `compute/api` | workspace-internal Rust crate; `publish = false` | Actor-based Rust API facade over `compute-core` | `compute-api` crate |
| `compute/wasm` and `compute/wasm/npm` | Rust crate plus public binary-wrapper package | WASM binding layer and browser package | `compute-core-wasm`, `@mog-sdk/wasm` |
| `compute/napi` and `compute/napi/npm/*` | private native binding crate plus public binary-wrapper packages | Node native binding layer and platform binary wrappers | `compute-core-napi`, platform `@mog-sdk/*` binary packages |
| `compute/pyo3` | public-experimental Python source; alpha in `pyproject.toml` | Python binding layer. The Python package name is `mog-sdk`; import name is `mog`. | `compute-core-pyo3` crate and `mog` Python package |

The root `Cargo.toml` is definitive for Rust workspace membership. Additional
current compute crates include `compute-parser`, `compute-stats`,
`compute-charts`, `compute-chart-render`, `compute-fill`, `compute-graph`,
`compute-relational`, `compute-solver`, `compute-collab`,
`compute-coordinator`, `compute-document`, `compute-wire`,
`compute-layout-index`, `compute-text-measurement`, `compute-screenshot`,
`compute-security`, and the shared type crates under
`compute/core/crates/types/*`.

### File I/O Layer

| Package | Status | Purpose | Key exports |
| --- | --- | --- | --- |
| `file-io/xlsx/parser` | workspace-internal Rust crate; TS package is generated-asset/private | Rust XLSX parser and WASM parser package scaffold | `xlsx-parser`, `@mog/xlsx-parser-wasm` |
| `file-io/xlsx-api` | workspace-internal Rust crate | Rust API facade for the XLSX parser | `xlsx-api` crate |
| `file-io/xlsx/bridge` | workspace-internal TS package | TypeScript bridge/types for the Rust XLSX parser | `@mog/xlsx-parser` |
| `file-io/xlsx/tooling` | dev-eval | XLSX parser and fixture tooling | `@mog/xlsx-tooling` |
| `file-io/xlsx/test-contracts` | workspace-internal Rust crate | Shared XLSX file I/O test contracts and report schemas | `xlsx-test-contracts` crate |
| `file-io/csv-parser` | workspace-internal Rust crate | Rust CSV parser feeding the same hydration path | `csv-parser` crate |
| `file-io/ooxml/types` | workspace-internal Rust crate | OOXML vocabulary for lossless round-tripping | `ooxml-types` crate |
| `file-io/print-export` | workspace-internal TS package | HTML/print/PDF export package | `@mog/print-export`, `createPdfExporter` |
| `file-io/pdf/graphics` | workspace-internal TS package | PDF graphics primitives | `@mog/pdf-graphics` |
| `file-io/pdf/layout` | workspace-internal TS package | PDF pagination/layout primitives | `@mog/pdf-layout` |
| `file-io/pdf/core` | workspace-internal Rust crate | Rust PDF core crate | `pdf-core` crate |

### Canvas Layer

The canvas system uses a multi-package architecture under `canvas/`:

| Package | Status | Purpose | Key exports |
| --- | --- | --- | --- |
| `canvas/engine` (`@mog/canvas-engine`) | bundle-only private package | Generic multi-canvas render loop, layer management, scheduler, input, hit testing | `createCanvasEngine`, `CanvasLayer` |
| `canvas/grid-renderer` (`@mog/grid-renderer`) | bundle-only private package | Cell, background, selection, header, and UI layers | `createGridLayers`, layer factories |
| `canvas/drawing-canvas` (`@mog/drawing-canvas`) | bundle-only private package | Floating object scene graph and render bridges | `SceneGraph`, `createDrawingLayer` |
| `canvas/overlay` (`@mog/canvas-overlay`) | bundle-only private package | Screen-space UX chrome such as handles, guides, and rubber band | `OverlayLayer`, `createOverlayLayer` |
| `canvas/grid-canvas` (`@mog/grid-canvas`) | bundle-only private package | Thin composition facade wiring the grid renderer and viewport layout | `createGridRenderer`, `computeViewportLayout` |
| `canvas/spatial` (`@mog/spatial`) | bundle-only private package | Spatial indexing and hit testing | Spatial indexes and hit-test helpers |

### Drawing Subpackages

| Subpackage | Status | Purpose | Key exports |
| --- | --- | --- | --- |
| `canvas/drawing/engine` (`@mog/drawing-engine`) | bundle-only private package | Floating-object composition, z-ordering, grouping, anchoring, rendering helpers | Drawing operations and renderers |
| `canvas/drawing/shapes` (`@mog/shape-engine`) | bundle-only private package | OOXML shape path generation and shape metadata | Shape path generation, preset registry |
| `canvas/drawing/geometry` (`@mog/geometry`) | bundle-only private package | Pure 2D geometry primitives | Matrix, transform, path, rect, connector routing helpers |
| `canvas/drawing/ink` (`@mog/ink-engine`) | bundle-only private package | Ink stroke creation, smoothing, erasing, and spatial indexing | Ink stroke and pressure helpers |
| `canvas/drawing/diagram` (`@mog/diagram-engine`) | bundle-only private package | Diagram layout, styles, gallery, and OOXML diagram parsing/layout engine | Diagram model, layout, styles, OOXML engine |
| `canvas/drawing/text-effects` (`@mog/text-effects-engine`) | bundle-only private package | OOXML text effects and text warp engine | Warp presets, effects, drawing-object output |

### Supporting Engines and Utilities

| Package | Status | Purpose | Key exports |
| --- | --- | --- | --- |
| `charts` (`@mog/charts`) | workspace-internal | Excel-compatible charting and custom rendering | `ChartEngine`, chart builders, grammar/primitives |
| `table-engine` (`@mog/table-engine`) | workspace-internal | Pure TypeScript table filtering, sorting, slicers, structured refs, visibility, styles | Table, filter, sort, slicer helpers |
| `spreadsheet-utils` (`@mog/spreadsheet-utils`) | workspace-internal | Shared spreadsheet helpers and UI metadata | A1 helpers, number-format helpers, function catalog/registry |
| `typeset/math-engine` (`@mog/math-engine`) | workspace-internal | OMML/LaTeX equation parsing, conversion, layout, diagnostics | `parseOMML`, `parseLatex`, `layoutEquation` |
| `infra/culture` (`@mog/culture`) | workspace-internal | Locale/culture support | Culture registry and normalization helpers |
| `infra/icons` (`@mog/icons`) | generated-asset private package | Generated SVG icon components | React icon components |
| `infra/platform` (`@mog/platform`) | workspace-internal | Platform abstraction for desktop and web hosts | `createPlatform`, `isTauri`, platform identity/errors |
| `infra/platform/memory` (`@mog/platform-memory`) | workspace-internal | In-memory platform implementation | Memory filesystem/platform helpers |
| `infra/env` (`@mog/env`) | workspace-internal | Environment detection/config helpers | Environment APIs |
| `infra/transport` (`@mog/transport`) | workspace-internal | Rust bridge transport for WASM, NAPI, and Tauri | `createTransport`, transport implementations |
| `infra/rust-bridge/*` | workspace-internal | Rust bridge code generation and runtime support | Bridge macros, generated TS types, N-API/WASM/Tauri/PyO3 helpers |

Number formatting is not a standalone workspace package. The current surfaces
are `@mog-sdk/contracts/number-formats`, `@mog/spreadsheet-utils/number-formats`,
`@mog/types-formatting`, and the Rust `compute-formats` crate.

### Tools

| Package | Status | Purpose |
| --- | --- | --- |
| Root package (`@mog/spreadsheet`) | monorepo-root private package | Workspace scripts and dependency coordination |
| `tools/eslint-plugin-mog` (`eslint-plugin-mog`) | dev-eval | Repository ESLint rules, including import-boundary enforcement |
| `tools/devtools` (`@mog/devtools`) | workspace-internal | Development tooling package |

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

A package may import its own layer and lower layers. Lower layers cannot import
higher layers:

```
apps -> shell/ui -> views -> kernel -> hardware/engines -> types/contracts
```

In rule form:

| Source layer | May import | Must not import |
| --- | --- | --- |
| `types/`, `contracts/` | Same layer only | Implementation packages |
| Hardware/engines | Types/contracts and same layer | Kernel, views, shell, apps, test-host |
| `kernel/` | Types/contracts and hardware | Views, shell, apps, `kernel/host-internal` |
| `views/` | Types/contracts, hardware, kernel as allowed by package contracts | Shell, apps, `kernel/host-internal` |
| `shell/`, `ui/` | Lower layers | Apps, `kernel/host-internal` |
| `apps/` | Lower layers | `kernel/host-internal` |

The import-boundary rule treats `types/` and `contracts/` as the bottom layer,
then `infra/`, `canvas/`, `charts`, `table-engine`, `spreadsheet-utils`,
`file-io`, `typeset`, and `compute` as the hardware layer. Runtime facades have
separate checks. `runtime/sdk` and `runtime/embed` are public facades over lower
layers. `runtime/spreadsheet-app` is a special public bundle-composition
package: it imports private app/shell/kernel code for bundling, keeps those
packages out of runtime dependencies, and uses
`runtime/spreadsheet-app/scripts/check-boundary.mjs` to prevent private types or
implementation package imports from leaking through public declarations.

### Cross-Layer Communication

Use public contracts and explicit APIs rather than importing across ownership
boundaries:

```typescript
// WRONG - kernel importing shell
import { ShellHost } from '@mog/shell';

// CORRECT - shell or apps subscribe to kernel/API events
workbook.on('cellChanged', () => {
  view.render.invalidate('data-change');
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
also update `tools/package-inventory.jsonc` and, where relevant,
`tools/eslint-plugin-mog/import-boundaries.cjs`.

Dependencies should only point to packages in lower layers.

## Contracts Sub-paths

The `contracts` package exports types and pure values via sub-paths:
most subpaths are currently classified as public-experimental in
`tools/package-inventory.jsonc`.

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

`@mog/shell` is a reserved private package today. Inside the monorepo, shell
exports host components, bootstrap utilities, hooks, contexts, platform helpers,
and UI primitives:

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

The catalog currently uses Math, Statistical, Text, Logical, Date & Time,
Lookup & Reference, Financial, Information, Database, and Engineering
categories. The `FunctionCategory` enum also reserves Web and Testing. Because
the function set changes with engine work, use the source catalog and
`compute/core/crates/compute-functions/src/` for current totals instead of
duplicating exact per-category counts here.
