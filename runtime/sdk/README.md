# @mog-sdk/sdk

Shortcut Data OS SDK — headless spreadsheet engine for Node.js, Workers, and
WASM-capable hosts. Runs the real kernel + Rust compute-core without a browser.

## Quick Start

```typescript
import { createWorkbook } from '@mog-sdk/sdk';

const wb = await createWorkbook();
const ws = wb.activeSheet;

await ws.setCell('A1', 42);
await ws.setCell('A2', 58);
await ws.setCell('A3', '=A1+A2');

const val = await ws.getValue('A3'); // 100
await wb.dispose();
```

Three lines to a running spreadsheet engine. No context threading, no
active-sheet callbacks. In Node, the package root resolves to the native N-API
entry; in Workers/web-standard runtimes it resolves to a WASM entry through
package export conditions.

## Install

```bash
# Monorepo — already available as workspace dependency
pnpm add @mog-sdk/sdk

# Node/native path: the native Rust addon must be built first in source checkouts
cd compute-core-napi && pnpm build
```

## Runtime Entries

```typescript
import { createWorkbook } from '@mog-sdk/sdk';
import { createWorkbook as createNodeWorkbook } from '@mog-sdk/sdk/node';
import { createWorkbook as createWasmWorkbook } from '@mog-sdk/sdk/wasm';
import { createWorkbook as createWorkerWorkbook } from '@mog-sdk/sdk/workerd';
```

Use the package root for normal consumers. Use `./node`, `./wasm`, or
`./workerd` only when a host or test needs to force a binding.

WASM-capable entries accept a host-provided `wasmModule`. Workers/workerd hosts
should pass a bundler/runtime-provided `WebAssembly.Module`; file-path workbook
I/O remains Node-only.

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
await wb.save('./outputs/model.xlsx'); // Node SDK creates missing parent dirs

// Save to buffer only
const buf = await wb.save();
const buf = await wb.toXlsx();
```

`wb.save(path)` rejects invalid paths and host filesystem failures with
`MogSdkError` details such as `issue`, `requestedPath`, `cwd`, `absolutePath`,
and `filesystemCode`.

### Version Store and Version History

`versionStore` is selected when the workbook is created. It configures the
storage provider for the version graph; commits, refs, checkout, and merge are
all public `wb.version.*` operations after the workbook is open.

The public basic flow is: configure `versionStore` at `createWorkbook`, commit
with a freshly read `expectedHead`, create and checkout a branch, preview a
merge, convert any preview conflicts into explicit resolutions, apply the merge
with `expectedTargetHead`, and use revert with the same target-ref fencing when
the host needs to back out a commit.

```typescript
const wb = await createWorkbook({
  documentId: 'budget-2026',
  versionStore: {
    kind: 'memory-durable-snapshot',
    workspaceId: 'finance',
    principalScope: 'analyst-1',
  },
});
```

Supported public store kinds are:

- `memory` / `in-memory`: ephemeral version history for one process.
- `memory-durable-snapshot`: durable-snapshot provider selection for local
  version-history workflows.
- `indexeddb`: IndexedDB-backed version history where the host exposes
  IndexedDB.
- `browser`: browser-friendly alias that currently maps to IndexedDB.

`node-file`, `filesystem`, `node:fs`, and related durable Node filesystem
aliases are intentionally unsupported in this SDK release. They fail closed
with `MogSdkVersionStoreConfigError`; the SDK does not silently fall back to
memory when a durable file store was requested. Use `workspaceId` and
`principalScope` for public scope partitioning, and pass workbook import
sources to `createWorkbook(...)`, not to `versionStore`.

Commit, branch, checkout, merge, and revert all return `VersionResult`
receipts. Check `ok` before reading `value`; merge and revert also return
operation-specific status receipts. Read the current ref before mutating a ref
and pass `expectedHead` / `expectedTargetHead` so stale writes fail closed.

```javascript
import { createWorkbook } from '@mog-sdk/sdk';

const mainRef = 'refs/heads/main';
const budgetRef = 'refs/heads/budget-q1';

function diagnosticText(diagnostics) {
  return diagnostics.map((diagnostic) => diagnostic.safeMessage ?? 'Version diagnostic').join('\n');
}

