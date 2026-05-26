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

  it('number → parse', () => {
    expect(toCellInput(42)).toEqual({ kind: 'parse', text: '42' });
    expect(toCellInput(0)).toEqual({ kind: 'parse', text: '0' });
    expect(toCellInput(-3.14)).toEqual({ kind: 'parse', text: '-3.14' });
  });

  it('boolean → parse', () => {
    expect(toCellInput(true)).toEqual({ kind: 'parse', text: 'true' });
    expect(toCellInput(false)).toEqual({ kind: 'parse', text: 'false' });
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
