import { jest } from '@jest/globals';
import { sheetId } from '@mog-sdk/contracts/core';
import type { PivotTableConfig } from '@mog-sdk/contracts/pivot';
import {
  addPivotCalculatedFieldToId,
  removePivotCalculatedFieldByName,
} from '../calculated-fields';

const SHEET_ID = sheetId('sheet-1');

function makeConfig(overrides?: Partial<PivotTableConfig>): PivotTableConfig {
  return {
    id: 'pivot-1',
    name: 'SalesPivot',
    sourceSheetName: 'Sheet1',
    sourceRange: { startRow: 0, startCol: 0, endRow: 10, endCol: 2 },
    fields: [
      { id: 'Region', name: 'Region', dataType: 'string' },
      { id: 'Amount', name: 'Amount', dataType: 'number' },
    ],
    placements: [
      { fieldId: 'Region', area: 'row', position: 0 },
      { fieldId: 'Amount', area: 'value', position: 0, aggregateFunction: 'sum' },
    ],
    filters: [],
    calculatedFields: [],
    outputLocation: { row: 0, col: 0 },
    ...overrides,
  };
}

function makeCtx(config: PivotTableConfig): any {
  return {
    pivot: {
      getPivot: jest.fn().mockResolvedValue(config),
      getAllPivots: jest.fn().mockResolvedValue([config]),
      updatePivot: jest.fn(async (_sheetId, _pivotId, updates) => ({
        ...config,
        ...updates,
      })),
    },
  };
}

describe('pivot calculated fields', () => {
  it('stores display formulas and creates a calculated value placement', async () => {
    const ctx = makeCtx(makeConfig());

    const receipt = await addPivotCalculatedFieldToId({
      ctx,
      sheetId: SHEET_ID,
      pivotId: 'pivot-1',
      field: {
        fieldId: 'CalcMargin',
        calculatedFieldId: 'CalcMargin' as any,
        name: 'Margin',
        formula: '=Amount / 2',
      },
    });

    const updates = ctx.pivot.updatePivot.mock.calls[0][2];
    expect(updates.calculatedFields).toEqual([
      expect.objectContaining({
        fieldId: 'CalcMargin',
        calculatedFieldId: 'CalcMargin',
        name: 'Margin',
        formula: '=Amount / 2',
      }),
    ]);
    expect(updates.placements).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          fieldId: 'CalcMargin',
          calculatedFieldId: 'CalcMargin',
          area: 'value',
          aggregateFunction: 'sum',
          displayName: 'Margin',
        }),
      ]),
    );
    expect(receipt.effects).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ type: 'calculatedFieldAdded', calculatedFieldId: 'CalcMargin' }),
        expect.objectContaining({ type: 'placementAdded', placementId: 'value:CalcMargin:1' }),
      ]),
    );
  });

  it('removes the calculated value placement with the calculated field', async () => {
    const ctx = makeCtx(
      makeConfig({
        calculatedFields: [
          {
            fieldId: 'CalcMargin',
            calculatedFieldId: 'CalcMargin' as any,
            name: 'Margin',
            formula: '=Amount / 2',
          },
        ],
        placements: [
          { fieldId: 'Region', area: 'row', position: 0 },
          { fieldId: 'Amount', area: 'value', position: 0, aggregateFunction: 'sum' },
          {
            fieldId: 'CalcMargin',
            calculatedFieldId: 'CalcMargin' as any,
            area: 'value',
            position: 1,
            aggregateFunction: 'sum',
            displayName: 'Margin',
          },
        ],
      }),
    );

    await removePivotCalculatedFieldByName({
      ctx,
      sheetId: SHEET_ID,
      pivotName: 'SalesPivot',
      fieldId: 'CalcMargin',
    });

    const updates = ctx.pivot.updatePivot.mock.calls[0][2];
    expect(updates.calculatedFields).toEqual([]);
    expect(updates.placements).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ fieldId: 'CalcMargin', area: 'value' }),
      ]),
    );
  });
});
