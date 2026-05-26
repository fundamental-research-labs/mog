// Mock domain error modules that may not exist yet — we only need the base KernelError here.
import { jest } from '@jest/globals';

jest.mock('../capability', () => ({}), { virtual: true });
jest.mock('../floating-object', () => ({}), { virtual: true });
jest.mock('../operation', () => ({}), { virtual: true });

import { KernelError, isKernelError, toApiError } from '..';

describe('KernelError', () => {
  describe('construction', () => {
    it('creates with code and message only', () => {
      const error = new KernelError('API_INVALID_CELL_ADDRESS', 'bad cell');
      expect(error.code).toBe('API_INVALID_CELL_ADDRESS');
      expect(error.message).toBe('bad cell');
      expect(error.name).toBe('KernelError');
      expect(error.context).toEqual({});
      expect(error.suggestion).toBeUndefined();
      expect(error.path).toBeUndefined();
      expect(error.cause).toBeUndefined();
    });

    it('creates with all options', () => {
      const cause = new Error('root cause');
      const error = new KernelError('FORMULA_PARSE_ERROR', 'parse failed', {
        context: { formula: '=SUM(A1' },
        suggestion: 'Check for missing parenthesis',
        path: ['sheet1', 'A1'],
        cause,
      });
      expect(error.code).toBe('FORMULA_PARSE_ERROR');
      expect(error.message).toBe('parse failed');
      expect(error.context).toEqual({ formula: '=SUM(A1' });
      expect(error.suggestion).toBe('Check for missing parenthesis');
      expect(error.path).toEqual(['sheet1', 'A1']);
      expect(error.cause).toBe(cause);
    });

    it('defaults context to empty object', () => {
      const error = new KernelError('OPERATION_FAILED', 'oops', {
        suggestion: 'try again',
      });
      expect(error.context).toEqual({});
    });

    it('is an instance of Error', () => {
      const error = new KernelError('OPERATION_FAILED', 'oops');
      expect(error).toBeInstanceOf(Error);
      expect(error).toBeInstanceOf(KernelError);
    });
  });

  describe('KernelError.from()', () => {
    it('wraps a plain Error, preserving its message as cause', () => {
      const original = new Error('disk full');
      const wrapped = KernelError.from(original, 'BRIDGE_TRANSPORT_ERROR');
      expect(wrapped).toBeInstanceOf(KernelError);
      expect(wrapped.code).toBe('BRIDGE_TRANSPORT_ERROR');
      expect(wrapped.message).toBe('disk full');
      expect(wrapped.cause).toBe(original);
    });

    it('wraps a plain Error with a custom message', () => {
      const original = new Error('disk full');
      const wrapped = KernelError.from(original, 'BRIDGE_TRANSPORT_ERROR', 'transport failed');
      expect(wrapped.message).toBe('transport failed');
      expect(wrapped.cause).toBe(original);
    });

    it('wraps a plain Error with options', () => {
      const original = new Error('disk full');
      const wrapped = KernelError.from(original, 'BRIDGE_TRANSPORT_ERROR', 'transport failed', {
        context: { endpoint: '/api' },
        suggestion: 'Retry later',
        path: ['bridge'],
      });
      expect(wrapped.context).toEqual({ endpoint: '/api' });
      expect(wrapped.suggestion).toBe('Retry later');
      expect(wrapped.path).toEqual(['bridge']);
    });

    it('does not double-wrap a KernelError', () => {
      const original = new KernelError('API_SHEET_NOT_FOUND', 'no sheet');
      const result = KernelError.from(original, 'OPERATION_FAILED', 'wrapper message');
      expect(result).toBe(original);
    });

    it('wraps a string', () => {
      const wrapped = KernelError.from('something broke', 'OPERATION_FAILED');
      expect(wrapped.message).toBe('something broke');
      expect(wrapped.cause).toBe('something broke');
    });

    it('wraps null', () => {
      const wrapped = KernelError.from(null, 'OPERATION_FAILED');
      expect(wrapped.message).toBe('null');
      // null cause is treated as "no cause" by the constructor (cause != null check)
      expect(wrapped.cause).toBeUndefined();
    });

    it('wraps undefined', () => {
      const wrapped = KernelError.from(undefined, 'OPERATION_FAILED');
      expect(wrapped.message).toBe('undefined');
      expect(wrapped.cause).toBeUndefined();
    });
  });

  describe('toJSON() / fromJSON() roundtrip', () => {
    it('roundtrips a simple error', () => {
      const original = new KernelError('API_INVALID_RANGE', 'bad range', {
        context: { range: 'Z999' },
        suggestion: 'Use a valid range',
        path: ['sheet', 'range'],
      });
      const json = original.toJSON();
      expect(json).toEqual({
        name: 'KernelError',
        code: 'API_INVALID_RANGE',
        message: 'bad range',
        context: { range: 'Z999' },
        suggestion: 'Use a valid range',
        path: ['sheet', 'range'],
      });

      const restored = KernelError.fromJSON(json);
      expect(restored.code).toBe(original.code);
      expect(restored.message).toBe(original.message);
      expect(restored.context).toEqual(original.context);
      expect(restored.suggestion).toBe(original.suggestion);
      expect(restored.path).toEqual(original.path);
      expect(restored.cause).toBeUndefined();
    });

    it('roundtrips a nested cause chain', () => {
      const root = new KernelError('BRIDGE_TRANSPORT_ERROR', 'connection lost', {
        context: { retries: 3 },
      });
      const outer = new KernelError('OPERATION_FAILED', 'operation failed', {
        context: { op: 'setCellValue' },
        suggestion: 'Retry',
        cause: root,
      });

      const json = outer.toJSON();
      expect(json.cause).toBeDefined();
      const causeJson = json.cause as Record<string, unknown>;
      expect(causeJson.code).toBe('BRIDGE_TRANSPORT_ERROR');
      expect(causeJson.message).toBe('connection lost');
      expect(causeJson.context).toEqual({ retries: 3 });

      const restored = KernelError.fromJSON(json);
      expect(restored.code).toBe('OPERATION_FAILED');
      expect(restored.message).toBe('operation failed');
      expect(restored.cause).toBeInstanceOf(KernelError);

      const restoredCause = restored.cause as KernelError;
      expect(restoredCause.code).toBe('BRIDGE_TRANSPORT_ERROR');
      expect(restoredCause.message).toBe('connection lost');
      expect(restoredCause.context).toEqual({ retries: 3 });
    });

    it('omits cause from JSON when cause is not a KernelError', () => {
      const error = new KernelError('OPERATION_FAILED', 'oops', {
        cause: new Error('plain cause'),
      });
      const json = error.toJSON();
      expect(json.cause).toBeUndefined();
    });

    it('omits undefined suggestion and path from JSON', () => {
      const error = new KernelError('OPERATION_FAILED', 'oops');
      const json = error.toJSON();
      expect(json.suggestion).toBeUndefined();
      expect(json.path).toBeUndefined();
    });
  });

  describe('cause chain', () => {
    it('preserves cause via ES2022 Error cause', () => {
      const root = new Error('root');
      const mid = new KernelError('BRIDGE_TRANSPORT_ERROR', 'mid', { cause: root });
      const top = new KernelError('OPERATION_FAILED', 'top', { cause: mid });

      expect(top.cause).toBe(mid);
      expect((top.cause as KernelError).cause).toBe(root);
    });
  });

  describe('isKernelError()', () => {
    it('returns true for KernelError', () => {
      expect(isKernelError(new KernelError('OPERATION_FAILED', 'x'))).toBe(true);
    });

    it('returns false for plain Error', () => {
      expect(isKernelError(new Error('x'))).toBe(false);
    });

    it('returns false for null', () => {
      expect(isKernelError(null)).toBe(false);
    });

    it('returns false for undefined', () => {
      expect(isKernelError(undefined)).toBe(false);
    });

    it('returns false for a string', () => {
      expect(isKernelError('not an error')).toBe(false);
    });
  });

  describe('toApiError()', () => {
    it('converts to ApiError shape', () => {
      const error = new KernelError('API_INVALID_CELL_ADDRESS', 'Invalid cell', {
        context: { cell: 'ZZZ' },
        suggestion: 'Use A1 notation',
        path: ['sheet', 'cell'],
      });
      const apiError = toApiError(error);
      expect(apiError).toEqual({
        code: 'API_INVALID_CELL_ADDRESS',
        message: 'Invalid cell',
        path: ['sheet', 'cell'],
        suggestion: 'Use A1 notation',
        details: { cell: 'ZZZ' },
      });
    });

    it('leaves optional fields undefined when not set', () => {
      const error = new KernelError('OPERATION_FAILED', 'generic failure');
      const apiError = toApiError(error);
      expect(apiError.code).toBe('OPERATION_FAILED');
      expect(apiError.message).toBe('generic failure');
      expect(apiError.path).toBeUndefined();
      expect(apiError.suggestion).toBeUndefined();
      expect(apiError.details).toEqual({});
    });
  });
});
