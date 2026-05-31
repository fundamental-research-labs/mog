import { getTracePrecedentSources } from '../formula-auditing';

function worksheet(formula: string, precedents: string[]) {
  return {
    getCell: async () => ({ formula }),
    getPrecedents: async () => precedents,
  };
}

describe('getTracePrecedentSources', () => {
  it('collapses a larger contiguous range to its origin', async () => {
    const ws = worksheet('=SUM(A1:A4)', ['A1', 'A2', 'A3', 'A4']);

    await expect(getTracePrecedentSources(ws, 0, 2)).resolves.toEqual([
      { row: 0, col: 0, address: 'A1' },
    ]);
  });

  it('keeps small two-cell ranges expanded', async () => {
    const ws = worksheet('=SUM(A1:B1)', ['A1', 'B1']);

    await expect(getTracePrecedentSources(ws, 0, 2)).resolves.toEqual([
      { row: 0, col: 0, address: 'A1' },
      { row: 0, col: 1, address: 'B1' },
    ]);
  });

  it('ignores function-like formula text that is not in the dependency graph', async () => {
    const ws = worksheet('=LOG10(A1)', ['A1']);

    await expect(getTracePrecedentSources(ws, 0, 1)).resolves.toEqual([
      { row: 0, col: 0, address: 'A1' },
    ]);
  });
});
