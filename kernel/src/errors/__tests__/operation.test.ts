import { jest } from '@jest/globals';

import { KernelError } from '..';
import { failResult, mapResult, okResult, unwrap, type OperationResult } from '../operation';

describe('operation result helpers', () => {
  describe('unwrap()', () => {
    it('returns data on success', () => {
      const result: OperationResult<number> = { success: true, data: 42 };
      expect(unwrap(result)).toBe(42);
    });

    it('returns void data on success with void result', () => {
      const result: OperationResult = { success: true, data: undefined };
      expect(unwrap(result)).toBeUndefined();
    });

    it('throws KernelError on failure', () => {
      const error = new KernelError('OPERATION_FAILED', 'something went wrong');
      const result: OperationResult<number> = { success: false, error };
      expect(() => unwrap(result)).toThrow(error);
    });

    it('throws the exact KernelError instance (not a wrapper)', () => {
      const error = new KernelError('API_SHEET_NOT_FOUND', 'no sheet', {
        context: { sheetId: 'abc' },
      });
      const result: OperationResult<string> = { success: false, error };
      try {
        unwrap(result);
        fail('should have thrown');
      } catch (e) {
        expect(e).toBe(error);
        expect(e).toBeInstanceOf(KernelError);
        expect((e as KernelError).code).toBe('API_SHEET_NOT_FOUND');
      }
    });
  });

  describe('mapResult()', () => {
    it('transforms success data', () => {
      const result: OperationResult<number> = { success: true, data: 10 };
      const mapped = mapResult(result, (n) => n * 2);
      expect(mapped).toEqual({ success: true, data: 20 });
    });

    it('preserves affectedCells on success', () => {
      const cells = [{ sheetId: 's1', row: 0, col: 0 }];
      const result: OperationResult<number> = {
        success: true,
        data: 5,
        affectedCells: cells as any,
      };
      const mapped = mapResult(result, (n) => String(n));
      expect(mapped.success).toBe(true);
      if (mapped.success) {
        expect(mapped.data).toBe('5');
        expect(mapped.affectedCells).toBe(cells);
      }
    });

    it('passes through failure unchanged', () => {
      const error = new KernelError('COMPUTE_ERROR', 'calc failed');
      const result: OperationResult<number> = { success: false, error };
      const mapped = mapResult(result, (n: number) => n * 2);
      expect(mapped.success).toBe(false);
      if (!mapped.success) {
        expect(mapped.error).toBe(error);
      }
    });

    it('does not call transform function on failure', () => {
      const error = new KernelError('COMPUTE_ERROR', 'calc failed');
      const result: OperationResult<number> = { success: false, error };
      const fn = jest.fn();
      mapResult(result, fn);
      expect(fn).not.toHaveBeenCalled();
    });
  });

  describe('failResult()', () => {
    it('creates a failure result with the given KernelError', () => {
      const error = new KernelError('API_INVALID_RANGE', 'bad range', {
        context: { range: 'ZZZ1:ZZZ2' },
      });
      const result = failResult(error);
      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error).toBe(error);
        expect(result.error.code).toBe('API_INVALID_RANGE');
      }
    });
  });

  describe('okResult()', () => {
    it('creates a success result with data', () => {
      const result = okResult(42);
      expect(result).toEqual({ success: true, data: 42 });
    });

    it('creates a success result with void data', () => {
      const result = okResult(undefined);
      expect(result).toEqual({ success: true, data: undefined });
    });

    it('creates a success result with affectedCells', () => {
      const cells = [{ sheetId: 's1', row: 1, col: 2 }];
      const result = okResult('done', cells as any);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.data).toBe('done');
        expect(result.affectedCells).toBe(cells);
      }
    });

    it('omits affectedCells when not provided', () => {
      const result = okResult(true);
      expect(result.success).toBe(true);
      if (result.success) {
        expect(result.affectedCells).toBeUndefined();
      }
    });
  });
});
