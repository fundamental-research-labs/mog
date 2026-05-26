# Node SDK

> **Status: skeleton — content pending package stabilization**

Use Mog programmatically in Node.js for server-side workbook manipulation, data pipelines, and automation.

## Prerequisites

- Node.js 20+ (native N-API binary; no WASM fallback needed)
- `@mog-sdk/node` package

## Install

```bash
# example: npm install @mog-sdk/node
```

Platform support matrix (macOS arm64/x64, Linux x64/arm64, Windows x64). Prebuilt binaries are included; no Rust toolchain required.

## Create a Workbook

Create a blank workbook, inspect its default sheet, and understand the Workbook handle lifecycle.

```typescript
// example: createWorkbook()
```

## Open an XLSX File

Read an existing .xlsx file from disk. Parser fidelity notes (styles, formulas, tables, charts).

```typescript
// example: openWorkbook(path)
```

## Read and Write Cells

Set and get cell values by address (A1 notation) or by CellId. Supported value types: string, number, boolean, date, error, blank.

```typescript
// example: setCellValue / getCellValue
```

## Formulas

Set formulas, trigger recalc, read computed values. Formula language compatibility with Excel/Google Sheets.

```typescript
// example: setCellFormula / getCellValue
```

## Sheets

Create, rename, delete, reorder sheets. Sheet handle API.

## Tables

Create structured tables (ListObjects). Add/remove columns and rows. Table references in formulas.

## Export

Write the workbook back to .xlsx on disk. Export options (compression, style preservation).

```typescript
// example: workbook.saveAs(path)
```

## Streaming and Large Files

Performance considerations for large workbooks. Memory usage patterns. Batch operations.

## Error Handling

Error types thrown by the SDK. How to distinguish parse errors, formula errors, and validation errors.

## Related Docs

- [Quickstart](quickstart.md) — minimal getting-started
- [Architecture Overview](architecture-overview.md) — how the kernel and compute bridge work
- [Python SDK](python-sdk.md) — Python equivalent (reserved)
- [API Reference](../reference/README.md)