function expectAppliedCommit(result) {
  if (result.status === 'blocked' || result.status === 'staleTargetHead') {
    throw new Error(diagnosticText(result.diagnostics));
  }
  if (result.status === 'conflicted') {
    throw new Error(`Merge still has ${result.requiredResolutionCount} unresolved conflicts`);
  }
  if (result.status === 'planned') {
    throw new Error('applyMerge planned the merge but did not mutate the target ref');
  }
  return result.commitRef;
}

const wb = await createWorkbook({
  documentId: 'budget-2026',
  userTimezone: 'UTC',
  versionStore: {
    kind: 'memory-durable-snapshot',
    workspaceId: 'finance',
    principalScope: 'analyst-1',
  },
});

try {
  const rootHeadResult = await wb.version.getHead();
  if (!rootHeadResult.ok) throw new Error(rootHeadResult.error.reason);
  if (!rootHeadResult.value.refRevision) {
    throw new Error('Main version head is missing its ref revision');
  }

  await wb.activeSheet.setCell('A1', 'Base forecast');
  const baseResult = await wb.version.commit({
    message: 'Initial budget model',
    expectedHead: {
      commitId: rootHeadResult.value.id,
      revision: rootHeadResult.value.refRevision,
    },
  });
  if (!baseResult.ok) throw new Error(baseResult.error.reason);
  const baseCommit = baseResult.value;
  wb.markClean();

  const branchResult = await wb.version.createBranch({
    name: budgetRef,
    targetCommitId: baseCommit.id,
    expectedAbsent: true,
  });
  if (!branchResult.ok) throw new Error(branchResult.error.reason);

  const checkoutResult = await wb.version.checkout(
    { kind: 'ref', name: budgetRef },
    { requireClean: true },
  );
  if (!checkoutResult.ok) throw new Error(checkoutResult.error.reason);
  if (checkoutResult.value.materialization !== 'applied') {
    throw new Error('Checkout did not materialize workbook state');
  }

  await wb.activeSheet.setCell('B2', 1200);
  const scenarioHeadResult = await wb.version.getHead();
  if (!scenarioHeadResult.ok) throw new Error(scenarioHeadResult.error.reason);
  if (!scenarioHeadResult.value.refRevision) {
    throw new Error('Scenario branch head is missing its ref revision');
  }

  const scenarioCommitResult = await wb.version.commit({
    message: 'Scenario revenue upside',
    expectedHead: {
      commitId: scenarioHeadResult.value.id,
      revision: scenarioHeadResult.value.refRevision,
    },
  });
  if (!scenarioCommitResult.ok) throw new Error(scenarioCommitResult.error.reason);
  const scenarioCommit = scenarioCommitResult.value;
  wb.markClean();

  const mainCheckoutResult = await wb.version.checkout(
    { kind: 'ref', name: mainRef },
    { requireClean: true },
  );
  if (!mainCheckoutResult.ok) throw new Error(mainCheckoutResult.error.reason);

  await wb.activeSheet.setCell('C2', 'main note');
  const mainHeadResult = await wb.version.getHead();
  if (!mainHeadResult.ok) throw new Error(mainHeadResult.error.reason);
  if (!mainHeadResult.value.refRevision) {
    throw new Error('Main branch head is missing its ref revision');
  }

  const mainCommitResult = await wb.version.commit({
    message: 'Main branch note',
    expectedHead: {
      commitId: mainHeadResult.value.id,
      revision: mainHeadResult.value.refRevision,
    },
  });
  if (!mainCommitResult.ok) throw new Error(mainCommitResult.error.reason);
  wb.markClean();

  const mainRefResult = await wb.version.readRef(mainRef);
  if (!mainRefResult.ok || mainRefResult.value.status !== 'success') {
    throw new Error(
      mainRefResult.ok
        ? diagnosticText(mainRefResult.value.diagnostics)
        : mainRefResult.error.reason,
    );
  }

  const expectedTargetHead = {
    commitId: mainRefResult.value.ref.commitId,
    revision: mainRefResult.value.ref.revision,
  };

  const previewResult = await wb.version.merge(
    {
      base: baseCommit.id,
      ours: expectedTargetHead.commitId,
      theirs: scenarioCommit.id,
    },
    {
      mode: 'preview',
      targetRef: mainRef,
      expectedTargetHead,
      persistReviewRecord: true,
    },
  );
  if (!previewResult.ok) throw new Error(previewResult.error.reason);

  const preview = previewResult.value;
  if (preview.status === 'blocked') {
    throw new Error(diagnosticText(preview.diagnostics));
  }

  const resolutions =
    preview.status === 'conflicted'
      ? preview.conflicts.map((conflict) => {
          const option =
            conflict.resolutionOptions.find((candidate) => candidate.kind === 'acceptTheirs') ??
            conflict.resolutionOptions[0];
          if (!option) throw new Error(`No resolution option for ${conflict.conflictId}`);
          return {
            conflictId: conflict.conflictId,
            expectedConflictDigest: conflict.conflictDigest,
            optionId: option.optionId,
            kind: option.kind,
          };
        })
      : [];

  const applyResult = await wb.version.applyMerge(
    {
      base: baseCommit.id,
      ours: expectedTargetHead.commitId,
      theirs: scenarioCommit.id,
      resolutions,
    },
    {
      mode: 'apply',
      targetRef: mainRef,
      expectedTargetHead,
    },
  );
  if (!applyResult.ok) throw new Error(applyResult.error.reason);

  const mergedHead = expectAppliedCommit(applyResult.value);
  if (!mergedHead.refRevision) {
    throw new Error('Merged target ref is missing its revision');
  }

  const revertResult = await wb.version.revert(
    {
      target: { kind: 'mergeCommit', commitId: mergedHead.id, mainlineParent: 1 },
      targetRef: mainRef,
      expectedTargetHead: {
        commitId: mergedHead.id,
        revision: mergedHead.refRevision,
      },
      preflight: {
        cas: {
          refName: mainRef,
          expectedRevision: mergedHead.refRevision,
        },
      },
      reason: 'Back out scenario merge',
    },
    { includeDiagnostics: true },
  );
  if (!revertResult.ok) throw new Error(revertResult.error.reason);
  if (revertResult.value.status === 'rejected' || revertResult.value.status === 'requires-review') {
    throw new Error(diagnosticText(revertResult.value.diagnostics));
  }
  if (revertResult.value.status === 'planned') {
    throw new Error('revert planned the change but did not mutate the target ref');
  }

  console.log({
    baseCommit: baseCommit.id,
    scenarioCommit: scenarioCommit.id,
    mergedCommit: mergedHead.id,
    revertCommit: revertResult.value.commitRef?.id,
  });
} finally {
  await wb.dispose();
}
```

For shorter flows, the same contracts apply: create a branch from a known
commit, pass `expectedHead` on commits that advance mutable refs, call
`wb.markClean()` before checkout if your host still considers the working copy
dirty, read the target ref immediately before merge preview and carry that same
`expectedTargetHead` into `applyMerge`, and read the target ref immediately
before `revert`.

```typescript
const initialHeadResult = await wb.version.getHead();
if (!initialHeadResult.ok || !initialHeadResult.value.refRevision) {
  throw new Error(
    initialHeadResult.ok
      ? 'Current head is missing its ref revision'
      : initialHeadResult.error.reason,
  );
}

