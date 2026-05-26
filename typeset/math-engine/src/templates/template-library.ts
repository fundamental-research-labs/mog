/**
 * Template Library
 *
 * Common equation templates as MathNode[] factories.
 * Each template returns a ready-to-use AST.
 */

import type {
  DelimiterNode,
  FractionNode,
  LimLowNode,
  MathNode,
  MathRun,
  MatrixNode,
  NaryNode,
  RadicalNode,
  SuperscriptNode,
} from '@mog-sdk/contracts/equation/omml-ast';

function run(text: string): MathRun {
  return { type: 'r', text };
}

function norRun(text: string): MathRun {
  return { type: 'r', text, rPr: { nor: true } };
}

/**
 * Quadratic formula: x = (-b +/- sqrt(b^2 - 4ac)) / 2a
 */
export function createQuadraticFormula(): MathNode[] {
  const bSquared: SuperscriptNode = {
    type: 'sSup',
    e: [run('b')],
    sup: [run('2')],
  };

  const discriminant: RadicalNode = {
    type: 'rad',
    degHide: true,
    deg: [],
    e: [bSquared, run('\u2212'), run('4'), run('a'), run('c')],
  };

  const numerator: MathNode[] = [run('\u2212'), run('b'), run('\u00B1'), discriminant];

  const denominator: MathNode[] = [run('2'), run('a')];

  const fraction: FractionNode = {
    type: 'f',
    fractionType: 'bar',
    num: numerator,
    den: denominator,
  };

  return [run('x'), run('='), fraction];
}

/**
 * Pythagorean theorem: a^2 + b^2 = c^2
 */
export function createPythagoreanTheorem(): MathNode[] {
  const aSquared: SuperscriptNode = {
    type: 'sSup',
    e: [run('a')],
    sup: [run('2')],
  };
  const bSquared: SuperscriptNode = {
    type: 'sSup',
    e: [run('b')],
    sup: [run('2')],
  };
  const cSquared: SuperscriptNode = {
    type: 'sSup',
    e: [run('c')],
    sup: [run('2')],
  };

  return [aSquared, run('+'), bSquared, run('='), cSquared];
}

/**
 * Euler's identity: e^(i*pi) + 1 = 0
 */
export function createEulersIdentity(): MathNode[] {
  const exponent: SuperscriptNode = {
    type: 'sSup',
    e: [run('e')],
    sup: [run('i'), run('\u03C0')],
  };

  return [exponent, run('+'), run('1'), run('='), run('0')];
}

/**
 * Binomial theorem: (x+y)^n = sum_{k=0}^{n} C(n,k) x^(n-k) y^k
 */
export function createBinomialTheorem(): MathNode[] {
  const lhs: SuperscriptNode = {
    type: 'sSup',
    e: [
      {
        type: 'd',
        begChr: '(',
        endChr: ')',
        e: [[run('x'), run('+'), run('y')]],
      } as DelimiterNode,
    ],
    sup: [run('n')],
  };

  const binomCoeff: FractionNode = {
    type: 'f',
    fractionType: 'noBar',
    num: [run('n')],
    den: [run('k')],
  };

  const xPower: SuperscriptNode = {
    type: 'sSup',
    e: [run('x')],
    sup: [run('n'), run('\u2212'), run('k')],
  };

  const yPower: SuperscriptNode = {
    type: 'sSup',
    e: [run('y')],
    sup: [run('k')],
  };

  const summation: NaryNode = {
    type: 'nary',
    chr: '\u2211',
    limLoc: 'undOvr',
    sub: [run('k'), run('='), run('0')],
    sup: [run('n')],
    e: [
      {
        type: 'd',
        begChr: '(',
        endChr: ')',
        e: [[binomCoeff]],
      } as DelimiterNode,
      xPower,
      yPower,
    ],
  };

  return [lhs, run('='), summation];
}

/**
 * Standard derivative: f'(x) = lim_{h->0} (f(x+h) - f(x)) / h
 */
export function createStandardDerivative(): MathNode[] {
  const limitBase: LimLowNode = {
    type: 'limLow',
    e: [norRun('lim')],
    lim: [run('h'), run('\u2192'), run('0')],
  };

  const numerator: MathNode[] = [
    run('f'),
    {
      type: 'd',
      begChr: '(',
      endChr: ')',
      e: [[run('x'), run('+'), run('h')]],
    } as DelimiterNode,
    run('\u2212'),
    run('f'),
    {
      type: 'd',
      begChr: '(',
      endChr: ')',
      e: [[run('x')]],
    } as DelimiterNode,
  ];

  const fraction: FractionNode = {
    type: 'f',
    fractionType: 'bar',
    num: numerator,
    den: [run('h')],
  };

  return [
    run('f'),
    run("'"),
    { type: 'd', begChr: '(', endChr: ')', e: [[run('x')]] } as DelimiterNode,
    run('='),
    limitBase,
    fraction,
  ];
}

/**
 * Standard integral: integral from a to b of f(x) dx
 */
export function createStandardIntegral(): MathNode[] {
  const integral: NaryNode = {
    type: 'nary',
    chr: '\u222B',
    limLoc: 'subSup',
    sub: [run('a')],
    sup: [run('b')],
    e: [
      run('f'),
      {
        type: 'd',
        begChr: '(',
        endChr: ')',
        e: [[run('x')]],
      } as DelimiterNode,
      run('\u2009'), // thin space
      run('d'),
      run('x'),
    ],
  };

  return [integral];
}

/**
 * Matrix multiplication: C = A * B (2x2)
 */
export function createMatrixMultiplication(): MathNode[] {
  const matA: DelimiterNode = {
    type: 'd',
    begChr: '(',
    endChr: ')',
    e: [
      [
        {
          type: 'm',
          mr: [
            [[run('a')], [run('b')]],
            [[run('c')], [run('d')]],
          ],
        } as MatrixNode,
      ],
    ],
  };

  const matB: DelimiterNode = {
    type: 'd',
    begChr: '(',
    endChr: ')',
    e: [
      [
        {
          type: 'm',
          mr: [
            [[run('e')], [run('f')]],
            [[run('g')], [run('h')]],
          ],
        } as MatrixNode,
      ],
    ],
  };

  return [run('C'), run('='), matA, run('\u22C5'), matB];
}

/**
 * Summation notation: sum_{i=1}^{n} i = n(n+1)/2
 */
export function createSummationNotation(): MathNode[] {
  const summation: NaryNode = {
    type: 'nary',
    chr: '\u2211',
    limLoc: 'undOvr',
    sub: [run('i'), run('='), run('1')],
    sup: [run('n')],
    e: [run('i')],
  };

  const rhs: FractionNode = {
    type: 'f',
    fractionType: 'bar',
    num: [
      run('n'),
      {
        type: 'd',
        begChr: '(',
        endChr: ')',
        e: [[run('n'), run('+'), run('1')]],
      } as DelimiterNode,
    ],
    den: [run('2')],
  };

  return [summation, run('='), rhs];
}

/**
 * Product notation: n! = prod_{k=1}^{n} k
 */
export function createProductNotation(): MathNode[] {
  const product: NaryNode = {
    type: 'nary',
    chr: '\u220F',
    limLoc: 'undOvr',
    sub: [run('k'), run('='), run('1')],
    sup: [run('n')],
    e: [run('k')],
  };

  return [run('n'), run('!'), run('='), product];
}
