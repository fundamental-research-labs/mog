import { jest } from '@jest/globals';

import { renderCenterContinuousText } from '../alignment';
import { OFFICE_THEME } from '../../shared/theme-constants';

function createContext(): CanvasRenderingContext2D {
  return {
    save: jest.fn(),
    restore: jest.fn(),
    beginPath: jest.fn(),
    rect: jest.fn(),
    clip: jest.fn(),
    fillText: jest.fn(),
    font: '',
    textBaseline: 'alphabetic',
    textAlign: 'left',
    fillStyle: '#000000',
  } as unknown as CanvasRenderingContext2D;
}

describe('renderCenterContinuousText', () => {
  it('does not claim blanks owned by a non-empty source on the left', () => {
    const ctx = createContext();
    const result = renderCenterContinuousText(
      ctx,
      'C source',
      0,
      2,
      200,
      0,
      100,
      20,
      { horizontalAlign: 'centerContinuous' },
      OFFICE_THEME,
      {
        positionIndex: { getColWidth: () => 100 } as any,
        totalCols: 4,
        isCellEmpty: (_row, col) => col !== 0,
        peekFormat: () => ({ horizontalAlign: 'centerContinuous' }),
      },
    );

    expect(result).toEqual({ extendedStartCol: 2, extendedEndCol: 3 });
    expect(ctx.fillText).toHaveBeenCalledWith('C source', 300, expect.any(Number));
  });

  it('clips text to the computed center-across span rectangle', () => {
    const ctx = createContext();
    renderCenterContinuousText(
      ctx,
      'Header',
      0,
      0,
      0,
      0,
      100,
      20,
      { horizontalAlign: 'centerContinuous' },
      OFFICE_THEME,
      {
        positionIndex: { getColWidth: () => 100 } as any,
        totalCols: 4,
        isCellEmpty: (_row, col) => col !== 0,
        peekFormat: () => ({ horizontalAlign: 'centerContinuous' }),
      },
    );

    expect(ctx.rect).toHaveBeenCalledWith(0, 0, 400, 20);
    expect(ctx.clip).toHaveBeenCalledTimes(1);
    expect(ctx.fillText).toHaveBeenCalledWith('Header', 200, expect.any(Number));
  });
});
