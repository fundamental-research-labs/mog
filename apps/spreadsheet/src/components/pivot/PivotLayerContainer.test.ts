import type { PivotFieldPlacementFlat, PivotTableConfig } from '@mog-sdk/contracts/pivot';

import type { PivotBounds } from '../../pivot/pivot-view-geometry';
import { getVisiblePivotReportFilterControls } from './PivotLayerContainer';

function placementId(id: string): PivotFieldPlacementFlat['placementId'] {
  return id as PivotFieldPlacementFlat['placementId'];
}

function reportFilterConfig(): PivotTableConfig {
  return {
    schemaVersion: 1,
    id: 'pivot-1',
    name: 'PivotTable1',
    sourceSheetName: 'Sheet1',
    sourceRange: { startRow: 0, startCol: 0, endRow: 20, endCol: 4 },
    outputSheetName: 'Sheet1',
    outputLocation: { row: 10, col: 2 },
    fields: [
      { id: 'Direction', name: 'Direction', sourceColumn: 0, dataType: 'string' },
      { id: 'Exclude?', name: 'Exclude?', sourceColumn: 1, dataType: 'string' },
      { id: 'Vendor', name: 'Vendor', sourceColumn: 2, dataType: 'string' },
      { id: 'Amount', name: 'Amount', sourceColumn: 3, dataType: 'number' },
    ],
    placements: [
      {
        placementId: placementId('filter:Direction:0'),
        fieldId: 'Direction',
        area: 'filter',
        position: 0,
      },
      {
        placementId: placementId('filter:Exclude:1'),
        fieldId: 'Exclude?',
        area: 'filter',
        position: 1,
      },
      { placementId: placementId('row:Vendor:0'), fieldId: 'Vendor', area: 'row', position: 0 },
      {
        placementId: placementId('value:Amount:0'),
        fieldId: 'Amount',
        area: 'value',
        position: 0,
        aggregateFunction: 'sum',
      },
    ],
    filters: [],
  };
}

describe('getVisiblePivotReportFilterControls', () => {
  const config = reportFilterConfig();
  const bounds: PivotBounds = { startRow: 10, startCol: 2, endRow: 20, endCol: 5 };
  const markerRect = { x: 100, y: 200, width: 320, height: 220 };

  it('lays report filter controls against their visible worksheet rows', () => {
    const controls = getVisiblePivotReportFilterControls(config, bounds, markerRect, (cell) => {
      if (cell.row === 10 && cell.col === 2) {
        return { x: 100, y: 200, width: 80, height: 20 };
      }
      if (cell.row === 11 && cell.col === 2) {
        return { x: 100, y: 222, width: 80, height: 20 };
      }
      return null;
    });

    expect(controls).toEqual([
      expect.objectContaining({
        fieldId: 'Direction',
        label: 'Direction',
        row: 10,
        rect: { x: 0, y: 0, width: 80, height: 20 },
      }),
      expect.objectContaining({
        fieldId: 'Exclude?',
        label: 'Exclude?',
        row: 11,
        rect: { x: 0, y: 22, width: 80, height: 20 },
      }),
    ]);
  });

  it('omits controls whose worksheet rows have scrolled out of view', () => {
    const controls = getVisiblePivotReportFilterControls(config, bounds, markerRect, (cell) => {
      if (cell.row === 11 && cell.col === 2) {
        return { x: 100, y: 8, width: 80, height: 20 };
      }
      return null;
    });

    expect(controls).toHaveLength(1);
    expect(controls[0]).toEqual(
      expect.objectContaining({
        fieldId: 'Exclude?',
        row: 11,
        rect: { x: 0, y: -192, width: 80, height: 20 },
      }),
    );
  });

  it('returns no controls when all report-filter rows are offscreen', () => {
    expect(getVisiblePivotReportFilterControls(config, bounds, markerRect, () => null)).toEqual([]);
  });
});
