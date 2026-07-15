/**
 * WorksheetPivotsImpl — Unit tests for new pivot API methods.
 *
 * Tests:
 * 1. setShowValuesAs — sets ShowValuesAs config on a value field
 * 2. addField with showValuesAs option — passes through to placement
 * 3. refreshAll — refreshes all pivots on the sheet
 * 4. rename — renames a pivot table
 * 5. resetField — resets placement to defaults and removes filter
 * 6. PivotTableHandle.setShowValuesAs — awaited handle method
 */

import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

// Mock transitive dependencies to prevent ESM import chain issues
jest.mock('../../floating-objects', () => ({
  createSpreadsheetObjectManager: jest.fn(),
}));
jest.mock('../../context', () => ({}));
jest.mock('../workbook/operations/sheet-crud-operations', () => ({
  renameSheet: jest.fn(),
  setSheetHidden: jest.fn(),
}));
jest.mock('../worksheet/operations/cell-operations');
jest.mock('../worksheet/operations/range-operations');
jest.mock('../worksheet/operations/format-operations');
jest.mock('../worksheet/operations/merge-operations');
jest.mock('../worksheet/operations/query-operations');
jest.mock('../worksheet/operations/hyperlink-operations');
jest.mock('../worksheet/operations/dependency-operations');
jest.mock('../worksheet/operations/validation-operations');
jest.mock('../worksheet/operations/filter-operations');
jest.mock('../worksheet/operations/shape-operations');
jest.mock('../worksheet/operations/floating-object-operations');
jest.mock('../worksheet/operations/sort-operations');
jest.mock('../worksheet/operations/cf-operations');
jest.mock('../worksheet/operations/grouping-operations');
jest.mock('../worksheet/operations/equation-operations');
jest.mock('../worksheet/operations/text-effects-operations');
jest.mock('../worksheet/operations/sheet-management-operations');
jest.mock('../worksheet/operations/table-operations');
jest.mock('../worksheet/operations/drawing-operations');
jest.mock('../worksheet/operations/fill-operations');
jest.mock('../../domain/cells/cell-iteration');
jest.mock('../../domain/charts/chart-store');
jest.mock('../../domain/formulas/named-ranges');
jest.mock('../../domain/sheets/sheet-meta');
jest.mock('../../domain/tables/core');
jest.mock('../../domain/sheets/structures');
jest.mock('../../domain/formatting/merges');
jest.mock('../internal/format-utils');
jest.mock('../../bridges/compute/compute-bridge', () => ({
  identityFormulaToWire: jest.fn(),
}));
jest.mock('../../bridges/compute/compute-core', () => ({}));
jest.mock('../internal/value-conversions', () => ({
  normalizeCellValue: jest.fn(),
  cellValueToString: jest.fn(),
}));
jest.mock('../../domain/cells/cell-viewport-iteration');
jest.mock('../../domain/cells/cell-identity');
jest.mock('../workbook/operations/scenario-operations');
jest.mock('../../services/checkpoint');
jest.mock('../../bridges/wire/cell-metadata-cache', () => ({
  createCellMetadataCache: jest.fn(() => ({
    isProjectedPosition: jest.fn(),
    getProjectionSourcePosition: jest.fn(),
    getProjectionRange: jest.fn(),
    hasValidationErrors: jest.fn(),
    evaluateViewport: jest.fn(),
    onChange: jest.fn(() => jest.fn()),
    clear: jest.fn(),
    dispose: jest.fn(),
  })),
}));

import type { ShowValuesAsConfig } from '@mog-sdk/contracts/pivot';
import { WorksheetImpl } from '../worksheet/worksheet-impl';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const SHEET_ID = sheetId('sheet-1');

function makePivotConfig(overrides?: Record<string, any>) {
  return {
    id: 'pivot-1',
    name: 'SalesPivot',
    sourceSheetName: 'Sheet1',
    sourceRange: { startRow: 0, startCol: 0, endRow: 99, endCol: 3 },
    fields: [
      { id: 'Region', name: 'Region', dataType: 'string' },
      { id: 'Amount', name: 'Amount', dataType: 'number' },
    ],
    placements: [
      { fieldId: 'Region', area: 'row', position: 0 },
      {
        fieldId: 'Amount',
        area: 'value',
        position: 0,
        aggregateFunction: 'sum',
        displayName: 'Sum of Amount',
      },
    ],
    filters: [],
    calculatedFields: [],
    outputLocation: { row: 2, col: 3 },
    ...overrides,
  };
}

function makePivotResult(overrides?: Record<string, any>) {
  return {
    rows: [
      {
        headers: [{ fieldId: 'Region', value: 'North', key: 'North' }],
        values: [150],
      },
    ],
    columnHeaders: [],
    renderedBounds: {
      totalRows: 2,
      totalCols: 2,
      firstDataRow: 1,
      firstDataCol: 1,
      numDataRows: 1,
      numDataCols: 1,
    },
    sourceRowCount: 1,
    ...overrides,
  };
}

function makeMutationReceipt(pivotId = 'pivot-1', placementId?: string) {
  return {
    kernelReceiptId: `receipt-${placementId ?? pivotId}`,
    pivotId,
    effects: placementId
      ? [
          {
            type: 'placementUpdated',
            placementId,
          },
        ]
      : [],
    mutationResult: {},
    updateReason: 'test',
    refreshPolicy: 'refreshAndMaterialize',
    materialized: true,
    configRevision: 1,
    status: 'applied',
  };
}

