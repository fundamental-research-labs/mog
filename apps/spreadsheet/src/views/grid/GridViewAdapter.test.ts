import { jest } from '@jest/globals';
import type { CellError } from '@mog-sdk/contracts/core';

jest.unstable_mockModule('./coordinator/grid-coordinator', () => ({
  GridCoordinator: jest.fn(),
}));

jest.unstable_mockModule('./initialization', () => ({
  setupGridRenderer: jest.fn(),
}));

const { GridViewAdapter } = await import('./GridViewAdapter');

const REF_ERROR: CellError = { type: 'error', value: 'Ref' };

describe('GridViewAdapter clipboard contract', () => {
  it('preserves CellError values when copying cells', () => {
    const workbook = {
      getSheetById: () => ({
        viewport: {
          getCellData: (row: number, col: number) =>
            row === 0 && col === 0
              ? { value: REF_ERROR, format: null }
              : { value: 'ok', format: null },
        },
      }),
    };

    const adapter = new GridViewAdapter({
      viewId: 'view-grid-test',
      config: { sheetId: 'sheet-grid-test' },
      workbook,
      uiStore: null,
    } as any);

    Object.assign(adapter, {
      coordinator: {
        grid: {
          getSelectionSnapshot: () => ({
            ranges: [{ startRow: 0, startCol: 0, endRow: 0, endCol: 1 }],
            activeCell: { row: 0, col: 0 },
          }),
        },
      },
    });

    const payload = adapter.getClipboardPayload();

    expect(payload.cells.values[0][0]).toBe(REF_ERROR);
    expect(payload.cells.values[0][1]).toBe('ok');
    expect(payload.text).toBe('#REF!\tok');
  });
});
