/**
 * Equation Templates
 *
 * Predefined LaTeX equation templates organized by category.
 * These templates provide quick access to common mathematical expressions.
 *
 */

import type { EquationTemplate, EquationTemplateCategory } from '../../ui-store';

// =============================================================================
// Basic Math Templates
// =============================================================================

const BASIC_TEMPLATES: EquationTemplate[] = [
  {
    id: 'basic-fraction',
    name: 'Fraction',
    latex: '\\frac{a}{b}',
    category: 'basic',
  },
  {
    id: 'basic-sqrt',
    name: 'Square Root',
    latex: '\\sqrt{x}',
    category: 'basic',
  },
  {
    id: 'basic-nthroot',
    name: 'Nth Root',
    latex: '\\sqrt[n]{x}',
    category: 'basic',
  },
  {
    id: 'basic-power',
    name: 'Power',
    latex: 'x^{n}',
    category: 'basic',
  },
  {
    id: 'basic-subscript',
    name: 'Subscript',
    latex: 'x_{i}',
    category: 'basic',
  },
  {
    id: 'basic-superscript-subscript',
    name: 'Super/Subscript',
    latex: 'x_{i}^{n}',
    category: 'basic',
  },
  {
    id: 'basic-abs',
    name: 'Absolute Value',
    latex: '|x|',
    category: 'basic',
  },
  {
    id: 'basic-parentheses',
    name: 'Parentheses',
    latex: '\\left( x \\right)',
    category: 'basic',
  },
  {
    id: 'basic-brackets',
    name: 'Square Brackets',
    latex: '\\left[ x \\right]',
    category: 'basic',
  },
  {
    id: 'basic-braces',
    name: 'Curly Braces',
    latex: '\\left\\{ x \\right\\}',
    category: 'basic',
  },
];

// =============================================================================
// Algebra Templates
// =============================================================================

const ALGEBRA_TEMPLATES: EquationTemplate[] = [
  {
    id: 'algebra-quadratic',
    name: 'Quadratic Formula',
    latex: 'x = \\frac{-b \\pm \\sqrt{b^2 - 4ac}}{2a}',
    category: 'algebra',
  },
  {
    id: 'algebra-binomial',
    name: 'Binomial Expansion',
    latex: '(a + b)^n = \\sum_{k=0}^{n} \\binom{n}{k} a^{n-k} b^k',
    category: 'algebra',
  },
  {
    id: 'algebra-log',
    name: 'Logarithm',
    latex: '\\log_{a}(x)',
    category: 'algebra',
  },
  {
    id: 'algebra-ln',
    name: 'Natural Log',
    latex: '\\ln(x)',
    category: 'algebra',
  },
  {
    id: 'algebra-exp',
    name: 'Exponential',
    latex: 'e^{x}',
    category: 'algebra',
  },
  {
    id: 'algebra-sum',
    name: 'Summation',
    latex: '\\sum_{i=1}^{n} x_i',
    category: 'algebra',
  },
  {
    id: 'algebra-product',
    name: 'Product',
    latex: '\\prod_{i=1}^{n} x_i',
    category: 'algebra',
  },
  {
    id: 'algebra-factorial',
    name: 'Factorial',
    latex: 'n!',
    category: 'algebra',
  },
  {
    id: 'algebra-combination',
    name: 'Combination',
    latex: '\\binom{n}{k}',
    category: 'algebra',
  },
  {
    id: 'algebra-inequality',
    name: 'Inequality',
    latex: 'a \\leq x \\leq b',
    category: 'algebra',
  },
];

// =============================================================================
// Calculus Templates
// =============================================================================

const CALCULUS_TEMPLATES: EquationTemplate[] = [
  {
    id: 'calculus-derivative',
    name: 'Derivative',
    latex: '\\frac{d}{dx}f(x)',
    category: 'calculus',
  },
  {
    id: 'calculus-partial',
    name: 'Partial Derivative',
    latex: '\\frac{\\partial f}{\\partial x}',
    category: 'calculus',
  },
  {
    id: 'calculus-integral',
    name: 'Definite Integral',
    latex: '\\int_{a}^{b} f(x) \\, dx',
    category: 'calculus',
  },
  {
    id: 'calculus-indefinite',
    name: 'Indefinite Integral',
    latex: '\\int f(x) \\, dx',
    category: 'calculus',
  },
  {
    id: 'calculus-double-integral',
    name: 'Double Integral',
    latex: '\\iint_{D} f(x,y) \\, dA',
    category: 'calculus',
  },
  {
    id: 'calculus-limit',
    name: 'Limit',
    latex: '\\lim_{x \\to a} f(x)',
    category: 'calculus',
  },
  {
    id: 'calculus-infinity-limit',
    name: 'Limit at Infinity',
    latex: '\\lim_{x \\to \\infty} f(x)',
    category: 'calculus',
  },
  {
    id: 'calculus-gradient',
    name: 'Gradient',
    latex: '\\nabla f',
    category: 'calculus',
  },
  {
    id: 'calculus-taylor',
    name: 'Taylor Series',
    latex: 'f(x) = \\sum_{n=0}^{\\infty} \\frac{f^{(n)}(a)}{n!}(x-a)^n',
    category: 'calculus',
  },
  {
    id: 'calculus-chain',
    name: 'Chain Rule',
    latex: '\\frac{dy}{dx} = \\frac{dy}{du} \\cdot \\frac{du}{dx}',
    category: 'calculus',
  },
];

// =============================================================================
// Statistics Templates
// =============================================================================

