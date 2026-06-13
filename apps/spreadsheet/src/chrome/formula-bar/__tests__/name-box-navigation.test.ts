import { createNameBoxRangeSelection } from '../name-box-navigation';

describe('createNameBoxRangeSelection', () => {
  it('anchors range navigation at the range start so viewport-follow can reveal the far edge', () => {
    expect(
      createNameBoxRangeSelection({
        startRow: 4,
        startCol: 2,
        endRow: 4,
        endCol: 15,
      }),
    ).toEqual({
      range: { startRow: 4, startCol: 2, endRow: 4, endCol: 15 },
      activeCell: { row: 4, col: 2 },
      anchor: { row: 4, col: 2 },
      viewportFollowCell: { row: 4, col: 15 },
    });
  });

  it('keeps single-cell navigation follow aligned with the active cell', () => {
    expect(
      createNameBoxRangeSelection({
        startRow: 12,
        startCol: 6,
        endRow: 12,
        endCol: 6,
      }),
    ).toEqual({
      range: { startRow: 12, startCol: 6, endRow: 12, endCol: 6 },
      activeCell: { row: 12, col: 6 },
      anchor: { row: 12, col: 6 },
      viewportFollowCell: { row: 12, col: 6 },
    });
  });

  it('preserves parsed full-row and full-column range flags', () => {
    expect(
      createNameBoxRangeSelection({
        startRow: 0,
        startCol: 2,
        endRow: 9,
        endCol: 2,
        isFullColumn: true,
      }).range,
    ).toEqual({
      startRow: 0,
      startCol: 2,
      endRow: 9,
      endCol: 2,
      isFullColumn: true,
    });

    expect(
      createNameBoxRangeSelection({
        startRow: 4,
        startCol: 0,
        endRow: 4,
        endCol: 9,
        isFullRow: true,
      }).range,
    ).toEqual({
      startRow: 4,
      startCol: 0,
      endRow: 4,
      endCol: 9,
      isFullRow: true,
    });
  });
});
