/**
 * Unit tests for the `toCellInput` helper that replaces the legacy
 * `\x00`-prefix sentinel at the SDK↔engine boundary.
 */

import { toCellInput } from '../cell-input';

describe('toCellInput', () => {
  it('null → clear', () => {
    expect(toCellInput(null)).toEqual({ kind: 'clear' });
  });

  it('undefined → clear', () => {
    expect(toCellInput(undefined)).toEqual({ kind: 'clear' });
  });

  it('empty string → clear (Excel convention; explicit Literal for the rare opt-in)', () => {
    // Ergonomic default: an empty string from a primitive-accepting call
    // site clears the cell, matching Excel / Google Sheets behaviour. The
    // rare "store empty text" intent requires the explicit
    // `{ kind: 'literal', text: '' }` form — programmatic callers build
    // that directly rather than going through this helper.
    expect(toCellInput('')).toEqual({ kind: 'clear' });
  });

  it('non-empty string → parse', () => {
    expect(toCellInput('hello')).toEqual({ kind: 'parse', text: 'hello' });
  });

  it('significant leading-zero numeric strings → literal text', () => {
    expect(toCellInput('000184')).toEqual({ kind: 'literal', text: '000184' });
    expect(toCellInput('00')).toEqual({ kind: 'literal', text: '00' });
    expect(toCellInput('-007')).toEqual({ kind: 'literal', text: '-007' });
    expect(toCellInput('0123.45')).toEqual({ kind: 'literal', text: '0123.45' });
    expect(toCellInput('  000184  ')).toEqual({ kind: 'literal', text: '  000184  ' });
  });

  it('ordinary numeric-looking strings still use parse', () => {
    expect(toCellInput('42')).toEqual({ kind: 'parse', text: '42' });
    expect(toCellInput('0')).toEqual({ kind: 'parse', text: '0' });
    expect(toCellInput('0.5')).toEqual({ kind: 'parse', text: '0.5' });
    expect(toCellInput('01/02/2026')).toEqual({ kind: 'parse', text: '01/02/2026' });
  });

  it('finite number → value', () => {
    expect(toCellInput(42)).toEqual({ kind: 'value', value: 42 });
    expect(toCellInput(0)).toEqual({ kind: 'value', value: 0 });
    expect(toCellInput(-3.14)).toEqual({ kind: 'value', value: -3.14 });
  });

  it('non-finite number → parse compatibility path', () => {
    expect(toCellInput(Number.NaN)).toEqual({ kind: 'parse', text: 'NaN' });
    expect(toCellInput(Number.POSITIVE_INFINITY)).toEqual({
      kind: 'parse',
      text: 'Infinity',
    });
  });

  it('boolean → value', () => {
    expect(toCellInput(true)).toEqual({ kind: 'value', value: true });
    expect(toCellInput(false)).toEqual({ kind: 'value', value: false });
  });

  it('CellError → value', () => {
    const error = { type: 'error' as const, value: 'Div0' as const };
    expect(toCellInput(error)).toEqual({ kind: 'value', value: error });
  });

  it('formula passes through to parse unchanged', () => {
    expect(toCellInput('=SUM(A1:A10)')).toEqual({
      kind: 'parse',
      text: '=SUM(A1:A10)',
    });
  });

  it('single-character NUL string survives as literal text in parse (no sentinel re-interpretation)', () => {
    // A literal "\x00" must NOT be swallowed as the legacy empty-string sentinel.
    expect(toCellInput('\x00')).toEqual({ kind: 'parse', text: '\x00' });
  });
});
