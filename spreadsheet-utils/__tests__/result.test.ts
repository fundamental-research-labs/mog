import { ok, err } from '@mog/spreadsheet-utils/result';
import type { Result } from '@mog-sdk/contracts/core/result';

describe('Result', () => {
  it('ok(42) produces { ok: true, value: 42 }', () => {
    const result = ok(42);
    expect(result).toEqual({ ok: true, value: 42 });
  });

  it('err("boom") produces { ok: false, error: "boom" }', () => {
    const result = err('boom');
    expect(result).toEqual({ ok: false, error: 'boom' });
  });

  it('type narrowing works — value accessible when ok is true', () => {
    const result: Result<number> = ok(99);
    if (result.ok) {
      // This line proves the type narrows to { ok: true, value: number }
      const n: number = result.value;
      expect(n).toBe(99);
    } else {
      fail('Expected ok result');
    }
  });

  it('type narrowing works — error accessible when ok is false', () => {
    const result: Result<number> = err('fail');
    if (!result.ok) {
      // This line proves the type narrows to { ok: false, error: string }
      const e: string = result.error;
      expect(e).toBe('fail');
    } else {
      fail('Expected err result');
    }
  });

  it('default error type is string', () => {
    // Result<number> without second type param defaults E to string
    const result: Result<number> = err('default string error');
    if (!result.ok) {
      expect(typeof result.error).toBe('string');
    }
  });

  it('supports custom error types', () => {
    type ParseError = { line: number; message: string };
    const result: Result<string, ParseError> = err({ line: 5, message: 'unexpected token' });
    if (!result.ok) {
      expect(result.error.line).toBe(5);
      expect(result.error.message).toBe('unexpected token');
    }
  });
});
