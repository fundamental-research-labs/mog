import { jest } from '@jest/globals';
import { sheetId } from '@mog-sdk/contracts/core';

import type { DocumentContext } from '../../../context/types';
import { WorksheetViewImpl } from '../view';

const SHEET_ID = sheetId('sheet-1');

function makeCtx() {
  return {
    computeBridge: {
      setFrozenPanes: jest.fn(async () => undefined),
      getFrozenPanesQuery: jest.fn(async () => ({ rows: 0, cols: 0 })),
      freezeRows: jest.fn(async () => undefined),
      freezeColumns: jest.fn(async () => undefined),
    },
    mirror: {
      getFrozenPanes: jest.fn(() => ({ rows: 0, cols: 0 })),
    },
    writeGate: {
      assertWritable: jest.fn(),
    },
  } as unknown as DocumentContext;
}

describe('WorksheetViewImpl freeze panes API', () => {
  it('freezePanes sets frozen rows and columns atomically', async () => {
    const ctx = makeCtx();
    const view = new WorksheetViewImpl(ctx, SHEET_ID);

    await view.freezePanes(3, 2);

    expect(ctx.writeGate.assertWritable).toHaveBeenCalledWith('view.freezePanes');
    expect(ctx.computeBridge.getFrozenPanesQuery).not.toHaveBeenCalled();
    expect(ctx.computeBridge.setFrozenPanes).toHaveBeenCalledWith(SHEET_ID, 3, 2);
  });

  it('setFrozenPanes aliases freezePanes for route-name compatibility', async () => {
    const ctx = makeCtx();
    const view = new WorksheetViewImpl(ctx, SHEET_ID);

    await view.setFrozenPanes(3, 2);

    expect(ctx.writeGate.assertWritable).toHaveBeenCalledWith('view.setFrozenPanes');
    expect(ctx.computeBridge.getFrozenPanesQuery).not.toHaveBeenCalled();
    expect(ctx.computeBridge.setFrozenPanes).toHaveBeenCalledWith(SHEET_ID, 3, 2);
  });

  it('freezePanes rejects negative row or column counts before mutating', async () => {
    const ctx = makeCtx();
    const view = new WorksheetViewImpl(ctx, SHEET_ID);

    await expect(view.freezePanes(-1, 2)).rejects.toThrow(
      'Frozen row and column counts cannot be negative',
    );
    await expect(view.freezePanes(1, -2)).rejects.toThrow(
      'Frozen row and column counts cannot be negative',
    );

    expect(ctx.computeBridge.setFrozenPanes).not.toHaveBeenCalled();
  });
});
