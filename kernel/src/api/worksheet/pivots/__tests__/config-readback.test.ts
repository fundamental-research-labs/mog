import { sheetId } from '@mog-sdk/contracts/core';
import type {
  CalculatedFieldId,
  PivotFieldArea,
  PivotFieldPlacementFlat,
  PivotTableConfig as DataPivotTableConfig,
} from '@mog-sdk/contracts/pivot';

import { dataConfigToApiConfig } from '../config-conversion';
import { buildPivotTableHandle } from '../handle';

const SHEET_ID = sheetId('sheet-1');

function makePlacementId(
  area: PivotFieldArea,
  fieldId: string,
  position: number,
): NonNullable<PivotFieldPlacementFlat['placementId']> {
  return `${area}:${fieldId}:${position}` as NonNullable<PivotFieldPlacementFlat['placementId']>;
}

function makeConfig(): DataPivotTableConfig {
  return {
    id: 'pivot-1',
    name: 'SalesPivot',
    sourceSheetName: 'Sheet1',
    sourceRange: { startRow: 0, startCol: 0, endRow: 5, endCol: 2 },
    outputSheetName: 'Sheet1',
    outputLocation: { row: 0, col: 0 },
    fields: [
      { id: 'f_region', name: 'Region', dataType: 'string' },
      { id: 'f_product', name: 'Product', dataType: 'string' },
      { id: 'f_amount', name: 'Amount', dataType: 'number' },
    ],
    placements: [
      {
        placementId: makePlacementId('row', 'f_region', 0),
        fieldId: 'f_region',
        area: 'row',
        position: 0,
      },
      {
        placementId: makePlacementId('value', 'f_amount', 0),
        fieldId: 'f_amount',
        area: 'value',
        position: 0,
        aggregateFunction: 'sum',
        showValuesAs: { type: 'percentOfGrandTotal' },
      },
    ],
    filters: [{ fieldId: 'f_product', includeValues: ['Widget'] }],
    layout: { layoutForm: 'tabular' },
    style: { name: 'PivotStyleMedium2' },
    calculatedFields: [
      {
        fieldId: 'calc_margin',
        calculatedFieldId: 'calc_margin' as CalculatedFieldId,
        name: 'Margin',
        formula: '=Amount / 2',
      },
    ],
    preserveFormatting: true,
  };
}

describe('pivot config readback', () => {
  it('summarizes filters and value metadata from full data config', () => {
    expect(dataConfigToApiConfig(makeConfig(), 'Sheet1')).toEqual(
      expect.objectContaining({
        rowFields: ['Region'],
        valueFields: [
          expect.objectContaining({
            field: 'Amount',
            aggregation: 'sum',
            showValuesAs: { type: 'percentOfGrandTotal' },
          }),
        ],
        filterFields: ['Product'],
        preserveFormatting: true,
      }),
    );
  });

  it('handle.getConfig returns the full stored data config', () => {
    const config = makeConfig();
    const snapshots = new Map<string, DataPivotTableConfig>();
    const handle = buildPivotTableHandle({
      ctx: {} as any,
      sheetId: SHEET_ID,
      pivotConfig: config,
      sourceSheetName: 'Sheet1',
      toApiConfig: dataConfigToApiConfig,
      makePlacementId,
      pivotPlacementId: (id) => id as NonNullable<PivotFieldPlacementFlat['placementId']>,
      resolvePlacement: () => {
        throw new Error('resolvePlacement should not be called by getConfig');
      },
      placementId: (placement) =>
        placement.placementId ??
        makePlacementId(placement.area, placement.fieldId, placement.position),
      getRange: async () => null,
      getCollectionInfo: async () => ({
        name: 'SalesPivot',
        dataSource: 'Sheet1!A1:C6',
        contentArea: 'A1:C6',
      }),
      addCalculatedField: async () => {
        throw new Error('addCalculatedField should not be called by getConfig');
      },
      setDataSource: async () => undefined,
      snapshots: {
        get: (pivotId) => snapshots.get(pivotId),
        set: (next) => snapshots.set(next.id, next),
        markDeleted: (pivotId) => snapshots.delete(pivotId),
        require: (pivotId) => {
          const current = snapshots.get(pivotId);
          if (!current) throw new Error(`missing pivot ${pivotId}`);
          return current;
        },
        refresh: async (pivotId) => {
          const current = snapshots.get(pivotId);
          if (!current) throw new Error(`missing pivot ${pivotId}`);
          return current;
        },
      },
    });

    const readback = handle.getConfig();

    expect(readback).toEqual(expect.objectContaining(config));
    expect(readback).not.toBe(config);
    expect(readback).toEqual(
      expect.objectContaining({
        fields: config.fields,
        placements: config.placements,
        filters: config.filters,
        layout: config.layout,
        style: config.style,
        calculatedFields: config.calculatedFields,
        rowFields: ['Region'],
        valueFields: [
          expect.objectContaining({
            field: 'Amount',
            aggregation: 'sum',
            showValuesAs: { type: 'percentOfGrandTotal' },
          }),
        ],
        filterFields: ['Product'],
        dataSource: 'Sheet1!A1:C6',
      }),
    );
  });
});
