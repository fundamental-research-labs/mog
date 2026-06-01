import { buildCanvasFontString, canvasFontFamily } from '../font';

describe('canvas font helpers', () => {
  it('maps OOXML theme font tokens to valid canvas font families', () => {
    expect(canvasFontFamily('+mn-lt')).toBe('Calibri, Arial, sans-serif');
    expect(buildCanvasFontString('bold', 28, '+mn-lt')).toBe(
      'bold 28px Calibri, Arial, sans-serif',
    );
  });

  it('quotes non-generic font family names that are not bare CSS identifiers', () => {
    expect(canvasFontFamily('Aptos Display')).toBe('"Aptos Display"');
    expect(canvasFontFamily('system-ui, sans-serif')).toBe('system-ui, sans-serif');
  });

  it('escapes quotes inside quoted canvas font family names', () => {
    expect(canvasFontFamily('Acme "Wide"')).toBe('"Acme \\"Wide\\""');
  });
});
