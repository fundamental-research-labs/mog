import { DEFAULT_RESOLVED_SHEET_VIEW_SKIN } from '@mog-sdk/contracts/rendering';
import { jest } from '@jest/globals';
import { renderCellFill } from '../fills';
import type { CellRenderInfo } from '../types';

function context(): CanvasRenderingContext2D {
  return {
    fillStyle: '',
    fillRect: jest.fn(),
    createPattern: jest.fn(() => 'pattern'),
  } as unknown as CanvasRenderingContext2D;
}

const cell: CellRenderInfo = {
  row: 0,
  col: 0,
  x: 10,
  y: 20,
  width: 80,
  height: 24,
  value: null,
  format: undefined,
  displayText: '',
  isEditing: false,
};

describe('renderCellFill dark-mode defaults', () => {
  it('uses defaultCellBackground for merged-cell base paint', () => {
    const ctx = context();
    const skin = { ...DEFAULT_RESOLVED_SHEET_VIEW_SKIN, defaultCellBackground: '#15191d' };

    renderCellFill(
      ctx,
      {
        ...cell,
        merge: {
          originRow: 0,
          originCol: 0,
          mergeWidth: 80,
          mergeHeight: 24,
          mergeX: 10,
          mergeY: 20,
        },
      },
      undefined,
      {
        sheetViewSkin: skin,
      },
    );

    expect(ctx.fillStyle).toBe('#15191d');
    expect(ctx.fillRect).toHaveBeenCalledWith(10, 20, 80, 24);
  });
});