function createMockCtx(): any {
  const pivotConfig = makePivotConfig();
  return {
    computeBridge: {
      setCell: jest.fn().mockResolvedValue({ success: true }),
      getCell: jest.fn().mockResolvedValue(undefined),
      setCells: jest.fn(),
      setCellsByPosition: jest.fn().mockResolvedValue(undefined),
      getCellIdAtPosition: jest.fn().mockResolvedValue(null),
      getUsedRange: jest.fn().mockResolvedValue(null),
      getFormula: jest.fn().mockResolvedValue(undefined),
      moveCell: jest.fn().mockResolvedValue(undefined),
      getActiveCell: jest.fn().mockResolvedValue(null),
      getWorksheetProtectionState: jest.fn().mockReturnValue({ isProtected: false }),
      getAllSheetIds: jest.fn().mockResolvedValue([SHEET_ID]),
      getSheetName: jest.fn().mockResolvedValue('Sheet1'),
      queryRange: jest
        .fn()
        .mockImplementation(async (_sheetId, startRow, startCol, endRow, endCol) => {
          const cells = [];
          if (startRow === 0 && endRow === 0) {
            const headers = ['Region', 'Amount'];
            for (let col = startCol; col <= endCol; col++) {
              cells.push({ row: 0, col, value: headers[col - startCol] ?? `Column${col + 1}` });
            }
          } else {
            for (let col = startCol; col <= endCol; col++) {
              cells.push({ row: startRow, col, value: col === startCol ? 'North' : 150 });
            }
          }
          return { cells };
        }),
    },
    pivot: {
      getPivot: jest.fn().mockResolvedValue(pivotConfig),
      getAllPivots: jest.fn().mockResolvedValue([pivotConfig]),
      updatePivot: jest.fn().mockResolvedValue(pivotConfig),
      createPivot: jest.fn().mockResolvedValue(pivotConfig),
      deletePivot: jest.fn().mockResolvedValue(undefined),
      refresh: jest.fn().mockResolvedValue(undefined),
      compute: jest.fn().mockResolvedValue(makePivotResult()),
      setAggregateFunction: jest.fn((pivotId, placementId) =>
        Promise.resolve(makeMutationReceipt(pivotId, placementId)),
      ),
      setShowValuesAs: jest.fn((pivotId, placementId) =>
        Promise.resolve(makeMutationReceipt(pivotId, placementId)),
      ),
      movePlacement: jest.fn((pivotId, placementId) =>
        Promise.resolve(makeMutationReceipt(pivotId, placementId)),
      ),
      setSortOrder: jest.fn((pivotId, placementId) =>
        Promise.resolve(makeMutationReceipt(pivotId, placementId)),
      ),
      getAllPivotItems: jest.fn().mockResolvedValue([]),
      getDrillDownData: jest.fn().mockResolvedValue([]),
    },
    calculator: {
      computePivot: jest.fn().mockResolvedValue({}),
    },
    eventBus: {
      on: jest.fn(() => () => {}),
      emit: jest.fn(),
      onMany: jest.fn(),
    },
    undo: { label: jest.fn() },
    yDoc: {},
    document: {},
    destroy: jest.fn(),
    services: {},
  };
}

