/**
 * Integration Test: Merged Cell Edge Cases
 *
 * These tests exercise the production navigation contract: the selection
 * machine receives `getMergedRegionAt` through SET_LAYOUT_CALLBACKS and treats
 * merged regions as single stops for plain active-cell arrows and single
 * obstacles for Tab/Shift+Arrow movement. Ctrl+Arrow data navigation can still
 * land on a merge origin because merged cells are data blocks.
 */

import { createIntegrationSimulator, type IntegrationSimulator } from '../../integration-simulator';

let sim: IntegrationSimulator;

afterEach(() => {
  sim?.destroy();
});

function expectSingleCell(row: number, col: number): void {
  expect(sim.activeCell()).toEqual({ row, col });
  expect(sim.selectionRanges()).toEqual([
    {
      startRow: row,
      startCol: col,
      endRow: row,
      endCol: col,
    },
  ]);
}

describe('Arrow navigation around merged regions', () => {
  it('ArrowLeft enters the adjacent merge before exiting through the boundary merge', () => {
    sim = createIntegrationSimulator({
      merges: [
        { startRow: 0, startCol: 0, endRow: 1, endCol: 1 },
        { startRow: 0, startCol: 2, endRow: 1, endCol: 3 },
      ],
      activeCell: { row: 0, col: 4 },
    });

    sim.pressKey('ArrowLeft');
    expectSingleCell(0, 2);

    sim.pressKey('ArrowLeft');
    expectSingleCell(0, 0);
  });

  it('ArrowUp into a boundary merge enters and remains at the merge origin', () => {
    sim = createIntegrationSimulator({
      merges: [{ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }],
      activeCell: { row: 2, col: 0 },
    });

    sim.pressKey('ArrowUp');

    expectSingleCell(0, 0);

    sim.pressKey('ArrowUp');
    expectSingleCell(0, 0);
  });

  it('ArrowDown enters a merged region then exits past it', () => {
    sim = createIntegrationSimulator({
      merges: [{ startRow: 2, startCol: 0, endRow: 3, endCol: 1 }],
      activeCell: { row: 1, col: 0 },
    });

    sim.pressKey('ArrowDown');
    expectSingleCell(2, 0);

    sim.pressKey('ArrowDown');
    expectSingleCell(4, 0);
  });

  it('ArrowRight enters a merged region then exits past it', () => {
    sim = createIntegrationSimulator({
      merges: [{ startRow: 1, startCol: 2, endRow: 2, endCol: 3 }],
      activeCell: { row: 1, col: 1 },
    });

    sim.pressKey('ArrowRight');
    expectSingleCell(1, 2);

    sim.pressKey('ArrowRight');
    expectSingleCell(1, 4);
  });

  it('ArrowLeft at column-zero merge remains at the merge origin', () => {
    sim = createIntegrationSimulator({
      merges: [{ startRow: 0, startCol: 0, endRow: 2, endCol: 0 }],
      activeCell: { row: 0, col: 0 },
    });

    sim.pressKey('ArrowLeft');

    expectSingleCell(0, 0);
  });
});

describe('Shift+Arrow through merged regions', () => {
  it('Shift+Down extends past the full merged region', () => {
    sim = createIntegrationSimulator({
      merges: [{ startRow: 2, startCol: 0, endRow: 3, endCol: 1 }],
      activeCell: { row: 0, col: 0 },
    });

    sim.pressKey('ArrowDown', { shift: true });
    expect(sim.selectionRanges()[0]).toMatchObject({
      startRow: 0,
      startCol: 0,
      endRow: 1,
      endCol: 0,
    });

    sim.pressKey('ArrowDown', { shift: true });
    expect(sim.selectionRanges()[0]).toMatchObject({
      startRow: 0,
      startCol: 0,
      endRow: 4,
      endCol: 0,
    });
  });

  it('Shift+Right extends past the full merged region', () => {
    sim = createIntegrationSimulator({
      merges: [{ startRow: 0, startCol: 2, endRow: 1, endCol: 3 }],
      activeCell: { row: 0, col: 0 },
    });

    sim.pressKey('ArrowRight', { shift: true });
    sim.pressKey('ArrowRight', { shift: true });

    expect(sim.selectionRanges()[0]).toMatchObject({
      startRow: 0,
      startCol: 0,
      endRow: 0,
      endCol: 4,
    });
  });

  it('plain ArrowDown after extending back out of a merge steps from active cell', () => {
    sim = createIntegrationSimulator({
      merges: [{ startRow: 2, startCol: 0, endRow: 3, endCol: 1 }],
      activeCell: { row: 0, col: 0 },
    });

    sim.pressKey('ArrowDown', { shift: true });
    sim.pressKey('ArrowDown', { shift: true });
    sim.pressKey('ArrowUp', { shift: true });
    sim.pressKey('ArrowDown');

    expectSingleCell(1, 0);
  });
});

describe('Tab navigation with merged regions', () => {
  it('Tab skips a horizontal merge as a single stop', () => {
    sim = createIntegrationSimulator({
      cells: {
        '0,0': 'A1',
        '0,1': 'B1C1',
        '0,3': 'D1',
      },
      merges: [{ startRow: 0, startCol: 1, endRow: 0, endCol: 2 }],
      activeCell: { row: 0, col: 0 },
    });

    sim.pressKey('Tab');

    expectSingleCell(0, 3);
  });

  it('Tab continues normally after skipping a merge', () => {
    sim = createIntegrationSimulator({
      cells: {
        '0,0': 'A1',
        '0,1': 'B1C1',
        '0,3': 'D1',
      },
      merges: [{ startRow: 0, startCol: 1, endRow: 0, endCol: 2 }],
      activeCell: { row: 0, col: 0 },
    });

    sim.pressKey('Tab');
    sim.pressKey('Tab');

    expectSingleCell(0, 4);
  });
});

describe('Ctrl+Arrow with merged cells as data blocks', () => {
  it('Ctrl+Down lands on a merge origin when the merge contains data', async () => {
    sim = createIntegrationSimulator({
      cells: {
        '0,0': 'top',
        '2,0': 'merged-data',
        '5,0': 'bottom',
      },
      merges: [{ startRow: 2, startCol: 0, endRow: 3, endCol: 1 }],
      activeCell: { row: 0, col: 0 },
    });

    await sim.pressKey('ArrowDown', { ctrl: true });

    expectSingleCell(2, 0);
  });

  it('Ctrl+Down from a merge origin exits to the next data block', async () => {
    sim = createIntegrationSimulator({
      cells: {
        '0,0': 'merged-data',
        '4,0': 'next-block',
      },
      merges: [{ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }],
      activeCell: { row: 0, col: 0 },
    });

    await sim.pressKey('ArrowDown', { ctrl: true });

    expectSingleCell(4, 0);
  });

  it('Ctrl+Right lands on a horizontal merge origin when it contains data', async () => {
    sim = createIntegrationSimulator({
      cells: {
        '0,0': 'left',
        '0,2': 'merged',
        '0,5': 'right',
      },
      merges: [{ startRow: 0, startCol: 2, endRow: 0, endCol: 3 }],
      activeCell: { row: 0, col: 0 },
    });

    await sim.pressKey('ArrowRight', { ctrl: true });

    expectSingleCell(0, 2);
  });
});
