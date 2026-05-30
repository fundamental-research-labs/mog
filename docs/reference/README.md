# API Reference

> **Status: skeleton — content pending package stabilization**

API reference index for Mog's public package surfaces. Detailed API docs are generated from TypeScript contract and declaration sources.

## Packages

### @mog-sdk/contracts

Public contract package. Types, schemas, constants, and shared API contracts consumed by the runtime packages.

- Source: `contracts/`
- API docs: (auto-generated, link TBD)
- Architecture: [Package Structure](../architecture/os/packages.md)

### @mog-sdk/node

Node.js SDK with native N-API bindings. Provides the workbook/document facade for server-side workbook creation, formula compute, and XLSX file I/O.

- Source: `runtime/sdk/`
- API docs: (auto-generated, link TBD)
- Guide: [Node SDK](../guides/node-sdk.md)

### @mog-sdk/sheet-view

Low-level spreadsheet grid renderer. Mounts SheetView in a DOM element, attaches a workbook data source, and exposes viewport, event, render-state, and extension capabilities.

- Source: `views/sheet-view/`
- API docs: (auto-generated, link TBD)
- Guide: [SheetView](../guides/sheet-view.md)

### @mog-sdk/embed

Read-only sheet/view embed package. Provides the `<mog-sheet>` web component and, through `@mog-sdk/embed/react`, the `MogSheet` React component. Composes SheetView with embed-specific formula bar and sheet tabs.

- Source: `runtime/embed/`
- API docs: (auto-generated, link TBD)
- Guides: [Web Component](../guides/embed-web-component.md) | [React](../guides/embed-react.md)

### @mog-sdk/spreadsheet-app

Full spreadsheet app embed for trusted same-origin hosts. Provides runtime/session APIs, a React app attachment surface, and CSS assets for host-controlled embedding.

- Source: `runtime/spreadsheet-app/`
- API docs: (auto-generated, link TBD)
- Guide: [Full Spreadsheet App Embed](../guides/spreadsheet-app-embed.md)

## Auto-Generation

API reference data is generated with `pnpm generate:api-ref`, which runs `tools/generate-api-reference.ts` against `types/api/src/api`. Declaration rollups and package API snapshots are produced with API Extractor for shipped TypeScript entry points. The generated JSON snapshot is stored in `docs/generated/api-reference.json`; package API snapshots are stored in `tools/api-snapshots/`.

## Conventions

- Documented TypeScript APIs use JSDoc comments as source material
- Public types are exported from package entry points; internal or workspace-private types are not documented here
- Deprecated APIs are marked with `@deprecated` and include migration guidance where available
