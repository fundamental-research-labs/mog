# @mog-sdk/node

Shortcut Data OS SDK — headless spreadsheet engine for Node.js. Runs the real kernel + Rust compute-core without a browser.

## Quick Start

```typescript
import { createWorkbook } from '@mog-sdk/node';

const wb = await createWorkbook();
const ws = wb.activeSheet;

await ws.setCell('A1', 42);
await ws.setCell('A2', 58);
await ws.setCell('A3', '=A1+A2');

const val = await ws.getValue('A3'); // 100
await wb.dispose();
```

Three lines to a running spreadsheet engine. No addon injection, no context threading, no active-sheet callbacks.

## Install

```bash
# Monorepo — already available as workspace dependency
pnpm add @mog-sdk/node

# The native Rust addon must be built first
cd compute-core-napi && pnpm build
```

## API Reference

### Creating Workbooks

```typescript
// Blank workbook
const wb = await createWorkbook();

// From file path
const wb = await createWorkbook('data.xlsx');

// From XLSX buffer
const wb = await createWorkbook(readFileSync('data.xlsx'));

// With import options
const wb = await createWorkbook('data.xlsx', { valuesOnly: true });

// Options bag (when you need a custom document ID)
const wb = await createWorkbook({ xlsx: buffer, documentId: 'my-doc' });

// Power-user: pre-existing kernel context (browser app path)
const wb = await createWorkbook({ ctx, eventBus });
```

### Reading Data

```typescript
const ws = wb.activeSheet;

// Single cell value (computed)
const val = await ws.getValue('A1');        // CellValue | null
const val2 = await ws.getValue(0, 0);       // numeric addressing

// Full cell data (value + formula + format)
const cell = await ws.getCell('A1');

// All data in used range as 2D array
const data = await ws.getData();            // CellValue[][]

// Range read
const range = await ws.getRange('A1:C10');  // CellData[][]

// LLM-friendly presentation
await ws.describe('A3');                    // "100(=A1+A2)"
await ws.describeRange('A1:B3');            // Tabular text
await ws.summarize();                       // Full sheet overview
```

### Writing Data

```typescript
// Single cell (A1 or numeric)
await ws.setCell('A1', 42);
await ws.setCell('A2', '=A1*2');
await ws.setCell(2, 0, 'text');

// Bulk write
await ws.setRange('A1', [
  ['Name', 'Score'],
  ['Alice', 92],
  ['Bob', 85],
]);
```

### Working with Sheets

```typescript
const count = wb.sheetCount;
const names = wb.sheetNames;
const ws2 = await wb.sheets.add('Sheet2');

// Get or create (idempotent)
const { sheet, created } = await wb.getOrCreateSheet('Data');
```

### Tables and Structured Data

```typescript
// Create a table from existing data
await ws.setRange('A1', [['Product', 'Q1', 'Q2'], ['Widget', 100, 150], ['Gadget', 200, 180]]);
await ws.tables.add('SalesData', 'A1:C3', { hasHeaders: true });
```

### Serialization

```typescript
// CSV (RFC 4180, formula injection protected)
const csv = await ws.toCSV();
const tsvData = await ws.toCSV({ separator: '\t' });

// JSON (array of objects, first row as headers)
const json = await ws.toJSON();
// [{ Product: 'Widget', Q1: 100, Q2: 150 }, ...]

const jsonNoHeader = await ws.toJSON({ headerRow: 'none' });
// [{ A: 'Product', B: 'Q1', C: 'Q2' }, ...]
```

### File I/O

```typescript
// Save to file (returns buffer too)
await wb.save('output.xlsx');

// Save to buffer only
const buf = await wb.save();
const buf = await wb.toXlsx();
```

### Formulas

Each `setCell` mutation triggers automatic recalc in Rust. Formulas are evaluated by the time `setCell` returns — no manual `calculate()` needed.

```typescript
await ws.setCell('A1', 10);
await ws.setCell('A2', 20);
await ws.setCell('A3', '=SUM(A1:A2)');

const val = await ws.getValue('A3'); // 30

// Search by formula
const cells = await ws.findByFormula(/SUM/);  // ['A3']
const formula = await ws.getFormula('A3');     // '=SUM(A1:A2)'
```

### Formatting & Structure

```typescript
await ws.formats.set('A1', { bold: true, fontColor: '#FF0000' });
await ws.formats.setRange('A1:B3', { italic: true });

await ws.structure.insertRows(2, 3);
await ws.structure.deleteColumns(1, 1);
await ws.structure.merge('A1:B1');
```

### Full Kernel API

The full kernel API is accessible — charts, tables, filters, validation, conditional formatting, pivots, and all 23 domain sub-APIs:

