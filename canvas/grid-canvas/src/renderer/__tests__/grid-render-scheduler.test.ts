import { jest } from '@jest/globals';

import type { CanvasEngine, DirtyCellExpander } from '@mog/canvas-engine';
import type { ViewportPositionIndex } from '@mog/grid-renderer';

import { GridRenderScheduler } from '../grid-render-scheduler';

function createEngine(): CanvasEngine {
  return {
    markDirty: jest.fn(),
    requestFrame: jest.fn(),
  } as unknown as CanvasEngine;
}

function createPositionIndex(): ViewportPositionIndex {
  return {
    getColLeft: jest.fn((col: number) => col * 64),
    getRowTop: jest.fn((row: number) => row * 20),
    getColWidth: jest.fn(() => 64),
    getRowHeight: jest.fn(() => 20),
  } as unknown as ViewportPositionIndex;
}

describe('GridRenderScheduler', () => {
  it('falls back to full cell-layer dirty for very large cell batches', () => {
    const engine = createEngine();
    const scheduler = new GridRenderScheduler(engine);
    const expander: DirtyCellExpander = {
      expandDirtyCells: jest.fn((cells) => cells),
    };
    const cells = Array.from({ length: 10_001 }, (_value, index) => ({
      row: Math.floor(index / 100),
      col: index % 100,
    }));

    scheduler.setPositionIndex(createPositionIndex());
    scheduler.setCellExpander(expander);
    scheduler.markCellsDirty(cells);

    expect(expander.expandDirtyCells).not.toHaveBeenCalled();
    expect(engine.markDirty).toHaveBeenCalledTimes(1);
    expect(engine.markDirty).toHaveBeenCalledWith('cells');
    expect(engine.requestFrame).toHaveBeenCalledTimes(1);
  });
});
