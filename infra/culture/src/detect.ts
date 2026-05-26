/**
 * Input Detection
 *
 * Pure functions for detecting currency, percentage, and fraction
 * patterns in user input.
 */

/**
 * Common currency symbols for detection.
 */
const CURRENCY_SYMBOLS = [
  '$',
  '€',
  '£',
  '¥',
  '₹',
  '₩',
  '₽',
  '₺',
  '฿',
  '₱',
  'CHF',
  'CA$',
  'A$',
  'HK$',
  'NT$',
  'S$',
  'R$',
  'Mex$',
  'AED',
  'SAR',
];

/**
 * Pattern to match currency symbols at start or end of string.
 */
const CURRENCY_PATTERN = new RegExp(
  `^(${CURRENCY_SYMBOLS.map((s) => s.replace('$', '\\$')).join('|')})\\s*|\\s*(${CURRENCY_SYMBOLS.map((s) => s.replace('$', '\\$')).join('|')})$`,
  'i',
);

/**
 * Detect currency from input.
 * Returns the currency symbol if detected, undefined otherwise.
 *
 * Examples: "$100" → "$", "50 EUR" → "€", "£99.99" → "£"
 */
export function detectCurrency(input: string): string | undefined {
  const match = input.match(CURRENCY_PATTERN);
  if (match) {
    return (match[1] || match[2])?.trim();
  }

  const codeMatch = input.match(/\s+(USD|EUR|GBP|JPY|CNY|INR|KRW|RUB|TRY|BRL)$/i);
  if (codeMatch) {
    const code = codeMatch[1].toUpperCase();
    const symbolMap: Record<string, string> = {
      USD: '$',
      EUR: '€',
      GBP: '£',
      JPY: '¥',
      CNY: '¥',
      INR: '₹',
      KRW: '₩',
      RUB: '₽',
      TRY: '₺',
      BRL: 'R$',
    };
    return symbolMap[code];
  }

  return undefined;
}

/**
 * Detect percentage from input.
 * Returns true if input ends with %.
 */
export function detectPercentage(input: string): boolean {
  return input.trim().endsWith('%');
}

/**
 * Parse fraction input and convert to decimal.
 * Returns the decimal value, or null if not a fraction.
 *
 * Examples: "1/2" → 0.5, "3 1/4" → 3.25, "1/2/2024" → null (date)
 */
export function parseFraction(input: string): number | null {
  const trimmed = input.trim();

  // Mixed number: "3 1/4" → 3.25
  const mixedMatch = trimmed.match(/^(-?\d+)\s+(\d+)\/(\d+)$/);
  if (mixedMatch) {
    const whole = parseInt(mixedMatch[1], 10);
    const numerator = parseInt(mixedMatch[2], 10);
    const denominator = parseInt(mixedMatch[3], 10);
    if (denominator === 0) return null;
    const sign = whole < 0 ? -1 : 1;
    return whole + sign * (numerator / denominator);
  }

  // Simple fraction: "1/2" → 0.5
  const simpleMatch = trimmed.match(/^(-?\d+)\/(\d+)$/);
  if (simpleMatch) {
    const numerator = parseInt(simpleMatch[1], 10);
    const denominator = parseInt(simpleMatch[2], 10);
    if (denominator === 0) return null;
    if (isLikelyDate(trimmed)) return null;
    return numerator / denominator;
  }

  return null;
}

/**
 * Strip currency symbols from input for number parsing.
 */
export function stripCurrency(input: string): string {
  let result = input;

  for (const symbol of CURRENCY_SYMBOLS) {
    const escaped = symbol.replace('$', '\\$');
    result = result.replace(new RegExp(escaped, 'gi'), '');
  }

  result = result.replace(/\s*(USD|EUR|GBP|JPY|CNY|INR|KRW|RUB|TRY|BRL)\s*/gi, '');

  return result.trim();
}

/**
 * Strip percentage sign from input.
 */
export function stripPercentage(input: string): string {
  return input.replace(/%/g, '').trim();
}

/**
 * Check if a slash-separated input is more likely a date than a fraction.
 */
function isLikelyDate(input: string): boolean {
  const parts = input.split('/');

  if (parts.length > 2) return true;

  if (parts.length === 2) {
    const [a, b] = parts.map((p) => parseInt(p, 10));
    if (b > 31) return false;
    const commonDenominators = [2, 3, 4, 5, 6, 8, 10, 16];
    if (commonDenominators.includes(b)) {
      if (a < b) return false;
    }
    return false;
  }

  return false;
}
