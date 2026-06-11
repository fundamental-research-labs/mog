import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';

jest.unstable_mockModule('../worksheet/operations/sort-operations', () => ({
  sortRange: jest.fn(),
}));

const { WorksheetImpl } = await import('../worksheet/worksheet-impl');
const SortOps = await import('../worksheet/operations/sort-operations');

const SHEET_ID = sheetId('sheet-1');

function createMockCtx(): any {
  return {
    writeGate: {
      assertWritable: jest.fn(),
    },
    eventBus: {
      onMany: jest.fn(() => jest.fn()),
    },
  };
}

describe('WorksheetImpl sort option forwarding', () => {
  let ctx: any;
  let ws: InstanceType<typeof WorksheetImpl>;

  beforeEach(() => {
    jest.clearAllMocks();
    ctx = createMockCtx();
    ws = new WorksheetImpl(SHEET_ID, ctx);
  });

  it('sortRange forwards visibleRowsOnly to SortOps', async () => {
    (SortOps.sortRange as jest.Mock).mockResolvedValue(undefined);

    await ws.sortRange('A1:C5', {
      columns: [{ column: 2, direction: 'asc' }],
      hasHeaders: true,
      visibleRowsOnly: true,
    });

    expect(SortOps.sortRange).toHaveBeenCalledWith(
      ctx,
      SHEET_ID,
      {
        sheetId: SHEET_ID,
        startRow: 0,
        startCol: 0,
        endRow: 4,
        endCol: 2,
      },
      {
        sortBy: [
          {
            column: 2,
            direction: 'asc',
            caseSensitive: undefined,
            sortBy: 'value',
            customList: undefined,
          },
        ],
        hasHeaders: true,
        visibleRowsOnly: true,
      },
    );
  });

  it('sortByColor forwards visibleRowsOnly to SortOps', async () => {
    (SortOps.sortRange as jest.Mock).mockResolvedValue(undefined);

    await ws.sortByColor('B2:D4', {
      column: 2,
      colorType: 'fill',
      color: '#ff0000',
      position: 'top',
      hasHeaders: false,
      visibleRowsOnly: true,
    });

    expect(SortOps.sortRange).toHaveBeenCalledWith(
      ctx,
      SHEET_ID,
      {
        sheetId: SHEET_ID,
        startRow: 1,
        startCol: 1,
        endRow: 3,
        endCol: 3,
      },
      {
        sortBy: [
          {
            column: 2,
            direction: 'asc',
            caseSensitive: false,
            sortBy: 'cellColor',
            targetColor: '#ff0000',
            colorPosition: 'top',
          },
        ],
        hasHeaders: false,
        visibleRowsOnly: true,
      },
    );
  });
});