const STATISTICS_TEMPLATES: EquationTemplate[] = [
  {
    id: 'stats-mean',
    name: 'Sample Mean',
    latex: '\\bar{x} = \\frac{1}{n} \\sum_{i=1}^{n} x_i',
    category: 'statistics',
  },
  {
    id: 'stats-variance',
    name: 'Variance',
    latex: 's^2 = \\frac{1}{n-1} \\sum_{i=1}^{n} (x_i - \\bar{x})^2',
    category: 'statistics',
  },
  {
    id: 'stats-stddev',
    name: 'Standard Deviation',
    latex: 's = \\sqrt{\\frac{1}{n-1} \\sum_{i=1}^{n} (x_i - \\bar{x})^2}',
    category: 'statistics',
  },
  {
    id: 'stats-correlation',
    name: 'Correlation',
    latex:
      'r = \\frac{\\sum (x_i - \\bar{x})(y_i - \\bar{y})}{\\sqrt{\\sum (x_i - \\bar{x})^2 \\sum (y_i - \\bar{y})^2}}',
    category: 'statistics',
  },
  {
    id: 'stats-zscore',
    name: 'Z-Score',
    latex: 'z = \\frac{x - \\mu}{\\sigma}',
    category: 'statistics',
  },
  {
    id: 'stats-normal',
    name: 'Normal Distribution',
    latex: 'f(x) = \\frac{1}{\\sigma\\sqrt{2\\pi}} e^{-\\frac{(x-\\mu)^2}{2\\sigma^2}}',
    category: 'statistics',
  },
  {
    id: 'stats-probability',
    name: 'Conditional Probability',
    latex: 'P(A|B) = \\frac{P(A \\cap B)}{P(B)}',
    category: 'statistics',
  },
  {
    id: 'stats-bayes',
    name: "Bayes' Theorem",
    latex: 'P(A|B) = \\frac{P(B|A) P(A)}{P(B)}',
    category: 'statistics',
  },
  {
    id: 'stats-expected',
    name: 'Expected Value',
    latex: 'E[X] = \\sum_{i=1}^{n} x_i P(x_i)',
    category: 'statistics',
  },
  {
    id: 'stats-regression',
    name: 'Linear Regression',
    latex: 'y = \\beta_0 + \\beta_1 x + \\epsilon',
    category: 'statistics',
  },
];

// =============================================================================
// Greek Letters Templates
// =============================================================================

const GREEK_TEMPLATES: EquationTemplate[] = [
  {
    id: 'greek-alpha',
    name: 'Alpha',
    latex: '\\alpha',
    category: 'greek',
  },
  {
    id: 'greek-beta',
    name: 'Beta',
    latex: '\\beta',
    category: 'greek',
  },
  {
    id: 'greek-gamma',
    name: 'Gamma',
    latex: '\\gamma',
    category: 'greek',
  },
  {
    id: 'greek-delta',
    name: 'Delta',
    latex: '\\delta',
    category: 'greek',
  },
  {
    id: 'greek-epsilon',
    name: 'Epsilon',
    latex: '\\epsilon',
    category: 'greek',
  },
  {
    id: 'greek-theta',
    name: 'Theta',
    latex: '\\theta',
    category: 'greek',
  },
  {
    id: 'greek-lambda',
    name: 'Lambda',
    latex: '\\lambda',
    category: 'greek',
  },
  {
    id: 'greek-mu',
    name: 'Mu',
    latex: '\\mu',
    category: 'greek',
  },
  {
    id: 'greek-pi',
    name: 'Pi',
    latex: '\\pi',
    category: 'greek',
  },
  {
    id: 'greek-sigma',
    name: 'Sigma',
    latex: '\\sigma',
    category: 'greek',
  },
  {
    id: 'greek-omega',
    name: 'Omega',
    latex: '\\omega',
    category: 'greek',
  },
  {
    id: 'greek-infinity',
    name: 'Infinity',
    latex: '\\infty',
    category: 'greek',
  },
];

// =============================================================================
// Combined Templates Map
// =============================================================================

/** All templates organized by category */
export const EQUATION_TEMPLATES_BY_CATEGORY: Record<EquationTemplateCategory, EquationTemplate[]> =
  {
    recent: [], // Populated dynamically from user history
    basic: BASIC_TEMPLATES,
    algebra: ALGEBRA_TEMPLATES,
    calculus: CALCULUS_TEMPLATES,
    statistics: STATISTICS_TEMPLATES,
    greek: GREEK_TEMPLATES,
  };

/** All templates as a flat array */
export const ALL_EQUATION_TEMPLATES: EquationTemplate[] = [
  ...BASIC_TEMPLATES,
  ...ALGEBRA_TEMPLATES,
  ...CALCULUS_TEMPLATES,
  ...STATISTICS_TEMPLATES,
  ...GREEK_TEMPLATES,
];

/** Template category display names */
export const CATEGORY_DISPLAY_NAMES: Record<EquationTemplateCategory, string> = {
  recent: 'Recent',
  basic: 'Basic Math',
  algebra: 'Algebra',
  calculus: 'Calculus',
  statistics: 'Statistics',
  greek: 'Greek & Symbols',
};

/**
 * Get a template by ID
 */
export function getTemplateById(id: string): EquationTemplate | undefined {
  return ALL_EQUATION_TEMPLATES.find((t) => t.id === id);
}

/**
 * Get templates for a category
 */
export function getTemplatesForCategory(category: EquationTemplateCategory): EquationTemplate[] {
  return EQUATION_TEMPLATES_BY_CATEGORY[category] ?? [];
}

/**
 * Get recent templates from IDs
 */
export function getRecentTemplates(recentIds: string[]): EquationTemplate[] {
  return recentIds
    .map((id) => getTemplateById(id))
    .filter((t): t is EquationTemplate => t !== undefined);
}
