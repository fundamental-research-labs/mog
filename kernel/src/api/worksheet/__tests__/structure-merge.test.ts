import { jest } from '@jest/globals';

import { sheetId } from '@mog-sdk/contracts/core';
import { WorksheetStructureImpl } from '../structure';

const SHEET_ID = sheetId('00000000-0000-0000-0000-000000000001');

function createCtx() {
  return {
    writeGate: {
      assertWritable: jest.fn(),
    },
    computeBridge: {
      mergeRange: jest.fn().mockResolvedValue(undefined),
      unmergeRange: jest.fn().mockResolvedValue(undefined),
      getMergesInViewportSpatial: jest.fn().mockResolvedValue([]),
      getAllMergesInSheet: jest.fn().mockResolvedValue([]),
      invalidateAllViewportPrefetch: jest.fn(),
      forceRefreshAllViewports: jest.fn().mockResolvedValue(undefined),
    },
  };
}

describe('WorksheetStructureImpl merge operations', () => {
  it('merge("A1:B2") resolves and delegates to computeBridge.mergeRange', async () => {
    const ctx = createCtx();
    const structure = new WorksheetStructureImpl(ctx as never, SHEET_ID);

    await structure.merge('A1:B2');

    expect(ctx.writeGate.assertWritable).toHaveBeenCalledWith('structure.merge');
    expect(ctx.computeBridge.mergeRange).toHaveBeenCalledWith(SHEET_ID, 0, 0, 1, 1);
    expect(ctx.computeBridge.invalidateAllViewportPrefetch).toHaveBeenCalledTimes(1);
    expect(ctx.computeBridge.forceRefreshAllViewports).toHaveBeenCalledTimes(1);
  });

  it('merge(0, 0, 1, 1) uses numeric bounds', async () => {
    const ctx = createCtx();
    const structure = new WorksheetStructureImpl(ctx as never, SHEET_ID);

    await structure.merge(0, 0, 1, 1);

    expect(ctx.computeBridge.mergeRange).toHaveBeenCalledWith(SHEET_ID, 0, 0, 1, 1);
  });

  it('unmerge("A1:B2") skips the mutating unmerge when no merges overlap', async () => {
    const ctx = createCtx();
    const structure = new WorksheetStructureImpl(ctx as never, SHEET_ID);

    const result = await structure.unmerge('A1:B2');

    expect(ctx.writeGate.assertWritable).toHaveBeenCalledWith('structure.unmerge');
    expect(ctx.computeBridge.getMergesInViewportSpatial).toHaveBeenCalledWith(SHEET_ID, 0, 0, 1, 1);
    expect(ctx.computeBridge.unmergeRange).not.toHaveBeenCalled();
    expect(ctx.computeBridge.invalidateAllViewportPrefetch).not.toHaveBeenCalled();
    expect(ctx.computeBridge.forceRefreshAllViewports).not.toHaveBeenCalled();
    expect(result).toEqual({ kind: 'unmerge', range: 'A1:B2' });
  });

  it('unmerge("A1:B2") delegates to computeBridge.unmergeRange when a merge overlaps', async () => {
    const ctx = createCtx();
    ctx.computeBridge.getMergesInViewportSpatial.mockResolvedValue([
      { startRow: 0, startCol: 0, endRow: 1, endCol: 1 },
    ]);
    const structure = new WorksheetStructureImpl(ctx as never, SHEET_ID);

    await structure.unmerge('A1:B2');

    expect(ctx.computeBridge.getMergesInViewportSpatial).toHaveBeenCalledWith(SHEET_ID, 0, 0, 1, 1);
    expect(ctx.computeBridge.unmergeRange).toHaveBeenCalledWith(SHEET_ID, 0, 0, 1, 1);
    expect(ctx.computeBridge.invalidateAllViewportPrefetch).toHaveBeenCalledTimes(1);
    expect(ctx.computeBridge.forceRefreshAllViewports).toHaveBeenCalledTimes(1);
  });

  it('getMergedRegions returns formatted merge regions', async () => {
    const ctx = createCtx();
    ctx.computeBridge.getAllMergesInSheet.mockResolvedValue([
      { startRow: 0, startCol: 0, endRow: 1, endCol: 1 },
      { startRow: 3, startCol: 2, endRow: 5, endCol: 4 },
    ]);
    const structure = new WorksheetStructureImpl(ctx as never, SHEET_ID);

    const regions = await structure.getMergedRegions();

    expect(regions).toHaveLength(2);
    expect(regions[0].range).toBe('A1:B2');
    expect(regions[0].startRow).toBe(0);
    expect(regions[1].range).toBe('C4:E6');
  });
});
