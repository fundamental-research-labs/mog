import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import type { PivotHeader, PivotTableConfig, PivotTableResult } from '@mog-sdk/contracts/pivot';

import { queryPivotByName } from '../query';

const SHEET_ID = sheetId('sheet-1');

function header(fieldId: string, value: string, depth: number): PivotHeader {
  return {
    key: `T:${value.toLowerCase()}`,
    value,
    fieldId,
    depth,
    span: 1,
    isExpandable: depth === 0,
    isExpanded: true,
    isSubtotal: false,
    isGrandTotal: false,
  };
}

function makeConfig(): PivotTableConfig {
  return {
    id: 'pivot-1',
    name: 'SalesPivot',
    sourceSheetName: 'Sheet1',
    sourceRange: { startRow: 0, startCol: 0, endRow: 5, endCol: 2 },
    outputSheetName: 'Sheet1',
    outputLocation: { row: 0, col: 0 },
    fields: [
      { id: 'Region', name: 'Region', dataType: 'string' },
      { id: 'Product', name: 'Product', dataType: 'string' },
      { id: 'Amount', name: 'Amount', dataType: 'number' },
    ],
    placements: [
      { fieldId: 'Region', area: 'row', position: 0 },
      { fieldId: 'Product', area: 'row', position: 1 },
      { fieldId: 'Amount', area: 'value', position: 0, aggregateFunction: 'sum' },
    ],
    filters: [],
    calculatedFields: [],
  };
}

function makeResult(): PivotTableResult {
  return {
    columnHeaders: [],
    rows: [
      {
        key: 'T:east',
        headers: [header('Region', 'East', 0)],
        values: [300],
        depth: 0,
        isSubtotal: false,
        isGrandTotal: false,
      },
      {
        key: 'T:east\0T:widget',
        headers: [header('Region', 'East', 0), header('Product', 'Widget', 1)],
        values: [100],
        depth: 1,
        isSubtotal: false,
        isGrandTotal: false,
      },
      {
        key: 'T:east\0T:gadget',
        headers: [header('Region', 'East', 0), header('Product', 'Gadget', 1)],
        values: [200],
        depth: 1,
        isSubtotal: false,
        isGrandTotal: false,
      },
      {
        key: 'T:west',
        headers: [header('Region', 'West', 0)],
        values: [80],
        depth: 0,
        isSubtotal: false,
        isGrandTotal: false,
      },
      {
        key: 'T:west\0T:widget',
        headers: [header('Region', 'West', 0), header('Product', 'Widget', 1)],
        values: [80],
        depth: 1,
        isSubtotal: false,
        isGrandTotal: false,
      },
    ],
    renderedBounds: {
      totalRows: 6,
      totalCols: 1,
      firstDataRow: 1,
      firstDataCol: 0,
      numDataRows: 5,
      numDataCols: 1,
    },
    sourceRowCount: 3,
  };
}

describe('queryPivotByName', () => {
  it('excludes incomplete multi-level parent display rows', async () => {
    const config = makeConfig();
    const ctx = {
      pivot: {
        getAllPivots: jest.fn().mockResolvedValue([config]),
        compute: jest.fn().mockResolvedValue(makeResult()),
      },
    } as any;

    await expect(
      queryPivotByName({ ctx, sheetId: SHEET_ID, pivotName: 'SalesPivot' }),
    ).resolves.toEqual(
      expect.objectContaining({
        records: [
          { dimensions: { Region: 'East', Product: 'Widget' }, values: { 'Sum of Amount': 100 } },
          { dimensions: { Region: 'East', Product: 'Gadget' }, values: { 'Sum of Amount': 200 } },
          { dimensions: { Region: 'West', Product: 'Widget' }, values: { 'Sum of Amount': 80 } },
        ],
      }),
    );

    await expect(
      queryPivotByName({
        ctx,
        sheetId: SHEET_ID,
        pivotName: 'SalesPivot',
        filters: { Region: 'East' },
      }),
    ).resolves.toEqual(
      expect.objectContaining({
        records: [
          { dimensions: { Region: 'East', Product: 'Widget' }, values: { 'Sum of Amount': 100 } },
          { dimensions: { Region: 'East', Product: 'Gadget' }, values: { 'Sum of Amount': 200 } },
        ],
      }),
    );
  });

  it('uses explicit value placement display names as query value labels', async () => {
    const config = makeConfig();
    config.placements = config.placements.map((placement) =>
      placement.area === 'value'
        ? { ...placement, displayName: 'Sales % Row', showValuesAs: { type: 'percentOfRowTotal' } }
        : placement,
    );
    const ctx = {
      pivot: {
        getAllPivots: jest.fn().mockResolvedValue([config]),
        compute: jest.fn().mockResolvedValue(makeResult()),
      },
    } as any;

    await expect(
      queryPivotByName({ ctx, sheetId: SHEET_ID, pivotName: 'SalesPivot' }),
    ).resolves.toEqual(
      expect.objectContaining({
        valueFields: ['Sales % Row'],
        records: expect.arrayContaining([
          {
            dimensions: { Region: 'East', Product: 'Widget' },
            values: { 'Sales % Row': 100 },
          },
        ]),
      }),
    );
  });
});