await wb.activeSheet.setCell('A1', 'Base forecast');
const baseResult = await wb.version.commit({
  message: 'Initial budget model',
  expectedHead: {
    commitId: initialHeadResult.value.id,
    revision: initialHeadResult.value.refRevision,
  },
});
if (!baseResult.ok) throw new Error(baseResult.error.reason);
const baseCommit = baseResult.value;
wb.markClean();

const budgetRefName = 'refs/heads/budget-q1';
const branchResult = await wb.version.createBranch({
  name: budgetRefName,
  targetCommitId: baseCommit.id,
  expectedAbsent: true,
});
if (!branchResult.ok) throw new Error(branchResult.error.reason);
const budgetRef = branchResult.value;

const checkoutResult = await wb.version.checkout(
  {
    kind: 'ref',
    name: budgetRef.name,
  },
  { requireClean: true },
);
if (!checkoutResult.ok) throw new Error(checkoutResult.error.reason);
if (checkoutResult.value.materialization !== 'applied') {
  throw new Error('Checkout did not materialize workbook state');
}

await wb.activeSheet.setCell('B2', 1200);
const scenarioHeadResult = await wb.version.getHead();
if (!scenarioHeadResult.ok || !scenarioHeadResult.value.refRevision) {
  throw new Error(
    scenarioHeadResult.ok
      ? 'Checked-out branch head is missing its ref revision'
      : scenarioHeadResult.error.reason,
  );
}

