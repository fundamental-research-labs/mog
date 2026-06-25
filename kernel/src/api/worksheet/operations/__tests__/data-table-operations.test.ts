import { jest } from '@jest/globals';

import * as DataTableOps from '../data-table-operations';

function createMockCtx(overrides: Record<string, jest.Mock> = {}): any {
  return {
    clock: {
      now: jest.fn(() => 0),
      dateNow: jest.fn(() => 0),
      performanceNow: jest.fn(() => 0),
    },
    computeBridge: {
      dataTable: jest.fn(),
      createDataTable: jest.fn(),
      getCellIdAt: jest.fn(),
      getActiveCell: jest.fn(),
      getCellData: jest.fn().mockResolvedValue(null),
      getProjectionSource: jest.fn().mockResolvedValue(null),
      getMutationHandler: jest.fn(() => ({
        changeAccumulator: {
          setDirectEdits: jest.fn(),
        },
      })),
      getAllTablesInSheet: jest.fn().mockResolvedValue([]),
      getActiveFilters: jest.fn().mockResolvedValue([]),
      applyFilter: jest.fn(),
      setCellsByPosition: jest.fn().mockResolvedValue(undefined),
      ...overrides,
    },
  };
}

function mutationOptions(): any {
  return {
    operationContext: {
      operationId: 'worksheet.whatIf.test:0:1',
      kind: 'mutation',
      author: {
        authorId: 'test-user',
        actorKind: 'user',
      },
      createdAt: '2026-06-24T00:00:00.000Z',
      sheetIds: ['sheet-1'],
      domainIds: ['cells'],
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
    },
  };
}

