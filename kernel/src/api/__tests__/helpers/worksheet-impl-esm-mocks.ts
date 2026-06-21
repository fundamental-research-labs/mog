import { jest } from '@jest/globals';
import { KernelError } from '../../../errors';

export function mockTableReceipt(kind: string) {
  return jest.fn((input: unknown = {}, maybeTable?: unknown) => {
    const record =
      typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {};
    const tableValue = maybeTable ?? record.table;
    const table =
      typeof tableValue === 'object' && tableValue !== null
        ? (tableValue as { id?: unknown; name?: unknown; range?: unknown })
        : undefined;

    return {
      kind,
      status: record.status ?? 'applied',
      effects: [],
      diagnostics: [],
      table,
      tableId: record.tableId ?? table?.id,
      tableName: record.tableName ?? table?.name,
      name: record.name ?? table?.name,
      range: record.range ?? record.newRange ?? table?.range,
    };
  });
}

export function mockEffectiveTableUpdateOptions() {
  return jest.fn((_table: unknown, updates: Record<string, unknown> | undefined) => updates ?? {});
}

const VALID_CLEAR_MODES = ['all', 'contents', 'formats', 'hyperlinks'] as const;
const VALID_CLEAR_MODE_SET: ReadonlySet<string> = new Set(VALID_CLEAR_MODES);

function clearModeSuggestion(applyTo: unknown): string {
  if (applyTo === 'value' || applyTo === 'values' || applyTo === 'content') {
    return 'Use "contents" to clear values and formulas while preserving formats and hyperlinks.';
  }

  if (applyTo === 'valuesAndFormats') {
    return [
      '"valuesAndFormats" is ambiguous and is not the same as "all", because "all" also clears hyperlinks.',
      'Use "contents", "formats", or "all" explicitly.',
    ].join(' ');
  }

  return `Use one of: ${VALID_CLEAR_MODES.join(', ')}.`;
}

function validateClearApplyTo(applyTo: unknown) {
  if (typeof applyTo === 'string' && VALID_CLEAR_MODE_SET.has(applyTo)) {
    return applyTo;
  }

  const suggestion = clearModeSuggestion(applyTo);
  throw new KernelError(
    'API_INVALID_ARGUMENT',
    `Invalid clear mode for applyTo: ${JSON.stringify(applyTo)}.`,
    {
      path: ['applyTo'],
      suggestion,
      context: {
        issueCode: 'UNKNOWN_CLEAR_MODE',
        received: applyTo,
        validValues: [...VALID_CLEAR_MODES],
        suggestion,
      },
    },
  );
}

export const worksheetCellOpsMock = {
  getCell: jest.fn(),
  getValue: jest.fn(),
  getDisplayValue: jest.fn(),
  getFormula: jest.fn(),
  getFormat: jest.fn(),
  getRawCellData: jest.fn(),
  getFormulaBarValue: jest.fn(),
  setCell: jest.fn(),
  setCells: jest.fn(),
  setFormula: jest.fn(),
  setDateValue: jest.fn(),
  setTimeValue: jest.fn(),
  getCellIdAt: jest.fn(),
  getProjectionRange: jest.fn(),
  getProjectionSource: jest.fn(),
  isProjectedPosition: jest.fn(),
};

export const worksheetRangeQueryOpsMock = {
  clearWithMode: jest.fn(),
  validateClearApplyTo: jest.fn(validateClearApplyTo),
};

export const worksheetFillOpsMock = {
  autoFill: jest.fn(),
  autoFillPreview: jest.fn(),
  fillSeries: jest.fn(),
};

export const worksheetValidationOpsMock = {
  updateColumnSchema: jest.fn().mockResolvedValue({ success: true, data: true }),
  removeColumnSchema: jest.fn().mockResolvedValue({ success: true, data: true }),
  validateCellValue: jest.fn().mockResolvedValue({ valid: true, errors: [] }),
  inferSchemaType: jest.fn().mockResolvedValue({ type: 'text' }),
  inferColumnSchema: jest.fn().mockResolvedValue({ schema: { type: 'text' }, confidence: 1 }),
  getRangeSchema: jest.fn().mockResolvedValue(null),
  getRangeSchemasForSheet: jest.fn().mockResolvedValue([]),
  getRangeSchemasInViewport: jest.fn().mockResolvedValue([]),
  setRangeSchema: jest.fn().mockResolvedValue(undefined),
  deleteRangeSchema: jest.fn().mockResolvedValue(undefined),
  validateCellValueAtPosition: jest.fn().mockResolvedValue({ valid: true, errors: [] }),
  getDropdownItems: jest.fn().mockResolvedValue([]),
  resolveDropdownItems: jest.fn().mockResolvedValue({ items: [], resolved: false }),
  generateSchemaId: jest.fn(() => 'rs-test'),
};

