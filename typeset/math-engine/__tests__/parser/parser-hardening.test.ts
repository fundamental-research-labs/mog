/**
 * Parser Hardening Tests
 *
 * Tests for AI-generated LaTeX parser hardening.
 * Covers new commands, additional operators, and error recovery.
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

describe('Parser Hardening', () => {
  // =========================================================================
  // 1. Binomial coefficients
  // =========================================================================
  describe('\\binom', () => {
    it('parses \\binom{n}{k} as noBar fraction wrapped in delimiters', () => {
      const nodes = parseOk('\\binom{n}{k}');
      expect(nodes).toHaveLength(1);
      const delim = nodes[0] as any;
      expect(delim.type).toBe('d');
      expect(delim.begChr).toBe('(');
      expect(delim.endChr).toBe(')');
      // Content should be a single noBar fraction
      expect(delim.e).toHaveLength(1);
      expect(delim.e[0]).toHaveLength(1);
      const frac = delim.e[0][0];
      expect(frac.type).toBe('f');
      expect(frac.fractionType).toBe('noBar');
      expect(frac.num).toHaveLength(1);
      expect(frac.den).toHaveLength(1);
    });

    it('parses \\dbinom{n}{k}', () => {
      const nodes = parseOk('\\dbinom{n}{k}');
      expect(nodes).toHaveLength(1);
      const delim = nodes[0] as any;
      expect(delim.type).toBe('d');
      expect(delim.e[0][0].fractionType).toBe('noBar');
    });

    it('parses \\tbinom{n}{k}', () => {
      const nodes = parseOk('\\tbinom{n}{k}');
      expect(nodes).toHaveLength(1);
      const delim = nodes[0] as any;
      expect(delim.type).toBe('d');
      expect(delim.e[0][0].fractionType).toBe('noBar');
    });

    it('parses \\binom with complex content', () => {
      const nodes = parseOk('\\binom{n+1}{k-1}');
      const delim = nodes[0] as any;
      const frac = delim.e[0][0];
      expect(frac.num.length).toBeGreaterThan(1);
      expect(frac.den.length).toBeGreaterThan(1);
    });
  });

  // =========================================================================
  // 2. Continued fractions
  // =========================================================================
  describe('\\cfrac', () => {
    it('parses \\cfrac{a}{b} the same as \\frac', () => {
      const nodes = parseOk('\\cfrac{a}{b}');
      expect(nodes).toHaveLength(1);
      const frac = nodes[0] as any;
      expect(frac.type).toBe('f');
      expect(frac.fractionType).toBe('bar');
      expect(frac.num).toHaveLength(1);
      expect(frac.den).toHaveLength(1);
    });

    it('parses nested \\cfrac', () => {
      const nodes = parseOk('\\cfrac{1}{1+\\cfrac{1}{2}}');
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe('f');
    });
  });

  // =========================================================================
  // 3. Overset / underset / stackrel
  // =========================================================================
  describe('\\overset', () => {
    it('parses \\overset{a}{b} as LimUppNode', () => {
      const nodes = parseOk('\\overset{a}{b}');
      expect(nodes).toHaveLength(1);
      const node = nodes[0] as any;
      expect(node.type).toBe('limUpp');
      // First group is annotation (top), second is base
      expect(node.lim).toHaveLength(1);
      expect(node.lim[0].text).toBe('a');
      expect(node.e).toHaveLength(1);
      expect(node.e[0].text).toBe('b');
    });

    it('parses \\overset with complex content', () => {
      const nodes = parseOk('\\overset{\\sim}{=}');
      expect(nodes).toHaveLength(1);
      expect(nodes[0].type).toBe('limUpp');
    });
  });

  describe('\\underset', () => {
    it('parses \\underset{a}{b} as LimLowNode', () => {
      const nodes = parseOk('\\underset{a}{b}');
      expect(nodes).toHaveLength(1);
      const node = nodes[0] as any;
      expect(node.type).toBe('limLow');
      expect(node.lim).toHaveLength(1);
      expect(node.lim[0].text).toBe('a');
      expect(node.e).toHaveLength(1);
      expect(node.e[0].text).toBe('b');
    });
  });

  describe('\\stackrel', () => {
    it('parses \\stackrel{a}{b} same as \\overset', () => {
      const nodes = parseOk('\\stackrel{a}{b}');
      expect(nodes).toHaveLength(1);
      const node = nodes[0] as any;
      expect(node.type).toBe('limUpp');
      expect(node.lim[0].text).toBe('a');
      expect(node.e[0].text).toBe('b');
    });
  });

  // =========================================================================
  // 4. Sizing commands
  // =========================================================================
  describe('sizing commands', () => {
    it('\\displaystyle is consumed and content is still parsed', () => {
      const nodes = parseOk('\\displaystyle x');
      // Should produce a text run for 'x' (displaystyle is transparent)
      expect(nodes.length).toBeGreaterThanOrEqual(1);
      const hasX = nodes.some((n: any) => n.text === 'x');
      expect(hasX).toBe(true);
    });

    it('\\textstyle is consumed and content is still parsed', () => {
      const nodes = parseOk('\\textstyle \\frac{a}{b}');
      expect(nodes.length).toBeGreaterThanOrEqual(1);
      // Should have a fraction node
      const hasFrac = nodes.some((n: any) => n.type === 'f');
      expect(hasFrac).toBe(true);
    });

    it('\\scriptstyle is consumed without error', () => {
      const result = parseLatex('\\scriptstyle x');
      expect(result.ok).toBe(true);
    });

    it('\\scriptscriptstyle is consumed without error', () => {
      const result = parseLatex('\\scriptscriptstyle x');
      expect(result.ok).toBe(true);
    });
  });

  // =========================================================================
  // 5. Color commands
  // =========================================================================
  describe('color commands', () => {
    it('\\color{red}{x} parses without crash, content is preserved', () => {
      const nodes = parseOk('\\color{red}{x}');
      // Color is ignored, but x should be in the output
      expect(nodes.length).toBeGreaterThanOrEqual(1);
      const hasX = nodes.some((n: any) => n.text === 'x');
      expect(hasX).toBe(true);
    });

    it('\\textcolor{blue}{y} parses without crash', () => {
      const nodes = parseOk('\\textcolor{blue}{y}');
      expect(nodes.length).toBeGreaterThanOrEqual(1);
      const hasY = nodes.some((n: any) => n.text === 'y');
      expect(hasY).toBe(true);
    });

    it('\\colorbox{yellow}{z} parses without crash', () => {
      const nodes = parseOk('\\colorbox{yellow}{z}');
      expect(nodes.length).toBeGreaterThanOrEqual(1);
      const hasZ = nodes.some((n: any) => n.text === 'z');
      expect(hasZ).toBe(true);
    });

    it('\\color with complex content', () => {
      const nodes = parseOk('\\color{red}{\\frac{a}{b}}');
      // Should have a fraction somewhere in the output
      const hasFrac = nodes.some((n: any) => n.type === 'f');
      expect(hasFrac).toBe(true);
    });
  });

  // =========================================================================
  // 6. Extensible arrows
  // =========================================================================
  describe('extensible arrows', () => {
    it('\\xrightarrow{above} parses without error', () => {
      const nodes = parseOk('\\xrightarrow{above}');
      expect(nodes).toHaveLength(1);
      const node = nodes[0] as any;
      expect(node.type).toBe('limUpp');
      // Base should be right arrow
      expect(node.e[0].text).toBe('\u2192');
    });

    it('\\xleftarrow{above} parses without error', () => {
      const nodes = parseOk('\\xleftarrow{above}');
      expect(nodes).toHaveLength(1);
      const node = nodes[0] as any;
      expect(node.type).toBe('limUpp');
      expect(node.e[0].text).toBe('\u2190');
    });

    it('\\xleftarrow[below]{above} parses both parts', () => {
      const nodes = parseOk('\\xleftarrow[below]{above}');
      expect(nodes).toHaveLength(1);
      const node = nodes[0] as any;
      // Outer is LimLow (below annotation)
      expect(node.type).toBe('limLow');
      expect(node.lim.length).toBeGreaterThan(0);
      // Inner is LimUpp (above annotation wrapping arrow)
      expect(node.e[0].type).toBe('limUpp');
    });

    it('\\xrightarrow[n \\to \\infty]{f(x)} with complex content', () => {
      const result = parseLatex('\\xrightarrow[n \\to \\infty]{f(x)}');
      expect(result.ok).toBe(true);
    });
  });

  // =========================================================================
  // 7. Operator name
  // =========================================================================
  describe('\\operatorname', () => {
    it('parses \\operatorname{Var} as function node', () => {
      const nodes = parseOk('\\operatorname{Var}');
      expect(nodes).toHaveLength(1);
      const func = nodes[0] as any;
      expect(func.type).toBe('func');
      expect(func.fName).toHaveLength(1);
      expect(func.fName[0].text).toBe('Var');
      expect(func.fName[0].rPr?.nor).toBe(true);
    });

    it('parses \\operatorname{tr} with argument', () => {
      const nodes = parseOk('\\operatorname{tr}{A}');
      expect(nodes).toHaveLength(1);
      const func = nodes[0] as any;
      expect(func.type).toBe('func');
      expect(func.fName[0].text).toBe('tr');
      expect(func.e.length).toBeGreaterThan(0);
    });

    it('parses \\operatorname with subscript', () => {
      const nodes = parseOk('\\operatorname{argmin}_{x}');
      expect(nodes).toHaveLength(1);
      // Should be a subscript node wrapping the operator name
      expect(nodes[0].type).toBe('sSub');
    });
  });

  // =========================================================================
  // 8. Additional operators
  // =========================================================================
  describe('additional operators', () => {
    const operatorTests: [string, string][] = [
      ['le', '\u2264'],
      ['ge', '\u2265'],
      ['ne', '\u2260'],
      ['ll', '\u226A'],
      ['gg', '\u226B'],
      ['prec', '\u227A'],
      ['succ', '\u227B'],
      ['preceq', '\u2AAF'],
      ['succeq', '\u2AB0'],
      ['cong', '\u2245'],
      ['simeq', '\u2243'],
      ['uparrow', '\u2191'],
      ['downarrow', '\u2193'],
      ['updownarrow', '\u2195'],
      ['Uparrow', '\u21D1'],
      ['Downarrow', '\u21D3'],
      ['Updownarrow', '\u21D5'],
      ['hookrightarrow', '\u21AA'],
      ['hookleftarrow', '\u21A9'],
      ['setminus', '\u2216'],
      ['therefore', '\u2234'],
      ['because', '\u2235'],
      ['implies', '\u21D2'],
      ['iff', '\u21D4'],
      ['dots', '\u2026'],
      ['dagger', '\u2020'],
      ['ddagger', '\u2021'],
      ['star', '\u22C6'],
      ['circ', '\u2218'],
      ['bullet', '\u2022'],
      ['diamond', '\u22C4'],
      ['triangle', '\u25B3'],
      ['triangleleft', '\u25C1'],
      ['triangleright', '\u25B7'],
      ['angle', '\u2220'],
      ['perp', '\u22A5'],
      ['parallel', '\u2225'],
      ['quad', '\u2003'],
      ['qquad', '\u2003\u2003'],
    ];

    for (const [cmd, expected] of operatorTests) {
      it(`\\${cmd} produces correct Unicode ${expected.codePointAt(0)?.toString(16)}`, () => {
        const nodes = parseOk(`\\${cmd}`);
        expect(nodes).toHaveLength(1);
        expect((nodes[0] as any).text).toBe(expected);
      });
    }
  });

  // =========================================================================
  // 9. Error recovery
  // =========================================================================
  describe('error recovery', () => {
    it('\\frac{a} (missing second group) does not crash', () => {
      const result = parseLatex('\\frac{a}');
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should still produce a fraction node
        expect(result.value.length).toBeGreaterThanOrEqual(1);
      }
    });

    it('\\frac{a (missing closing brace and second group) does not crash', () => {
      const result = parseLatex('\\frac{a');
      expect(result.ok).toBe(true);
    });

    it('unmatched braces do not crash', () => {
      const result = parseLatex('x + {a + b');
      expect(result.ok).toBe(true);
    });

    it('\\left( without \\right produces partial result', () => {
      const result = parseLatex('\\left( x + y');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBeGreaterThan(0);
        // Should still produce a delimiter node
        const delim = result.value[0] as any;
        expect(delim.type).toBe('d');
      }
    });

    it('double backslash at end of input does not crash', () => {
      const result = parseLatex('x\\\\');
      expect(result.ok).toBe(true);
    });

    it('unknown command produces text fallback', () => {
      const nodes = parseOk('\\foobar');
      expect(nodes).toHaveLength(1);
      expect((nodes[0] as any).text).toBe('foobar');
    });

    it('deeply nested valid structures do not crash', () => {
      // 20 levels deep
      let latex = 'x';
      for (let i = 0; i < 20; i++) {
        latex = `\\frac{${latex}}{y}`;
      }
      const result = parseLatex(latex);
      expect(result.ok).toBe(true);
    });

    it('mixed valid and invalid commands produce partial results', () => {
      const result = parseLatex('\\alpha + \\invalidcmd + \\beta');
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should have alpha, +, invalidcmd as text, +, beta
        expect(result.value.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('empty \\binom{}{} does not crash', () => {
      const result = parseLatex('\\binom{}{}');
      expect(result.ok).toBe(true);
    });

    it('empty \\overset{}{} does not crash', () => {
      const result = parseLatex('\\overset{}{}');
      expect(result.ok).toBe(true);
    });

    it('\\color with missing content group does not crash', () => {
      const result = parseLatex('\\color{red}');
      expect(result.ok).toBe(true);
    });

    it('\\operatorname with empty braces does not crash', () => {
      const result = parseLatex('\\operatorname{}');
      expect(result.ok).toBe(true);
    });

    it('\\xrightarrow with empty above does not crash', () => {
      const result = parseLatex('\\xrightarrow{}');
      expect(result.ok).toBe(true);
    });
  });

  // =========================================================================
  // 10. Integration: AI-style complex expressions
  // =========================================================================
  describe('AI-generated expression patterns', () => {
    it('parses a typical probability expression', () => {
      const result = parseLatex('P\\left(X = k\\right) = \\binom{n}{k} p^{k} (1-p)^{n-k}');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBeGreaterThan(0);
      }
    });

    it('parses a limit with operatorname', () => {
      const result = parseLatex('\\operatorname{Var}(X) = E[X^2] - (E[X])^2');
      expect(result.ok).toBe(true);
    });

    it('parses displaystyle in a fraction', () => {
      const result = parseLatex('\\frac{\\displaystyle\\sum_{i=1}^{n} x_i}{n}');
      expect(result.ok).toBe(true);
    });

    it('parses an expression with color and overset', () => {
      const result = parseLatex('\\overset{\\text{def}}{=} \\color{blue}{x^2 + y^2}');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.length).toBeGreaterThan(0);
      }
    });

    it('parses extensible arrow in a diagram-like expression', () => {
      const result = parseLatex('A \\xrightarrow{f} B \\xrightarrow{g} C');
      expect(result.ok).toBe(true);
    });
  });

  // =========================================================================
  // 11. Spacing commands
  // =========================================================================
  describe('spacing commands', () => {
    it('\\, produces thin space (U+2009)', () => {
      const nodes = parseOk('a\\,b');
      expect(nodes).toHaveLength(3);
      expect((nodes[1] as any).text).toBe('\u2009');
    });

    it('\\; produces medium mathematical space (U+2005)', () => {
      const nodes = parseOk('a\\;b');
      expect(nodes).toHaveLength(3);
      expect((nodes[1] as any).text).toBe('\u2005');
    });

    it('\\! produces hair space (U+200A) as negative thin space approximation', () => {
      const nodes = parseOk('a\\!b');
      expect(nodes).toHaveLength(3);
      expect((nodes[1] as any).text).toBe('\u200A');
    });

    it('\\: produces medium mathematical space (U+2005)', () => {
      const nodes = parseOk('a\\:b');
      expect(nodes).toHaveLength(3);
      expect((nodes[1] as any).text).toBe('\u2005');
    });

    it('\\ (backslash space) produces regular space', () => {
      const nodes = parseOk('a\\ b');
      expect(nodes).toHaveLength(3);
      expect((nodes[1] as any).text).toBe(' ');
    });
  });

  // =========================================================================
  // 12. N-ary multi-expression body
  // =========================================================================
  describe('n-ary multi-expression body', () => {
    it('\\sum captures all remaining expressions as body', () => {
      const nodes = parseOk('\\sum_{i=1}^{n} a + b');
      expect(nodes).toHaveLength(1);
      const nary = nodes[0] as any;
      expect(nary.type).toBe('nary');
      // Body should contain a, +, and b (not just a)
      expect(nary.e.length).toBeGreaterThanOrEqual(3);
    });

    it('\\sum body stops at closing brace', () => {
      const nodes = parseOk('{\\sum_{i=1}^{n} x_i}');
      // The whole group is parsed; the nary should consume x_i within the group
      expect(nodes.length).toBeGreaterThan(0);
    });

    it('\\int captures multi-expression body', () => {
      const nodes = parseOk('\\int_{0}^{1} f(x) dx');
      expect(nodes).toHaveLength(1);
      const nary = nodes[0] as any;
      expect(nary.type).toBe('nary');
      // Body should contain f, (, x, ), d, x
      expect(nary.e.length).toBeGreaterThan(1);
    });

    it('n-ary body stops at \\right delimiter', () => {
      const nodes = parseOk('\\left( \\sum_{i} a_i \\right)');
      expect(nodes).toHaveLength(1);
      const delim = nodes[0] as any;
      expect(delim.type).toBe('d');
    });

    it('n-ary body stops at row separator \\\\', () => {
      const result = parseLatex('\\begin{aligned} \\sum x + y \\\\ z \\end{aligned}');
      expect(result.ok).toBe(true);
    });

    it('n-ary body stops at column separator &', () => {
      const result = parseLatex('\\begin{pmatrix} \\sum x & y \\end{pmatrix}');
      expect(result.ok).toBe(true);
    });
  });
});
