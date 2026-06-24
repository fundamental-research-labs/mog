import type { ApiGuidanceEntry } from './types';

const dataTableComputeReceiptSnippet = `const receipt = await ws.whatIf.dataTable("B3", {
  rowInputCell: "B1",
  colInputCell: "B2",
  rowValues: [0.08, 0.09, 0.1],
  colValues: [0.02, 0.025, 0.03],
});
const diagnosticMessage = receipt.diagnostics
  .map((diagnostic) => diagnostic.message)
  .join("\\n");
if (receipt.status === "failed" || receipt.status === "unsupported") {
  throw new Error(diagnosticMessage || "Data Table compute " + receipt.status);
}
if (receipt.status !== "completed") {
  throw new Error(diagnosticMessage || "Data Table compute " + receipt.status);
}
if (!receipt.effects.some((effect) => effect.type === "computedGrid")) {
  throw new Error("Data Table compute did not report a computed grid");
}
const computedGrid = receipt.results;`;

const dataTableCreateReceiptSnippet = `const receipt = await ws.whatIf.createDataTable({
  tableRange: "B3:F8",
  rowInputCell: "B1",
  colInputCell: "B2",
});
const diagnosticMessage = receipt.diagnostics
  .map((diagnostic) => diagnostic.message)
  .join("\\n");
if (receipt.status === "failed" || receipt.status === "unsupported") {
  throw new Error(diagnosticMessage || "Data Table create " + receipt.status);
}
if (receipt.status === "partial" || !receipt.materialized) {
  const repairHint = receipt.diagnostics.find((diagnostic) => diagnostic.recoverable)?.nextAction;
  const repair = await ws.whatIf.refreshDataTable(receipt.regionId, { force: true });
  const repairDiagnostics = repair.diagnostics
    .map((diagnostic) => diagnostic.message)
    .join("\\n");
  if (
    repair.status === "failed" ||
    repair.status === "unsupported" ||
    repair.status === "partial"
  ) {
    throw new Error(repairDiagnostics || repairHint || "Data Table repair " + repair.status);
  }
}
const materializedRanges = receipt.effects
  .filter((effect) => effect.type === "materializedCells" && effect.range)
  .map((effect) => effect.range);`;

const dataTableRefreshRepairSnippet = `const repair = await ws.whatIf.refreshDataTable("B3:F8", {
  force: true,
});
const diagnosticMessage = repair.diagnostics
  .map((diagnostic) => diagnostic.message)
  .join("\\n");
if (
  repair.status === "failed" ||
  repair.status === "unsupported" ||
  repair.status === "partial"
) {
  throw new Error(diagnosticMessage || "Data Table repair " + repair.status);
}
const refreshedRanges = repair.effects
  .filter((effect) => effect.type === "materializedCells" && effect.range)
  .map((effect) => effect.range);`;

const pivotMaterializeReceiptSnippet = `const receipt = await ws.pivots.add(
  {
    name: "SalesPivot",
    dataSource: "Sales!A1:E500",
    targetSheet: "Summary",
    targetAddress: "A3",
    rowFields: ["Region"],
    columnFields: ["Quarter"],
    valueFields: [{ field: "Revenue", aggregation: "sum" }],
  },
  { lifecycle: "materialize" },
);
const diagnosticMessage = receipt.diagnostics
  .map((diagnostic) => diagnostic.message)
  .join("\\n");
if (receipt.status === "failed") {
  throw new Error(diagnosticMessage || "Pivot materialization failed");
}
if (receipt.status === "partial" || !receipt.materialized) {
  const repair = await ws.pivots.refresh(receipt.config.name);
  const repairDiagnostics = repair.diagnostics
    .map((diagnostic) => diagnostic.message)
    .join("\\n");
  if (repair.status !== "applied") {
    throw new Error(repairDiagnostics || "Pivot repair " + repair.status);
  }
}
const changedRanges = receipt.effects
  .filter((effect) => effect.range)
  .map((effect) => effect.range);`;

