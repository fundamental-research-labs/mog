# API Reference

> **Status: skeleton — content pending package stabilization**

API reference index for Mog's public packages. Detailed API docs will be auto-generated from TypeScript declarations and Rust doc comments.

## Packages

### @mog-sdk/kernel

The core data layer. Workbook creation, cell read/write, formula evaluation, sheet management, table operations, event subscriptions. Used in both browser (WASM) and server (N-API) environments.

- Source: `packages/kernel/`
- API docs: (auto-generated, link TBD)
- Guide: [Quickstart](../guides/quickstart.md)

### @mog-sdk/node

Node.js SDK with native N-API bindings. Provides the same Workbook API as @mog-sdk/kernel with native performance. Includes XLSX file I/O.

- Source: `packages/sdk/`
- API docs: (auto-generated, link TBD)
- Guide: [Node SDK](../guides/node-sdk.md)

### @mog-sdk/sheet-view

Spreadsheet grid renderer. Mounts a canvas-based grid to a DOM element, bound to a Workbook instance. Handles selection, editing, scrolling, and virtualized rendering.

- Source: `packages/sheet-view/`
- API docs: (auto-generated, link TBD)
- Guide: [SheetView](../guides/sheet-view.md)

### @mog-sdk/embed

High-level embed package. Provides `<mog-sheet>` web component and `MogSheet` React component. Bundles SheetView with toolbar, formula bar, and sheet tabs.

- Source: `packages/embed/`
- API docs: (auto-generated, link TBD)
- Guides: [Web Component](../guides/embed-web-component.md) | [React](../guides/embed-react.md)

## Auto-Generation

API reference documentation is generated from source using TypeDoc (TypeScript) and rustdoc (Rust). The generation pipeline runs as part of the release process. Pre-generated snapshots are stored in `docs/generated/`.

## Conventions

- All public APIs use JSDoc/rustdoc comments as the source of truth
- Types are exported from package entry points; internal types are not documented here
- Deprecated APIs are marked with `@deprecated` and include migration guidance
