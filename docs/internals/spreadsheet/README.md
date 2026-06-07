# Spreadsheet

This directory is an internals reference for maintainers working on Mog's
spreadsheet stack. The stack spans Rust compute/document crates, a
workspace-internal TypeScript kernel, public runtime/view facades, bundle-only
canvas/rendering packages, and workspace-internal file I/O.

For public setup, start from the shipped package guides instead of importing
the kernel or implementation packages directly. Current public entry points are
`@mog-sdk/sdk`, `@mog-sdk/embed`, `@mog-sdk/spreadsheet-app`,
`@mog-sdk/sheet-view`, `@mog-sdk/contracts`, and the `@mog-sdk/wasm`/native
binary wrapper packages. `@mog-sdk/kernel`, `@mog/transport`, `file-io/*`,
`canvas/*`, `charts`, `table-engine`, and most `@mog/*` packages are
workspace-internal, bundle-only, reserved, generated assets, or private in the
current package inventory.

## Source of Truth

- TypeScript workspaces: `pnpm-workspace.yaml` and package `exports`.
- Package disposition: `tools/package-inventory.jsonc`.
- Rust crates: root `Cargo.toml`.
- Public SDK path: `runtime/sdk/src/index.ts` and `runtime/sdk/src/boot.ts`.
- Kernel implementation path: `kernel/src/api/` and
  `kernel/src/bridges/compute/`.
- View package path: `views/sheet-view/src/`.
- File-format paths: `file-io/xlsx/parser/`, `file-io/xlsx-api/`,
  `file-io/csv-parser/`, and `file-io/print-export/`.

The implemented spreadsheet file-format paths currently cover XLSX
import/export, CSV import through the Rust CSV parser and compute hydration
path, and print/PDF export helpers. Do not document CSV export or direct
file-I/O package use as shipped public surfaces unless the package inventory
and public facades say so.

## Architecture and Contracts

- [Architecture](ARCHITECTURE.md) - spreadsheet subsystem design
- [Package structure](packages.md) - package layout, status, and source paths
- [Data model](data-model.md) - workbook, sheet, cell, range, and metadata model
- [Cell identity](cell-identity.md) - stable identities for collaborative editing
- [State](state.md) - persistent and session state boundaries
- [Core foundations](foundations.md) - foundations shared by API and runtime work
- [API design philosophy](API-DESIGN-PHILOSOPHY.md) - API conventions and tradeoffs

## Features and Domain Notes

- [Charts](charts.md)
- [Tables](tables.md)
- [Pivot tables](pivot-tables.md)
- [Known formula discrepancies](known-formula-discrepancies.md)

## Rendering

- [Renderer architecture](renderer/README.md) - canvas rendering pipeline
- [Canvas](renderer/canvas.md) - canvas and rendering architecture
- [Coordinates](renderer/coordinates.md) - renderer coordinate system
- [Binary wire pipeline](renderer/binary-wire-pipeline.md) - Rust-to-canvas data path
- [XState patterns](renderer/xstate.md) - state-machine usage in rendering
