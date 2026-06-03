import type { GroupDefinition } from '@mog-sdk/contracts/grouping';
import { getColumnOutlineLevels, getRowOutlineLevels } from '../outline-levels';
import { getOutlineSymbols } from '../rendering';
import { computeAffectedColumns, computeAffectedRows, getAdjacentSummaryIndex } from '../shared';

const SHEET_ID = 'sheet-1';

function group(overrides: Partial<GroupDefinition>): GroupDefinition {
  return {
    id: 'group-1',
    sheetId: SHEET_ID,
    axis: 'row',
    start: 2,
    end: 5,
    level: 1,
    collapsed: false,
    ...overrides,
  };
}

function context(rowGroups: GroupDefinition[], columnGroups: GroupDefinition[]) {
  return {
    computeBridge: {
      getGroups: async (_sheetId: string, axis: 'row' | 'column') =>
        axis === 'row' ? rowGroups : columnGroups,
    },
  } as any;
}

describe('grouping adjacent summary contract', () => {
  it('affected helpers return the full detail span', () => {
    expect(computeAffectedRows(group({ axis: 'row' }), false)).toEqual([2, 3, 4, 5]);
    expect(computeAffectedColumns(group({ axis: 'column', start: 1, end: 3 }), false)).toEqual([
      1, 2, 3,
    ]);
  });

  it('computes adjacent summary indices with bounds handling', () => {
    expect(getAdjacentSummaryIndex(2, 5, true)).toBe(6);
    expect(getAdjacentSummaryIndex(2, 5, false)).toBe(1);
    expect(getAdjacentSummaryIndex(0, 3, false)).toBeNull();
  });

  it('marks row detail endpoints hidden and adjacent summary rows visible', async () => {
    const rowGroup = group({ axis: 'row', collapsed: true });
    const levels = await getRowOutlineLevels(context([rowGroup], []), SHEET_ID, 5, 6);

    expect(levels[0]).toMatchObject({ index: 5, visible: false, isSummary: false });
    expect(levels[1]).toMatchObject({ index: 6, visible: true, isSummary: true });
  });

  it('marks column detail endpoints hidden and adjacent summary columns visible', async () => {
    const colGroup = group({ axis: 'column', start: 1, end: 3, collapsed: true });
    const levels = await getColumnOutlineLevels(context([], [colGroup]), SHEET_ID, 3, 4);

    expect(levels[0]).toMatchObject({ index: 3, visible: false, isSummary: false });
    expect(levels[1]).toMatchObject({ index: 4, visible: true, isSummary: true });
  });

  it('places outline symbols on adjacent summary rows and columns', async () => {
    const rowGroup = group({ axis: 'row' });
    const colGroup = group({ axis: 'column', start: 1, end: 3, id: 'group-2' });
    const symbols = await getOutlineSymbols(context([rowGroup], [colGroup]), SHEET_ID, {
      startRow: 0,
      endRow: 10,
      startCol: 0,
      endCol: 10,
    });

    expect(symbols.find((symbol) => symbol.groupId === rowGroup.id)).toMatchObject({ index: 6 });
    expect(symbols.find((symbol) => symbol.groupId === colGroup.id)).toMatchObject({ index: 4 });
  });
});
