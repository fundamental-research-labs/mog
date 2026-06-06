import { jest } from '@jest/globals';

const cellOpsMock = {
  getCellIdAt: jest.fn(),
  getCell: jest.fn(),
  setCell: jest.fn(),
};

jest.unstable_mockModule('../cell-operations', () => cellOpsMock);

const GoalSeekOps = await import('../goal-seek-operations');

function createMockCtx(overrides: Record<string, jest.Mock> = {}): any {
  return {
    computeBridge: {
      goalSeek: jest.fn(),
      ...overrides,
    },
  };
}

describe('goal seek operations', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns the proposed solution without mutating the changing cell', async () => {
    const ctx = createMockCtx({
      goalSeek: jest.fn().mockResolvedValue({
        found: true,
        solutionValue: 240,
        achievedValue: 1000,
        iterations: 6,
      }),
    });
    cellOpsMock.getCellIdAt.mockImplementation(async (_ctx, _sheetId, row: number, col: number) => {
      if (row === 1 && col === 1) return 'formula-cell-id';
      if (row === 0 && col === 1) return 'input-cell-id';
      return null;
    });
    cellOpsMock.getCell.mockResolvedValue({ value: 10 });

    const result = await GoalSeekOps.goalSeek(ctx, 'sheet-1', 'B2', 1000, 'B1');

    expect(ctx.computeBridge.goalSeek).toHaveBeenCalledWith({
      formula_cell: 'formula-cell-id',
      target: 1000,
      input_cell: 'input-cell-id',
      initial_guess: 10,
    });
    expect(cellOpsMock.setCell).not.toHaveBeenCalled();
    expect(result).toEqual({
      found: true,
      value: 240,
      achievedValue: 1000,
      iterations: 6,
    });
  });
});
