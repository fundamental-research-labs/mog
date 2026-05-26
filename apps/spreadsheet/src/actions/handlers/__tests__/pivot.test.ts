import { describe, expect, jest, test } from '@jest/globals';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import { sheetId as makeSheetId } from '@mog-sdk/contracts/core';

import * as PivotHandlers from '../pivot';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DISPATCHER_SOURCE = readFileSync(
  path.resolve(__dirname, '..', '..', 'dispatcher.ts'),
  'utf8',
);

function isPivotHandlerRegistered(action: string): boolean {
  return new RegExp(`(^|\\s)${action}:\\s*PivotHandlers\\.${action}[,\\s]`, 'm').test(
    DISPATCHER_SOURCE,
  );
}

function createMockDeps(): ActionDependencies {
  const activeSheetId = makeSheetId('sheet1');
  const pivots = {
    setShowValuesAs: jest.fn().mockResolvedValue(undefined),
    setLayout: jest.fn().mockResolvedValue(undefined),
    setDataSource: jest.fn().mockResolvedValue(undefined),
    setFilter: jest.fn().mockResolvedValue(undefined),
    addCalculatedField: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
  };
  const worksheet = { pivots };
  const workbook = {
    getSheetById: jest.fn().mockReturnValue(worksheet),
  };

  return {
    workbook,
    getActiveSheetId: jest.fn().mockReturnValue(activeSheetId),
  } as unknown as ActionDependencies;
}

function getPivotApi(deps: ActionDependencies) {
  return (deps.workbook.getSheetById(deps.getActiveSheetId()) as any).pivots;
}

