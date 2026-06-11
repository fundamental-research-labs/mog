import { jest } from '@jest/globals';

const parseCellRange = jest.fn();
const parseCellAddress = jest.fn();

jest.unstable_mockModule('@mog-sdk/kernel', () => ({
  parseCellAddress,
  parseCellRange,
}));

const { parseNameBoxReference } = await import('../name-box-navigation');

describe('parseNameBoxReference', () => {
  beforeEach(() => {
    parseCellRange.mockReset();
    parseCellAddress.mockReset();
  });

  it('resolves single-cell references without name lookup', () => {
    parseCellRange.mockReturnValueOnce(null);
    parseCellAddress.mockReturnValueOnce({
      row: 1,
      col: 1,
      sheetName: undefined,
    });

    expect(parseNameBoxReference('B2')).toEqual({
      range: { startRow: 1, startCol: 1, endRow: 1, endCol: 1 },
      activeCell: { row: 1, col: 1 },
      sheetName: undefined,
    });
    expect(parseCellRange).toHaveBeenCalledWith('B2');
    expect(parseCellAddress).toHaveBeenCalledWith('B2');
  });

  it('resolves ranges with the first cell active', () => {
    parseCellRange.mockReturnValueOnce({
      startRow: 2,
      startCol: 2,
      endRow: 3,
      endCol: 3,
      sheetName: undefined,
    });

    expect(parseNameBoxReference('C3:D4')).toEqual({
      range: { startRow: 2, startCol: 2, endRow: 3, endCol: 3 },
      activeCell: { row: 2, col: 2 },
      sheetName: undefined,
    });
    expect(parseCellRange).toHaveBeenCalledWith('C3:D4');
    expect(parseCellAddress).not.toHaveBeenCalled();
  });
});
