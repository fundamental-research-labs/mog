import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import {
  worksheetTableOpsMock,
  worksheetValidationOpsMock,
} from './helpers/worksheet-impl-esm-mocks';

jest.unstable_mockModule('../../floating-objects', () => ({
  createSpreadsheetObjectManager: jest.fn(),
}));
jest.unstable_mockModule('../../context', () => ({}));
jest.unstable_mockModule('../workbook/operations/sheet-crud-operations', () => ({
  renameSheet: jest.fn(),
  setSheetHidden: jest.fn(),
}));
jest.unstable_mockModule('../worksheet/operations/cell-operations', () => ({
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
}));
jest.unstable_mockModule('../worksheet/operations/range-operations', () => ({
  getRange: jest.fn(),
  getCells: jest.fn(),
  setRange: jest.fn(),
  clearRange: jest.fn(),
}));
jest.unstable_mockModule('../worksheet/operations/format-operations', () => ({
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
jest.unstable_mockModule('../worksheet/operations/merge-operations', () => ({
  getMergeAt: jest.fn(),
}));
jest.unstable_mockModule('../worksheet/operations/query-operations', () => ({
  getUsedRange: jest.fn(),
  findCells: jest.fn(),
  findByValue: jest.fn(),
  findByFormula: jest.fn(),
  getSelectionAggregates: jest.fn(),
  formatValues: jest.fn(),
}));
jest.unstable_mockModule('../worksheet/operations/hyperlink-operations', () => ({
  getHyperlink: jest.fn(),
  setHyperlink: jest.fn(),
  removeHyperlink: jest.fn(),
}));
jest.unstable_mockModule('../worksheet/operations/dependency-operations', () => ({
  getPrecedents: jest.fn(),
  getDependents: jest.fn(),
}));
jest.unstable_mockModule(
  '../worksheet/operations/validation-operations',
  () => worksheetValidationOpsMock,
);
jest.unstable_mockModule('../worksheet/operations/filter-operations', () => ({}));
jest.unstable_mockModule('../worksheet/operations/shape-operations', () => ({}));
jest.unstable_mockModule('../worksheet/operations/floating-object-operations', () => ({}));
jest.unstable_mockModule('../worksheet/operations/sort-operations', () => ({}));
jest.unstable_mockModule('../worksheet/operations/cf-operations', () => ({}));
jest.unstable_mockModule('../worksheet/operations/grouping-operations', () => ({}));
jest.unstable_mockModule('../worksheet/operations/equation-operations', () => ({
  DEFAULT_EQUATION_WIDTH: 150,
  DEFAULT_EQUATION_HEIGHT: 50,
}));
jest.unstable_mockModule('../worksheet/operations/text-effects-operations', () => ({
  DEFAULT_TEXT_EFFECT_WIDTH: 300,
  DEFAULT_TEXT_EFFECT_HEIGHT: 100,
  createDefaultApiTextEffectConfig: jest.fn(() => ({})),
  createTextEffect: jest.fn(),
  updateTextEffect: jest.fn(),
  convertToTextEffect: jest.fn(),
  convertToTextBox: jest.fn(),
}));
jest.unstable_mockModule('../worksheet/operations/sheet-management-operations', () => ({}));
jest.unstable_mockModule('../worksheet/operations/table-operations', () => worksheetTableOpsMock);
jest.unstable_mockModule('../worksheet/operations/drawing-operations', () => ({}));
jest.unstable_mockModule('../worksheet/operations/fill-operations', () => ({}));
jest.unstable_mockModule('../../domain/cells/cell-iteration', () => ({
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
jest.unstable_mockModule('../../domain/charts/chart-store', () => ({ getAll: jest.fn() }));
jest.unstable_mockModule('../../domain/formulas/named-ranges', () => ({
  getVisible: jest.fn(async () => []),
  getRefersToA1: jest.fn(async () => ''),
}));
jest.unstable_mockModule('../../domain/sheets/sheet-meta', () => ({ getMeta: jest.fn() }));
jest.unstable_mockModule('../../domain/tables/core', () => ({
  getTablesInSheet: jest.fn(async () => []),
  getTable: jest.fn(),
}));
jest.unstable_mockModule('../../domain/sheets/structures', () => ({
  insertRows: jest.fn(),
  deleteRows: jest.fn(),
  insertColumns: jest.fn(),
  deleteColumns: jest.fn(),
}));
jest.unstable_mockModule('../../domain/formatting/merges', () => ({
  getAll: jest.fn(),
  mergeRange: jest.fn(),
  unmergeRange: jest.fn(),
}));
jest.unstable_mockModule('../internal/format-utils', () => ({
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

const { WorksheetImpl } = await import('../worksheet/worksheet-impl');
const CellOps = await import('../worksheet/operations/cell-operations');
const RangeOps = await import('../worksheet/operations/range-operations');

const SHEET_ID = sheetId('sheet-1');

function expectVersionOperationOptions(operationIdPrefix: string, domainIds: readonly string[]) {
  return expect.objectContaining({
    operationContext: expect.objectContaining({
      operationId: expect.stringMatching(
        new RegExp(`^${operationIdPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}:`),
      ),
      kind: 'mutation',
      author: expect.objectContaining({ actorKind: 'user' }),
      sheetIds: [SHEET_ID],
      domainIds,
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
    }),
  });
}

function createMockCtx(): any {
  return {
    writeGate: {
      assertWritable: jest.fn(),
    },
    eventBus: {
      onMany: jest.fn(() => jest.fn()),
    },
    mirror: {
      getSheetSettings: jest.fn().mockReturnValue({ isProtected: false }),
    },
    computeBridge: {
      canEditCell: jest.fn().mockResolvedValue(true),
      evaluateExpression: jest.fn().mockResolvedValue(null),
      getSheetName: jest.fn().mockResolvedValue(null),
      isSheetProtected: jest.fn().mockResolvedValue(false),
    },
  };
}

describe('Worksheet formula API ergonomics', () => {
  let ctx: any;
  let ws: InstanceType<typeof WorksheetImpl>;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = createMockCtx();
    ws = new WorksheetImpl(SHEET_ID, ctx);
  });

  it('setCell recommends a1.address for generated-looking invalid address strings', async () => {
    await expect(ws.setCell('row=3,col=1', 42)).rejects.toMatchObject({
      code: 'API_INVALID_ADDRESS',
      message: 'Invalid cell address: "row=3,col=1"',
      suggestion: expect.stringContaining('a1.address(row, col)'),
      context: expect.objectContaining({
        validationKind: 'invalidCellAddress',
        received: 'row=3,col=1',
        suggestion: expect.stringContaining('zero-based Mog coordinates'),
      }),
    });
    expect(CellOps.setCell).not.toHaveBeenCalled();
  });

  it('setCell asFormula normalizes bare formulas without double-prepending equals', async () => {
    (CellOps.setCell as jest.Mock).mockResolvedValue(undefined);

    await ws.setCell('A1', 'SUM(A1:A10)', { asFormula: true });
    await ws.setCell('A2', '=SUM(A1:A10)', { asFormula: true });

    expect(CellOps.setCell).toHaveBeenNthCalledWith(
      1,
      ctx,
      SHEET_ID,
      0,
      0,
      '=SUM(A1:A10)',
      expectVersionOperationOptions('worksheet.setCell', ['cells']),
    );
    expect(CellOps.setCell).toHaveBeenNthCalledWith(
      2,
      ctx,
      SHEET_ID,
      1,
      0,
      '=SUM(A1:A10)',
      expectVersionOperationOptions('worksheet.setCell', ['cells']),
    );
  });

  it('setCell rejects formula-looking strings missing equals unless text intent is explicit', async () => {
    await expect(ws.setCell('A1', '+G352')).rejects.toMatchObject({
      code: 'API_INVALID_ARGUMENT',
      message:
        'worksheet.setCell: "+G352" looks like a formula but is missing the leading "=". Mog cannot safely guess whether you meant a formula or literal text.',
      suggestion:
        'Formula: call worksheet.setFormula(address, "=+G352"). Literal text: call worksheet.setCell(address, "+G352", { asText: true }).',
      context: expect.objectContaining({
        validationKind: 'formulaTextMissingEquals',
        formulaExample: 'worksheet.setFormula(address, "=+G352")',
        literalTextExample: 'worksheet.setCell(address, "+G352", { asText: true })',
      }),
    });
    expect(CellOps.setCell).not.toHaveBeenCalled();
  });

  it('setValue rejects formula text and stores it literally when asText is explicit', async () => {
    await expect(ws.setValue('A1', '=SUM(B1:B10)')).rejects.toMatchObject({
      code: 'API_INVALID_ARGUMENT',
      message:
        'worksheet.setValue: received formula text "=SUM(B1:B10)", but this API writes values unless formula intent is explicit.',
      suggestion:
        'Formula: call worksheet.setFormula(address, "=SUM(B1:B10)"). Literal text: call worksheet.setValue(address, "=SUM(B1:B10)", { asText: true }).',
    });
    expect(CellOps.setCell).not.toHaveBeenCalled();

    (CellOps.setCell as jest.Mock).mockResolvedValue(undefined);
    await ws.setValue('A1', '=SUM(B1:B10)', { asText: true });

    expect(CellOps.setCell).toHaveBeenCalledWith(
      ctx,
      SHEET_ID,
      0,
      0,
      "'=SUM(B1:B10)",
      expectVersionOperationOptions('worksheet.setValue', ['cells']),
    );
  });

  it('setCell stores numeric-looking strings literally when asText is explicit', async () => {
    (CellOps.setCell as jest.Mock).mockResolvedValue(undefined);

    await ws.setCell('A1', '90210', { asText: true });

    expect(CellOps.setCell).toHaveBeenCalledWith(
      ctx,
      SHEET_ID,
      0,
      0,
      "'90210",
      expectVersionOperationOptions('worksheet.setCell', ['cells']),
    );
  });

  it('setFormula normalizes bare formulas before delegating to the cell write path', async () => {
    (CellOps.setCell as jest.Mock).mockResolvedValue(undefined);

    await ws.setFormula('A1', 'SUM(B1:B10)');

    expect(CellOps.setCell).toHaveBeenCalledWith(
      ctx,
      SHEET_ID,
      0,
      0,
      '=SUM(B1:B10)',
      expectVersionOperationOptions('worksheet.setFormula', ['cells']),
    );
  });

  it('setFormula rejects a missing formula argument with runnable guidance', async () => {
    await expect((ws as any).setFormula('A1')).rejects.toMatchObject({
      code: 'API_INVALID_ARGUMENT',
      message:
        'worksheet.setFormula: missing required formula argument. Expected setFormula(address, formula).',
      path: ['formula'],
      suggestion:
        'Call worksheet.setFormula("A1", "=SUM(B1:B10)"). The formula may include or omit the leading "=".',
      context: expect.objectContaining({
        validationKind: 'missingFormula',
        received: 'undefined',
      }),
    });
    expect(CellOps.setCell).not.toHaveBeenCalled();
  });

  it('setFormula rejects non-string formulas with the received type', async () => {
    await expect((ws as any).setFormula('A1', null)).rejects.toMatchObject({
      code: 'API_INVALID_ARGUMENT',
      message: 'worksheet.setFormula: formula must be a string expression, received null',
      path: ['formula'],
      suggestion:
        'Call worksheet.setFormula("A1", "=SUM(B1:B10)"). The formula may include or omit the leading "=".',
      context: expect.objectContaining({
        validationKind: 'invalidFormulaType',
        received: 'null',
      }),
    });
    expect(CellOps.setCell).not.toHaveBeenCalled();
  });

  it('setFormula rejects empty formulas with an actionable example', async () => {
    await expect(ws.setFormula('A1', '=')).rejects.toMatchObject({
      code: 'API_INVALID_ARGUMENT',
      message:
        'worksheet.setFormula: formula cannot be empty. Provide an expression after the optional leading "=".',
      path: ['formula'],
      suggestion:
        'Call worksheet.setFormula("A1", "=SUM(B1:B10)"). The formula may include or omit the leading "=".',
      context: expect.objectContaining({
        validationKind: 'emptyFormula',
        expected: 'formula string such as "=SUM(B1:B10)" or "SUM(B1:B10)"',
      }),
    });
    expect(CellOps.setCell).not.toHaveBeenCalled();
  });

  it('setCells accepts explicit formula entries and rejects mixed value/formula intent', async () => {
    (CellOps.setCells as jest.Mock).mockResolvedValue({ cellsWritten: 1, errors: null });

    const result = await ws.setCells([{ cell: 'B2', formula: 'SUM(A1:A3)' }]);

    expect(result).toEqual({ cellsWritten: 1, errors: null });
    expect(CellOps.setCells).toHaveBeenCalledWith(
      ctx,
      SHEET_ID,
      [{ address: 'B2', value: '=SUM(A1:A3)' }],
      expectVersionOperationOptions('worksheet.setCells', ['cells']),
    );

    jest.clearAllMocks();
    await expect(
      ws.setCells([{ cell: 'A1', value: 1, formula: '=SUM(B1:B3)' } as any]),
    ).rejects.toMatchObject({
      code: 'API_INVALID_ARGUMENT',
      suggestion: expect.stringContaining('{ cell: "A1", formula: "=SUM(B1:B3)" }'),
    });
    expect(CellOps.setCells).not.toHaveBeenCalled();
  });

  it('setCells points to the exact formula entry when a formula is invalid', async () => {
    await expect(ws.setCells([{ cell: 'A1', formula: '' }])).rejects.toMatchObject({
      code: 'API_INVALID_ARGUMENT',
      message:
        'worksheet.setCells: cells[0].formula cannot be empty. Provide an expression after the optional leading "=".',
      path: ['cells', '0', 'formula'],
      suggestion:
        'Use { cell: "A1", formula: "=SUM(B1:B10)" } for formulas, or { cell: "A1", value } for literal values.',
    });
    expect(CellOps.setCells).not.toHaveBeenCalled();
  });

  it('setFormulas normalizes formulas and delegates to the range write path', async () => {
    (RangeOps.setRange as jest.Mock).mockResolvedValue(undefined);

    await ws.setFormulas('A1:B1', [['SUM(C1:C3)', '=D1*2']]);

    expect(RangeOps.setRange).toHaveBeenCalledWith(
      ctx,
      SHEET_ID,
      0,
      0,
      [['=SUM(C1:C3)', '=D1*2']],
      expectVersionOperationOptions('worksheet.setFormulas', ['cells']),
    );
  });

  it('setFormulas rejects missing or malformed formula grids with exact paths', async () => {
    await expect((ws as any).setFormulas('A1')).rejects.toMatchObject({
      code: 'API_INVALID_ARGUMENT',
      message:
        'worksheet.setFormulas: missing required formulas array. Expected setFormulas(range, formulas).',
      path: ['formulas'],
      suggestion:
        'Call worksheet.setFormulas("A1:B2", [["=SUM(B1:B10)"]]). Each populated item must be a formula string.',
      context: expect.objectContaining({
        validationKind: 'missingFormulas',
      }),
    });

    await expect((ws as any).setFormulas('A1', [1])).rejects.toMatchObject({
      code: 'API_INVALID_ARGUMENT',
      message:
        'worksheet.setFormulas: formulas[0] must be an array of formula strings, received number',
      path: ['formulas', '0'],
      context: expect.objectContaining({
        validationKind: 'invalidFormulaRowType',
      }),
    });
    expect(RangeOps.setRange).not.toHaveBeenCalled();
  });

  it('setFormulas points to the exact formula cell when a formula is invalid', async () => {
    await expect(ws.setFormulas('A1:B1', [['=SUM(A1:A3)', '']])).rejects.toMatchObject({
      code: 'API_INVALID_ARGUMENT',
      message:
        'worksheet.setFormulas: formulas[0][1] cannot be empty. Provide an expression after the optional leading "=".',
      path: ['formulas', '0', '1'],
    });
    expect(RangeOps.setRange).not.toHaveBeenCalled();
  });

  it('getValue rejects formula text with a hint to use evaluateFormula', async () => {
    await expect(ws.getValue('=PMT(0.1/12,12,1000)')).rejects.toMatchObject({
      code: 'API_INVALID_ADDRESS',
      message:
        'worksheet.getValue: expected a cell address such as "A1", but received formula text "=PMT(0.1/12,12,1000)". getValue reads existing cells; it does not evaluate formula text.',
      suggestion:
        'To evaluate this formula, call worksheet.evaluateFormula("=PMT(0.1/12,12,1000)"). To read a value already in the sheet, pass a cell address such as worksheet.getValue("A1").',
      path: ['address'],
    });
    expect(CellOps.getValue).not.toHaveBeenCalled();
  });

  it('evaluateFormula and evaluate accept leading equals', async () => {
    ctx.computeBridge.evaluateExpression.mockResolvedValueOnce(123).mockResolvedValueOnce(7);

    await expect(ws.evaluateFormula('=SUM(A1:A3)')).resolves.toBe(123);
    await expect(ws.evaluate('=1+6')).resolves.toBe(7);

    expect(ctx.computeBridge.evaluateExpression).toHaveBeenNthCalledWith(1, SHEET_ID, 'SUM(A1:A3)');
    expect(ctx.computeBridge.evaluateExpression).toHaveBeenNthCalledWith(2, SHEET_ID, '1+6');
  });
});
