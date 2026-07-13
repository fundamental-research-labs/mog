import { jest } from '@jest/globals';

import { clearCellMetadataInRange } from '../cell-metadata-clearing';

function deferredVoid() {
  let resolve!: () => void;
  const promise = new Promise<void>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

describe('clearCellMetadataInRange', () => {
  test('keeps metadata writes sequential and treats missing validation as a no-op', async () => {
    const removalStarted = deferredVoid();
    const removalFinished = deferredVoid();
    const removeForCell = jest.fn(() => {
      removalStarted.resolve();
      return removalFinished.promise;
    });
    const clearInRange = jest.fn().mockRejectedValue({ code: 'VALIDATION_NOT_FOUND' } as never);
    const clearInRanges = jest.fn().mockResolvedValue(undefined as never);
    const worksheet = {
      comments: {
        list: jest.fn().mockResolvedValue([{ cellRef: 'comment-cell' }] as never),
        removeForCell,
      },
      validations: { clearInRange },
      conditionalFormats: { clearInRanges },
      _internal: {
        batchGetCellPositions: jest
          .fn()
          .mockResolvedValue(new Map([['comment-cell', { row: 0, col: 0 }]]) as never),
      },
    } as any;
    const range = { startRow: 0, startCol: 0, endRow: 0, endCol: 0 };

    const operation = clearCellMetadataInRange(worksheet, range);
    await removalStarted.promise;

    expect(clearInRange).not.toHaveBeenCalled();
    expect(clearInRanges).not.toHaveBeenCalled();

    removalFinished.resolve();
    await expect(operation).resolves.toBeUndefined();

    expect(clearInRange).toHaveBeenCalledWith(range);
    expect(clearInRanges).toHaveBeenCalledWith([range]);
    expect(removeForCell.mock.invocationCallOrder[0]).toBeLessThan(
      clearInRange.mock.invocationCallOrder[0]!,
    );
    expect(clearInRange.mock.invocationCallOrder[0]).toBeLessThan(
      clearInRanges.mock.invocationCallOrder[0]!,
    );
  });
});