describe('Pivot action handlers', () => {
  test('PIVOT_SET_SHOW_VALUES_AS calls WorksheetPivots.setShowValuesAs and refresh', async () => {
    const deps = createMockDeps();

    const result = await PivotHandlers.PIVOT_SET_SHOW_VALUES_AS(deps, {
      pivotName: 'SalesPivot',
      fieldId: 'Amount',
      showValuesAs: { type: 'percentOfGrandTotal' },
    });

    const pivots = getPivotApi(deps);
    expect(result).toEqual({ handled: true });
    expect(pivots.setShowValuesAs).toHaveBeenCalledWith('SalesPivot', 'Amount', {
      type: 'percentOfGrandTotal',
    });
    expect(pivots.refresh).toHaveBeenCalledWith('SalesPivot');
    expect(pivots.setShowValuesAs.mock.invocationCallOrder[0]).toBeLessThan(
      pivots.refresh.mock.invocationCallOrder[0],
    );
  });

  test('PIVOT_SET_SHOW_VALUES_AS passes null to clear the calculation', async () => {
    const deps = createMockDeps();

    await PivotHandlers.PIVOT_SET_SHOW_VALUES_AS(deps, {
      pivotName: 'SalesPivot',
      fieldId: 'Amount',
      showValuesAs: null,
    });

    expect(getPivotApi(deps).setShowValuesAs).toHaveBeenCalledWith('SalesPivot', 'Amount', null);
  });

  test('PIVOT_SET_SHOW_VALUES_AS prefers placementId and propagates receipts', async () => {
    const deps = createMockDeps();
    const pivotReceipt = {
      kind: 'pivotKernelMutation',
      pivotId: 'pivot-1',
      pivotName: 'SalesPivot',
      action: 'setShowValuesAs',
      placementId: 'value:Amount:1',
    };
    const refreshReceipt = { kind: 'pivotRefresh', pivotId: 'pivot-1' };
    const pivots = getPivotApi(deps);
    pivots.setShowValuesAs.mockResolvedValueOnce(pivotReceipt);
    pivots.refresh.mockResolvedValueOnce(refreshReceipt);

    const result = await PivotHandlers.PIVOT_SET_SHOW_VALUES_AS(deps, {
      pivotName: 'SalesPivot',
      fieldId: 'Amount',
      placementId: 'value:Amount:1',
      showValuesAs: { type: 'percentOfGrandTotal' },
    });

    expect(pivots.setShowValuesAs).toHaveBeenCalledWith('SalesPivot', 'value:Amount:1', {
      type: 'percentOfGrandTotal',
    });
    expect(result).toEqual({ handled: true, receipts: [pivotReceipt, refreshReceipt] });
  });

  test('PIVOT_SET_GRAND_TOTALS calls WorksheetPivots.setLayout and refresh', async () => {
    const deps = createMockDeps();
    const layoutReceipt = {
      kernelReceiptId: 'pivot-1:setLayout:1',
      pivotId: 'pivot-1',
      effects: [],
      mutationResult: {
        action: 'setLayout',
        pivotName: 'SalesPivot',
        layout: { showRowGrandTotals: false, showColumnGrandTotals: true },
      },
      updateReason: 'layoutChanged',
      refreshPolicy: 'refreshAndMaterialize',
      materialized: true,
      configRevision: 1,
      status: 'applied',
    };
    const refreshReceipt = { kind: 'pivotRefresh', pivotId: 'pivot-1' };
    const pivots = getPivotApi(deps);
    pivots.setLayout.mockResolvedValueOnce(layoutReceipt);
    pivots.refresh.mockResolvedValueOnce(refreshReceipt);

    const result = await PivotHandlers.PIVOT_SET_GRAND_TOTALS(deps, {
      pivotName: 'SalesPivot',
      showRowGrandTotals: false,
      showColumnGrandTotals: true,
    });

    expect(result).toEqual({ handled: true, receipts: [layoutReceipt, refreshReceipt] });
    expect(pivots.setLayout).toHaveBeenCalledWith('SalesPivot', {
      showRowGrandTotals: false,
      showColumnGrandTotals: true,
    });
    expect(pivots.refresh).toHaveBeenCalledWith('SalesPivot');
    expect(pivots.setLayout.mock.invocationCallOrder[0]).toBeLessThan(
      pivots.refresh.mock.invocationCallOrder[0],
    );
  });

  test('PIVOT_SET_DATA_SOURCE calls WorksheetPivots.setDataSource without refresh', async () => {
    const deps = createMockDeps();

    const result = await PivotHandlers.PIVOT_SET_DATA_SOURCE(deps, {
      pivotName: 'SalesPivot',
      dataSource: "'Bob''s Data'!A1:B5",
    });

    const pivots = getPivotApi(deps);
    expect(result).toEqual({ handled: true });
    expect(pivots.setDataSource).toHaveBeenCalledWith('SalesPivot', "'Bob''s Data'!A1:B5");
    expect(pivots.refresh).not.toHaveBeenCalled();
  });

  test('PIVOT_SET_FILTER calls WorksheetPivots.setFilter without refresh', async () => {
    const deps = createMockDeps();

    const result = await PivotHandlers.PIVOT_SET_FILTER(deps, {
      pivotName: 'SalesPivot',
      fieldId: 'Year',
      filter: { includeValues: ['2024'] },
    });

    const pivots = getPivotApi(deps);
    expect(result).toEqual({ handled: true });
    expect(pivots.setFilter).toHaveBeenCalledWith('SalesPivot', 'Year', {
      includeValues: ['2024'],
    });
    expect(pivots.refresh).not.toHaveBeenCalled();
  });

  test('PIVOT_ADD_CALCULATED_FIELD calls WorksheetPivots.addCalculatedField and refresh', async () => {
    const deps = createMockDeps();

    const result = await PivotHandlers.PIVOT_ADD_CALCULATED_FIELD(deps, {
      pivotName: 'SalesPivot',
      field: { fieldId: 'Profit', name: 'Profit', formula: '=Revenue - Cost' },
    });

    const pivots = getPivotApi(deps);
    expect(result).toEqual({ handled: true });
    expect(pivots.addCalculatedField).toHaveBeenCalledWith('SalesPivot', {
      fieldId: 'Profit',
      name: 'Profit',
      formula: '=Revenue - Cost',
    });
    expect(pivots.refresh).toHaveBeenCalledWith('SalesPivot');
    expect(pivots.addCalculatedField.mock.invocationCallOrder[0]).toBeLessThan(
      pivots.refresh.mock.invocationCallOrder[0],
    );
  });

  test('PIVOT actions are registered in HANDLER_MAP', () => {
    expect(isPivotHandlerRegistered('PIVOT_SET_SHOW_VALUES_AS')).toBe(true);
    expect(isPivotHandlerRegistered('PIVOT_SET_GRAND_TOTALS')).toBe(true);
    expect(isPivotHandlerRegistered('PIVOT_SET_DATA_SOURCE')).toBe(true);
    expect(isPivotHandlerRegistered('PIVOT_SET_FILTER')).toBe(true);
    expect(isPivotHandlerRegistered('PIVOT_ADD_CALCULATED_FIELD')).toBe(true);
  });
});
