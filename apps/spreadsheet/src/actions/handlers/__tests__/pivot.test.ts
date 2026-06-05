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
  const pivotConfig = {
    id: 'pivot-1',
    name: 'Sales Pivot',
    placements: [
      {
        placementId: 'value:Amount:0',
        fieldId: 'Amount',
        area: 'value',
        position: 0,
      },
    ],
  };
  const handle = {
    setShowValuesAs: jest.fn().mockResolvedValue(undefined),
    setLayout: jest.fn().mockResolvedValue(undefined),
    setDataSource: jest.fn().mockResolvedValue(undefined),
    setFilter: jest.fn().mockResolvedValue(undefined),
    addCalculatedField: jest.fn().mockResolvedValue(undefined),
    refresh: jest.fn().mockResolvedValue(undefined),
  };
  const pivots = {
    get: jest.fn(async (pivotName: string) => (pivotName === pivotConfig.name ? handle : null)),
    handle,
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

function getPivotHandle(deps: ActionDependencies) {
  return getPivotApi(deps).handle;
}

describe('Pivot action handlers', () => {
  test.each([
    [
      'PIVOT_SET_SHOW_VALUES_AS',
      PivotHandlers.PIVOT_SET_SHOW_VALUES_AS,
      { fieldId: 'Amount', showValuesAs: null },
    ],
    [
      'PIVOT_SET_GRAND_TOTALS',
      PivotHandlers.PIVOT_SET_GRAND_TOTALS,
      { showRowGrandTotals: true, showColumnGrandTotals: true },
    ],
    ['PIVOT_SET_DATA_SOURCE', PivotHandlers.PIVOT_SET_DATA_SOURCE, { dataSource: 'Data!A1:B5' }],
    [
      'PIVOT_SET_FILTER',
      PivotHandlers.PIVOT_SET_FILTER,
      { fieldId: 'Year', filter: { includeValues: ['2024'] } },
    ],
    [
      'PIVOT_ADD_CALCULATED_FIELD',
      PivotHandlers.PIVOT_ADD_CALCULATED_FIELD,
      { field: { fieldId: 'Profit', name: 'Profit', formula: '=Revenue - Cost' } },
    ],
  ])('%s rejects payloads without pivotName', async (actionName, handler, payload) => {
    const result = await handler(createMockDeps(), payload);

    expect(result).toEqual({
      handled: false,
      reason: 'wrong_context',
      error: `${actionName} pivotName must be a non-empty string`,
    });
  });

  test('PIVOT_SET_SHOW_VALUES_AS routes through the resolved pivot handle', async () => {
    const deps = createMockDeps();
    const pivots = getPivotApi(deps);
    const handle = getPivotHandle(deps);

    const result = await PivotHandlers.PIVOT_SET_SHOW_VALUES_AS(deps, {
      pivotName: 'Sales Pivot',
      fieldId: 'Amount',
      showValuesAs: { type: 'percentOfGrandTotal' },
    });

    expect(pivots.get).toHaveBeenCalledWith('Sales Pivot');
    expect(handle.setShowValuesAs).toHaveBeenCalledWith('Amount', {
      type: 'percentOfGrandTotal',
    });
    expect(handle.refresh).toHaveBeenCalled();
    expect(pivots).not.toHaveProperty('getById');
    expect(pivots).not.toHaveProperty('refreshById');
    expect(result).toEqual({ handled: true });
  });

  test('PIVOT_SET_SHOW_VALUES_AS accepts placementId directly', async () => {
    const deps = createMockDeps();

    await PivotHandlers.PIVOT_SET_SHOW_VALUES_AS(deps, {
      pivotName: 'Sales Pivot',
      placementId: 'value:Amount:0',
      showValuesAs: null,
    });

    const pivots = getPivotApi(deps);
    const handle = getPivotHandle(deps);
    expect(handle.setShowValuesAs).toHaveBeenCalledWith('value:Amount:0', null);
    expect(handle.refresh).toHaveBeenCalled();
    expect(pivots).not.toHaveProperty('setShowValuesAsById');
  });

  test('PIVOT_SET_GRAND_TOTALS routes through the resolved pivot handle', async () => {
    const deps = createMockDeps();
    const pivots = getPivotApi(deps);
    const handle = getPivotHandle(deps);

    const result = await PivotHandlers.PIVOT_SET_GRAND_TOTALS(deps, {
      pivotName: 'Sales Pivot',
      showRowGrandTotals: false,
      showColumnGrandTotals: true,
    });

    expect(result).toEqual({ handled: true });
    expect(handle.setLayout).toHaveBeenCalledWith({
      showRowGrandTotals: false,
      showColumnGrandTotals: true,
    });
    expect(handle.refresh).toHaveBeenCalled();
    expect(pivots).not.toHaveProperty('setLayoutById');
  });

  test('PIVOT_SET_DATA_SOURCE routes through the resolved pivot handle', async () => {
    const deps = createMockDeps();

    const result = await PivotHandlers.PIVOT_SET_DATA_SOURCE(deps, {
      pivotName: 'Sales Pivot',
      dataSource: "'Bob''s Data'!A1:B5",
    });

    const pivots = getPivotApi(deps);
    const handle = getPivotHandle(deps);
    expect(result).toEqual({ handled: true });
    expect(handle.setDataSource).toHaveBeenCalledWith("'Bob''s Data'!A1:B5");
    expect(pivots).not.toHaveProperty('setDataSourceById');
  });

  test('PIVOT_SET_FILTER routes through the resolved pivot handle', async () => {
    const deps = createMockDeps();

    const result = await PivotHandlers.PIVOT_SET_FILTER(deps, {
      pivotName: 'Sales Pivot',
      fieldId: 'Year',
      filter: { includeValues: ['2024'] },
    });

    const pivots = getPivotApi(deps);
    const handle = getPivotHandle(deps);
    expect(result).toEqual({ handled: true });
    expect(handle.setFilter).toHaveBeenCalledWith('Year', {
      includeValues: ['2024'],
    });
    expect(pivots).not.toHaveProperty('setFilterById');
  });

  test('PIVOT_ADD_CALCULATED_FIELD routes through the resolved pivot handle', async () => {
    const deps = createMockDeps();
    const addReceipt = {
      kind: 'pivotKernelMutation',
      pivotId: 'pivot-1',
      action: 'addCalculatedField',
    };
    const pivots = getPivotApi(deps);
    const handle = getPivotHandle(deps);
    handle.addCalculatedField.mockResolvedValueOnce(addReceipt);

    const result = await PivotHandlers.PIVOT_ADD_CALCULATED_FIELD(deps, {
      pivotName: 'Sales Pivot',
      field: { fieldId: 'Profit', name: 'Profit', formula: '=Revenue - Cost' },
    });

    expect(result).toEqual({ handled: true, receipts: [addReceipt] });
    expect(handle.addCalculatedField).toHaveBeenCalledWith({
      fieldId: 'Profit',
      name: 'Profit',
      formula: '=Revenue - Cost',
    });
    expect(handle.refresh).toHaveBeenCalled();
    expect(pivots).not.toHaveProperty('refreshById');
  });

  test('PIVOT actions are registered in HANDLER_MAP', () => {
    expect(isPivotHandlerRegistered('PIVOT_SET_SHOW_VALUES_AS')).toBe(true);
    expect(isPivotHandlerRegistered('PIVOT_SET_GRAND_TOTALS')).toBe(true);
    expect(isPivotHandlerRegistered('PIVOT_SET_DATA_SOURCE')).toBe(true);
    expect(isPivotHandlerRegistered('PIVOT_SET_FILTER')).toBe(true);
    expect(isPivotHandlerRegistered('PIVOT_ADD_CALCULATED_FIELD')).toBe(true);
  });
});