const autofillPreviewThenApplySnippet = `const preview = await ws.autoFillPreview("A2:A3", "A4:A20", "series");
const previewDiagnostics = [
  ...preview.diagnostics.map((diagnostic) => diagnostic.message),
  ...preview.referenceDiagnostics
    .filter((diagnostic) => diagnostic.outOfBounds)
    .map((diagnostic) => "Reference out of bounds at " + diagnostic.row + "," + diagnostic.col),
];
if (previewDiagnostics.length > 0) {
  throw new Error(previewDiagnostics.join("\\n"));
}
if (preview.status !== "completed" || preview.worksheetChanged || preview.undoChanged) {
  throw new Error("Autofill preview did not remain read-only");
}
const receipt = await ws.autoFill("A2:A3", "A4:A20", preview.mode);
if (receipt.status === "applied") {
  const changedRanges = receipt.effects
    .filter((effect) => effect.type === "changedRange" && effect.range)
    .map((effect) => effect.range);
}`;

const versionStoreConfigSnippet = `import { createWorkbook } from "@mog-sdk/sdk";

const wb = await createWorkbook({
  documentId: "budget-2026",
  userTimezone: "UTC",
  versionStore: {
    kind: "memory-durable-snapshot",
    workspaceId: "finance",
    principalScope: "analyst-1",
  },
});`;

const versionCommitSnippet = `const headResult = await wb.version.getHead();
if (!headResult.ok) {
  throw new Error(headResult.error.reason);
}
if (!headResult.value.refRevision) {
  throw new Error("Current version head is not attached to a mutable ref");
}
const commitResult = await wb.version.commit({
  message: "Update forecast inputs",
  expectedHead: {
    commitId: headResult.value.id,
    revision: headResult.value.refRevision,
  },
});
if (!commitResult.ok) {
  throw new Error(commitResult.error.reason);
}
const commitId = commitResult.value.id;`;

const versionBranchSnippet = `const targetHeadResult = await wb.version.getHead();
if (!targetHeadResult.ok) {
  throw new Error(targetHeadResult.error.reason);
}
const branchResult = await wb.version.createBranch({
  name: "refs/heads/budget-q1",
  targetCommitId: targetHeadResult.value.id,
  expectedAbsent: true,
});
if (!branchResult.ok) {
  throw new Error(branchResult.error.reason);
}
const branchRef = branchResult.value;`;

const versionCheckoutSnippet = `wb.markClean();
const checkoutResult = await wb.version.checkout({
  kind: "ref",
  name: "refs/heads/budget-q1",
}, {
  requireClean: true,
});
if (!checkoutResult.ok) {
  throw new Error(checkoutResult.error.reason);
}
if (checkoutResult.value.materialization !== "applied") {
  throw new Error("Checkout planned but did not materialize workbook state");
}`;

const versionMergePreviewSnippet = `const mainRefResult = await wb.version.readRef("refs/heads/main");
if (!mainRefResult.ok || mainRefResult.value.status !== "success") {
  throw new Error(
    mainRefResult.ok
      ? mainRefResult.value.diagnostics[0]?.safeMessage ?? "Main ref unavailable"
      : mainRefResult.error.reason,
  );
}
const expectedTargetHead = {
  commitId: mainRefResult.value.ref.commitId,
  revision: mainRefResult.value.ref.revision,
};
const mergeInput = {
  base: baseCommitId,
  ours: expectedTargetHead.commitId,
  theirs: branchCommitId,
};
const previewResult = await wb.version.merge(mergeInput, {
  mode: "preview",
  targetRef: "refs/heads/main",
  expectedTargetHead,
  persistReviewRecord: true,
});
if (!previewResult.ok) {
  throw new Error(previewResult.error.reason);
}
const preview = previewResult.value;
if (preview.status === "blocked") {
  throw new Error(preview.diagnostics.map((diagnostic) => diagnostic.safeMessage).join("\\n"));
}
const resolutions = preview.status === "conflicted"
  ? preview.conflicts.map((conflict) => {
      const option =
        conflict.resolutionOptions.find((candidate) => candidate.kind === "acceptTheirs") ??
        conflict.resolutionOptions[0];
      if (!option) {
        throw new Error("No resolution option for " + conflict.conflictId);
      }
      return {
        conflictId: conflict.conflictId,
        expectedConflictDigest: conflict.conflictDigest,
        optionId: option.optionId,
        kind: option.kind,
      };
    })
  : [];`;

