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
await wb.save('./outputs/model.xlsx'); // Node SDK creates missing parent dirs

const savedBytes = await wb.save();
const xlsxBytes = await wb.toXlsx();
```

`wb.save(path)` still returns XLSX bytes after writing. Path validation and
host write failures reject with `MogSdkError` details containing fields such as
`issue`, `requestedPath`, `cwd`, `absolutePath`, and `filesystemCode`.

## Version History

Enable version history when the workbook is created. The public SDK accepts
provider selection through `versionStore`; version operations then live under
`wb.version`.

The basic public flow is:

1. Pass `documentId` plus a supported `versionStore` to `createWorkbook(...)`.
2. Before each commit, read the current head and pass `expectedHead` with the
   head commit ID and ref revision.
3. Create branches with `wb.version.createBranch(...)`, then checkout the
   branch through `wb.version.checkout(...)` after the workbook is clean.
4. Preview merges with `wb.version.merge(...)`. Preview is read-only.
5. If the preview is conflicted, choose a resolution for every conflict and pass
   those conflict IDs, digests, option IDs, and option kinds to
   `wb.version.applyMerge(...)`.
6. Apply the accepted merge preview with the same `targetRef` and
   `expectedTargetHead`. If the target moved, handle `staleTargetHead` by
   re-reading the target and previewing again. Non-materializing direct applies
   from an attached active checkout branch may omit `targetRef`; the SDK targets
   the active branch and uses its current head when `expectedTargetHead` is also
   omitted.
7. Revert with a concrete `targetRef` plus a freshly read `expectedTargetHead`
   so stale target refs fail closed.

Supported public `versionStore.kind` values are `memory`, `in-memory`,
`memory-durable-snapshot`, `indexeddb`, and `browser`. Scope durable public
stores with `workspaceId` and `principalScope`; pass workbook import sources to
`createWorkbook(...)`, not to `versionStore`.

```javascript
import { createWorkbook } from '@mog-sdk/sdk';

const mainRef = 'refs/heads/main';
const budgetRef = 'refs/heads/budget-q1';

function failFromDiagnostics(diagnostics) {
  return diagnostics.map((diagnostic) => diagnostic.safeMessage ?? 'Version diagnostic').join('\n');
}

async function valueOf(resultPromise) {
  const result = await resultPromise;
  if (!result.ok) throw new Error(result.error.reason);
  return result.value;
}

async function readRef(wb, refName) {
  const result = await valueOf(wb.version.readRef(refName));
  if (result.status !== 'success') throw new Error(failFromDiagnostics(result.diagnostics));
  return result.ref;
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
  const rootHead = await valueOf(wb.version.getHead());
  if (!rootHead.refRevision) throw new Error('Main version head is missing its ref revision');

  await wb.activeSheet.setCell('A1', 'Base forecast');
  const baseCommit = await valueOf(
    wb.version.commit({
      message: 'Initial budget model',
      expectedHead: { commitId: rootHead.id, revision: rootHead.refRevision },
    }),
  );
  wb.markClean();

  await valueOf(
    wb.version.createBranch({
      name: budgetRef,
      targetCommitId: baseCommit.id,
      expectedAbsent: true,
    }),
  );

  const checkout = await valueOf(
    wb.version.checkout({ kind: 'ref', name: budgetRef }, { requireClean: true }),
  );
  if (checkout.materialization !== 'applied') {
    throw new Error('Checkout did not materialize workbook state');
  }

  await wb.activeSheet.setCell('B2', 1200);
  const branchHead = await valueOf(wb.version.getHead());
  if (!branchHead.refRevision) throw new Error('Scenario branch head is missing its revision');
  const branchCommit = await valueOf(
    wb.version.commit({
      message: 'Scenario revenue upside',
      expectedHead: { commitId: branchHead.id, revision: branchHead.refRevision },
    }),
  );
  wb.markClean();

  await valueOf(wb.version.checkout({ kind: 'ref', name: mainRef }, { requireClean: true }));
  const mainHead = await readRef(wb, mainRef);
  const expectedTargetHead = { commitId: mainHead.commitId, revision: mainHead.revision };

  const preview = await valueOf(
    wb.version.merge(
      { base: baseCommit.id, ours: expectedTargetHead.commitId, theirs: branchCommit.id },
      { mode: 'preview', targetRef: mainRef, expectedTargetHead },
    ),
  );
  if (preview.status === 'blocked') throw new Error(failFromDiagnostics(preview.diagnostics));

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

  const applied = await valueOf(
    wb.version.applyMerge(
      {
        base: baseCommit.id,
        ours: expectedTargetHead.commitId,
        theirs: branchCommit.id,
        resolutions,
      },
      { mode: 'apply', targetRef: mainRef, expectedTargetHead },
    ),
  );
  if (applied.status === 'blocked' || applied.status === 'staleTargetHead') {
    throw new Error(failFromDiagnostics(applied.diagnostics));
  }
  if (applied.status === 'conflicted') {
    throw new Error(`Merge still has ${applied.requiredResolutionCount} unresolved conflicts`);
  }
  if (applied.status === 'planned') {
    throw new Error('applyMerge planned the merge but did not mutate the target ref');
  }
  if (!applied.commitRef.refRevision) throw new Error('Merged target ref is missing its revision');

  const reverted = await valueOf(
    wb.version.revert(
      {
        target: { kind: 'commit', commitId: branchCommit.id },
        targetRef: mainRef,
        expectedTargetHead: {
          commitId: applied.commitRef.id,
          revision: applied.commitRef.refRevision,
        },
        preflight: {
          cas: { refName: mainRef, expectedRevision: applied.commitRef.refRevision },
        },
        reason: 'Back out scenario commit',
      },
      { includeDiagnostics: true },
    ),
  );
  if (reverted.status === 'rejected' || reverted.status === 'requires-review') {
    throw new Error(failFromDiagnostics(reverted.diagnostics));
  }
  if (reverted.status === 'planned') {
    throw new Error('revert planned the change but did not mutate the target ref');
  }

  console.log({
    baseCommit: baseCommit.id,
    branchCommit: branchCommit.id,
    mergedHead: applied.commitRef.id,
    revertCommit: reverted.commitRef?.id,
  });
} finally {
  await wb.dispose();
}
```

For merge, read the target ref immediately before preview and carry that exact
commit/revision through `applyMerge` as `expectedTargetHead`. A conflicted merge
preview is not applyable until every conflict has a resolution containing the
previewed `conflictId`, `conflictDigest`, `optionId`, and option `kind`. For
revert, read the target ref immediately before mutation and pass its
commit/revision as `expectedTargetHead`. Use `{ dryRun: true }` for revert when
the host wants to inspect diagnostics before moving the target ref.

Direct `applyMerge` calls against an attached active checkout are branch writes;
they move the target ref but do not reload the live workbook contents by
default. Pass `{ mode: 'apply', targetRef, expectedTargetHead,
materializeActiveCheckout: true }` when the target is the active checkout branch
and the workbook should immediately materialize the merged branch state. The
option is valid only in apply mode, and `targetRef`, `expectedTargetHead`, and
`input.ours` must all match the attached active checkout head.

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