const scenarioCommitResult = await wb.version.commit({
  message: 'Scenario revenue upside',
  expectedHead: {
    commitId: scenarioHeadResult.value.id,
    revision: scenarioHeadResult.value.refRevision,
  },
});
if (!scenarioCommitResult.ok) throw new Error(scenarioCommitResult.error.reason);
const scenarioCommit = scenarioCommitResult.value;
wb.markClean();
```

Merge preview is read-only. `applyMerge` is the mutating operation; pass a
concrete `targetRef` and the same `expectedTargetHead` used by the accepted
preview so a moved target ref returns `staleTargetHead` instead of applying over
newer work. When preview returns `conflicted`, each applied resolution must echo
the previewed `conflictId`, `conflictDigest`, selected `optionId`, and option
`kind`. If apply returns `staleTargetHead`, re-read the target ref and preview
again.

```typescript
const mainRefResult = await wb.version.readRef('refs/heads/main');
if (!mainRefResult.ok || mainRefResult.value.status !== 'success') {
  throw new Error(
    mainRefResult.ok
      ? mainRefResult.value.diagnostics[0]?.safeMessage ?? 'Main ref unavailable'
      : mainRefResult.error.reason,
  );
}

const expectedTargetHead = {
  commitId: mainRefResult.value.ref.commitId,
  revision: mainRefResult.value.ref.revision,
};

const previewResult = await wb.version.merge(
  {
    base: baseCommit.id,
    ours: expectedTargetHead.commitId,
    theirs: scenarioCommit.id,
  },
  {
    mode: 'preview',
    targetRef: 'refs/heads/main',
    expectedTargetHead,
    persistReviewRecord: true,
  },
);
if (!previewResult.ok) throw new Error(previewResult.error.reason);

const preview = previewResult.value;
if (preview.status === 'blocked') {
  throw new Error(preview.diagnostics.map((item) => item.safeMessage).join('\n'));
}

const resolutions =
  preview.status === 'conflicted'
    ? preview.conflicts.map((conflict) => {
        const option =
          conflict.resolutionOptions.find((candidate) => candidate.kind === 'acceptTheirs') ??
          conflict.resolutionOptions[0];
        if (!option) throw new Error(`No resolution option for ${conflict.conflictId}`);
        return {
          conflictId: conflict.conflictId,
          expectedConflictDigest: conflict.conflictDigest,
          optionId: option.optionId,
          kind: option.kind,
        };
      })
    : [];

const applyResult = await wb.version.applyMerge(
  {
    base: baseCommit.id,
    ours: expectedTargetHead.commitId,
    theirs: scenarioCommit.id,
    resolutions,
  },
  {
    mode: 'apply',
    targetRef: 'refs/heads/main',
    expectedTargetHead,
  },
);
if (!applyResult.ok) throw new Error(applyResult.error.reason);

const applied = applyResult.value;
if (applied.status === 'blocked' || applied.status === 'staleTargetHead') {
  throw new Error(applied.diagnostics.map((item) => item.safeMessage).join('\n'));
}
if (applied.status === 'conflicted') {
  throw new Error(`Merge still has ${applied.requiredResolutionCount} unresolved conflicts`);
}
if (applied.status === 'planned') {
  throw new Error('applyMerge planned the merge but did not mutate the target ref');
}

const newMainHead = applied.commitRef.id;
```

Revert supports single commits, ranges, and merge commits. Use `dryRun` when a
review gate must inspect diagnostics before the target ref can move.

```typescript
const mainRefResult = await wb.version.readRef('refs/heads/main');
if (!mainRefResult.ok || mainRefResult.value.status !== 'success') {
  throw new Error(
    mainRefResult.ok
      ? mainRefResult.value.diagnostics[0]?.safeMessage ?? 'Main ref unavailable'
      : mainRefResult.error.reason,
  );
}

const revertResult = await wb.version.revert(
  {
    target: { kind: 'commit', commitId: scenarioCommit.id },
    targetRef: 'refs/heads/main',
    expectedTargetHead: {
      commitId: mainRefResult.value.ref.commitId,
      revision: mainRefResult.value.ref.revision,
    },
    preflight: {
      cas: {
        refName: 'refs/heads/main',
        expectedRevision: mainRefResult.value.ref.revision,
      },
    },
    reason: 'Back out scenario commit',
  },
  { dryRun: true, includeDiagnostics: true },
);
if (!revertResult.ok) throw new Error(revertResult.error.reason);
if (revertResult.value.status === 'rejected' || revertResult.value.status === 'requires-review') {
  throw new Error(revertResult.value.diagnostics.map((item) => item.safeMessage).join('\n'));
}
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
await ws.conditionalFormats.addFormula('B2:B10', '=B2>100', { backgroundColor: '#fff2cc' });

