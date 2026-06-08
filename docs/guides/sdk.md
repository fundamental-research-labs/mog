# SDK

> **Status: shipped public package:** `@mog-sdk/sdk`

Use Mog programmatically for trusted same-process workbook automation, data
pipelines, server-side file processing, and Workers-style runtimes. The stable
public entry point is async `createWorkbook()` from `@mog-sdk/sdk`; package
export conditions select the native Node implementation in Node and the WASM
implementation in Workers/web-standard runtimes.

The SDK is not a hostile-client security boundary. Do not run untrusted
agent or user code in the same process and treat the package as an automation
SDK owned by the host application.

## Prerequisites

- Node.js 18+ for the Node/native entry
- npm, pnpm, or yarn
- A supported native platform package installed through `@mog-sdk/sdk` optional
  dependencies when using the Node/native entry
- A host-provided `WebAssembly.Module` for Workers or hosts that disallow
  package-side WASM byte loading or compilation

The root package uses conditional exports:

- `@mog-sdk/sdk` resolves to native N-API in Node and WASM in
  Workers/web-standard runtimes.
- `@mog-sdk/sdk/node` forces the native Node entry.
- `@mog-sdk/sdk/wasm` forces the WASM entry for hosts that can provide or load
  the compute WASM module.
- `@mog-sdk/sdk/workerd` is the explicit Workers/workerd entry.

The Node/native entry uses native N-API platform packages. It does not fall back
to WASM after package resolution has selected the native entry. Supported public
binary wrappers are:

- `@mog-sdk/darwin-arm64`
- `@mog-sdk/darwin-x64`
- `@mog-sdk/linux-arm64-gnu`
- `@mog-sdk/linux-arm64-musl`
- `@mog-sdk/linux-x64-gnu`
- `@mog-sdk/linux-x64-musl`
- `@mog-sdk/win32-x64-msvc`

If optional dependencies are omitted or the platform is unsupported, workbook
creation through `@mog-sdk/sdk/node` or a Node-resolved root import fails when
the SDK tries to load the native package. Use `@mog-sdk/sdk/wasm` or
`@mog-sdk/sdk/workerd` for non-native hosts.

## Runnable Quickstart

```bash
mkdir mog-sdk
cd mog-sdk
npm init -y
npm pkg set type=module
npm install @mog-sdk/sdk
cat > index.mjs <<'JS'
import { createWorkbook } from '@mog-sdk/sdk';

const wb = await createWorkbook({ userTimezone: 'UTC' });

try {
  const ws = wb.activeSheet;

  await ws.setCell('A1', 42);
  await ws.setCell('A2', '=A1*2');

  console.log(await ws.getValue('A2'));
} finally {
  wb.dispose();
}
JS
node index.mjs
```

Expected output:

```text
84
```

`createWorkbook()` also works without options. Pass `userTimezone` when `Date`
inputs need to be interpreted in a user calendar frame; headless Node sessions
default to `UTC`.

## Runtime Entries

The normal import is the package root:

```typescript
import { createWorkbook } from '@mog-sdk/sdk';
```

Use explicit subpaths only when the host or test needs to force a binding:

```typescript
import { createWorkbook as createNodeWorkbook } from '@mog-sdk/sdk/node';
import { createWorkbook as createWasmWorkbook } from '@mog-sdk/sdk/wasm';
import { createWorkbook as createWorkerWorkbook } from '@mog-sdk/sdk/workerd';
```

The native Node entry accepts file paths and byte sources. The WASM and workerd
entries accept bytes or byte sources; file-path I/O is Node-only.

```typescript
const wb = await createWasmWorkbook({
  xlsx: xlsxBytes,
  wasmModule: computeWasmModule,
  userTimezone: 'UTC',
});
```

`wasmModule` is accepted only by WASM-capable entries. Passing `wasmModule` or a
`runtime` option to the native Node entry is an argument error; runtime
selection belongs to package exports and subpath imports.

Workers/workerd hosts should provide the compute WASM module as a
`WebAssembly.Module`, for example through the bundler/runtime WASM module
import supported by that host. If PNG or JPEG chart export is needed, provide
the chart raster module separately:

```typescript
const wb = await createWorkerWorkbook({
  wasmModule: computeWasmModule,
  chartRendering: {
    rasterModule: chartRasterWasmModule,
  },
  userTimezone: 'UTC',
});
```

## Create or Open Workbooks

```typescript
import { readFile } from 'node:fs/promises';
import { createWorkbook } from '@mog-sdk/sdk';

const blank = await createWorkbook();
const fromPath = await createWorkbook('model.xlsx');
const bytes = new Uint8Array(await readFile('model.xlsx'));
const fromBytes = await createWorkbook(bytes);
const withOptions = await createWorkbook({
  xlsx: bytes,
  documentId: 'model-1',
  userTimezone: 'America/Los_Angeles',
});

blank.dispose();
fromPath.dispose();
fromBytes.dispose();
withOptions.dispose();
```

The path and byte overloads also accept XLSX import options as the second
argument in the Node/native entry. WASM and workerd callers pass bytes. Import
warnings from XLSX open are available on `wb.importWarnings`.

## Read and Write Cells

Use A1 notation or zero-based numeric row/column coordinates. Writable
primitive values are `string`, `number`, `boolean`, and `null`; `Date` inputs
are accepted by `setCell`, `setRange`, and `setCells`.

Strings that start with `=` are stored as formulas unless you pass cell write
options that force literal text.

```typescript
await ws.setCell('B1', 'Revenue');
await ws.setCell(1, 1, 1250); // B2

const value = await ws.getValue('B2');
const cell = await ws.getCell('B2');
const range = await ws.getRange('A1:B10');
```