const versionApplyMergeSnippet = `const applyTargetRefResult = await wb.version.readRef("refs/heads/main");
if (!applyTargetRefResult.ok || applyTargetRefResult.value.status !== "success") {
  throw new Error(
    applyTargetRefResult.ok
      ? applyTargetRefResult.value.diagnostics[0]?.safeMessage ?? "Main ref unavailable"
      : applyTargetRefResult.error.reason,
  );
}
const applyExpectedTargetHead = {
  commitId: applyTargetRefResult.value.ref.commitId,
  revision: applyTargetRefResult.value.ref.revision,
};
const applyResult = await wb.version.applyMerge(
  {
    base: baseCommitId,
    ours: applyExpectedTargetHead.commitId,
    theirs: branchCommitId,
    resolutions,
  },
  {
    mode: "apply",
    targetRef: "refs/heads/main",
    expectedTargetHead: applyExpectedTargetHead,
  },
);
if (!applyResult.ok) {
  throw new Error(applyResult.error.reason);
}
const applied = applyResult.value;
if (applied.status === "blocked" || applied.status === "staleTargetHead") {
  throw new Error(applied.diagnostics.map((diagnostic) => diagnostic.safeMessage).join("\\n"));
}
if (applied.status === "conflicted") {
  throw new Error("Merge still has " + applied.requiredResolutionCount + " unresolved conflicts");
}
if (applied.status === "planned") {
  throw new Error("applyMerge planned the merge but did not mutate the target ref");
}
const newHeadId = applied.commitRef.id;`;

const versionRevertSnippet = `const targetRefResult = await wb.version.readRef("refs/heads/main");
if (!targetRefResult.ok || targetRefResult.value.status !== "success") {
  throw new Error(
    targetRefResult.ok
      ? targetRefResult.value.diagnostics[0]?.safeMessage ?? "Main ref unavailable"
      : targetRefResult.error.reason,
  );
}
const commitToRevertId = branchCommit.id;
const revertResult = await wb.version.revert(
  {
    target: { kind: "commit", commitId: commitToRevertId },
    targetRef: "refs/heads/main",
    expectedTargetHead: {
      commitId: targetRefResult.value.ref.commitId,
      revision: targetRefResult.value.ref.revision,
    },
    preflight: {
      cas: {
        refName: "refs/heads/main",
        expectedRevision: targetRefResult.value.ref.revision,
      },
    },
    reason: "Back out scenario commit",
  },
  { includeDiagnostics: true },
);
if (!revertResult.ok) {
  throw new Error(revertResult.error.reason);
}
const reverted = revertResult.value;
if (reverted.status === "rejected" || reverted.status === "requires-review") {
  throw new Error(reverted.diagnostics.map((diagnostic) => diagnostic.safeMessage).join("\\n"));
}
if (reverted.status === "planned") {
  throw new Error("revert planned the change but did not mutate the target ref");
}
const revertCommitId = reverted.commitRef?.id;`;

