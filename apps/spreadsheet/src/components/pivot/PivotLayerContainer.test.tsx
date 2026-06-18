import type { PivotTableConfig, PivotRenderedBounds } from '@mog-sdk/contracts/pivot';

import { getVisiblePivotFieldHeaderControls } from './pivot-layer-layout';

function baseConfig(placements: PivotTableConfig['placements']): PivotTableConfig {
  return {
    schemaVersion: 1,
    id: 'pivot-1',
    name: 'PivotTable1',
    sourceSheetName: 'Source',
    sourceRange: { startRow: 0, startCol: 0, endRow: 10, endCol: 2 },
    outputSheetName: 'Sheet1',
    outputLocation: { row: 0, col: 11 },
    fields: [
      { id: 'PO_Number', name: 'PO_Number', sourceColumn: 0, dataType: 'string' },
      { id: 'Vendor', name: 'Vendor', sourceColumn: 1, dataType: 'string' },
    ],
    placements,
    filters: [],
  };
}

const markerRect = { x: 100, y: 50, width: 240, height: 120 };
const cellRect = ({ row, col }: { row: number; col: number }) => ({
  x: 100 + (col - 11) * 80,
  y: 50 + row * 24,
  width: 80,
  height: 24,
});

describe('getVisiblePivotFieldHeaderControls', () => {
  it('anchors a row field control to the rendered row header cell', () => {
    const config = baseConfig([
      {
        placementId: 'row:PO_Number:0' as PivotTableConfig['placements'][number]['placementId'],
        fieldId: 'PO_Number',
        area: 'row',
        position: 0,
      },
    ]);
    const renderedBounds: PivotRenderedBounds = {
      totalRows: 4,
      totalCols: 1,
      firstDataRow: 1,
      firstDataCol: 0,
      numDataCols: 0,
    };

    expect(
      getVisiblePivotFieldHeaderControls(
        config,
        { startRow: 0, startCol: 11, endRow: 3, endCol: 11 },
        markerRect,
        cellRect,
        renderedBounds,
      ),
    ).toEqual([
      {
        placementId: 'row:PO_Number:0',
        fieldId: 'PO_Number',
        area: 'row',
        label: 'PO_Number',
        row: 0,
        col: 11,
        rect: { x: 0, y: 0, width: 80, height: 24 },
      },
    ]);
  });

  it('anchors column field controls above the data area', () => {
    const config = baseConfig([
      {
        placementId: 'column:Vendor:0' as PivotTableConfig['placements'][number]['placementId'],
        fieldId: 'Vendor',
        area: 'column',
        position: 0,
      },
    ]);
    const renderedBounds: PivotRenderedBounds = {
      totalRows: 5,
      totalCols: 3,
      firstDataRow: 1,
      firstDataCol: 1,
      numDataCols: 2,
    };

    expect(
      getVisiblePivotFieldHeaderControls(
        config,
        { startRow: 0, startCol: 11, endRow: 4, endCol: 13 },
        markerRect,
        cellRect,
        renderedBounds,
      ),
    ).toEqual([
      {
        placementId: 'column:Vendor:0',
        fieldId: 'Vendor',
        area: 'column',
        label: 'Vendor',
        row: 0,
        col: 12,
        rect: { x: 80, y: 0, width: 80, height: 24 },
      },
    ]);
  });
});
