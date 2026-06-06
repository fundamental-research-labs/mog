import { jest } from '@jest/globals';

import {
  resolveSelectionBorderDoubleClickTarget,
  type SelectionBorderWorksheet,
} from '../selection-border-double-click';

function worksheet(options: {
  target: { row: number; col: number };
  boundaryCell?: { value?: unknown; formula?: unknown; formatted?: unknown } | null;
}): SelectionBorderWorksheet {
  return {
    findDataEdge: jest.fn(async () => options.target),
    getCell: jest.fn(async () => options.boundaryCell ?? { value: null }),
  };
}

describe('resolveSelectionBorderDoubleClickTarget', () => {
  const bounds = { maxRows: 100, maxCols: 50 };

  it('uses data-edge navigation for selected-border right double-click with data', async () => {
    const ws = worksheet({ target: { row: 0, col: 4 } });

    await expect(
      resolveSelectionBorderDoubleClickTarget(ws, { row: 0, col: 0 }, 'right', bounds),
    ).resolves.toEqual({ row: 0, col: 4 });

    expect(ws.findDataEdge).toHaveBeenCalledWith(0, 0, 'right');
  });

  it('suppresses empty-region right double-clicks that only reach the sheet terminal column', async () => {
    const ws = worksheet({ target: { row: 9, col: 49 }, boundaryCell: { value: null } });

    await expect(
      resolveSelectionBorderDoubleClickTarget(ws, { row: 9, col: 3 }, 'right', bounds),
    ).resolves.toBeNull();
  });

  it('does not suppress terminal right targets that contain authored formula content', async () => {
    const ws = worksheet({
      target: { row: 9, col: 49 },
      boundaryCell: { value: '', formula: '=IF(FALSE,1,"")' },
    });

    await expect(
      resolveSelectionBorderDoubleClickTarget(ws, { row: 9, col: 3 }, 'right', bounds),
    ).resolves.toEqual({ row: 9, col: 49 });
  });

  it('preserves top and left sheet-boundary jumps for empty regions', async () => {
    const topWs = worksheet({ target: { row: 0, col: 3 }, boundaryCell: { value: null } });
    const leftWs = worksheet({ target: { row: 9, col: 0 }, boundaryCell: { value: null } });

    await expect(
      resolveSelectionBorderDoubleClickTarget(topWs, { row: 9, col: 3 }, 'up', bounds),
    ).resolves.toEqual({ row: 0, col: 3 });
    await expect(
      resolveSelectionBorderDoubleClickTarget(leftWs, { row: 9, col: 3 }, 'left', bounds),
    ).resolves.toEqual({ row: 9, col: 0 });
  });
});
