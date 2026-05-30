# Quickstart

Get Mog running in under 5 minutes with the public Node SDK. By the end of
this guide you will have a workbook in memory, written values to cells, and
read formula results back.

## Prerequisites

- Node.js 18+
- npm, pnpm, or yarn
- Basic familiarity with TypeScript/JavaScript

## Install

```bash
npm install @mog-sdk/node
```

The package loads the native N-API engine for the current platform through
optional `@mog-sdk/*` platform packages.

## Create a Workbook

Instantiate a blank workbook and inspect the active sheet.

```typescript
import { createWorkbook } from '@mog-sdk/node';

const wb = await createWorkbook();
const ws = wb.activeSheet;

console.log(wb.sheetCount);
console.log(ws.name);
```

## Read and Write Cells

Write primitive values by A1 address or numeric row/column position. Read
computed values with `getValue()` and cell metadata with `getCell()`.

```typescript
await ws.setCell('A1', 42);
await ws.setCell(1, 0, 58); // A2, using zero-based row/column indexes

console.log(await ws.getValue('A1')); // 42
console.log(await ws.getCell('A1')); // value plus metadata such as formula/format
```

## Write a Formula

Strings starting with `=` are stored as formulas. `setCell()` recalculates the
workbook before it resolves for ordinary cell writes.

```typescript
await ws.setCell('A3', '=SUM(A1:A2)');

console.log(await ws.getValue('A3')); // 100
console.log((await ws.getCell('A3')).formula); // =SUM(A1:A2)
```

Dispose the workbook when finished so the SDK can release native resources.

```typescript
wb.dispose();
```

## Next Steps

- [Embed in a web page](embed-web-component.md) — render a sheet/view embed
- [Full spreadsheet app embed](spreadsheet-app-embed.md) — mount the full app surface with `@mog-sdk/spreadsheet-app`
- [Embed in React](embed-react.md) — use the React component
- [Node SDK deep dive](node-sdk.md) — server-side workbook manipulation
- [Architecture overview](architecture-overview.md) — understand the platform layers

## Related Docs

- [Architecture](../architecture/README.md)
- [API Reference](../reference/README.md)