export const apiGuidanceCatalog = [
  {
    id: 'officejs.bootstrap',
    dialect: 'officejs',
    category: 'bootstrap',
    matchers: [
      { id: 'officejs.excel-run', kind: 'call', symbol: 'Excel.run', confidence: 0.99 },
      { id: 'officejs.office-on-ready', kind: 'call', symbol: 'Office.onReady', confidence: 0.94 },
      {
        id: 'officejs.excel-create-workbook',
        kind: 'call',
        symbol: 'Excel.createWorkbook',
        confidence: 0.96,
      },
    ],
    message:
      'This looks like Microsoft Office JavaScript spreadsheet API code. You are writing Mog code.',
    suggestion:
      'Do not wrap Mog code in Excel.run or Office.onReady. Use the injected `wb` / `ws` objects, or create a workbook with `createWorkbook(...)` at the SDK boundary.',
    mogReplacements: [
      {
        path: 'wb.activeSheet',
        snippet: 'const ws = wb.activeSheet;',
      },
      {
        path: 'createWorkbook',
        snippet:
          "import { createWorkbook } from '@mog-sdk/sdk';\nconst wb = await createWorkbook();",
        note: 'Root SDK factory, not a workbook member path.',
      },
    ],
    confidence: 0.99,
    blocking: true,
  },
  {
    id: 'officejs.host-globals',
    dialect: 'officejs',
    category: 'host',
    matchers: [
      { id: 'officejs.office-context', kind: 'member-chain', symbol: 'Office.context' },
      {
        id: 'officejs.office-document',
        kind: 'member-chain',
        symbol: 'Office.context.document',
      },
      {
        id: 'officejs.display-dialog',
        kind: 'member-chain',
        symbol: 'Office.context.ui.displayDialogAsync',
      },
      { id: 'officejs.storage', kind: 'member-chain', symbol: 'OfficeRuntime.storage' },
    ],
    message: 'Office host globals are not available in Mog code.',
    suggestion:
      'Use the Mog SDK workbook object and host integration outside the code execution sandbox.',
    mogReplacements: [
      { path: 'wb.save', snippet: 'await wb.save(path);' },
      { path: 'wb.toXlsx', snippet: 'const bytes = await wb.toXlsx();' },
    ],
    confidence: 0.96,
    blocking: true,
  },
  {
    id: 'officejs.sync-load',
    dialect: 'officejs',
    category: 'sync-load',
    matchers: [
      { id: 'officejs.context-sync', kind: 'call', symbol: 'context.sync', confidence: 0.98 },
      { id: 'officejs.proxy-load', kind: 'call', symbol: '.load', confidence: 0.92 },
      { id: 'officejs.null-object', kind: 'member-chain', symbol: '.isNullObject' },
      { id: 'officejs.tracked-objects', kind: 'member-chain', symbol: 'trackedObjects' },
      {
        id: 'officejs.load-then-sync',
        kind: 'compound',
        symbols: ['.load', 'context.sync'],
        confidence: 0.99,
        blocking: true,
      },
    ],
    message:
      'Microsoft Office JavaScript spreadsheet proxy load/sync code is not part of the Mog API.',
    suggestion:
      'Mog APIs return real values directly. Await the Mog method that reads or writes the data you need.',
    mogReplacements: [
      {
        path: 'ws.getCells',
        snippet: 'const cells = await ws.getCells("A1:B2");',
        note: 'Use when you need addresses, absolute row/col, formulas, formats, or range-relative offsets.',
      },
      { path: 'ws.getValues', snippet: 'const values = await ws.getValues("A1:B2");' },
      { path: 'ws.getRange', snippet: 'const range = await ws.getRange("A1:B2");' },
      { path: 'wb.findSheet', snippet: 'const ws = await wb.findSheet(name);' },
    ],
    confidence: 0.96,
    blocking: true,
  },
  {
    id: 'officejs.active-sheet',
    dialect: 'officejs',
    category: 'worksheet',
    matchers: [
      {
        id: 'officejs.context-workbook-active-worksheet',
        kind: 'call',
        symbol: 'context.workbook.worksheets.getActiveWorksheet',
        confidence: 0.98,
      },
      {
        id: 'officejs.workbook-active-worksheet',
        kind: 'call',
        symbol: 'workbook.worksheets.getActiveWorksheet',
        confidence: 0.94,
      },
      {
        id: 'officejs.worksheets-active-worksheet',
        kind: 'call',
        symbol: 'worksheets.getActiveWorksheet',
        confidence: 0.94,
      },
    ],
    message:
      'This active worksheet access comes from the Microsoft Office JavaScript spreadsheet API, not Mog.',
    suggestion: 'Use `const ws = wb.activeSheet;` for the active worksheet.',
    mogReplacements: [{ path: 'wb.activeSheet', snippet: 'const ws = wb.activeSheet;' }],
    confidence: 0.98,
    blocking: true,
  },
  {
    id: 'officejs.sheet-lookup',
    dialect: 'officejs',
    category: 'worksheet',
    matchers: [
      { id: 'officejs.worksheets-get-item', kind: 'member-chain', symbol: 'worksheets.getItem' },
      {
        id: 'officejs.worksheets-get-item-or-null',
        kind: 'member-chain',
        symbol: 'worksheets.getItemOrNullObject',
      },
      { id: 'officejs.worksheets-items', kind: 'member-chain', symbol: 'worksheets.items' },
    ],
    message:
      'Microsoft Office JavaScript spreadsheet worksheet collection calls are not Mog worksheet access.',
    suggestion:
      'Use `await wb.getSheet(name)` when the sheet must exist, `await wb.findSheet(name)` for nullable lookup, or `wb.sheetNames` / `await wb.getSheets()` for listing.',
    mogReplacements: [
      { path: 'wb.getSheet', snippet: 'const ws = await wb.getSheet(name);' },
      { path: 'wb.findSheet', snippet: 'const ws = await wb.findSheet(name);' },
      { path: 'wb.sheetNames', snippet: 'const names = wb.sheetNames;' },
      { path: 'wb.getSheets', snippet: 'const sheets = await wb.getSheets();' },
    ],
    confidence: 0.95,
    blocking: true,
  },
  {
    id: 'officejs.range-write',
    dialect: 'officejs',
    category: 'range',
    matchers: [
      { id: 'officejs.range-values-assignment', kind: 'assignment', symbol: '.values' },
      { id: 'officejs.range-formulas-assignment', kind: 'assignment', symbol: '.formulas' },
    ],
    message:
      'Microsoft Office JavaScript spreadsheet range proxy assignment does not write data in Mog.',
    suggestion: 'Use `await ws.setRange(range, values)` for range writes.',
    mogReplacements: [{ path: 'ws.setRange', snippet: 'await ws.setRange("A1:B2", values);' }],
    confidence: 0.97,
    blocking: true,
  },
  {
    id: 'officejs.range-read',
    dialect: 'officejs',
    category: 'range',
    matchers: [
      {
        id: 'officejs.load-sync-range-values',
        kind: 'compound',
        symbols: ['.load', 'context.sync', '.values'],
        confidence: 0.98,
        blocking: true,
      },
    ],
    message:
      'Microsoft Office JavaScript spreadsheet range proxy reads require load/sync; Mog reads return values directly.',
    suggestion:
      'Use `await ws.getCells(range)` for address-bearing cells, `await ws.getValues(range)` for a value matrix, or `await ws.getRange(range)` for a cell-data matrix.',
    mogReplacements: [
      {
        path: 'ws.getCells',
        snippet: 'const cells = await ws.getCells("A1:B2");',
        note: 'Flat records include address, row, col, value, formula, format, and range offsets.',
      },
      { path: 'ws.getValues', snippet: 'const values = await ws.getValues("A1:B2");' },
      { path: 'ws.getRange', snippet: 'const range = await ws.getRange("A1:B2");' },
    ],
    confidence: 0.9,
    blocking: true,
  },
  {
    id: 'officejs.range-navigation',
    dialect: 'officejs',
    category: 'range',
    matchers: [
      {
        id: 'officejs.get-used-range-null-object',
        kind: 'call',
        symbol: 'getUsedRangeOrNullObject',
      },
      { id: 'officejs.get-range-edge', kind: 'call', symbol: 'getRangeEdge' },
      { id: 'officejs.get-surrounding-region', kind: 'call', symbol: 'getSurroundingRegion' },
      { id: 'officejs.get-resized-range', kind: 'call', symbol: 'getResizedRange' },
      { id: 'officejs.get-offset-range', kind: 'call', symbol: 'getOffsetRange' },
    ],
    message:
      'Microsoft Office JavaScript spreadsheet range navigation helpers do not map one-for-one to Mog APIs.',
    suggestion:
      'Choose the Mog range API that matches the intent: used range, current region, data edge, or address/index conversion.',
    mogReplacements: [
      { path: 'ws.getUsedRange', snippet: 'const used = await ws.getUsedRange();' },
      { path: 'ws.getCurrentRegion', snippet: 'const region = await ws.getCurrentRegion(0, 0);' },
      { path: 'ws.findDataEdge', snippet: 'const edge = await ws.findDataEdge(0, 0, "down");' },
      { path: 'wb.addressToIndex', snippet: 'const { row, col } = wb.addressToIndex("A1");' },
    ],
    confidence: 0.9,
    blocking: true,
  },
  {
    id: 'officejs.what-if-data-table',
    dialect: 'officejs',
    category: 'worksheet',
    matchers: [
      {
        id: 'officejs-workbook-application-calculate',
        kind: 'call',
        symbol: 'context.workbook.application.calculate',
        confidence: 0.8,
      },
      {
        id: 'officejs-calculation-type',
        kind: 'member-chain',
        symbol: 'Excel.CalculationType',
        confidence: 0.78,
      },
    ],
    message:
      'Microsoft Office JavaScript spreadsheet recalculation helpers do not expose Mog Data Table receipt semantics.',
    suggestion:
      'Use worksheet what-if APIs and branch on receipt status, diagnostics, and effects before reading results or assuming worksheet writes.',
    mogReplacements: [
      {
        path: 'ws.whatIf.dataTable',
        snippet: dataTableComputeReceiptSnippet,
        note: 'Transient Data Table compute returns a receipt and does not mutate the worksheet.',
      },
      {
        path: 'ws.whatIf.createDataTable',
        snippet: dataTableCreateReceiptSnippet,
        note: 'Persistent Data Table creation can be applied, partial, failed, or unsupported.',
      },
      {
        path: 'ws.whatIf.refreshDataTable',
        snippet: dataTableRefreshRepairSnippet,
        note: 'Use refresh receipts to repair or verify a partial materialized Data Table.',
      },
    ],
    confidence: 0.82,
    blocking: true,
  },
  {
    id: 'officejs.pivots',
    dialect: 'officejs',
    category: 'pivots',
    matchers: [
      {
        id: 'officejs-context-workbook-pivottables',
        kind: 'member-chain',
        symbol: 'context.workbook.pivotTables',
        confidence: 0.86,
      },
    ],
    message:
      'Microsoft Office JavaScript pivot table APIs do not return Mog materialization receipts.',
    suggestion:
      'Use `ws.pivots.add(..., { lifecycle: "materialize" })` and branch on the returned receipt before relying on rendered output.',
    mogReplacements: [
      {
        path: 'ws.pivots.add',
        snippet: pivotMaterializeReceiptSnippet,
        note: 'Materialized pivot creation can return applied, partial, or failed receipts.',
      },
      {
        path: 'ws.pivots.refresh',
        snippet: pivotMaterializeReceiptSnippet,
        note: 'Refresh is the public repair path when materialization was partial.',
      },
    ],
    confidence: 0.84,
    blocking: true,
  },
  {
    id: 'officejs.autofill',
    dialect: 'officejs',
    category: 'range',
    matchers: [
      {
        id: 'officejs-excel-autofill-type',
        kind: 'member-chain',
        symbol: 'Excel.AutoFillType',
        confidence: 0.86,
      },
    ],
    message: 'Microsoft Office JavaScript autofill does not provide Mog preview receipts.',
    suggestion:
      'Preview first with `ws.autoFillPreview(...)`, inspect diagnostics and reference diagnostics, then call `ws.autoFill(...)` only when the preview is acceptable.',
    mogReplacements: [
      {
        path: 'ws.autoFillPreview',
        snippet: autofillPreviewThenApplySnippet,
        note: 'Preview uses the same fill engine as apply without changing worksheet cells or undo state.',
      },
      {
        path: 'ws.autoFill',
        snippet: autofillPreviewThenApplySnippet,
        note: 'Apply after the preview receipt confirms the formula references are acceptable.',
      },
    ],
    confidence: 0.86,
    blocking: true,
  },
  {
    id: 'mog-version.public-api-examples',
    dialect: 'mog-version',
    category: 'workbook',
    matchers: [
      { id: 'mog-version.workbook-commit-guess', kind: 'call', symbol: 'wb.commit' },
      { id: 'mog-version.workbook-branch-guess', kind: 'call', symbol: 'wb.branch' },
      { id: 'mog-version.workbook-create-branch-guess', kind: 'call', symbol: 'wb.createBranch' },
      { id: 'mog-version.workbook-checkout-guess', kind: 'call', symbol: 'wb.checkout' },
      { id: 'mog-version.workbook-preview-merge-guess', kind: 'call', symbol: 'wb.previewMerge' },
      { id: 'mog-version.workbook-merge-preview-guess', kind: 'call', symbol: 'wb.mergePreview' },
      { id: 'mog-version.workbook-apply-merge-guess', kind: 'call', symbol: 'wb.applyMerge' },
      { id: 'mog-version.workbook-revert-guess', kind: 'call', symbol: 'wb.revert' },
      { id: 'mog-version.create-version-store-guess', kind: 'call', symbol: 'createVersionStore' },
      {
        id: 'mog-version.workbook-version-store-guess',
        kind: 'member-chain',
        symbol: 'wb.versionStore',
      },
    ],
    message: 'Workbook version history APIs are exposed through the `wb.version` public API slice.',
    suggestion:
      'Configure version history with `createWorkbook({ documentId, versionStore })`, then use `wb.version.commit`, `wb.version.createBranch`, `wb.version.checkout`, `wb.version.merge`, `wb.version.applyMerge`, and `wb.version.revert`; every operation returns a VersionResult and merge/revert calls also return status receipts.',
    mogReplacements: [
      {
        path: 'createWorkbook',
        snippet: versionStoreConfigSnippet,
        note: 'Version-store config belongs to createWorkbook options. Supported public kinds are memory, in-memory, memory-durable-snapshot, indexeddb, and browser; use documentId/workspaceId/principalScope for scope.',
      },
      {
        path: 'wb.version.commit',
        snippet: versionCommitSnippet,
        note: 'Commit captures the current workbook working state and advances the active or explicit target ref. Read the head first and pass expectedHead so stale ref writes fail closed.',
      },
      {
        path: 'wb.version.createBranch',
        snippet: versionBranchSnippet,
        note: 'Create public refs under refs/heads/<branch-name> for branch workflows.',
      },
      {
        path: 'wb.version.checkout',
        snippet: versionCheckoutSnippet,
        note: 'Checkout refuses dirty or unsafe state and reports whether workbook state was materialized.',
      },
      {
        path: 'wb.version.merge',
        snippet: versionMergePreviewSnippet,
        note: 'Merge is read-only by default; inspect blocked/conflicted/clean/fast-forward statuses before applying, and carry the accepted preview target head into applyMerge.',
      },
      {
        path: 'wb.version.applyMerge',
        snippet: versionApplyMergeSnippet,
        note: 'Apply merge with a concrete target ref and the expected target head from the accepted preview so stale refs fail closed. If preview was conflicted, pass one resolution per conflict with the previewed conflictId, digest, optionId, and kind.',
      },
      {
        path: 'wb.version.revert',
        snippet: versionRevertSnippet,
        note: 'Revert with an explicit target ref and expected target head; dry-run first with { dryRun: true } when the host needs review before mutation.',
      },
    ],
    confidence: 0.86,
    blocking: false,
  },
  {
    id: 'officejs.formatting',
    dialect: 'officejs',
    category: 'formatting',
    matchers: [
      { id: 'officejs.fill-color', kind: 'member-chain', symbol: '.format.fill.color' },
      { id: 'officejs.font-bold', kind: 'member-chain', symbol: '.format.font.bold' },
      { id: 'officejs.number-format', kind: 'member-chain', symbol: '.numberFormat' },
    ],
    message:
      'Microsoft Office JavaScript spreadsheet range formatting properties are not Mog formatting calls.',
    suggestion: 'Use the worksheet formats API with an explicit range and format object.',
    mogReplacements: [
      {
        path: 'ws.formats.setRange',
        snippet: 'await ws.formats.setRange("A1:B2", { backgroundColor: "#fff" });',
      },
      {
        path: 'ws.formats.setCellProperties',
        snippet:
          'await ws.formats.setCellProperties([{ row: 0, col: 0, format: { bold: true } }]);',
        note: 'Use cell properties for per-cell format matrices.',
      },
      {
        path: 'ws.formats.setNumberFormatLocal',
        snippet: 'await ws.formats.setNumberFormatLocal("A1:B2", "0.00", "en-US");',
      },
    ],
    confidence: 0.96,
    blocking: true,
  },
  {
    id: 'officejs.tables',
    dialect: 'officejs',
    category: 'tables',
    matchers: [
      { id: 'officejs.worksheet-tables-add', kind: 'call', symbol: 'worksheet.tables.add' },
      { id: 'officejs-sheet-tables-add', kind: 'call', symbol: 'sheet.tables.add' },
      { id: 'officejs.table-rows-add', kind: 'call', symbol: 'table.rows.add' },
      { id: 'officejs.table-columns-add', kind: 'call', symbol: 'table.columns.add' },
      { id: 'officejs.workbook-tables', kind: 'member-chain', symbol: 'context.workbook.tables' },
    ],
    message:
      'Microsoft Office JavaScript spreadsheet table collection calls use a different table API shape.',
    suggestion:
      'Use `await ws.tables.add(range, { name, hasHeaders })` and worksheet table row helpers.',
    mogReplacements: [
      {
        path: 'ws.tables.add',
        snippet: 'const table = await ws.tables.add("A1:C10", { name, hasHeaders: true });',
      },
      {
        path: 'ws.tables.addRow',
        snippet: 'await ws.tables.addRow(table.name, undefined, values);',
      },
      {
        path: 'wb.getSheets',
        snippet: 'for (const ws of await wb.getSheets()) {\n  // inspect ws.tables\n}',
      },
    ],
    confidence: 0.95,
    blocking: true,
  },
  {
    id: 'officejs.filters-sort',
    dialect: 'officejs',
    category: 'filters',
    matchers: [
      { id: 'officejs.table-sort-apply', kind: 'call', symbol: 'table.sort.apply' },
      {
        id: 'officejs-column-filter-values',
        kind: 'call',
        symbol: 'column.filter.applyValuesFilter',
      },
      {
        id: 'officejs-worksheet-auto-filter-apply',
        kind: 'call',
        symbol: 'worksheet.autoFilter.apply',
      },
      { id: 'officejs-sheet-auto-filter-apply', kind: 'call', symbol: 'sheet.autoFilter.apply' },
    ],
    message:
      'Microsoft Office JavaScript spreadsheet filter and sort calls are not Mog filter APIs.',
    suggestion:
      'Use worksheet filter APIs or `ws.sortRange(...)` with explicit ranges and criteria.',
    mogReplacements: [
      { path: 'ws.filters.add', snippet: 'await ws.filters.add("A1:C10");' },
      {
        path: 'ws.filters.setColumnFilter',
        snippet: 'await ws.filters.setColumnFilter(0, { type: "value", values: ["Widget"] });',
      },
      {
        path: 'ws.tables.sort.apply',
        snippet: 'await ws.tables.sort.apply("Table1", [{ columnIndex: 0, ascending: true }]);',
      },
      {
        path: 'ws.sortRange',
        snippet:
          'await ws.sortRange("A1:C10", { columns: [{ columnIndex: 0, ascending: true }], hasHeaders: true });',
      },
    ],
    confidence: 0.95,
    blocking: true,
  },
  {
    id: 'officejs.names',
    dialect: 'officejs',
    category: 'names',
    matchers: [
      {
        id: 'officejs-workbook-names-add',
        kind: 'member-chain',
        symbol: 'context.workbook.names.add',
      },
      {
        id: 'officejs-workbook-names-get-item',
        kind: 'member-chain',
        symbol: 'context.workbook.names.getItem',
      },
      { id: 'officejs-named-item-get-range', kind: 'member-chain', symbol: 'namedItem.getRange' },
      { id: 'officejs-names-items', kind: 'member-chain', symbol: 'names.items' },
    ],
    message: 'Microsoft Office JavaScript spreadsheet named item APIs do not exist in Mog.',
    suggestion: 'Use the Mog workbook or worksheet names APIs.',
    mogReplacements: [
      { path: 'wb.names.add', snippet: 'await wb.names.add(name, reference);' },
      { path: 'wb.names.getRange', snippet: 'const range = await wb.names.getRange(name);' },
      { path: 'wb.names.list', snippet: 'const names = await wb.names.list();' },
      { path: 'ws.names.add', snippet: 'await ws.names.add("LocalName", "A1:A10");' },
    ],
    confidence: 0.93,
    blocking: true,
  },
  {
    id: 'officejs.file-io',
    dialect: 'officejs',
    category: 'file-io',
    matchers: [
      {
        id: 'officejs-document-get-file',
        kind: 'member-chain',
        symbol: 'Office.context.document.getFileAsync',
      },
      { id: 'officejs-file-slices', kind: 'member-chain', symbol: '.getSliceAsync' },
      { id: 'officejs-create-workbook-file', kind: 'call', symbol: 'Excel.createWorkbook' },
    ],
    message:
      'Microsoft Office JavaScript spreadsheet document file APIs are host APIs, not Mog file I/O.',
    suggestion: 'Use Mog workbook save/export APIs or create workbooks through the SDK.',
    mogReplacements: [
      { path: 'wb.save', snippet: 'await wb.save(path);' },
      { path: 'wb.toXlsx', snippet: 'const bytes = await wb.toXlsx();' },
      {
        path: 'createWorkbook',
        snippet: 'const wb = await createWorkbook(sourceOrOptions);',
        note: 'Root SDK factory, not a workbook member path.',
      },
    ],
    confidence: 0.96,
    blocking: true,
  },
] as const satisfies readonly ApiGuidanceEntry[];

export const documentedRootGuidancePaths = new Set(['createWorkbook']);
