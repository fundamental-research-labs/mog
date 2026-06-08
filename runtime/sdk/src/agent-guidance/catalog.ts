import type { ApiGuidanceEntry } from './types';

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
    suggestion: 'Use `await ws.getValues(range)` or `await ws.getRange(range)`.',
    mogReplacements: [
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
