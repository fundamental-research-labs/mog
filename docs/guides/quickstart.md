# Quickstart

Get Mog running with the shipped public SDK. This guide creates a blank
workbook, writes values, writes a formula, reads the computed result, and then
closes the workbook.

## Prerequisites

- Node.js 18+
- npm
- A supported native platform package for the Node-resolved `@mog-sdk/sdk`
  entry: macOS arm64/x64, Linux x64/arm64 with glibc or musl, or Windows x64

## Create and Run a Script

The example uses plain ESM JavaScript so it runs without a TypeScript build
step.

```bash
mkdir mog-quickstart
cd mog-quickstart
npm init -y
npm install @mog-sdk/sdk

cat > quickstart.mjs <<'EOF'
import { createWorkbook } from '@mog-sdk/sdk';

const wb = await createWorkbook({ userTimezone: 'UTC' });

try {
  const ws = wb.activeSheet;

  console.log(`sheet count: ${wb.sheetCount}`);
  console.log(`active sheet: ${ws.name}`);

  await ws.setCell('A1', 42);
  await ws.setCell(1, 0, 58); // A2, using zero-based row/column indexes
  await ws.setCell('A3', '=SUM(A1:A2)');

  console.log(`A1: ${await ws.getValue('A1')}`);
  console.log(`A2: ${await ws.getValue('A2')}`);
  console.log(`A3: ${await ws.getValue('A3')}`);
  console.log(`A3 formula: ${await ws.getFormula('A3')}`);
} finally {
  await wb.close('skipSave');
}
EOF

node quickstart.mjs
```

Expected output:

```text
sheet count: 1
active sheet: Sheet1
A1: 42
A2: 58
A3: 100
A3 formula: =SUM(A1:A2)
```

## What This Uses

- In Node, `createWorkbook()` from `@mog-sdk/sdk` creates a headless workbook
  backed by the native N-API engine. The same package root resolves to WASM in
  Workers/web-standard runtimes through package export conditions.
- `wb.activeSheet`, `wb.sheetCount`, and `ws.name` are synchronous cached
  workbook/sheet properties.
- `ws.setCell()` accepts A1 addresses and zero-based numeric row/column
  coordinates.
- Strings that start with `=` are stored as formulas. `ws.getValue()` returns
  the computed value, and `ws.getFormula()` returns the authored formula text.
- `await wb.close('skipSave')` releases the workbook without exporting a file.

## Native Package Troubleshooting

`@mog-sdk/sdk` loads the native N-API engine through optional `@mog-sdk/*`
platform packages when the Node/native entry is selected. That native entry
does not fall back to WASM. If installation or startup fails because a package
such as
`@mog-sdk/darwin-arm64`, `@mog-sdk/linux-x64-gnu`, or
`@mog-sdk/win32-x64-msvc` is missing, check that optional dependencies were not
disabled and that the machine is one of the supported platforms above.
For explicit WASM or Workers usage, use `@mog-sdk/sdk/wasm` or
`@mog-sdk/sdk/workerd` and pass a host-provided `wasmModule`; see the SDK deep
dive.

## Next Steps

- [SDK deep dive](sdk.md) — server-side workbook manipulation
- [Embed in a web page](embed-web-component.md) — render a sheet/view embed
- [Full spreadsheet app embed](spreadsheet-app-embed.md) — mount the full app surface with `@mog-sdk/spreadsheet-app`
- [Embed in React](embed-react.md) — use the React component
- [Architecture overview](architecture-overview.md) — understand the platform layers

## Related Docs

- [Architecture](../architecture/README.md)
- [API Reference](../reference/README.md)
