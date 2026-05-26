/**
 * Equation Templates
 *
 * Pre-defined equation templates matching Excel's Equation gallery.
 * Moved from kernel/src/equation/contracts-runtime/templates.ts so that
 * any package depending on @mog/math-engine can use them without
 * pulling in the kernel.
 */

import type { EquationTemplate, EquationTemplateCategory } from '@mog-sdk/contracts/equation';

export const FRACTION_TEMPLATES: EquationTemplate[] = [
  {
    id: 'frac-simple',
    name: 'Simple Fraction',
    category: 'fractions',
    latex: '\\frac{a}{b}',
    omml: '<m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>',
    thumbnail: '',
    placeholders: ['a', 'b'],
  },
  {
    id: 'frac-stacked',
    name: 'Stacked Fraction',
    category: 'fractions',
    latex: '\\frac{x+1}{x-1}',
    omml: '',
    thumbnail: '',
    placeholders: ['x+1', 'x-1'],
  },
  {
    id: 'frac-skewed',
    name: 'Skewed Fraction',
    category: 'fractions',
    latex: '^a/_b',
    omml: '',
    thumbnail: '',
    placeholders: ['a', 'b'],
  },
];

export const RADICAL_TEMPLATES: EquationTemplate[] = [
  {
    id: 'rad-square',
    name: 'Square Root',
    category: 'radicals',
    latex: '\\sqrt{x}',
    omml: '<m:oMath><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad></m:oMath>',
    thumbnail: '',
    placeholders: ['x'],
  },
  {
    id: 'rad-nth',
    name: 'N-th Root',
    category: 'radicals',
    latex: '\\sqrt[n]{x}',
    omml: '',
    thumbnail: '',
    placeholders: ['n', 'x'],
  },
  {
    id: 'rad-quadratic',
    name: 'Quadratic Formula',
    category: 'radicals',
    latex: '\\frac{-b \\pm \\sqrt{b^2-4ac}}{2a}',
    omml: '',
    thumbnail: '',
    placeholders: ['a', 'b', 'c'],
  },
];

export const INTEGRAL_TEMPLATES: EquationTemplate[] = [
  {
    id: 'int-indefinite',
    name: 'Indefinite Integral',
    category: 'integrals',
    latex: '\\int f(x)\\,dx',
    omml: '',
    thumbnail: '',
    placeholders: ['f(x)'],
  },
  {
    id: 'int-definite',
    name: 'Definite Integral',
    category: 'integrals',
    latex: '\\int_{a}^{b} f(x)\\,dx',
    omml: '',
    thumbnail: '',
    placeholders: ['a', 'b', 'f(x)'],
  },
  {
    id: 'int-double',
    name: 'Double Integral',
    category: 'integrals',
    latex: '\\iint_D f(x,y)\\,dA',
    omml: '',
    thumbnail: '',
    placeholders: ['D', 'f(x,y)'],
  },
  {
    id: 'int-contour',
    name: 'Contour Integral',
    category: 'integrals',
    latex: '\\oint_C f(z)\\,dz',
    omml: '',
    thumbnail: '',
    placeholders: ['C', 'f(z)'],
  },
];

export const LARGE_OPERATOR_TEMPLATES: EquationTemplate[] = [
  {
    id: 'sum-simple',
    name: 'Summation',
    category: 'large-operators',
    latex: '\\sum_{i=1}^{n} a_i',
    omml: '',
    thumbnail: '',
    placeholders: ['i', 'n', 'a_i'],
  },
  {
    id: 'prod-simple',
    name: 'Product',
    category: 'large-operators',
    latex: '\\prod_{i=1}^{n} a_i',
    omml: '',
    thumbnail: '',
    placeholders: ['i', 'n', 'a_i'],
  },
  {
    id: 'limit-simple',
    name: 'Limit',
    category: 'large-operators',
    latex: '\\lim_{x \\to \\infty} f(x)',
    omml: '',
    thumbnail: '',
    placeholders: ['x', '\u221e', 'f(x)'],
  },
];

export const MATRIX_TEMPLATES: EquationTemplate[] = [
  {
    id: 'matrix-2x2',
    name: '2x2 Matrix',
    category: 'matrices',
    latex: '\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}',
    omml: '',
    thumbnail: '',
    placeholders: ['a', 'b', 'c', 'd'],
  },
  {
    id: 'matrix-3x3',
    name: '3x3 Matrix',
    category: 'matrices',
    latex: '\\begin{pmatrix} a & b & c \\\\ d & e & f \\\\ g & h & i \\end{pmatrix}',
    omml: '',
    thumbnail: '',
    placeholders: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i'],
  },
  {
    id: 'matrix-det',
    name: 'Determinant',
    category: 'matrices',
    latex: '\\begin{vmatrix} a & b \\\\ c & d \\end{vmatrix}',
    omml: '',
    thumbnail: '',
    placeholders: ['a', 'b', 'c', 'd'],
  },
];

export const SCRIPT_TEMPLATES: EquationTemplate[] = [
  {
    id: 'script-super',
    name: 'Superscript',
    category: 'scripts',
    latex: 'x^n',
    omml: '',
    thumbnail: '',
    placeholders: ['x', 'n'],
  },
  {
    id: 'script-sub',
    name: 'Subscript',
    category: 'scripts',
    latex: 'x_i',
    omml: '',
    thumbnail: '',
    placeholders: ['x', 'i'],
  },
  {
    id: 'script-both',
    name: 'Sub and Superscript',
    category: 'scripts',
    latex: 'x_i^n',
    omml: '',
    thumbnail: '',
    placeholders: ['x', 'i', 'n'],
  },
];

export const ALL_EQUATION_TEMPLATES: EquationTemplate[] = [
  ...FRACTION_TEMPLATES,
  ...RADICAL_TEMPLATES,
  ...INTEGRAL_TEMPLATES,
  ...LARGE_OPERATOR_TEMPLATES,
  ...MATRIX_TEMPLATES,
  ...SCRIPT_TEMPLATES,
];

export function getTemplatesByCategory(category: EquationTemplateCategory): EquationTemplate[] {
  return ALL_EQUATION_TEMPLATES.filter((t) => t.category === category);
}
