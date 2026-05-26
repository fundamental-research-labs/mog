/**
 * Formula String Runtime Functions
 *
 * Extracted from @mog-sdk/contracts/cells/formula-string.
 */

import type { FormulaA1, FormulaTemplate } from '@mog-sdk/contracts/cells/formula-string';

/**
 * Assert a string is FormulaA1 (has `=` prefix). Throws in dev if not.
 */
export function asFormulaA1(s: string): FormulaA1 {
  if (!s.startsWith('=')) {
    throw new Error(`Expected FormulaA1 (with "=" prefix), got: "${s.slice(0, 40)}"`);
  }
  return s as FormulaA1;
}

/**
 * Convert a FormulaTemplate to FormulaA1 by prepending `=`.
 */
export function toFormulaA1(template: FormulaTemplate): FormulaA1 {
  return `=${template}` as FormulaA1;
}

/**
 * Assert a string is FormulaTemplate (no `=` prefix). Throws in dev if not.
 */
export function asFormulaTemplate(s: string): FormulaTemplate {
  if (s.startsWith('=')) {
    throw new Error(`Expected FormulaTemplate (without "=" prefix), got: "${s.slice(0, 40)}"`);
  }
  return s as FormulaTemplate;
}

/**
 * Convert a FormulaA1 to FormulaTemplate by stripping the `=` prefix.
 */
export function toFormulaTemplate(a1: FormulaA1): FormulaTemplate {
  return a1.slice(1) as FormulaTemplate;
}

/**
 * Normalize a string of unknown format to FormulaA1.
 */
export function ensureFormulaA1(s: string): FormulaA1 {
  return (s.startsWith('=') ? s : `=${s}`) as FormulaA1;
}
