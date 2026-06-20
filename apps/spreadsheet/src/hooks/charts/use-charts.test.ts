import type { WorksheetInternalChart } from '@mog-sdk/contracts/api';

import { __testing__ } from './use-charts';

function chart(overrides: Partial<WorksheetInternalChart> = {}): WorksheetInternalChart {
  return {
    id: 'chart-1',
    sheetId: 'sheet-1',
    type: 'bar',
    anchorRow: 0,
    anchorCol: 0,
    width: 480,
    height: 225,
    dataRange: 'A1:B2',
    seriesOrientation: 'columns',
    ...overrides,
  } as WorksheetInternalChart;
}

describe('useCharts cache predicates', () => {
  it('allows definition reuse when only position metadata changes', () => {
    expect(
      __testing__.isOnlyPositionChange(
        chart({ updatedAt: 1, anchorCellId: 'cell-a' as WorksheetInternalChart['anchorCellId'] }),
        chart({
          anchorRow: 4,
          anchorCol: 3,
          updatedAt: 2,
          anchorCellId: 'cell-b' as WorksheetInternalChart['anchorCellId'],
        }),
      ),
    ).toBe(true);
  });

  it('rejects definition reuse when content changes with a move', () => {
    expect(
      __testing__.isOnlyPositionChange(
        chart({ seriesOrientation: 'columns' }),
        chart({ anchorRow: 4, anchorCol: 3, seriesOrientation: 'rows' }),
      ),
    ).toBe(false);
  });
});
