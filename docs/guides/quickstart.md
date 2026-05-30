# Quickstart

> **Status: skeleton — content pending package stabilization**

Get Mog running in under 5 minutes. By the end of this guide you will have a workbook in memory, written values to cells, and read them back.

## Prerequisites

- Node.js 20+ or Bun 1.1+
- npm, pnpm, or yarn
- Basic familiarity with TypeScript/JavaScript

## Install

How to install `@mog-sdk/kernel` (browser/WASM) or `@mog-sdk/node` (server/N-API). Package names, version constraints, and peer dependencies.

## Create a Workbook

Instantiate a blank workbook, add a sheet, and inspect the default state.

```typescript
// example: create workbook, add sheet
```

## Read and Write Cells

Write values (strings, numbers, booleans) to cells by address or CellId. Read them back. Cover the difference between display values and raw values.

```typescript
// example: set cell, get cell
```

## Write a Formula

Set a formula on a cell, trigger recalc, and read the computed result.

```typescript
// example: set formula, read result
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
