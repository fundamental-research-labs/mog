import { jest } from '@jest/globals';

import { clearValidationsInRangeIfPresent } from '../validation-clearing';

const RANGE = { startRow: 1, startCol: 2, endRow: 3, endCol: 4 };

describe('clearValidationsInRangeIfPresent', () => {
  test('treats a missing optional validation target as an idempotent no-op', async () => {
    const clearInRange = jest.fn().mockRejectedValue({ code: 'VALIDATION_NOT_FOUND' } as never);
    const worksheet = { validations: { clearInRange } } as any;

    await expect(clearValidationsInRangeIfPresent(worksheet, RANGE)).resolves.toBeUndefined();
    expect(clearInRange).toHaveBeenCalledWith(RANGE);
  });

  test('preserves non-missing validation failures', async () => {
    const failure = new Error('transport failed');
    const worksheet = {
      validations: { clearInRange: jest.fn().mockRejectedValue(failure as never) },
    } as any;

    await expect(clearValidationsInRangeIfPresent(worksheet, RANGE)).rejects.toBe(failure);
  });
});
