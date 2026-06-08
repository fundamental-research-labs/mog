import { jest } from '@jest/globals';

import { createHandleLiveness } from '../lifecycle/handle-liveness';
import { WorkbookChangesImpl } from '../workbook/changes';
import { WorksheetChangesImpl } from '../worksheet/changes';

function makeCtx() {
  const accumulator = {
    register: jest.fn(),
    unregister: jest.fn(),
    registerWorkbook: jest.fn(),
    unregisterWorkbook: jest.fn(),
  };
  const ctx = {
    computeBridge: {
      getMutationHandler: () => ({ changeAccumulator: accumulator }),
    },
  };
  return { ctx: ctx as any, accumulator };
}

describe('change tracker liveness', () => {
  it('worksheet tracker unregisters, clears active state, and rejects collect after owner invalidation', () => {
    const { ctx, accumulator } = makeCtx();
    const liveness = createHandleLiveness({ label: 'Workbook' });
    const changes = new WorksheetChangesImpl(ctx, 'sheet-1', liveness);
    const tracker = changes.track();

    liveness.invalidate({ operation: 'workbook.dispose' });

    expect(accumulator.unregister).toHaveBeenCalledWith(tracker);
    expect(tracker.active).toBe(false);
    expect(() => tracker.collect()).toThrow(/disposed|closed|invalidated/i);
    expect(() => tracker.close()).not.toThrow();
  });

  it('workbook tracker unregisters, clears active state, and rejects collect paths after owner invalidation', async () => {
    const { ctx, accumulator } = makeCtx();
    const liveness = createHandleLiveness({ label: 'Workbook' });
    const changes = new WorkbookChangesImpl(ctx, liveness);
    const tracker = changes.track();

    liveness.invalidate({ operation: 'workbook.dispose' });

    expect(accumulator.unregisterWorkbook).toHaveBeenCalledWith(tracker);
    expect(tracker.active).toBe(false);
    expect(() => tracker.collect()).toThrow(/disposed|closed|invalidated/i);
    await expect(tracker.collectAsync()).rejects.toThrow(/disposed|closed|invalidated/i);
    expect(() => tracker.close()).not.toThrow();
  });
});
