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
