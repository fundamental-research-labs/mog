# Mog

Mog is a spreadsheet engine, app runtime, and SDK stack for building
workbook-aware agents, automations, and embedded spreadsheet experiences.

Try it live at [mog.shortcut.ai](https://mog.shortcut.ai/).

## Install

Use `@mog-sdk/sdk` for headless workbook automation in Node.js, Workers, and
other WASM-capable hosts.

```bash
npm install @mog-sdk/sdk
```

The package root is the default public entrypoint:

```ts
import { createWorkbook } from '@mog-sdk/sdk';
```

Use explicit runtime subpaths only when the host or test needs to force a
binding:

```ts
import { createWorkbook as createNodeWorkbook } from '@mog-sdk/sdk/node';
import { createWorkbook as createWasmWorkbook } from '@mog-sdk/sdk/wasm';
import { createWorkbook as createWorkerWorkbook } from '@mog-sdk/sdk/workerd';
```

## Quickstart

```ts
import { createWorkbook } from '@mog-sdk/sdk';

const wb = await createWorkbook({ userTimezone: 'UTC' });

try {
  const ws = wb.activeSheet;

  await ws.setCell('A1', 42);
  await ws.setCell('A2', '=A1*2');

  console.log(await ws.getValue('A2')); // 84
} finally {
  wb.dispose();
}
```

## Workbooks

Create a blank workbook, open an XLSX file, or load XLSX bytes.

```ts
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
```

The native Node entry accepts file paths and bytes. WASM and workerd entries
accept bytes and a host-provided `WebAssembly.Module`.

## Cells And Ranges

Use A1 notation or zero-based row/column coordinates. Strings that start with
`=` are formulas.

```ts
const ws = wb.activeSheet;

await ws.setCell('B1', 'Revenue');
await ws.setCell(1, 1, 1250); // B2

const value = await ws.getValue('B2');
const cell = await ws.getCell('B2');
const range = await ws.getRange('A1:B10');
```

Use `setRange` for rectangular writes and `setCells` for scattered writes.

```ts
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

## Formulas

Formula writes recalculate before the write resolves. Read computed values with
`getValue`, formula text with `getFormula`, and run an explicit calculation with
`wb.calculate()` when needed.

```ts
await ws.setCell('A1', 10);
await ws.setCell('A2', 20);
await ws.setCell('A3', '=SUM(A1:A2)');

console.log(await ws.getValue('A3')); // 30
console.log(await ws.getFormula('A3')); // =SUM(A1:A2)

const result = await wb.calculate();
console.log(result.recomputedCount);
```

## Sheets, Tables, And Filters

```ts
const summary = wb.activeSheet;
const data = await wb.sheets.add('Data');

await wb.sheets.rename(summary.name, 'Summary');
await wb.sheets.move('Data', 0);

const byName = await wb.getSheet('Summary');
const { sheet: inputs, created } = await wb.getOrCreateSheet('Inputs');
```

```ts
await data.setRange('A1:C3', [
  ['Product', 'Q1', 'Q2'],
  ['Widget', 100, 150],
  ['Gadget', 200, 180],
]);

const table = await data.tables.add('A1:C3', {
  name: 'SalesData',
  hasHeaders: true,
});

await data.tables.addRow(table.name, undefined, ['Service', 50, 75]);
await data.filters.add('A1:C10');
await data.filters.setColumnFilter(0, { type: 'value', values: ['Widget'] });
```

## Export

```ts
await wb.save('output.xlsx');

const savedBytes = await wb.save();
const xlsxBytes = await wb.toXlsx();
const csv = await wb.activeSheet.toCSV();
const json = await wb.activeSheet.toJSON();
```

## API Discovery For Agents

Mog includes generated API metadata for code generation and validation. Use
`api.describe(...)` to inspect real Mog API paths, and use
`api.guidance.analyze(source)` or `api.guidance.preflight(source)` before
running generated code.

```ts
import { api } from '@mog-sdk/sdk';

console.log(api.describe());
console.log(api.describe('ws.tables.add'));
console.log(api.describe('type:TableOptions'));

const preflight = api.guidance.preflight(source);
if (!preflight.ok) {
  const first = preflight.diagnostics[0];
  const message =
    first?.mogReplacements[0]?.snippet ?? first?.suggestion ?? 'Invalid Mog code';
  throw new Error(message);
}
```

Mog is not a Microsoft Office JavaScript API compatibility layer. Do not write
`Excel.run`, `Office.context`, `context.sync()`, Range proxy `.load(...)` calls,
or assignments such as `range.values = data`. Generated sandbox code should use
the injected `wb` object, derive `const ws = wb.activeSheet`, and call
Mog-native APIs such as `await ws.setRange(range, data)`.

## Browser Embeds

Use `@mog-sdk/embed` when a browser host needs to render a workbook.

- [React embed](docs/guides/embed-react.md)
- [Web Component embed](docs/guides/embed-web-component.md)
- [Full spreadsheet app embed](docs/guides/spreadsheet-app-embed.md)

## API Docs

- [SDK guide](docs/guides/sdk.md)
- [Public package reference](docs/reference/README.md)
- [Architecture overview](docs/guides/architecture-overview.md)
- [Trademark notices](TRADEMARKS.md)

## Contributing

The best way to contribute right now is to report bugs.

## License

Apache-2.0. See [LICENSE](LICENSE).