```typescript
// Charts
await ws.charts.add({ type: 'bar', dataRange: 'A1:B5' });

// Conditional formatting
await ws.conditionalFormats.add({ range: 'B2:B10', rule: { type: 'greaterThan', value: 100 } });

// Tables
await ws.tables.add('MyTable', 'A1:C5', { hasHeaders: true });

// Filters
await ws.filters.add('A1:C10');
```

### Low-Level Access

Drop to the raw compute bridge when the high-level API isn't enough:

```typescript
const bridge = wb.context.computeBridge;
const sheetId = (await bridge.getAllSheetIds())[0];
const result = await bridge.setCell(sheetId, crypto.randomUUID(), 0, 0, '=1+1');
```

### Cleanup

**Always dispose when done** to avoid resource leaks:

```typescript
await wb.dispose();
```

## Interactive Script Runner

```bash
# From sdk/
node run.cjs                          # runs examples/hello.ts
node run.cjs examples/explore-api.ts  # explore the full API
node run.cjs my-script.ts             # run your own script
```

Scripts export a default async function that receives a ready `Workbook`:

```typescript
import type { Workbook } from '../src/index';

export default async function (wb: Workbook) {
  const ws = wb.activeSheet;
  await ws.setCell('A1', 'Hello from SDK!');
  console.log(await ws.getValue('A1'));
}
```

## Public Surface

`@mog-sdk/node` exposes the workbook/document facade from its package root.
Raw NAPI boot helpers, Yrs boot paths, and collaboration coordinator wrappers
are internal implementation surfaces; package consumers should use
`createWorkbook()` or `MogDocumentFactory`.

## Architecture

```
createWorkbook()
  └─ DocumentFactory.create({ environment: 'headless' })
       └─ DocumentLifecycleSystem (XState machine)
            ├─ createTransport() → NAPI by default, WASM when requested
            │    ├─ LazyNapiTransport → compute-core-napi.node (Rust)
            │    └─ WasmTransport → @mog-sdk/wasm or host WebAssembly.Module
            ├─ ComputeBridge (async cell ops, recalc)
            └─ DocumentContext (kernel services, event bus)
                 ├─ Workbook / Worksheet (unified API)
                 └─ ChartImageExporter → portable SVG + runtime raster backend
```

The SDK boots the **same kernel** used by the browser app, with headless stubs for browser-only services (DOM, IndexedDB). Transport goes through napi-rs directly to Rust — no IPC, full native speed. Chart image export is supported through `sheet.charts.exportImage(...)`: SVG uses the shared portable vector renderer, while PNG/JPEG compile chart marks in TypeScript via the shared chart bridge and rasterize through a runtime backend. By default, Node uses the native raster backend lazily. Advanced callers can pass `chartRendering: { rasterBackend }` to provide their own backend or `chartRendering: { rasterModule }` to initialize `@mog-sdk/chart-raster-wasm` from a host-provided `WebAssembly.Module`. The raster backend is required only when exporting PNG/JPEG chart images; ordinary workbook creation, cell operations, formula evaluation, SVG chart export, and non-image exports do not validate that raster function.

```ts
const wb = await createWorkbook({
  userTimezone: 'UTC',
  runtime: 'wasm',
  wasmModule: computeWasmModule,
  chartRendering: {
    rasterModule: chartRasterWasmModule,
  },
});
```

Use `runtime: 'wasm'` to route compute through the WASM transport instead of the native N-API addon. Hosts that disallow package-side WASM compilation can precompile the compute module themselves and pass it as `wasmModule`; PNG/JPEG chart export can do the same with `chartRendering.rasterModule`.

## Prerequisites

- **Node.js** 20+
- **pnpm** 10+
- **Native addon** built: `cd compute-core-napi && pnpm build`

To check if the addon is current:

```bash
node check-addon.cjs
```

## Example Scripts

| Script | What it does |
|--------|-------------|
| `examples/hello.ts` | Boot, write cells, read back |
| `examples/explore-api.ts` | Write dataset, read, search, summarize |
| `examples/getrange-test.ts` | Validate batch_get_cells: formulas, empty cells, identity |
| `examples/test-interactive.ts` | Interactive API exploration |
| `examples/test-usedrange.ts` | Used range detection |

## Known Issues

**Console noise on boot**: `[SchemaValidationBridge]` errors during startup are harmless — the schema bridge tries to populate caches before the compute bridge is fully ready.

**IndexedDB error on dispose**: `indexedDB is not defined` appears on shutdown. The kernel tries to save to IndexedDB (browser API) which doesn't exist in Node.js. Caught and harmless.