For rectangular writes, use `setRange`. For scattered writes, use `setCells`.

```typescript
await ws.setRange('A1:B3', [
  ['Name', 'Score'],
  ['Alice', 92],
  ['Bob', 85],
]);

await ws.setCells([
  { addr: 'D1', value: 'Total' },
  { row: 0, col: 4, value: '=SUM(B2:B3)' }, // E1
]);

const values = await ws.getValues('A1:B3');
```

## Formulas and Calculation

For ordinary writes, formulas are recalculated before the write resolves. Read
computed values with `getValue`, formula text with `getFormula`, and trigger an
explicit full or iterative calculation with `wb.calculate()` when needed.

```typescript
await ws.setCell('A1', 10);
await ws.setCell('A2', 20);
await ws.setCell('A3', '=SUM(A1:A2)');

console.log(await ws.getValue('A3')); // 30
console.log(await ws.getFormula('A3')); // =SUM(A1:A2)

const result = await wb.calculate();
console.log(result.recomputedCount);
```

## Sheets

`wb.activeSheet` is a synchronous property backed by the current workbook state.
Name and index lookups are async.

```typescript
const sheet = wb.activeSheet;
const data = await wb.sheets.add('Data');
await wb.sheets.rename(sheet.name, 'Summary');
await wb.sheets.move('Data', 0);

const byName = await wb.getSheet('Summary');
const byIndex = await wb.getSheetByIndex(0);
const { sheet: existingOrNew, created } = await wb.getOrCreateSheet('Inputs');
```

## Tables

Create tables from worksheet ranges with `ws.tables.add(range, options)`.
Manage rows, columns, filters, names, and styles through `ws.tables`.

```typescript
await ws.setRange('A1:C3', [
  ['Product', 'Q1', 'Q2'],
  ['Widget', 100, 150],
  ['Gadget', 200, 180],
]);

const table = await ws.tables.add('A1:C3', {
  name: 'SalesData',
  hasHeaders: true,
});

await ws.tables.addRow(table.name, undefined, ['Service', 50, 75]);
await ws.tables.setShowBandedRows(table.name, true);
```

## Filters

Create worksheet auto-filters with `ws.filters.add(range)`, then apply
column criteria with `ws.filters.setColumnFilter(col, criteria, filterId?)`.

```typescript
await ws.filters.add('A1:C10');
await ws.filters.setColumnFilter(0, { type: 'value', values: ['Widget'] });
```

## Export

Export to an `.xlsx` file with `wb.save(path)`, or get workbook bytes with
`wb.save()` or `wb.toXlsx()`.

```typescript
await wb.save('output.xlsx');

const savedBytes = await wb.save();
const xlsxBytes = await wb.toXlsx();
```

## Error Handling

The package exports `MogSdkError` and the `MogSdkErrorCode` type for structured
error handling. Catch errors, normalize unknown values with `MogSdkError.from`,
and inspect `code`.

```typescript
import { MogSdkError, type MogSdkErrorCode } from '@mog-sdk/sdk';

try {
  await wb.getSheet('MissingSheet');
} catch (error) {
  const err = MogSdkError.from(error, 'getSheet');
  const code: MogSdkErrorCode = err.code;
  console.error(code, err.message);
}
```

## API Discovery

The package includes generated SDK introspection metadata. Use `api.describe`
to inspect root methods, sub-APIs, or a specific method signature. Agents that
generate code should also use `api.guidance.analyze(source)` or
`api.guidance.preflight(source)` before execution, and
`api.guidance.explain(...)` for wrong-dialect explanations when that API is
available in their SDK version.

```typescript
import { api } from '@mog-sdk/sdk';

console.log(api.describe());
console.log(api.describe('ws.tables.add'));
console.log(api.describe('type:TableOptions'));

console.log(api.guidance.explain('context.workbook.worksheets.getActiveWorksheet'));
console.log(api.guidance.explain('wb.activeSheet'));

for (const diagnostic of api.guidance.analyze(source)) {
  console.log(diagnostic.mogReplacements, diagnostic.references);
}
```

## Agent API Guidance

Mog is not a Microsoft Office JavaScript API compatibility layer. Code shaped
like that API is diagnosed as a known wrong dialect so agents can rewrite it;
it is not supported or shimmed. Do not use `Excel.run`, `Office.context`,
`context.sync()`, Range proxy `.load(...)`, null-object sentinels, or
assignments such as `range.values = data`.

Generated sandbox code should use the injected `wb` object and derive
`const ws = wb.activeSheet`. Use Mog-native API paths instead:
`await wb.getSheet(name)`, `await ws.setRange(range, data)`,
`await ws.getValues(range)`, `await ws.formats.setRange(range, format)`, and
`await ws.tables.add(range, options)`. Read `diagnostic.mogReplacements` for
replacement paths/snippets; the summary error string is not the full guidance.

## Public Surface Notes

Use `createWorkbook()` for normal SDK integrations. The package root also
exports public contract types, `MogDocumentFactory`, `MogSdkError`, event
facades, utility functions, and API introspection data.

Do not import `@mog-sdk/kernel`, `@mog/transport`, or source-internal host
adapter modules from external applications. Low-level headless boot helpers and
collaboration wrappers are compatibility/internal implementation surfaces in the
SDK declarations; they are not the guide path for public integrations.

## Related Docs

- [Quickstart](quickstart.md) - minimal getting-started
- [Architecture Overview](architecture-overview.md) - public package boundaries and runtime layers
- [Python SDK](python-sdk.md) - Python bindings status and setup
- [API Reference](../reference/README.md)