export const worksheetTableOpsMock = {
  createTableMutationOptions: jest.fn((_ctx, operationIdPrefix, sheetId, groupId) => ({
    operationContext: {
      operationId: `${operationIdPrefix}:test`,
      kind: 'mutation',
      author: { authorId: 'test', actorKind: 'user' },
      createdAt: '2026-01-01T00:00:00.000Z',
      ...(sheetId !== undefined ? { sheetIds: [sheetId] } : {}),
      domainIds: ['tables'],
      ...(groupId ? { groupId } : {}),
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
    },
  })),
  createGroupedTableMutationOptions: jest.fn((ctx, operationIdPrefix, sheetId) => {
    const groupId = `${operationIdPrefix}:test`;
    return () =>
      worksheetTableOpsMock.createTableMutationOptions(ctx, operationIdPrefix, sheetId, groupId);
  }),
  buildTableAddColumnReceipt: mockTableReceipt('tableAddColumn'),
  buildTableAddReceipt: mockTableReceipt('tableAdd'),
  buildTableAddRowReceipt: mockTableReceipt('tableAddRow'),
  buildTableClearReceipt: mockTableReceipt('tableClear'),
  buildTableConvertToRangeReceipt: mockTableReceipt('tableConvertToRange'),
  buildTableDeleteRowReceipt: mockTableReceipt('tableDeleteRow'),
  buildTableRemoveColumnReceipt: mockTableReceipt('tableRemoveColumn'),
  buildTableRemoveReceipt: mockTableReceipt('tableRemove'),
  buildTableRenameColumnReceipt: mockTableReceipt('tableRenameColumn'),
  buildTableRenameReceipt: mockTableReceipt('tableRename'),
  buildTableResizeReceipt: mockTableReceipt('tableResize'),
  buildTableUpdateReceipt: mockTableReceipt('tableUpdate'),
  bridgeTableToTableInfo: jest.fn(),
  effectiveTableUpdateOptions: mockEffectiveTableUpdateOptions(),
  getTableAtCell: jest.fn(),
  getTableByName: jest.fn(),
  getAllTablesInSheet: jest.fn(),
  getTableHitRegion: jest.fn(),
  removeTable: jest.fn(),
  resizeTable: jest.fn(),
  setTableStyle: jest.fn(),
  renameTable: jest.fn(),
  addTableColumn: jest.fn(),
  removeTableColumn: jest.fn(),
  createTable: jest.fn(),
  toggleTotalsRow: jest.fn(),
  toggleHeaderRow: jest.fn(),
  applyAutoExpansion: jest.fn(),
  getTableColumnDataCellsFromInfo: jest.fn(),
  getDataBodyRangeFromInfo: jest.fn(),
  getHeaderRowRangeFromInfo: jest.fn(),
  getTotalRowRangeFromInfo: jest.fn(),
  setCalculatedColumnFormula: jest.fn(),
  clearCalculatedColumnFormula: jest.fn(),
};

export const worksheetSheetMetaMock = {
  getMeta: jest.fn(),
  getName: jest.fn(),
  getOrder: jest.fn(),
  getFirstId: jest.fn(),
  getUsedRangeEnd: jest.fn(),
  getUsedRange: jest.fn(),
  setUsedRange: jest.fn(),
  getFrozenPanes: jest.fn(),
  setFrozenPanes: jest.fn(),
  getPageBreaks: jest.fn(),
  setPageBreaks: jest.fn(),
  getPrintSettings: jest.fn(),
  setPrintSettings: jest.fn(),
};

export const worksheetCheckpointMock = {
  createCheckpointManager: jest.fn(),
};

export const worksheetCellMetadataCacheInstanceMock = {
  isProjectedPosition: jest.fn(),
  getProjectionSourcePosition: jest.fn(),
  getProjectionRange: jest.fn(),
  hasValidationErrors: jest.fn(),
  evaluateViewport: jest.fn(),
  onChange: jest.fn(() => jest.fn()),
  clear: jest.fn(),
  dispose: jest.fn(),
};

