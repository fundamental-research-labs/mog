# Node SDK

> **Status: available as `@mog-sdk/node`**

Use Mog programmatically in Node.js for server-side workbook manipulation, data pipelines, and automation.

## Prerequisites

- Node.js 18+
- `@mog-sdk/node`

The Node SDK uses native N-API platform packages. There is no WASM fallback in the Node runtime path.

## Install

```bash
npm install @mog-sdk/node
```

`@mog-sdk/node` declares optional native packages for macOS arm64/x64, Linux x64/arm64 (glibc and musl), and Windows x64.

## Create a Workbook

Create a blank workbook, use the active sheet, and dispose the workbook when finished.

```typescript
import { createWorkbook } from '@mog-sdk/node';

const wb = await createWorkbook();
const ws = wb.activeSheet;

await ws.setCell('A1', 100);
await ws.setCell('A2', '=A1*2');
console.log(await ws.getValue('A2'));

wb.dispose();
```

## Open an XLSX File

Read an existing `.xlsx` file from disk with `createWorkbook('model.xlsx')`, or pass raw bytes with `createWorkbook(xlsxBytes)`. Import warnings are available from `wb.importWarnings`.

## Read and Write Cells

Use A1 notation or zero-based numeric row/column coordinates. Writable primitive values are `string`, `number`, `boolean`, and `null`; `Date` inputs are accepted by `setCell` and `setRange`.

```typescript
await ws.setCell('B1', 'Revenue');
await ws.setCell(1, 1, 1250);

const value = await ws.getValue('B2');
const cell = await ws.getCell('B2');
const range = await ws.getRange('A1:B10');
```

## Formulas

Strings that start with `=` are written as formulas. Formula values are recalculated by the engine and can be read through `getValue`, `getFormula`, or explicit `wb.calculate()` calls.

## Sheets

Use `wb.sheets.add`, `wb.sheets.rename`, `wb.sheets.move`, and related `wb.sheets` methods for sheet lifecycle operations. Use `wb.getSheet`, `wb.getSheetByIndex`, or `wb.getOrCreateSheet` for lookup.

## Tables

Create tables from worksheet ranges with `ws.tables.add(range, { name, hasHeaders })`. Manage rows, columns, filters, names, and styles through `ws.tables`.

## Export

Export to an `.xlsx` file with `wb.save('output.xlsx')`, or get workbook bytes with `wb.save()` or `wb.toXlsx()`.

## Batch Operations

Prefer `setRange` for rectangular writes and `setCells` for scattered writes.

## Error Handling

The package exports `MogSdkError` and the `MogSdkErrorCode` type for structured error handling. Catch errors, normalize unknown values with `MogSdkError.from`, and inspect `code`.

## Related Docs

- [Quickstart](quickstart.md) — minimal getting-started
- [Architecture Overview](architecture-overview.md) — how the kernel and compute bridge work
- [Python SDK](python-sdk.md) — Python equivalent (reserved)
- [API Reference](../reference/README.md)
