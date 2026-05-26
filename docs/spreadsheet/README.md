# Spreadsheet

Mog's spreadsheet layer combines a Rust compute engine, a TypeScript kernel
API, reusable view components, and file-format import/export support.

## Architecture

- [Architecture](ARCHITECTURE.md) - spreadsheet subsystem design
- [Data model](data-model.md) - workbook, sheet, cell, range, and metadata model
- [Cell identity](cell-identity.md) - stable identities for collaborative editing
- [State](state.md) - persistent and session state boundaries
- [Renderer](renderer/README.md) - canvas rendering pipeline

## Features

- [Tables](tables.md)
- [Pivot tables](pivot-tables.md)
- [Known formula discrepancies](known-formula-discrepancies.md)
