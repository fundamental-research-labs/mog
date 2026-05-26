import { jest } from '@jest/globals';

import { CellMetadataCache } from '../cell-metadata-cache';

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T | PromiseLike<T>) => void;
  reject: (reason?: unknown) => void;
} {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('CellMetadataCache disposal guards', () => {
  it('does not write cache state or notify after dispose during evaluateViewport()', async () => {
    const projections =
      deferred<Array<{ originRow: number; originCol: number; rows: number; cols: number }>>();
    const validations = deferred<Array<{ row: number; col: number }>>();
    const onChange = jest.fn();

    const workbook = {
      getSheetById: jest.fn(() => ({
        bindings: {
          getViewportProjectionData: jest.fn(() => projections.promise),
        },
        validations: {
          getErrorsInRange: jest.fn(() => validations.promise),
        },
      })),
    };

    const cache = new CellMetadataCache(workbook as any);
    cache.onChange(onChange);

    const evaluation = cache.evaluateViewport('sheet-1' as any, 0, 0, 10, 10);
    cache.dispose();

    projections.resolve([{ originRow: 1, originCol: 1, rows: 2, cols: 2 }]);
    validations.resolve([{ row: 2, col: 2 }]);
    await evaluation;

    expect(cache.getProjectionRange(1, 1)).toBeUndefined();
    expect(cache.isProjectedPosition(2, 2)).toBe(false);
    expect(cache.hasValidationErrors(2, 2)).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
  });
});