describe('data table operations', () => {
  describe('dataTable', () => {
    it('returns a transient compute receipt with worksheet unchanged effects', async () => {
      const ctx = createMockCtx({
        getCellIdAt: jest
          .fn()
          .mockResolvedValueOnce('formula-id')
          .mockResolvedValueOnce('row-input-id')
          .mockResolvedValueOnce('col-input-id'),
        dataTable: jest.fn().mockResolvedValue({
          results: [[10, 20]],
          cellCount: 2,
          cancelled: false,
        }),
      });

      const result = await DataTableOps.dataTable(ctx, 'sheet-1', 'B2', {
        rowInputCell: 'A1',
        colInputCell: 'A2',
        rowValues: [1],
        colValues: [2, 3],
      });

      expect(ctx.computeBridge.dataTable).toHaveBeenCalledWith({
        formula_cell: 'formula-id',
        row_input_cell: 'row-input-id',
        col_input_cell: 'col-input-id',
        row_values: [1],
        col_values: [2, 3],
      });
      expect(result).toEqual({
        kind: 'dataTable.compute',
        status: 'completed',
        effects: [
          { type: 'computedGrid', sheetId: 'sheet-1', count: 2 },
          { type: 'worksheetUnchanged', sheetId: 'sheet-1' },
        ],
        diagnostics: [],
        lifecycle: 'transient',
        materialized: false,
        worksheetChanged: false,
        results: [[10, 20]],
        cellCount: 2,
        elapsedMs: 0,
        cancelled: false,
      });
    });
  });

  describe('createDataTable', () => {
    it('passes the sheet-scoped creation request to Rust and returns a creation receipt', async () => {
      const ctx = createMockCtx({
        createDataTable: jest.fn().mockResolvedValue({
          data: {
            regionId: 'sheet-1:1:1:3:3',
            tableRange: 'B2:D4',
            bodyRange: 'C3:D4',
            rowInputCell: 'A1',
            colInputCell: 'A2',
            rowsComputed: 2,
            colsComputed: 2,
            cellCount: 4,
          },
        }),
      });

      const options = mutationOptions();
      const result = await DataTableOps.createDataTable(
        ctx,
        'sheet-1',
        {
          tableRange: 'B2:D4',
          rowInputCell: 'A1',
          colInputCell: 'A2',
        },
        options,
      );

      expect(ctx.computeBridge.createDataTable).toHaveBeenCalledWith(
        'sheet-1',
        1,
        1,
        3,
        3,
        {
          sheetId: 'sheet-1',
          tableRange: 'B2:D4',
          rowInputCell: 'A1',
          colInputCell: 'A2',
        },
        options,
      );
      expect(result).toEqual({
        kind: 'dataTable.create',
        status: 'applied',
        effects: [
          {
            type: 'storedMetadata',
            sheetId: 'sheet-1',
            range: 'C3:D4',
            objectId: 'sheet-1:1:1:3:3',
          },
          {
            type: 'materializedCells',
            sheetId: 'sheet-1',
            range: 'C3:D4',
            objectId: 'sheet-1:1:1:3:3',
            count: 4,
          },
          {
            type: 'createdUndoEntry',
            sheetId: 'sheet-1',
            range: 'B2:D4',
            objectId: 'sheet-1:1:1:3:3',
          },
        ],
        diagnostics: [],
        lifecycle: 'live',
        materialized: true,
        worksheetChanged: true,
        regionId: 'sheet-1:1:1:3:3',
        tableRange: 'B2:D4',
        bodyRange: 'C3:D4',
        rowInputCell: 'A1',
        colInputCell: 'A2',
        rowsComputed: 2,
        colsComputed: 2,
        cellCount: 4,
      });
    });

    it('fails when Rust does not return CreateDataTableResult data', async () => {
      const ctx = createMockCtx({
        createDataTable: jest.fn().mockResolvedValue({ data: { regionId: 'missing-fields' } }),
      });

      await expect(
        DataTableOps.createDataTable(
          ctx,
          'sheet-1',
          {
            tableRange: 'B2:D4',
            rowInputCell: 'A1',
            colInputCell: 'A2',
          },
          mutationOptions(),
        ),
      ).rejects.toThrow('CreateDataTableResult');
    });
  });

  describe('writeDataTableValues', () => {
    it('computes and writes static values through the cell mutation path', async () => {
      const ctx = createMockCtx({
        getCellIdAt: jest
          .fn()
          .mockResolvedValueOnce('formula-id')
          .mockResolvedValueOnce('row-input-id')
          .mockResolvedValueOnce('col-input-id'),
        dataTable: jest.fn().mockResolvedValue({
          results: [
            [10, 20],
            [30, 40],
          ],
          cellCount: 4,
          cancelled: false,
        }),
      });

      const options = mutationOptions();
      const result = await DataTableOps.writeDataTableValues(
        ctx,
        'sheet-1',
        'B2',
        {
          rowInputCell: 'A1',
          colInputCell: 'A2',
          rowValues: [1, 2],
          colValues: [3, 4],
          targetRange: 'C3:D4',
        },
        options,
      );

      expect(ctx.computeBridge.setCellsByPosition).toHaveBeenCalledWith(
        'sheet-1',
        [
          { row: 2, col: 2, input: { kind: 'value', value: 10 } },
          { row: 2, col: 3, input: { kind: 'value', value: 20 } },
          { row: 3, col: 2, input: { kind: 'value', value: 30 } },
          { row: 3, col: 3, input: { kind: 'value', value: 40 } },
        ],
        options,
      );
      expect(result).toMatchObject({
        kind: 'dataTable.writeStaticValues',
        status: 'applied',
        lifecycle: 'staticValues',
        materialized: true,
        worksheetChanged: true,
        targetRange: 'C3:D4',
        cellCount: 4,
        cellsWritten: 4,
      });
      expect(result.effects).toEqual([
        { type: 'computedGrid', sheetId: 'sheet-1', count: 4 },
        { type: 'wroteStaticValues', sheetId: 'sheet-1', range: 'C3:D4', count: 4 },
        { type: 'changedRange', sheetId: 'sheet-1', range: 'C3:D4', count: 4 },
        { type: 'createdUndoEntry', sheetId: 'sheet-1', range: 'C3:D4' },
      ]);
    });

    it('returns a failed receipt without writing when target dimensions mismatch', async () => {
      const ctx = createMockCtx({
        getCellIdAt: jest.fn().mockResolvedValueOnce('formula-id').mockResolvedValueOnce(null),
        dataTable: jest.fn().mockResolvedValue({
          results: [[10, 20]],
          cellCount: 2,
          cancelled: false,
        }),
      });

      const result = await DataTableOps.writeDataTableValues(
        ctx,
        'sheet-1',
        'B2',
        {
          rowInputCell: null,
          colInputCell: null,
          rowValues: [],
          colValues: [3, 4],
          targetRange: 'C3:C4',
        },
        mutationOptions(),
      );

      expect(ctx.computeBridge.setCellsByPosition).not.toHaveBeenCalled();
      expect(result.status).toBe('failed');
      expect(result.effects).toEqual([
        { type: 'computedGrid', sheetId: 'sheet-1', count: 2 },
        { type: 'worksheetUnchanged', sheetId: 'sheet-1', range: 'C3:C4' },
      ]);
      expect(result.diagnostics[0]).toMatchObject({
        code: 'DATA_TABLE_STATIC_RANGE_MISMATCH',
        target: { sheetId: 'sheet-1', range: 'C3:C4' },
      });
    });
  });

  describe('describeDataTables', () => {
    it('describes unique Data Table regions from cell metadata', async () => {
      const ctx = createMockCtx({
        getDataBounds: jest.fn().mockResolvedValue({
          minRow: 1,
          minCol: 1,
          maxRow: 2,
          maxCol: 2,
        }),
        getCellIdAt: jest.fn().mockResolvedValue('dt-cell'),
        getActiveCell: jest.fn().mockResolvedValue({
          cellId: 'dt-cell',
          value: 10,
          formula: '=TABLE($A$2,$A$1)',
          metadata: {
            region: {
              kind: 'dataTable',
              isAnchor: true,
              anchorRow: 1,
              anchorCol: 1,
              bounds: { rows: 2, cols: 2 },
            },
          },
          isFormulaHidden: false,
        }),
      });

      await expect(DataTableOps.describeDataTables(ctx, 'sheet-1')).resolves.toEqual([
        {
          regionId: 'sheet-1:1:1:2:2',
          sheetId: 'sheet-1',
          lifecycle: 'live',
          materialized: true,
          bodyRange: 'B2:C3',
          anchorAddress: 'B2',
          startRow: 1,
          startCol: 1,
          endRow: 2,
          endCol: 2,
          rowsComputed: 2,
          colsComputed: 2,
          cellCount: 4,
        },
      ]);
    });
  });

  describe('refreshDataTable', () => {
    it('returns an explicit unsupported receipt on the current bridge surface', async () => {
      const ctx = createMockCtx({
        getDataBounds: jest.fn().mockResolvedValue(null),
      });

      const result = await DataTableOps.refreshDataTable(ctx, 'sheet-1', 'B2:C3');

      expect(result).toMatchObject({
        kind: 'dataTable.refresh',
        status: 'unsupported',
        effects: [{ type: 'worksheetUnchanged', sheetId: 'sheet-1' }],
        lifecycle: 'live',
        materialized: false,
        worksheetChanged: false,
        target: 'B2:C3',
      });
      expect(result.diagnostics[0]).toMatchObject({
        severity: 'error',
        code: 'DATA_TABLE_REFRESH_UNSUPPORTED',
      });
    });
  });
});
