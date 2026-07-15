import { jest } from '@jest/globals';

import type { CellBorders } from '@mog-sdk/contracts/core';

import { renderBorders } from '../borders';
import type { CellRenderInfo } from '../types';

function renderDiagonal(borders: CellBorders): CanvasRenderingContext2D {
  const context = {
    beginPath: jest.fn(),
    lineTo: jest.fn(),
    moveTo: jest.fn(),
    setLineDash: jest.fn(),
    stroke: jest.fn(),
    strokeStyle: '',
    lineWidth: 1,
  } as unknown as CanvasRenderingContext2D;
  const cell: CellRenderInfo = {
    row: 0,
    col: 0,
    x: 10,
    y: 20,
    width: 30,
    height: 40,
    value: null,
    format: { borders },
    displayText: '',
    isEditing: false,
  };

  renderBorders(context, cell, 1);
  return context;
}

describe('diagonal border rendering', () => {
  test('canonical diagonal flags select the persisted directions', () => {
    const context = renderDiagonal({
      diagonal: { style: 'thin', color: '#123456' },
      diagonalUp: true,
      diagonalDown: false,
    });

    expect(context.moveTo).toHaveBeenCalledTimes(1);
    expect(context.moveTo).toHaveBeenCalledWith(10, 60);
    expect(context.lineTo).toHaveBeenCalledWith(40, 20);
  });

  test('legacy direction remains a read-compatible fallback', () => {
    const context = renderDiagonal({
      diagonal: { style: 'thin', color: '#123456', direction: 'down' },
    });

    expect(context.moveTo).toHaveBeenCalledTimes(1);
    expect(context.moveTo).toHaveBeenCalledWith(10, 20);
    expect(context.lineTo).toHaveBeenCalledWith(40, 60);
  });
});