// Data validation
await ws.validations.setList('C2:C10', ['Open', 'Blocked', 'Done']);

// Tables
await ws.tables.add('A1:C5', { name: 'MyTable', hasHeaders: true });

// Filters
await ws.filters.add('A1:C10');
await ws.filters.setColumnFilter(0, { type: 'value', values: ['Widget'] });
```

### API Discovery and Agent Guidance

Use `api.describe(...)` to inspect real Mog paths before generating code. Use
`api.guidance.analyze(source)` or `api.guidance.preflight(source)` before
execution, and use `api.guidance.explain(...)` for wrong-dialect symbols or
real Mog paths.

```typescript
import { api } from '@mog-sdk/sdk';

console.log(api.describe('ws.tables.add'));
console.log(api.describe('ws.filters.setColumnFilter'));

console.log(api.guidance.explain('context.workbook.worksheets.getActiveWorksheet'));
console.log(api.guidance.explain('wb.activeSheet'));

const diagnostics = api.guidance.analyze(source);
for (const diagnostic of diagnostics) {
  console.log(diagnostic.mogReplacements, diagnostic.references);
}

const preflight = api.guidance.preflight(source);
if (!preflight.ok) {
  const first = preflight.diagnostics[0];
  throw new Error(first?.mogReplacements[0]?.snippet ?? first?.suggestion ?? 'Invalid Mog code');
}
```

OfficeJS-looking code is a diagnosed foreign dialect, not a supported API mode.
Do not write `Excel.run`, `Office.context`, `context.sync()`, Range proxy
`.load(...)` calls, null-object sentinels, or assignments such as
`range.values = data`. In generated sandbox code, use the injected `wb` object
and derive `const ws = wb.activeSheet`; then call Mog-native APIs such as
`await wb.getSheet(name)`, `await ws.setRange(range, data)`, and
`await ws.formats.setRange(range, format)`. Read `diagnostic.mogReplacements`
for replacement paths/snippets; do not rely only on the summary error string.

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

`@mog-sdk/sdk` exposes the workbook/document facade from its package root.
Raw NAPI boot helpers, Yrs boot paths, and collaboration coordinator wrappers
are internal implementation surfaces; package consumers should use
`createWorkbook()` or `MogDocumentFactory`.

## Architecture

```
createWorkbook()
  └─ DocumentFactory.create({ environment: 'headless' })
       └─ DocumentLifecycleSystem (XState machine)
            ├─ createTransport() → package-selected native N-API or WASM
            │    ├─ LazyNapiTransport → compute-core-napi.node (Rust)
            │    └─ WasmTransport → @mog-sdk/wasm or host WebAssembly.Module
            ├─ ComputeBridge (async cell ops, recalc)
            └─ DocumentContext (kernel services, event bus)
                 ├─ Workbook / Worksheet (unified API)
                 └─ ChartImageExporter → portable SVG + runtime raster backend
```

The SDK boots the **same kernel** used by the browser app, with headless stubs for browser-only services (DOM, IndexedDB). Transport goes through napi-rs directly to Rust — no IPC, full native speed. Chart image export is supported through `sheet.charts.exportImage(...)`: SVG uses the shared portable vector renderer, while PNG/JPEG compile chart marks in TypeScript via the shared chart bridge and rasterize through a runtime backend. By default, Node uses the native raster backend lazily. Advanced callers can pass `chartRendering: { rasterBackend }` to provide their own backend or `chartRendering: { rasterModule }` to initialize `@mog-sdk/chart-raster-wasm` from a host-provided `WebAssembly.Module`. The raster backend is required only when exporting PNG/JPEG chart images; ordinary workbook creation, cell operations, formula evaluation, SVG chart export, and non-image exports do not validate that raster function.

```ts
import { createWorkbook as createWasmWorkbook } from '@mog-sdk/sdk/wasm';

const wb = await createWasmWorkbook({
  userTimezone: 'UTC',
  wasmModule: computeWasmModule,
  chartRendering: {
    rasterModule: chartRasterWasmModule,
  },
});
```

Use `@mog-sdk/sdk/wasm` to route compute through the WASM transport explicitly. Hosts that disallow package-side WASM compilation can precompile the compute module themselves and pass it as `wasmModule`; PNG/JPEG chart export can do the same with `chartRendering.rasterModule`.

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
