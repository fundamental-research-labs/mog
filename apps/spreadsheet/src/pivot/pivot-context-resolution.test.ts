import type { PlacementId, PivotTableConfig, PivotTableResult } from '@mog-sdk/contracts/pivot';

import { resolvePivotContextAtCell } from './pivot-context-resolution';

const rowPlacementId = 'row:PO_Number:0' as PlacementId;
const valuePlacementId = 'value:Total:0' as PlacementId;
const columnPlacementId = 'column:Quarter:0' as PlacementId;

function config(): PivotTableConfig {
  return {
    schemaVersion: 2,
    id: 'pivot-purchase-orders',
    name: 'Purchase Orders Pivot',
    sourceSheetName: 'Purchase Orders',
    sourceRange: { startRow: 0, startCol: 0, endRow: 10, endCol: 9 },
    outputSheetName: 'Purchase Orders',
    outputLocation: { row: 0, col: 11 },
    fields: [
      { id: 'PO_Number', name: 'PO_Number', sourceColumn: 0, dataType: 'string' },
      { id: 'Total', name: 'Total', sourceColumn: 8, dataType: 'number' },
    ],
    placements: [
      {
        placementId: rowPlacementId,
        fieldId: 'PO_Number',
        area: 'row',
        position: 0,
      },
      {
        placementId: valuePlacementId,
        fieldId: 'Total',
        area: 'value',
        position: 0,
        aggregateFunction: 'sum',
      },
    ],
    filters: [],
  };
}

function result(): PivotTableResult {
  return {
    columnHeaders: [],
    rows: [
      {
        key: 'AD-10001',
        headers: [
          {
            key: 'AD-10001',
            value: 'AD-10001',
            fieldId: 'PO_Number',
            axisPlacementId: rowPlacementId,
            depth: 0,
            span: 1,
            isExpandable: false,
            isExpanded: true,
            isSubtotal: false,
            isGrandTotal: false,
          },
        ],
        values: [123],
        depth: 0,
        isSubtotal: false,
        isGrandTotal: false,
      },
    ],
    grandTotals: {},
    sourceRowCount: 10,
    renderedBounds: {
      totalRows: 2,
      totalCols: 2,
      firstDataRow: 1,
      firstDataCol: 1,
      numDataCols: 1,
    },
  };
}

function columnConfig(): PivotTableConfig {
  return {
    schemaVersion: 2,
    id: 'pivot-quarterly',
    name: 'Quarterly Pivot',
    sourceSheetName: 'Data',
    sourceRange: { startRow: 0, startCol: 0, endRow: 10, endCol: 3 },
    outputSheetName: 'Sheet1',
    outputLocation: { row: 4, col: 2 },
    fields: [
      { id: 'Quarter', name: 'Quarter', sourceColumn: 0, dataType: 'string' },
      { id: 'Total', name: 'Total', sourceColumn: 1, dataType: 'number' },
    ],
    placements: [
      {
        placementId: columnPlacementId,
        fieldId: 'Quarter',
        area: 'column',
        position: 0,
      },
      {
        placementId: valuePlacementId,
        fieldId: 'Total',
        area: 'value',
        position: 0,
        aggregateFunction: 'sum',
      },
    ],
    filters: [],
  };
}

function columnResult(): PivotTableResult {
  return {
    columnHeaders: [
      {
        fieldId: 'Quarter',
        headers: [
          {
            key: 'Q1',
            value: 'Q1',
            fieldId: 'Quarter',
            axisPlacementId: columnPlacementId,
            depth: 0,
            span: 1,
            isExpandable: false,
            isExpanded: true,
            isSubtotal: false,
            isGrandTotal: false,
          },
          {
            key: 'Q2',
            value: 'Q2',
            fieldId: 'Quarter',
            axisPlacementId: columnPlacementId,
            depth: 0,
            span: 1,
            isExpandable: false,
            isExpanded: true,
            isSubtotal: false,
            isGrandTotal: false,
          },
        ],
      },
    ],
    rows: [],
    grandTotals: {},
    sourceRowCount: 10,
    renderedBounds: {
      totalRows: 2,
      totalCols: 2,
      firstDataRow: 1,
      firstDataCol: 0,
      numDataCols: 2,
    },
  };
}

describe('resolvePivotContextAtCell', () => {
  it('resolves row field header cells to row placement context', () => {
    const context = resolvePivotContextAtCell({ config: config(), result: result() }, 0, 11);

    expect(context).toEqual({
      target: 'pivot-row-header',
      pivotId: 'pivot-purchase-orders',
      pivotFieldId: 'PO_Number',
      pivotPlacementId: rowPlacementId,
      pivotFieldArea: 'row',
    });
  });

  it('resolves row-label body cells to the row placement sort context', () => {
    const context = resolvePivotContextAtCell({ config: config(), result: result() }, 1, 11);

    expect(context).toEqual({
      target: 'pivot-row-header',
      pivotId: 'pivot-purchase-orders',
      pivotHeaderKey: 'AD-10001',
      pivotFieldId: 'PO_Number',
      pivotPlacementId: rowPlacementId,
      pivotFieldArea: 'row',
    });
  });

  it('resolves value cells to the value placement context', () => {
    const context = resolvePivotContextAtCell({ config: config(), result: result() }, 1, 12);

    expect(context).toEqual({
      target: 'pivot-value',
      pivotId: 'pivot-purchase-orders',
      pivotFieldId: 'Total',
      pivotPlacementId: valuePlacementId,
      pivotFieldArea: 'value',
    });
  });

  it('resolves column header member cells to column placement context', () => {
    const context = resolvePivotContextAtCell(
      { config: columnConfig(), result: columnResult() },
      4,
      3,
    );

    expect(context).toEqual({
      target: 'pivot-column-header',
      pivotId: 'pivot-quarterly',
      pivotHeaderKey: 'Q2',
      pivotFieldId: 'Quarter',
      pivotPlacementId: columnPlacementId,
      pivotFieldArea: 'column',
    });
  });
});
