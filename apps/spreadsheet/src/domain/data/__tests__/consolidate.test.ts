import type { CellData, CellValue } from '@mog-sdk/contracts/core';

import { buildConsolidateOutput, type ConsolidateSourceRange } from '../consolidate';

function cell(value: CellValue): CellData {
  return { value };
}

function source(
  range: ConsolidateSourceRange['range'],
  rows: CellValue[][],
): ConsolidateSourceRange {
  return {
    reference: '',
    range,
    cells: rows.map((row) => row.map(cell)),
  };
}

describe('buildConsolidateOutput', () => {
  it('sums same-shaped source ranges by position', () => {
    const result = buildConsolidateOutput({
      func: 'sum',
      sources: [
        source({ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }, [
          ['1', '2'],
          ['3', '4'],
        ]),
        source({ startRow: 0, startCol: 3, endRow: 1, endCol: 4 }, [
          ['10', '20'],
          ['30', '40'],
        ]),
      ],
      useTopRowLabels: false,
      useLeftColumnLabels: false,
      createLinks: false,
    });

    expect(result.values).toEqual([
      [11, 22],
      [33, 44],
    ]);
  });

  it('emits matching source formulas when create links is enabled', () => {
    const result = buildConsolidateOutput({
      func: 'sum',
      sources: [
        source({ startRow: 0, startCol: 0, endRow: 1, endCol: 1 }, [
          ['1', '2'],
          ['3', '4'],
        ]),
        source({ startRow: 0, startCol: 3, endRow: 1, endCol: 4 }, [
          ['10', '20'],
          ['30', '40'],
        ]),
      ],
      useTopRowLabels: false,
      useLeftColumnLabels: false,
      createLinks: true,
    });

    expect(result.values).toEqual([
      ['=SUM(A1,D1)', '=SUM(B1,E1)'],
      ['=SUM(A2,D2)', '=SUM(B2,E2)'],
    ]);
  });

  it('aligns sources by top-row and left-column labels', () => {
    const result = buildConsolidateOutput({
      func: 'sum',
      sources: [
        source({ startRow: 0, startCol: 0, endRow: 2, endCol: 2 }, [
          ['', 'Q1', 'Q2'],
          ['North', '10', '20'],
          ['South', '30', '40'],
        ]),
        source({ startRow: 0, startCol: 4, endRow: 2, endCol: 6 }, [
          ['', 'Q2', 'Q1'],
          ['South', '5', '7'],
          ['North', '11', '13'],
        ]),
      ],
      useTopRowLabels: true,
      useLeftColumnLabels: true,
      createLinks: false,
    });

    expect(result.values).toEqual([
      ['', 'Q1', 'Q2'],
      ['North', 23, 31],
      ['South', 37, 45],
    ]);
  });
});
