/**
 * Integration Test: Merged Cell Navigation
 *
 * Verifies that plain arrow navigation routes merged-cell movement through the
 * selection machine's `getMergedRegionAt` callback and skips merged interiors.
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

describe('Arrow navigation skips merged regions', () => {
  it('ArrowDown skips to the row after a vertical merge', () => {
    sim = createIntegrationSimulator({
      merges: [{ startRow: 3, startCol: 0, endRow: 4, endCol: 1 }],
      activeCell: { row: 2, col: 0 },
    });

    sim.pressKey('ArrowDown');

    expectSingleCell(5, 0);
  });

  it('ArrowRight skips to the column after a horizontal merge', () => {
    sim = createIntegrationSimulator({
      merges: [{ startRow: 1, startCol: 2, endRow: 2, endCol: 3 }],
      activeCell: { row: 1, col: 1 },
    });

    sim.pressKey('ArrowRight');

    expectSingleCell(1, 4);
  });

  it('ArrowDown from above a merge skips to the first unmerged row after it', () => {
    sim = createIntegrationSimulator({
      merges: [{ startRow: 1, startCol: 1, endRow: 2, endCol: 2 }],
      activeCell: { row: 0, col: 0 },
    });

    sim.pressKey('ArrowRight');
    expectSingleCell(0, 1);

    sim.pressKey('ArrowDown');
    expectSingleCell(3, 1);
  });
});