export function installWorksheetImplEsmMocks(): void {
  jest.unstable_mockModule('../../../floating-objects', () => ({
    createSpreadsheetObjectManager: jest.fn(),
  }));
  jest.unstable_mockModule('../../../context', () => ({}));
  jest.unstable_mockModule('../../workbook/operations/sheet-crud-operations', () => ({
    createSheet: jest.fn(),
    removeSheet: jest.fn(),
    renameSheet: jest.fn(),
    copySheet: jest.fn(),
    moveSheet: jest.fn(),
    setSheetHidden: jest.fn(),
  }));
  jest.unstable_mockModule('../../../bridges/compute/compute-bridge', () => ({
    ComputeBridge: jest.fn(),
    createComputeBridge: jest.fn(),
    createComputeBridgeFromTransport: jest.fn(),
    extractMutationData: jest.fn(),
    identityFormulaToWire: jest.fn(),
    rustSchemaResolveEditor: jest.fn(),
    wireTableToTableConfig: jest.fn(),
    wireToIdentityFormula: jest.fn(),
  }));
  jest.unstable_mockModule('../../../bridges/wire/cell-metadata-cache', () => ({
    CellMetadataCache: jest.fn(),
    createCellMetadataCache: jest.fn(() => worksheetCellMetadataCacheInstanceMock),
  }));
  jest.unstable_mockModule('../../internal/value-conversions', () => ({
    normalizeCellValue: jest.fn(),
    cellValueToString: jest.fn(),
    classifyRangeValueType: jest.fn(),
  }));

  jest.unstable_mockModule(
    '../../worksheet/operations/cell-operations',
    () => worksheetCellOpsMock,
  );
  jest.unstable_mockModule('../../worksheet/operations/range-operations', () => ({
    getRange: jest.fn(),
    setRange: jest.fn(),
    clearRange: jest.fn(),
  }));
  jest.unstable_mockModule(
    '../../worksheet/operations/range-query-operations',
    () => worksheetRangeQueryOpsMock,
  );
  jest.unstable_mockModule('../../worksheet/operations/format-operations', () => ({
    setFormat: jest.fn(),
    setRangeFormat: jest.fn(),
    setFormatForRanges: jest.fn(),
    setRowFormat: jest.fn(),
    setColFormat: jest.fn(),
    clearFormat: jest.fn(),
    applyFormatToRange: jest.fn(),
    getRowProperties: jest.fn(),
    setRowProperties: jest.fn(),
    getColumnProperties: jest.fn(),
    setColumnProperties: jest.fn(),
    getCellProperties: jest.fn(),
    setCellProperties: jest.fn(),
    getDisplayedCellProperties: jest.fn(),
    getDisplayedRangeProperties: jest.fn(),
  }));
  jest.unstable_mockModule('../../worksheet/operations/merge-operations', () => ({
    getMergeAt: jest.fn(),
  }));
  jest.unstable_mockModule('../../worksheet/operations/query-operations', () => ({
    getUsedRange: jest.fn(),
    findCells: jest.fn(),
    findByValue: jest.fn(),
    findByFormula: jest.fn(),
    getSelectionAggregates: jest.fn(),
    formatValues: jest.fn(),
  }));
  jest.unstable_mockModule('../../worksheet/operations/hyperlink-operations', () => ({
    getHyperlink: jest.fn(),
    setHyperlink: jest.fn(),
    removeHyperlink: jest.fn(),
  }));
  jest.unstable_mockModule('../../worksheet/operations/dependency-operations', () => ({
    getPrecedents: jest.fn(),
    getDependents: jest.fn(),
  }));
  jest.unstable_mockModule(
    '../../worksheet/operations/validation-operations',
    () => worksheetValidationOpsMock,
  );
  jest.unstable_mockModule('../../worksheet/operations/filter-operations', () => ({}));
  jest.unstable_mockModule('../../worksheet/operations/shape-operations', () => ({}));
  jest.unstable_mockModule('../../worksheet/operations/floating-object-operations', () => ({}));
  jest.unstable_mockModule('../../worksheet/operations/sort-operations', () => ({}));
  jest.unstable_mockModule('../../worksheet/operations/cf-operations', () => ({}));
  jest.unstable_mockModule('../../worksheet/operations/grouping-operations', () => ({}));
  jest.unstable_mockModule('../../worksheet/operations/equation-operations', () => ({
    DEFAULT_EQUATION_WIDTH: 150,
    DEFAULT_EQUATION_HEIGHT: 50,
  }));
  jest.unstable_mockModule('../../worksheet/operations/text-effects-operations', () => ({
    DEFAULT_TEXT_EFFECT_WIDTH: 300,
    DEFAULT_TEXT_EFFECT_HEIGHT: 100,
    createDefaultApiTextEffectConfig: jest.fn(() => ({})),
    createTextEffect: jest.fn(),
    updateTextEffect: jest.fn(),
    convertToTextEffect: jest.fn(),
    convertToTextBox: jest.fn(),
  }));
  jest.unstable_mockModule('../../worksheet/operations/sheet-management-operations', () => ({}));
  jest.unstable_mockModule(
    '../../worksheet/operations/table-operations',
    () => worksheetTableOpsMock,
  );
  jest.unstable_mockModule('../../worksheet/operations/drawing-operations', () => ({}));
  jest.unstable_mockModule(
    '../../worksheet/operations/fill-operations',
    () => worksheetFillOpsMock,
  );
  jest.unstable_mockModule('../../worksheet/operations/describe-operations', () => ({
    describe: jest.fn(),
    formatDescribeRange: jest.fn(),
    describeRange: jest.fn(),
    summarize: jest.fn(),
  }));

  jest.unstable_mockModule('../../../domain/cells/cell-viewport-iteration', () => ({}));
  jest.unstable_mockModule('../../../domain/cells/cell-iteration', () => ({
    computeValueToRaw: jest.fn((value) => value ?? null),
    computeValueToCellValue: jest.fn((value) => value),
    clearRange: jest.fn(),
    clearRangeAndReturnIds: jest.fn(),
    relocateCells: jest.fn(),
    forEach: jest.fn(),
    forEachInRange: jest.fn(),
    getCurrentRegion: jest.fn(),
    getDataBoundsForRange: jest.fn(),
  }));
  jest.unstable_mockModule('../../../domain/cells/cell-identity', () => ({
    getOrCreateCellId: jest.fn(),
    getCellIdAt: jest.fn(),
    updateCellPosition: jest.fn(),
  }));
  jest.unstable_mockModule('../../../domain/charts/chart-store', () => ({ getAll: jest.fn() }));
  jest.unstable_mockModule('../../../domain/formulas/named-ranges', () => ({
    getVisible: jest.fn(),
    getRefersToA1: jest.fn(),
  }));
  jest.unstable_mockModule('../../../domain/sheets/sheet-meta', () => worksheetSheetMetaMock);
  jest.unstable_mockModule('../../../domain/tables/core', () => ({
    getTablesInSheet: jest.fn(),
    getTable: jest.fn(),
  }));
  jest.unstable_mockModule('../../../domain/sheets/structures', () => ({
    insertRows: jest.fn(),
    deleteRows: jest.fn(),
    insertColumns: jest.fn(),
    deleteColumns: jest.fn(),
  }));
  jest.unstable_mockModule('../../../domain/formatting/merges', () => ({
    getAll: jest.fn(),
    mergeRange: jest.fn(),
    unmergeRange: jest.fn(),
  }));
  jest.unstable_mockModule('../../internal/format-utils', () => ({
    MAX_RANGE_CELLS: 10_000,
    MAX_RANGE_BOUNDING_BOX: 500_000,
    MAX_DESCRIBE_OUTPUT_CHARS: 50_000,
    MAX_SUMMARY_NAMED_RANGES: 20,
    analyzeFormulas: jest.fn(),
    buildStyleHintsFromFormat: jest.fn(),
    extractTintAndShade: jest.fn(),
    getFontTintAndShade: jest.fn(),
    getBackgroundTintAndShade: jest.fn(),
    getPatternForegroundTintAndShade: jest.fn(),
    generateFormulaDocumentation: jest.fn(),
    getStyleHints: jest.fn(),
    normalizeFormula: jest.fn(),
  }));
  jest.unstable_mockModule('../../workbook/operations/scenario-operations', () => ({
    createScenario: jest.fn(),
    updateScenario: jest.fn(),
    deleteScenario: jest.fn(),
    getAllScenarios: jest.fn(),
    getActiveScenarioState: jest.fn(),
    applyScenarioFull: jest.fn(),
    restoreScenarioValues: jest.fn(),
    restoreScenarioBaseline: jest.fn(),
  }));
  jest.unstable_mockModule('../../../services/checkpoint', () => worksheetCheckpointMock);
}