function createWorksheet(ctx: any): any {
  return new (WorksheetImpl as any)(SHEET_ID, ctx, {} as any);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('WorksheetPivotsImpl', () => {
  let ctx: ReturnType<typeof createMockCtx>;
  let ws: any;

  beforeEach(() => {
    ctx = createMockCtx();
    ws = createWorksheet(ctx);
  });

  // =========================================================================
  // setShowValuesAs
  // =========================================================================

  describe('setShowValuesAs', () => {
    it('sets ShowValuesAs config on a value field placement', async () => {
      const showValuesAs: ShowValuesAsConfig = { type: 'percentOfGrandTotal' };

      await ws.pivots.setShowValuesAs('SalesPivot', 'Amount', showValuesAs);

      expect(ctx.pivot.updatePivot).toHaveBeenCalledWith(
        SHEET_ID,
        'pivot-1',
        expect.objectContaining({
          placements: expect.arrayContaining([
            expect.objectContaining({
              fieldId: 'Amount',
              area: 'value',
              showValuesAs: { type: 'percentOfGrandTotal' },
            }),
          ]),
        }),
        { reason: 'showValuesAsChanged', refreshPolicy: 'refreshAndMaterialize' },
      );
    });

    it('clears ShowValuesAs when null is passed', async () => {
      // Start with a pivot that has ShowValuesAs set
      const configWithSVA = makePivotConfig({
        placements: [
          { fieldId: 'Region', area: 'row', position: 0 },
          {
            fieldId: 'Amount',
            area: 'value',
            position: 0,
            aggregateFunction: 'sum',
            showValuesAs: { type: 'percentOfGrandTotal' },
          },
        ],
      });
      ctx.pivot.getPivot.mockResolvedValue(configWithSVA);

      await ws.pivots.setShowValuesAs('SalesPivot', 'Amount', null);

      expect(ctx.pivot.updatePivot).toHaveBeenCalledWith(
        SHEET_ID,
        'pivot-1',
        expect.objectContaining({
          placements: expect.arrayContaining([
            expect.objectContaining({
              fieldId: 'Amount',
              area: 'value',
              showValuesAs: undefined,
            }),
          ]),
        }),
        { reason: 'showValuesAsChanged', refreshPolicy: 'refreshAndMaterialize' },
      );
    });

    it('does not modify non-value placements', async () => {
      await expect(
        ws.pivots.setShowValuesAs('SalesPivot', 'Region', {
          type: 'percentOfGrandTotal',
        }),
      ).rejects.toThrow(/not found/i);

      expect(ctx.pivot.updatePivot).not.toHaveBeenCalled();
    });

    it('accepts a placement id and returns a pivot kernel mutation receipt', async () => {
      const config = makePivotConfig({
        placements: [
          { fieldId: 'Region', area: 'row', position: 0 },
          {
            fieldId: 'Amount',
            area: 'value',
            position: 0,
            aggregateFunction: 'sum',
            displayName: 'Sum of Amount',
          },
          {
            fieldId: 'Amount',
            area: 'value',
            position: 1,
            aggregateFunction: 'count',
            displayName: 'Count of Amount',
          },
        ],
      });
      ctx.pivot.getPivot.mockResolvedValue(config);
      ctx.pivot.getAllPivots.mockResolvedValue([config]);

      const receipt = await ws.pivots.setShowValuesAs('SalesPivot', 'value:Amount:1', {
        type: 'percentOfGrandTotal',
      });

      expect(ctx.pivot.setShowValuesAs).toHaveBeenCalledWith('pivot-1', 'value:Amount:1', {
        type: 'percentOfGrandTotal',
      });
      expect(ctx.pivot.updatePivot).not.toHaveBeenCalled();
      expect(receipt).toEqual(
        expect.objectContaining({
          pivotId: 'pivot-1',
          status: 'applied',
          effects: expect.arrayContaining([
            expect.objectContaining({
              type: 'placementUpdated',
              placementId: 'value:Amount:1',
            }),
          ]),
        }),
      );
    });

    it('rejects ambiguous value field facade references before mutation', async () => {
      const config = makePivotConfig({
        placements: [
          { fieldId: 'Region', area: 'row', position: 0 },
          { fieldId: 'Amount', area: 'value', position: 0, aggregateFunction: 'sum' },
          { fieldId: 'Amount', area: 'value', position: 1, aggregateFunction: 'count' },
        ],
      });
      ctx.pivot.getPivot.mockResolvedValue(config);
      ctx.pivot.getAllPivots.mockResolvedValue([config]);

      await expect(
        ws.pivots.setShowValuesAs('SalesPivot', 'Amount', { type: 'percentOfGrandTotal' }),
      ).rejects.toMatchObject({
        code: 'PIVOT_UNRESOLVED_FIELD_REFERENCES',
        context: expect.objectContaining({
          identifier: 'Amount',
          candidates: ['value:Amount:0', 'value:Amount:1'],
        }),
      });
      expect(ctx.pivot.updatePivot).not.toHaveBeenCalled();
    });

    it('resolves public string references by pivot name, not raw pivot ID', async () => {
      const idMatch = makePivotConfig({ id: 'pivot-1', name: 'SalesPivot' });
      const nameMatch = makePivotConfig({ id: 'pivot-2', name: 'pivot-1' });
      ctx.pivot.getAllPivots.mockResolvedValue([idMatch, nameMatch]);
      ctx.pivot.getPivot.mockImplementation(async (_sheetId: string, pivotId: string) =>
        pivotId === 'pivot-1' ? idMatch : null,
      );

      await ws.pivots.setShowValuesAs('pivot-1', 'Amount', { type: 'percentOfGrandTotal' });

      expect(ctx.pivot.setShowValuesAs).not.toHaveBeenCalled();
      expect(ctx.pivot.updatePivot).toHaveBeenCalledWith(
        expect.anything(),
        'pivot-2',
        expect.objectContaining({
          placements: expect.arrayContaining([
            expect.objectContaining({
              fieldId: 'Amount',
              showValuesAs: { type: 'percentOfGrandTotal' },
            }),
          ]),
        }),
        { reason: 'showValuesAsChanged', refreshPolicy: 'refreshAndMaterialize' },
      );
    });
  });

  describe('setAggregateFunction', () => {
    it('accepts a placement id and updates only that value placement', async () => {
      const config = makePivotConfig({
        placements: [
          { fieldId: 'Region', area: 'row', position: 0 },
          { fieldId: 'Amount', area: 'value', position: 0, aggregateFunction: 'sum' },
          { fieldId: 'Amount', area: 'value', position: 1, aggregateFunction: 'count' },
        ],
      });
      ctx.pivot.getPivot.mockResolvedValue(config);
      ctx.pivot.getAllPivots.mockResolvedValue([config]);

      const receipt = await ws.pivots.setAggregateFunction('SalesPivot', 'value:Amount:1', 'max');

      expect(ctx.pivot.setAggregateFunction).toHaveBeenCalledWith(
        'pivot-1',
        'value:Amount:1',
        'max',
      );
      expect(ctx.pivot.updatePivot).not.toHaveBeenCalled();
      expect(receipt).toEqual(
        expect.objectContaining({
          pivotId: 'pivot-1',
          status: 'applied',
          effects: expect.arrayContaining([
            expect.objectContaining({
              type: 'placementUpdated',
              placementId: 'value:Amount:1',
            }),
          ]),
        }),
      );
    });

    it('rejects ambiguous value field facade references before mutation', async () => {
      const config = makePivotConfig({
        placements: [
          { fieldId: 'Region', area: 'row', position: 0 },
          { fieldId: 'Amount', area: 'value', position: 0, aggregateFunction: 'sum' },
          { fieldId: 'Amount', area: 'value', position: 1, aggregateFunction: 'count' },
        ],
      });
      ctx.pivot.getPivot.mockResolvedValue(config);
      ctx.pivot.getAllPivots.mockResolvedValue([config]);

      await expect(
        ws.pivots.setAggregateFunction('SalesPivot', 'Amount', 'average'),
      ).rejects.toMatchObject({
        code: 'PIVOT_UNRESOLVED_FIELD_REFERENCES',
        context: expect.objectContaining({
          identifier: 'Amount',
          candidates: ['value:Amount:0', 'value:Amount:1'],
        }),
      });
      expect(ctx.pivot.updatePivot).not.toHaveBeenCalled();
    });

    it('persists counta when targeting a text value field placement id', async () => {
      const config = makePivotConfig({
        fields: [
          { id: 'Region', name: 'Region', dataType: 'string' },
          { id: 'OrderId', name: 'OrderId', dataType: 'string' },
        ],
        placements: [
          { fieldId: 'Region', area: 'row', position: 0 },
          { fieldId: 'OrderId', area: 'value', position: 0, aggregateFunction: 'count' },
        ],
      });
      ctx.pivot.getPivot.mockResolvedValue(config);
      ctx.pivot.getAllPivots.mockResolvedValue([config]);

      await ws.pivots.setAggregateFunction('SalesPivot', 'value:OrderId:0', 'counta');

      expect(ctx.pivot.setAggregateFunction).toHaveBeenCalledWith(
        'pivot-1',
        'value:OrderId:0',
        'counta',
      );
      expect(ctx.pivot.updatePivot).not.toHaveBeenCalled();
    });
  });

  describe('moveField', () => {
    it('delegates to PivotBridge.movePlacement with the resolved placement id', async () => {
      const config = makePivotConfig({
        placements: [
          { fieldId: 'Month', area: 'row', position: 0 },
          { fieldId: 'Vendor', area: 'row', position: 1 },
          { fieldId: 'Amount', area: 'value', position: 0, aggregateFunction: 'sum' },
        ],
      });
      ctx.pivot.getPivot.mockResolvedValue(config);
      ctx.pivot.getAllPivots.mockResolvedValue([config]);

      await ws.pivots.moveField('SalesPivot', 'Vendor', 'row', 'row', 0);

      expect(ctx.pivot.movePlacement).toHaveBeenCalledWith('pivot-1', 'row:Vendor:1', 'row', 0);
      expect(ctx.pivot.updatePivot).not.toHaveBeenCalled();
    });

    it('can move one duplicate value placement when addressed by placement id', async () => {
      const config = makePivotConfig({
        placements: [
          { fieldId: 'Region', area: 'row', position: 0 },
          {
            placementId: 'value:Amount:sum',
            fieldId: 'Amount',
            area: 'value',
            position: 0,
            aggregateFunction: 'sum',
          },
          {
            placementId: 'value:Amount:count',
            fieldId: 'Amount',
            area: 'value',
            position: 1,
            aggregateFunction: 'count',
          },
        ],
      });
      ctx.pivot.getPivot.mockResolvedValue(config);
      ctx.pivot.getAllPivots.mockResolvedValue([config]);

      await ws.pivots.moveField('SalesPivot', 'value:Amount:count', 'value', 'value', 0);

      expect(ctx.pivot.movePlacement).toHaveBeenCalledWith(
        'pivot-1',
        'value:Amount:count',
        'value',
        0,
      );
      expect(ctx.pivot.updatePivot).not.toHaveBeenCalled();
    });
  });

  describe('setSortOrder', () => {
    it('accepts a placement id and delegates to the bridge placement mutation', async () => {
      const config = makePivotConfig({
        placements: [
          { fieldId: 'Region', area: 'row', position: 0 },
          { fieldId: 'Amount', area: 'value', position: 0, aggregateFunction: 'sum' },
        ],
      });
      ctx.pivot.getPivot.mockResolvedValue(config);
      ctx.pivot.getAllPivots.mockResolvedValue([config]);

      const receipt = await ws.pivots.setSortOrder('SalesPivot', 'row:Region:0', 'desc');

      expect(ctx.pivot.setSortOrder).toHaveBeenCalledWith('pivot-1', 'row:Region:0', 'desc');
      expect(ctx.pivot.updatePivot).not.toHaveBeenCalled();
      expect(receipt).toEqual(
        expect.objectContaining({
          pivotId: 'pivot-1',
          status: 'applied',
          effects: expect.arrayContaining([
            expect.objectContaining({
              type: 'placementUpdated',
              placementId: 'row:Region:0',
            }),
          ]),
        }),
      );
    });

    it('rejects value placements before mutating sort order', async () => {
      await expect(ws.pivots.setSortOrder('SalesPivot', 'Amount', 'asc')).rejects.toThrow(
        /row or column area/i,
      );

      expect(ctx.pivot.setSortOrder).not.toHaveBeenCalled();
      expect(ctx.pivot.updatePivot).not.toHaveBeenCalled();
    });
  });

  describe('placement discovery', () => {
    it('lists normalized placement ids and finds placements by field facade', async () => {
      const placements = await ws.pivots.listPlacements('SalesPivot');
      await expect(ws.pivots.findPlacementsByField('SalesPivot', 'Amount')).resolves.toEqual([
        expect.objectContaining({
          placementId: 'value:Amount:0',
          fieldId: 'Amount',
          fieldName: 'Amount',
        }),
      ]);

      expect(placements).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ placementId: 'row:Region:0', fieldName: 'Region' }),
          expect.objectContaining({ placementId: 'value:Amount:0', fieldName: 'Amount' }),
        ]),
      );
    });
  });

  // =========================================================================
  // addField with showValuesAs
  // =========================================================================

  describe('addField with showValuesAs', () => {
    it('passes showValuesAs through to the new placement', async () => {
      const showValuesAs: ShowValuesAsConfig = {
        type: 'difference',
        baseField: 'Region',
        baseItem: { type: 'relative', position: 'previous' },
      };

      await ws.pivots.addField('SalesPivot', 'Amount2', 'value', {
        aggregateFunction: 'sum',
        showValuesAs,
      });

      const call = ctx.pivot.updatePivot.mock.calls[0];
      const placements = call[2].placements;
      const newPlacement = placements.find((p: any) => p.fieldId === 'Amount2');
      expect(newPlacement).toBeDefined();
      expect(newPlacement.showValuesAs).toEqual(showValuesAs);
      expect(newPlacement.displayName).toBe('Sum of Amount2');
    });
  });

  // =========================================================================
  // refreshAll
  // =========================================================================

  describe('refreshAll', () => {
    it('refreshes all pivots on the sheet', async () => {
      const config2 = makePivotConfig({ id: 'pivot-2', name: 'RevenuePivot' });
      ctx.pivot.getAllPivots.mockResolvedValue([makePivotConfig(), config2]);

      await ws.pivots.refreshAll();

      expect(ctx.pivot.refresh).toHaveBeenCalledTimes(2);
      expect(ctx.pivot.refresh).toHaveBeenCalledWith(SHEET_ID, 'pivot-1');
      expect(ctx.pivot.refresh).toHaveBeenCalledWith(SHEET_ID, 'pivot-2');
    });

    it('handles empty pivot list gracefully', async () => {
      ctx.pivot.getAllPivots.mockResolvedValue([]);

      await ws.pivots.refreshAll();

      expect(ctx.pivot.refresh).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // rename
  // =========================================================================

  describe('rename', () => {
    it('renames a pivot table', async () => {
      await ws.pivots.rename('SalesPivot', 'NewName');

      expect(ctx.pivot.updatePivot).toHaveBeenCalledWith(
        SHEET_ID,
        'pivot-1',
        {
          name: 'NewName',
        },
        { reason: 'renamed', refreshPolicy: 'refreshAndMaterialize' },
      );
    });

    it('rejects with PIVOT_NOT_FOUND when the pivot target is missing', async () => {
      await expect(ws.pivots.rename('nonexistent', 'NewName')).rejects.toMatchObject({
        code: 'PIVOT_NOT_FOUND',
      });
    });
  });

  // =========================================================================
  // resetField
  // =========================================================================

  describe('resetField', () => {
    it('resets a placement to defaults and removes filter', async () => {
      const configWithExtras = makePivotConfig({
        placements: [
          { fieldId: 'Region', area: 'row', position: 0, sortOrder: 'asc' },
          {
            fieldId: 'Amount',
            area: 'value',
            position: 0,
            aggregateFunction: 'sum',
            displayName: 'Total Sales',
            showValuesAs: { type: 'percentOfGrandTotal' },
          },
        ],
        filters: [{ fieldId: 'Amount', includeValues: ['100', '200'] }],
      });
      ctx.pivot.getPivot.mockResolvedValue(configWithExtras);

      await ws.pivots.resetField('SalesPivot', 'Amount');

      // First call: updatePivot with reset placements
      const firstCall = ctx.pivot.updatePivot.mock.calls[0];
      const placements = firstCall[2].placements;
      const resetPlacement = placements.find((p: any) => p.fieldId === 'Amount');
      expect(resetPlacement).toEqual({
        fieldId: 'Amount',
        area: 'value',
        position: 0,
      });

      // Second call: removeFilter strips the Amount filter
      expect(ctx.pivot.updatePivot).toHaveBeenCalledTimes(2);
      const secondCall = ctx.pivot.updatePivot.mock.calls[1];
      expect(secondCall[2].filters).toEqual([]);
    });

    it('preserves other placements when resetting one', async () => {
      const config = makePivotConfig();
      ctx.pivot.getPivot.mockResolvedValue(config);

      await ws.pivots.resetField('SalesPivot', 'Amount');

      const firstCall = ctx.pivot.updatePivot.mock.calls[0];
      const placements = firstCall[2].placements;
      const regionPlacement = placements.find((p: any) => p.fieldId === 'Region');
      // Region placement should be untouched
      expect(regionPlacement).toEqual({ fieldId: 'Region', area: 'row', position: 0 });
    });
  });

  // =========================================================================
  // setDataSource
  // =========================================================================

  describe('setDataSource', () => {
    it('updates source range, redetects fields, and marks dirty without refresh', async () => {
      await ws.pivots.setDataSource('SalesPivot', 'Sheet1!A1:B5');

      expect(ctx.pivot.updatePivot).toHaveBeenCalledWith(
        SHEET_ID,
        'pivot-1',
        expect.objectContaining({
          sourceSheetName: 'Sheet1',
          sourceRange: { startRow: 0, startCol: 0, endRow: 4, endCol: 1 },
          fields: expect.arrayContaining([
            expect.objectContaining({ id: 'col0', name: 'Region' }),
            expect.objectContaining({ id: 'col1', name: 'Amount' }),
          ]),
        }),
        { reason: 'sourceRangeChanged', refreshPolicy: 'dirtyOnly' },
      );
    });

    it('accepts canonical quoted sheet names with apostrophes', async () => {
      ctx.computeBridge.getSheetName.mockResolvedValue("Bob's Data");

      await ws.pivots.setDataSource('SalesPivot', "'Bob''s Data'!A1:B5");

      expect(ctx.pivot.updatePivot).toHaveBeenCalledWith(
        SHEET_ID,
        'pivot-1',
        expect.objectContaining({
          sourceSheetName: "Bob's Data",
        }),
        { reason: 'sourceRangeChanged', refreshPolicy: 'dirtyOnly' },
      );
    });

    it('returns a failed receipt for a missing sheet with a typed pivot error', async () => {
      ctx.computeBridge.getSheetName.mockResolvedValue('Other');

      const receipt = await ws.pivots.setDataSource('SalesPivot', 'Missing!A1:B5');

      expect(receipt).toEqual(
        expect.objectContaining({
          kind: 'pivot.setDataSource',
          status: 'failed',
          diagnostics: expect.arrayContaining([
            expect.objectContaining({
              code: 'PIVOT_INVALID_DATA_SOURCE',
              details: expect.objectContaining({ reason: 'sourceSheetNotFound' }),
            }),
          ]),
        }),
      );
    });

    it('rejects ambiguous duplicate headers with candidate details', async () => {
      ctx.pivot.getAllPivots.mockResolvedValue([
        makePivotConfig({
          fields: [
            { id: 'Region', name: 'Region', dataType: 'string' },
            { id: 'Amount', name: 'Amount', dataType: 'number' },
          ],
          placements: [{ fieldId: 'Amount', area: 'value', position: 0 }],
        }),
      ]);
      ctx.computeBridge.queryRange.mockImplementation(
        async (_sheetId, startRow, startCol, endRow, endCol) => {
          const cells = [];
          if (startRow === 0 && endRow === 0) {
            const headers = ['Amount', 'Amount', 'Region'];
            for (let col = startCol; col <= endCol; col++) {
              cells.push({ row: 0, col, value: headers[col - startCol] });
            }
          } else {
            for (let col = startCol; col <= endCol; col++) {
              cells.push({ row: startRow, col, value: col === endCol ? 'North' : 150 });
            }
          }
          return { cells };
        },
      );

      const receipt = await ws.pivots.setDataSource('SalesPivot', 'Sheet1!A1:C5');

      expect(receipt).toEqual(
        expect.objectContaining({
          status: 'failed',
          diagnostics: expect.arrayContaining([
            expect.objectContaining({
              code: 'PIVOT_UNRESOLVED_FIELD_REFERENCES',
              details: expect.objectContaining({
                invalidReferences: expect.arrayContaining([
                  expect.objectContaining({
                    kind: 'ambiguousDuplicateHeader',
                    candidates: expect.arrayContaining(['col0:Amount@0', 'col1:Amount@1']),
                  }),
                ]),
              }),
            }),
          ]),
        }),
      );
      expect(ctx.pivot.updatePivot).not.toHaveBeenCalled();
    });

    it('rejects all stale setDataSource references atomically with structured context', async () => {
      ctx.pivot.getAllPivots.mockResolvedValue([
        makePivotConfig({
          placements: [
            {
              fieldId: 'Region',
              area: 'row',
              position: 0,
              sortByValue: { valueFieldId: 'Amount', order: 'desc' },
              showValuesAs: { type: 'difference', baseField: 'Amount' },
            },
            { fieldId: 'CalcMargin', area: 'value', position: 0 },
          ],
          filters: [
            {
              fieldId: 'Amount',
              topBottom: { type: 'top', n: 10, by: 'items', valueFieldId: 'Amount' },
            },
          ],
          calculatedFields: [{ fieldId: 'CalcMargin', name: 'Margin', formula: 'Amount - Cost' }],
        }),
      ]);
      ctx.computeBridge.queryRange.mockImplementation(
        async (_sheetId, startRow, startCol, endRow, endCol) => {
          const cells = [];
          if (startRow === 0 && endRow === 0) {
            const headers = ['Region', 'Product'];
            for (let col = startCol; col <= endCol; col++) {
              cells.push({ row: 0, col, value: headers[col - startCol] });
            }
          } else {
            for (let col = startCol; col <= endCol; col++) {
              cells.push({ row: startRow, col, value: col === startCol ? 'North' : 'Widget' });
            }
          }
          return { cells };
        },
      );

      const receipt = await ws.pivots.setDataSource('SalesPivot', 'Sheet1!A1:B5');

      expect(receipt).toEqual(
        expect.objectContaining({
          status: 'failed',
          diagnostics: expect.arrayContaining([
            expect.objectContaining({
              code: 'PIVOT_UNRESOLVED_FIELD_REFERENCES',
              details: expect.objectContaining({
                invalidReferences: expect.arrayContaining([
                  expect.objectContaining({ kind: 'sortByValueField', fieldId: 'Amount' }),
                  expect.objectContaining({ kind: 'showValuesAsBaseField', fieldId: 'Amount' }),
                  expect.objectContaining({ kind: 'calculatedField', fieldId: 'CalcMargin' }),
                  expect.objectContaining({ kind: 'filterField', fieldId: 'Amount' }),
                  expect.objectContaining({ kind: 'topBottomValueField', fieldId: 'Amount' }),
                  expect.objectContaining({ kind: 'calculatedFieldFormula' }),
                ]),
              }),
            }),
          ]),
        }),
      );
      expect(ctx.pivot.updatePivot).not.toHaveBeenCalled();
    });

    it('redetects old source fields when stored field metadata is empty before validating stale references', async () => {
      const config = makePivotConfig({
        sourceRange: { startRow: 0, startCol: 0, endRow: 4, endCol: 2 },
        fields: [],
        placements: [
          { fieldId: 'Region', area: 'row', position: 0 },
          { fieldId: 'CalcMargin', area: 'value', position: 0, aggregateFunction: 'sum' },
        ],
        filters: [
          {
            fieldId: 'Amount',
            topBottom: { type: 'top', n: 10, by: 'items', valueFieldId: 'Amount' },
          },
        ],
        calculatedFields: [{ fieldId: 'CalcMargin', name: 'Margin', formula: 'Amount - Cost' }],
      });
      ctx.pivot.getAllPivots.mockResolvedValue([config]);
      ctx.pivot.getPivot.mockResolvedValue(config);
      ctx.computeBridge.queryRange.mockImplementation(
        async (_sheetId, startRow, startCol, endRow, endCol) => {
          const cells = [];
          if (startRow === 0 && endRow === 0) {
            const headers = startCol === 0 ? ['Region', 'Amount', 'Cost'] : ['Segment', 'Product'];
            for (let col = startCol; col <= endCol; col++) {
              cells.push({ row: 0, col, value: headers[col - startCol] });
            }
          } else {
            for (let col = startCol; col <= endCol; col++) {
              cells.push({ row: startRow, col, value: col === startCol ? 'North' : 150 });
            }
          }
          return { cells };
        },
      );

      const receipt = await ws.pivots.setDataSource('SalesPivot', 'Sheet1!E1:F5');

      expect(receipt).toEqual(
        expect.objectContaining({
          status: 'failed',
          diagnostics: expect.arrayContaining([
            expect.objectContaining({
              code: 'PIVOT_UNRESOLVED_FIELD_REFERENCES',
              details: expect.objectContaining({
                invalidReferences: expect.arrayContaining([
                  expect.objectContaining({ kind: 'placement', fieldId: 'Region' }),
                  expect.objectContaining({ kind: 'calculatedField', fieldId: 'CalcMargin' }),
                  expect.objectContaining({ kind: 'filterField', fieldId: 'Amount' }),
                  expect.objectContaining({ kind: 'topBottomValueField', fieldId: 'Amount' }),
                  expect.objectContaining({ kind: 'calculatedFieldFormula' }),
                ]),
              }),
            }),
          ]),
        }),
      );
      expect(ctx.pivot.updatePivot).not.toHaveBeenCalled();
    });

    it('handle.setDataSource awaits the same contract', async () => {
      const handle = await ws.pivots.get('SalesPivot');

      await handle!.setDataSource('Sheet1!A1:B5');

      expect(ctx.pivot.updatePivot).toHaveBeenCalledWith(
        SHEET_ID,
        'pivot-1',
        expect.objectContaining({ sourceSheetName: 'Sheet1' }),
        { reason: 'sourceRangeChanged', refreshPolicy: 'dirtyOnly' },
      );
    });

    it('handle.setDataSource keeps targeting the captured pivot id when names collide later', async () => {
      const target = makePivotConfig({ id: 'pivot-1', name: 'SalesPivot' });
      ctx.pivot.getAllPivots.mockResolvedValue([target]);
      const handle = await ws.pivots.get('SalesPivot');
      expect(handle?.getName()).toBe('SalesPivot');

      const duplicateName = makePivotConfig({ id: 'pivot-2', name: 'SalesPivot' });
      ctx.pivot.getAllPivots.mockResolvedValue([duplicateName, target]);
      ctx.pivot.getPivot.mockImplementation(async (_sheetId: string, pivotId: string) =>
        pivotId === 'pivot-1' ? target : duplicateName,
      );

      await handle!.setDataSource('Sheet1!A1:B5');

      expect(ctx.pivot.updatePivot).toHaveBeenCalledWith(
        SHEET_ID,
        'pivot-1',
        expect.objectContaining({ sourceSheetName: 'Sheet1' }),
        { reason: 'sourceRangeChanged', refreshPolicy: 'dirtyOnly' },
      );
      expect(ctx.pivot.updatePivot).not.toHaveBeenCalledWith(
        SHEET_ID,
        'pivot-2',
        expect.anything(),
        expect.anything(),
      );
    });
  });

  // =========================================================================
  // Pure read paths on dirty pivots
  // =========================================================================

  describe('dirty pivot read paths', () => {
    beforeEach(async () => {
      await ws.pivots.setDataSource('SalesPivot', 'Sheet1!A1:B5');
      jest.clearAllMocks();
    });

    it('compute reads through the pure pivot compute path even when forceRefresh is true', async () => {
      await expect(ws.pivots.compute('SalesPivot', true)).resolves.toEqual(
        expect.objectContaining({
          kind: 'pivot.compute',
          status: 'completed',
          result: expect.objectContaining({ sourceRowCount: 1 }),
        }),
      );

      expect(ctx.pivot.compute).toHaveBeenCalledWith(SHEET_ID, 'pivot-1', true);
      expect(ctx.pivot.refresh).not.toHaveBeenCalled();
    });

    it('queryPivot reads through compute and does not refresh or materialize', async () => {
      const receipt = await ws.pivots.queryPivot('SalesPivot');

      expect(receipt).toEqual(
        expect.objectContaining({
          kind: 'pivot.query',
          status: 'completed',
          result: expect.objectContaining({
            pivotName: 'SalesPivot',
            rowFields: ['Region'],
            valueFields: ['Sum of Amount'],
          }),
        }),
      );
      expect(ctx.pivot.compute).toHaveBeenCalledWith(SHEET_ID, 'pivot-1');
      expect(ctx.pivot.refresh).not.toHaveBeenCalled();
    });

    it('getRange derives bounds from compute and does not refresh or materialize', async () => {
      await expect(ws.pivots.getRange('SalesPivot')).resolves.toEqual({
        startRow: 2,
        startCol: 3,
        endRow: 3,
        endCol: 4,
        address: 'D3:E4',
      });

      expect(ctx.pivot.compute).toHaveBeenCalledWith(SHEET_ID, 'pivot-1');
      expect(ctx.pivot.refresh).not.toHaveBeenCalled();
    });
  });

  // =========================================================================
  // PivotTableHandle.setShowValuesAs
  // =========================================================================

  describe('PivotTableHandle.setShowValuesAs', () => {
    it('sets ShowValuesAs via the awaited handle method', async () => {
      const handle = await ws.pivots.get('SalesPivot');
      expect(handle).not.toBeNull();

      await handle!.setShowValuesAs('Amount', { type: 'percentOfRowTotal' });

      expect(ctx.pivot.updatePivot).toHaveBeenCalledWith(
        SHEET_ID,
        'pivot-1',
        expect.objectContaining({
          placements: expect.arrayContaining([
            expect.objectContaining({
              fieldId: 'Amount',
              area: 'value',
              showValuesAs: { type: 'percentOfRowTotal' },
            }),
          ]),
        }),
        { reason: 'showValuesAsChanged', refreshPolicy: 'refreshAndMaterialize' },
      );
    });

    it('matches by displayName on the handle', async () => {
      const handle = await ws.pivots.get('SalesPivot');
      expect(handle).not.toBeNull();

      await handle!.setShowValuesAs('Sum of Amount', { type: 'percentOfGrandTotal' });

      // Should match the placement with displayName 'Sum of Amount'
      const call = ctx.pivot.updatePivot.mock.calls[0];
      const placements = call[2].placements;
      const valuePlacement = placements.find((p: any) => p.fieldId === 'Amount');
      expect(valuePlacement.showValuesAs).toEqual({ type: 'percentOfGrandTotal' });
    });
  });

  describe('setLayout', () => {
    it('updates layout and returns a layout mutation receipt', async () => {
      ctx.pivot.updatePivot.mockImplementation(async (_sheetId, _pivotId, updates) => ({
        ...makePivotConfig(),
        ...updates,
      }));

      const receipt = await ws.pivots.setLayout('SalesPivot', {
        showRowGrandTotals: false,
        showColumnGrandTotals: false,
      });

      expect(ctx.pivot.updatePivot).toHaveBeenCalledWith(
        SHEET_ID,
        'pivot-1',
        {
          layout: {
            showRowGrandTotals: false,
            showColumnGrandTotals: false,
          },
        },
        { reason: 'layoutChanged', refreshPolicy: 'refreshAndMaterialize' },
      );
      expect(receipt).toEqual(
        expect.objectContaining({
          pivotId: 'pivot-1',
          status: 'applied',
          updateReason: 'layoutChanged',
          refreshPolicy: 'refreshAndMaterialize',
          mutationResult: expect.objectContaining({
            action: 'setLayout',
            pivotName: 'SalesPivot',
            layout: {
              showRowGrandTotals: false,
              showColumnGrandTotals: false,
            },
          }),
        }),
      );
    });
  });
});
