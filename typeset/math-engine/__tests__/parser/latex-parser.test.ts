/**
 * LaTeX Parser Tests
 *
 * Tests parsing of LaTeX math syntax into MathAST.
 */

import type { MathNode } from '@mog-sdk/contracts/equation/omml-ast';
import { parseLatex } from '../../src/parser/latex-parser';

function parseOk(latex: string): MathNode[] {
  const result = parseLatex(latex);
  if (!result.ok) {
    throw new Error(`Parse failed: ${result.error.message}`);
  }
  return result.value;
}

describe('LaTeX Parser', () => {
  describe('simple text', () => {
    it('parses single character', () => {
      const nodes = parseOk('x');
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe('r');
      expect((nodes[0] as any).text).toBe('x');
    });

    it('parses multiple characters', () => {
      const nodes = parseOk('abc');
      expect(nodes.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('fractions', () => {
    it('parses \\frac{a}{b}', () => {
      const nodes = parseOk('\\frac{a}{b}');
      expect(nodes).toHaveLength(1);
      const frac = nodes[0] as MathNode & { type: 'f' };
      expect(frac.type).toBe('f');
      expect(frac.fractionType).toBe('bar');
      expect(frac.num).toHaveLength(1);
      expect(frac.den).toHaveLength(1);
    });

    it('parses \\frac with complex numerator/denominator', () => {
      const nodes = parseOk('\\frac{x+1}{x-1}');
      const frac = nodes[0] as MathNode & { type: 'f' };
      expect(frac.type).toBe('f');
      expect(frac.num.length).toBeGreaterThan(0);
      expect(frac.den.length).toBeGreaterThan(0);
    });

    it('parses \\dfrac', () => {
      const nodes = parseOk('\\dfrac{a}{b}');
      expect(nodes[0].type).toBe('f');
    });
  });

  describe('radicals', () => {
    it('parses \\sqrt{x}', () => {
      const nodes = parseOk('\\sqrt{x}');
      expect(nodes).toHaveLength(1);
      const rad = nodes[0] as MathNode & { type: 'rad' };
      expect(rad.type).toBe('rad');
      expect(rad.degHide).toBe(true);
      expect(rad.e).toHaveLength(1);
    });

    it('parses \\sqrt[n]{x}', () => {
      const nodes = parseOk('\\sqrt[n]{x}');
      const rad = nodes[0] as MathNode & { type: 'rad' };
      expect(rad.type).toBe('rad');
      expect(rad.deg.length).toBeGreaterThan(0);
    });
  });

  describe('scripts', () => {
    it('parses x^{2}', () => {
      const nodes = parseOk('x^{2}');
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe('sSup');
    });

    it('parses x_{n}', () => {
      const nodes = parseOk('x_{n}');
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe('sSub');
    });

    it('parses x_{i}^{n} (sub+super)', () => {
      const nodes = parseOk('x_{i}^{n}');
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe('sSubSup');
    });

    it('parses x^{n}_{i} (super+sub)', () => {
      const nodes = parseOk('x^{n}_{i}');
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe('sSubSup');
    });

    it('parses single character exponent x^2', () => {
      const nodes = parseOk('x^2');
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe('sSup');
    });
  });

  describe('delimiters', () => {
    it('parses \\left(x\\right)', () => {
      const nodes = parseOk('\\left(x\\right)');
      expect(nodes).toHaveLength(1);
      const delim = nodes[0] as MathNode & { type: 'd' };
      expect(delim.type).toBe('d');
      expect(delim.begChr).toBe('(');
      expect(delim.endChr).toBe(')');
    });

    it('parses \\left[x\\right]', () => {
      const nodes = parseOk('\\left[x\\right]');
      const delim = nodes[0] as MathNode & { type: 'd' };
      expect(delim.begChr).toBe('[');
      expect(delim.endChr).toBe(']');
    });
  });

  describe('matrices', () => {
    it('parses \\begin{pmatrix}...\\end{pmatrix}', () => {
      const nodes = parseOk('\\begin{pmatrix} a & b \\\\ c & d \\end{pmatrix}');
      // Should produce a delimiter wrapping a matrix
      expect(nodes.length).toBeGreaterThan(0);
      // The outer node should be a delimiter (parenthesized matrix)
      const delim = nodes[0] as MathNode & { type: 'd' };
      expect(delim.type).toBe('d');
      expect(delim.begChr).toBe('(');
      expect(delim.endChr).toBe(')');
    });

    it('parses \\begin{bmatrix}...\\end{bmatrix}', () => {
      const nodes = parseOk('\\begin{bmatrix} a \\\\ b \\end{bmatrix}');
      expect(nodes.length).toBeGreaterThan(0);
      const delim = nodes[0] as MathNode & { type: 'd' };
      expect(delim.type).toBe('d');
      expect(delim.begChr).toBe('[');
    });
  });

  describe('accents', () => {
    it('parses \\hat{x}', () => {
      const nodes = parseOk('\\hat{x}');
      expect(nodes).toHaveLength(1);
      const acc = nodes[0] as MathNode & { type: 'acc' };
      expect(acc.type).toBe('acc');
      expect(acc.chr).toBe('\u0302');
    });

    it('parses \\tilde{x}', () => {
      const nodes = parseOk('\\tilde{x}');
      const acc = nodes[0] as MathNode & { type: 'acc' };
      expect(acc.type).toBe('acc');
      expect(acc.chr).toBe('\u0303');
    });

    it('parses \\vec{v}', () => {
      const nodes = parseOk('\\vec{v}');
      const acc = nodes[0] as MathNode & { type: 'acc' };
      expect(acc.type).toBe('acc');
      expect(acc.chr).toBe('\u20D7');
    });
  });

  describe('n-ary operators', () => {
    it('parses \\sum_{i=1}^{n}', () => {
      const nodes = parseOk('\\sum_{i=1}^{n}');
      expect(nodes.length).toBeGreaterThan(0);
      const nary = nodes[0] as MathNode & { type: 'nary' };
      expect(nary.type).toBe('nary');
      expect(nary.chr).toBe('\u2211');
    });

    it('parses \\int_{a}^{b}', () => {
      const nodes = parseOk('\\int_{a}^{b}');
      const nary = nodes[0] as MathNode & { type: 'nary' };
      expect(nary.type).toBe('nary');
      expect(nary.chr).toBe('\u222B');
      expect(nary.limLoc).toBe('subSup');
    });

    it('parses \\prod_{k=1}^{n}', () => {
      const nodes = parseOk('\\prod_{k=1}^{n}');
      const nary = nodes[0] as MathNode & { type: 'nary' };
      expect(nary.type).toBe('nary');
      expect(nary.chr).toBe('\u220F');
    });
  });

  describe('functions', () => {
    it('parses \\sin{x}', () => {
      const nodes = parseOk('\\sin{x}');
      expect(nodes.length).toBeGreaterThan(0);
      const func = nodes[0] as MathNode & { type: 'func' };
      expect(func.type).toBe('func');
    });

    it('parses \\lim with subscript', () => {
      const nodes = parseOk('\\lim_{x \\to 0}');
      expect(nodes.length).toBeGreaterThan(0);
      // Should parse as limLow
      expect(nodes[0].type).toBe('limLow');
    });
  });

  describe('Greek letters', () => {
    it('parses \\alpha', () => {
      const nodes = parseOk('\\alpha');
      expect(nodes).toHaveLength(1);
      expect((nodes[0] as any).text).toBe('\u03B1');
    });

    it('parses \\Omega', () => {
      const nodes = parseOk('\\Omega');
      expect(nodes).toHaveLength(1);
      expect((nodes[0] as any).text).toBe('\u03A9');
    });
  });

  describe('operators', () => {
    it('parses \\times', () => {
      const nodes = parseOk('\\times');
      expect(nodes).toHaveLength(1);
      expect((nodes[0] as any).text).toBe('\u00D7');
    });

    it('parses \\leq', () => {
      const nodes = parseOk('\\leq');
      expect((nodes[0] as any).text).toBe('\u2264');
    });

    it('parses \\infty', () => {
      const nodes = parseOk('\\infty');
      expect((nodes[0] as any).text).toBe('\u221E');
    });
  });

  describe('overline/underline', () => {
    it('parses \\overline{x}', () => {
      const nodes = parseOk('\\overline{x}');
      const bar = nodes[0] as MathNode & { type: 'bar' };
      expect(bar.type).toBe('bar');
      expect(bar.pos).toBe('top');
    });

    it('parses \\underline{x}', () => {
      const nodes = parseOk('\\underline{x}');
      const bar = nodes[0] as MathNode & { type: 'bar' };
      expect(bar.type).toBe('bar');
      expect(bar.pos).toBe('bot');
    });
  });

  describe('text commands', () => {
    it('parses \\text{hello}', () => {
      const nodes = parseOk('\\text{hello}');
      const run = nodes[0] as MathNode & { type: 'r' };
      expect(run.type).toBe('r');
      expect(run.text).toBe('hello');
      expect(run.rPr?.nor).toBe(true);
    });

    it('parses \\mathbf{x}', () => {
      const nodes = parseOk('\\mathbf{x}');
      const run = nodes[0] as MathNode & { type: 'r' };
      expect(run.rPr?.sty).toBe('b');
    });
  });

  describe('error handling', () => {
    it('returns error for empty input', () => {
      const result = parseLatex('');
      expect(result.ok).toBe(false);
    });

    it('handles malformed input gracefully', () => {
      // Should not throw
      const result = parseLatex('\\frac{');
      expect(result.ok).toBe(true);
    });
  });
});
