import { KernelError } from '..';
import {
  chartNotFound,
  formulaParseError,
  invalidCellAddress,
  invalidRange,
  operationFailed,
  sheetNotFound,
} from '../api';

describe('API error factories', () => {
  it('invalidCellAddress returns KernelError with correct properties', () => {
    const err = invalidCellAddress(-1, 5);
    expect(err).toBeInstanceOf(KernelError);
    expect(err.code).toBe('API_INVALID_CELL_ADDRESS');
    expect(err.message).toBe('Cell address (-1, 5) is invalid');
    expect(err.path).toEqual(['row', 'col']);
    expect(err.suggestion).toBe('Row and column must be >= 0');
    expect(err.context).toEqual({
      paramName: 'address',
      expected: 'row >= 0, col >= 0',
      row: -1,
      col: 5,
    });
  });

  it('invalidRange returns KernelError with correct properties', () => {
    const err = invalidRange(5, 3, 1, 2);
    expect(err).toBeInstanceOf(KernelError);
    expect(err.code).toBe('API_INVALID_RANGE');
    expect(err.message).toBe('Range (5, 3) to (1, 2) is invalid');
    expect(err.path).toEqual(['startRow', 'startCol', 'endRow', 'endCol']);
    expect(err.suggestion).toBe('Start must be <= end, and all values must be >= 0');
    expect(err.context).toEqual({
      paramName: 'range',
      expected: 'start <= end, all >= 0',
      startRow: 5,
      startCol: 3,
      endRow: 1,
      endCol: 2,
    });
  });

  it('sheetNotFound returns KernelError with correct properties', () => {
    const err = sheetNotFound('sheet-42');
    expect(err).toBeInstanceOf(KernelError);
    expect(err.code).toBe('API_SHEET_NOT_FOUND');
    expect(err.message).toBe('Sheet "sheet-42" not found');
    expect(err.path).toEqual(['sheetId']);
    expect(err.suggestion).toBe('Use getSheetIds() to list available sheets');
    expect(err.context).toEqual({ resourceType: 'sheet', resourceId: 'sheet-42' });
  });

  it('formulaParseError returns KernelError with correct properties', () => {
    const err = formulaParseError('=SUM(A1', 'unexpected end of input');
    expect(err).toBeInstanceOf(KernelError);
    expect(err.code).toBe('FORMULA_PARSE_ERROR');
    expect(err.message).toBe('Failed to parse formula: unexpected end of input');
    expect(err.path).toEqual(['formula']);
    expect(err.suggestion).toBe('Check formula syntax. Formulas must start with "="');
    expect(err.context).toEqual({ formula: '=SUM(A1', parseError: 'unexpected end of input' });
  });

  it('chartNotFound returns KernelError with correct properties', () => {
    const err = chartNotFound('chart-7');
    expect(err).toBeInstanceOf(KernelError);
    expect(err.code).toBe('OBJ_CHART_NOT_FOUND');
    expect(err.message).toBe('Chart "chart-7" not found');
    expect(err.path).toEqual(['chartId']);
    expect(err.suggestion).toBe(
      'Use ws.charts.list() to list available charts, or api.describe("ws.charts") for chart API discovery',
    );
    expect(err.context).toEqual({ resourceType: 'chart', resourceId: 'chart-7' });
  });

  it('operationFailed returns KernelError without path or suggestion', () => {
    const err = operationFailed('paste', 'clipboard empty');
    expect(err).toBeInstanceOf(KernelError);
    expect(err.code).toBe('OPERATION_FAILED');
    expect(err.message).toBe('Operation "paste" failed: clipboard empty');
    expect(err.path).toBeUndefined();
    expect(err.suggestion).toBeUndefined();
    expect(err.context).toEqual({ operation: 'paste', reason: 'clipboard empty' });
  });

  it('operationFailed preserves an optional cause without changing message or context', () => {
    const cause = new Error('native raster unavailable');
    const err = operationFailed('exportChartImage', 'native raster unavailable', { cause });

    expect(err).toBeInstanceOf(KernelError);
    expect(err.code).toBe('OPERATION_FAILED');
    expect(err.message).toBe('Operation "exportChartImage" failed: native raster unavailable');
    expect(err.context).toEqual({
      operation: 'exportChartImage',
      reason: 'native raster unavailable',
    });
    expect(err.cause).toBe(cause);
  });

  it('all factories return throwable Error instances', () => {
    const err = sheetNotFound('x');
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('KernelError');
    expect(() => {
      throw err;
    }).toThrow(KernelError);
  });
});
