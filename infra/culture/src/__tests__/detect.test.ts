import {
  detectCurrency,
  detectPercentage,
  parseFraction,
  stripCurrency,
  stripPercentage,
} from '../detect';

describe('detectCurrency', () => {
  it('detects $ prefix', () => {
    expect(detectCurrency('$100')).toBe('$');
  });

  it('detects € prefix', () => {
    expect(detectCurrency('€50')).toBe('€');
  });

  it('detects £ prefix', () => {
    expect(detectCurrency('£99.99')).toBe('£');
  });

  it('detects ¥ prefix', () => {
    expect(detectCurrency('¥1000')).toBe('¥');
  });

  it('detects trailing currency code: 100 USD', () => {
    expect(detectCurrency('100 USD')).toBe('$');
  });

  it('detects trailing currency code: 50 EUR', () => {
    expect(detectCurrency('50 EUR')).toBe('€');
  });

  it('returns undefined for plain number', () => {
    expect(detectCurrency('100')).toBeUndefined();
  });

  it('returns undefined for text', () => {
    expect(detectCurrency('hello')).toBeUndefined();
  });
});

describe('detectPercentage', () => {
  it('detects trailing %', () => {
    expect(detectPercentage('50%')).toBe(true);
  });

  it('detects with space before %', () => {
    expect(detectPercentage('50 %')).toBe(true);
  });

  it('returns false for plain number', () => {
    expect(detectPercentage('50')).toBe(false);
  });
});

describe('parseFraction', () => {
  it('parses 1/2 → 0.5', () => {
    expect(parseFraction('1/2')).toBe(0.5);
  });

  it('parses 3/4 → 0.75', () => {
    expect(parseFraction('3/4')).toBe(0.75);
  });

  it('parses mixed number: 3 1/4 → 3.25', () => {
    expect(parseFraction('3 1/4')).toBe(3.25);
  });

  it('parses negative mixed: -2 1/2 → -2.5', () => {
    expect(parseFraction('-2 1/2')).toBe(-2.5);
  });

  it('returns null for date-like: 1/2/2024', () => {
    expect(parseFraction('1/2/2024')).toBeNull();
  });

  it('returns null for division by zero', () => {
    expect(parseFraction('1/0')).toBeNull();
  });

  it('returns null for plain text', () => {
    expect(parseFraction('hello')).toBeNull();
  });

  it('returns null for plain number', () => {
    expect(parseFraction('42')).toBeNull();
  });
});

describe('stripCurrency', () => {
  it('strips $ from $100', () => {
    expect(stripCurrency('$100')).toBe('100');
  });

  it('strips € from €50', () => {
    expect(stripCurrency('€50')).toBe('50');
  });

  it('strips trailing currency code', () => {
    expect(stripCurrency('100 USD')).toBe('100');
  });

  it('strips currency code BRL', () => {
    expect(stripCurrency('50 BRL')).toBe('50');
  });
});

describe('stripPercentage', () => {
  it('strips % from 50%', () => {
    expect(stripPercentage('50%')).toBe('50');
  });

  it('strips multiple %', () => {
    expect(stripPercentage('50%%')).toBe('50');
  });
});
