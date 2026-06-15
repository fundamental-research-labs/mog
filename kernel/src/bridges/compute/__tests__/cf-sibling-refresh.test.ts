import { jest } from '@jest/globals';

import { refreshViewportForCfSiblings } from '../cf-sibling-refresh';

function cellChange(sheetId: string) {
  return {
    cellId: `${sheetId}:cell`,
    sheetId,
    value: { type: 'Null' },
    extraFlags: 0,
  } as never;
}

describe('refreshViewportForCfSiblings', () => {
  it('skips viewport refresh when changed sheets have no conditional-format rules', async () => {
    const transport = {
      call: jest.fn(async () => []),
    };
    const fetchManager = {
      forceRefreshSheetViewports: jest.fn(async () => undefined),
    };

    await refreshViewportForCfSiblings({
      transport: transport as never,
      docId: 'doc-1',
      fetchManager: fetchManager as never,
      sheetsWithCfRules: new Map(),
      changedCells: [cellChange('sheet-1')],
      cfChanges: undefined,
    });

    expect(transport.call).toHaveBeenCalledWith('compute_get_all_cf_rules', {
      docId: 'doc-1',
      sheetId: 'sheet-1',
    });
    expect(fetchManager.forceRefreshSheetViewports).not.toHaveBeenCalled();
  });

  it('refreshes only sheets with conditional-format rules', async () => {
    const transport = {
      call: jest.fn(async (_command: string, args: { sheetId: string }) =>
        args.sheetId === 'sheet-1' ? [{ id: 'cf-1' }] : [],
      ),
    };
    const fetchManager = {
      forceRefreshSheetViewports: jest.fn(async () => undefined),
    };

    await refreshViewportForCfSiblings({
      transport: transport as never,
      docId: 'doc-1',
      fetchManager: fetchManager as never,
      sheetsWithCfRules: new Map(),
      changedCells: [cellChange('sheet-1'), cellChange('sheet-2')],
      cfChanges: undefined,
    });

    expect(fetchManager.forceRefreshSheetViewports).toHaveBeenCalledTimes(1);
    expect(fetchManager.forceRefreshSheetViewports).toHaveBeenCalledWith('sheet-1');
  });

  it('evicts the sheet CF-rule cache when CF rules change', async () => {
    const transport = {
      call: jest.fn(async () => []),
    };
    const fetchManager = {
      forceRefreshSheetViewports: jest.fn(async () => undefined),
    };
    const cache = new Map([['sheet-1', true]]);

    await refreshViewportForCfSiblings({
      transport: transport as never,
      docId: 'doc-1',
      fetchManager: fetchManager as never,
      sheetsWithCfRules: cache,
      changedCells: [cellChange('sheet-1')],
      cfChanges: [{ sheetId: 'sheet-1', kind: 'Removed' }],
    });

    expect(transport.call).toHaveBeenCalledWith('compute_get_all_cf_rules', {
      docId: 'doc-1',
      sheetId: 'sheet-1',
    });
    expect(fetchManager.forceRefreshSheetViewports).not.toHaveBeenCalled();
    expect(cache.get('sheet-1')).toBe(false);
  });
});
