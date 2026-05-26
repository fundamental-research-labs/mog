/**
 * OMML-to-LaTeX Converter Tests
 *
 * Tests conversion from MathAST to LaTeX for each node type.
 */

import { astToLatex } from '../../src/converter/omml-to-latex';
import { parseOMML } from '../../src/parser/omml-parser';

function ommlToLatex(omml: string): string {
  const result = parseOMML(omml);
  if (!result.ok) throw new Error(`Parse failed: ${result.error.message}`);
  return astToLatex(result.value);
}

describe('OMML to LaTeX Converter', () => {
  describe('text runs', () => {
    it('converts simple text', () => {
      const latex = ommlToLatex('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>');
      expect(latex).toBe('x');
    });

    it('converts multiple runs', () => {
      const latex = ommlToLatex(
        '<m:oMath><m:r><m:t>a</m:t></m:r><m:r><m:t>+</m:t></m:r><m:r><m:t>b</m:t></m:r></m:oMath>',
      );
      expect(latex).toBe('a+b');
    });
  });

  describe('fractions', () => {
    it('converts bar fraction to \\frac', () => {
      const latex = ommlToLatex(
        '<m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>',
      );
      expect(latex).toBe('\\frac{a}{b}');
    });

    it('converts linear fraction', () => {
      const latex = ommlToLatex(
        '<m:oMath><m:f><m:fPr><m:type m:val="lin"/></m:fPr><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>',
      );
      expect(latex).toBe('a/b');
    });

    it('converts noBar fraction to \\binom', () => {
      const latex = ommlToLatex(
        '<m:oMath><m:f><m:fPr><m:type m:val="noBar"/></m:fPr><m:num><m:r><m:t>n</m:t></m:r></m:num><m:den><m:r><m:t>k</m:t></m:r></m:den></m:f></m:oMath>',
      );
      expect(latex).toBe('\\binom{n}{k}');
    });
  });

  describe('radicals', () => {
    it('converts square root to \\sqrt', () => {
      const latex = ommlToLatex(
        '<m:oMath><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad></m:oMath>',
      );
      expect(latex).toBe('\\sqrt{x}');
    });

    it('converts nth root to \\sqrt[n]', () => {
      const latex = ommlToLatex(
        '<m:oMath><m:rad><m:deg><m:r><m:t>3</m:t></m:r></m:deg><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad></m:oMath>',
      );
      expect(latex).toBe('\\sqrt[3]{x}');
    });
  });

  describe('scripts', () => {
    it('converts superscript', () => {
      const latex = ommlToLatex(
        '<m:oMath><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>',
      );
      expect(latex).toBe('x^{2}');
    });

    it('converts subscript', () => {
      const latex = ommlToLatex(
        '<m:oMath><m:sSub><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sub><m:r><m:t>n</m:t></m:r></m:sub></m:sSub></m:oMath>',
      );
      expect(latex).toBe('x_{n}');
    });

    it('converts sub-superscript', () => {
      const latex = ommlToLatex(
        '<m:oMath><m:sSubSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sub><m:r><m:t>i</m:t></m:r></m:sub><m:sup><m:r><m:t>n</m:t></m:r></m:sup></m:sSubSup></m:oMath>',
      );
      expect(latex).toBe('x_{i}^{n}');
    });
  });

  describe('n-ary operators', () => {
    it('converts summation', () => {
      const latex = ommlToLatex(
        '<m:oMath><m:nary><m:naryPr><m:chr m:val="\u2211"/></m:naryPr><m:sub><m:r><m:t>i=1</m:t></m:r></m:sub><m:sup><m:r><m:t>n</m:t></m:r></m:sup><m:e><m:r><m:t>i</m:t></m:r></m:e></m:nary></m:oMath>',
      );
      expect(latex).toContain('\\sum');
      expect(latex).toContain('_{i=1}');
      expect(latex).toContain('^{n}');
    });

    it('converts integral', () => {
      const latex = ommlToLatex(
        '<m:oMath><m:nary><m:naryPr><m:chr m:val="\u222B"/></m:naryPr><m:sub><m:r><m:t>a</m:t></m:r></m:sub><m:sup><m:r><m:t>b</m:t></m:r></m:sup><m:e><m:r><m:t>f</m:t></m:r></m:e></m:nary></m:oMath>',
      );
      expect(latex).toContain('\\int');
    });
  });

  describe('delimiters', () => {
    it('converts parentheses', () => {
      const latex = ommlToLatex(
        '<m:oMath><m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr><m:e><m:r><m:t>x</m:t></m:r></m:e></m:d></m:oMath>',
      );
      expect(latex).toContain('\\left(');
      expect(latex).toContain('\\right)');
    });
  });

  describe('accents', () => {
    it('converts hat accent', () => {
      const latex = ommlToLatex(
        '<m:oMath><m:acc><m:accPr><m:chr m:val="\u0302"/></m:accPr><m:e><m:r><m:t>x</m:t></m:r></m:e></m:acc></m:oMath>',
      );
      expect(latex).toBe('\\hat{x}');
    });

    it('converts tilde accent', () => {
      const latex = ommlToLatex(
        '<m:oMath><m:acc><m:accPr><m:chr m:val="\u0303"/></m:accPr><m:e><m:r><m:t>x</m:t></m:r></m:e></m:acc></m:oMath>',
      );
      expect(latex).toBe('\\tilde{x}');
    });
  });

  describe('bars', () => {
    it('converts overbar to \\overline', () => {
      const latex = ommlToLatex(
        '<m:oMath><m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e><m:r><m:t>x</m:t></m:r></m:e></m:bar></m:oMath>',
      );
      expect(latex).toBe('\\overline{x}');
    });

    it('converts underbar to \\underline', () => {
      const latex = ommlToLatex(
        '<m:oMath><m:bar><m:barPr><m:pos m:val="bot"/></m:barPr><m:e><m:r><m:t>x</m:t></m:r></m:e></m:bar></m:oMath>',
      );
      expect(latex).toBe('\\underline{x}');
    });
  });

  describe('functions', () => {
    it('converts known function', () => {
      const latex = ommlToLatex(
        '<m:oMath><m:func><m:fName><m:r><m:t>sin</m:t></m:r></m:fName><m:e><m:r><m:t>x</m:t></m:r></m:e></m:func></m:oMath>',
      );
      expect(latex).toContain('\\sin');
    });
  });

  describe('limits', () => {
    it('converts lower limit', () => {
      const latex = ommlToLatex(
        '<m:oMath><m:limLow><m:e><m:r><m:t>lim</m:t></m:r></m:e><m:lim><m:r><m:t>x</m:t></m:r></m:lim></m:limLow></m:oMath>',
      );
      expect(latex).toContain('lim');
      expect(latex).toContain('_{x}');
    });
  });

  describe('snapshot tests', () => {
    it('quadratic formula snapshot', () => {
      const omml = `<m:oMath>
        <m:r><m:t>x</m:t></m:r>
        <m:r><m:t>=</m:t></m:r>
        <m:f>
          <m:num>
            <m:r><m:t>-b\u00B1</m:t></m:r>
            <m:rad>
              <m:radPr><m:degHide m:val="1"/></m:radPr>
              <m:deg/>
              <m:e>
                <m:sSup><m:e><m:r><m:t>b</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup>
                <m:r><m:t>-4ac</m:t></m:r>
              </m:e>
            </m:rad>
          </m:num>
          <m:den><m:r><m:t>2a</m:t></m:r></m:den>
        </m:f>
      </m:oMath>`;
      const latex = ommlToLatex(omml);
      expect(latex).toMatchSnapshot();
    });

    it('Euler identity snapshot', () => {
      const omml = `<m:oMath>
        <m:sSup>
          <m:e><m:r><m:t>e</m:t></m:r></m:e>
          <m:sup><m:r><m:t>i\u03C0</m:t></m:r></m:sup>
        </m:sSup>
        <m:r><m:t>+1=0</m:t></m:r>
      </m:oMath>`;
      const latex = ommlToLatex(omml);
      expect(latex).toMatchSnapshot();
    });
  });

  describe('phantoms', () => {
    it('wraps content in \\phantom when show is false', () => {
      const node = {
        type: 'phant' as const,
        show: false,
        e: [{ type: 'r' as const, text: 'x' }],
      };
      const latex = astToLatex(node);
      expect(latex).toBe('\\phantom{x}');
    });

    it('does NOT produce \\phantom when show is undefined (default is visible)', () => {
      const node = {
        type: 'phant' as const,
        e: [{ type: 'r' as const, text: 'x' }],
      };
      const latex = astToLatex(node);
      expect(latex).toBe('x');
      expect(latex).not.toContain('\\phantom');
    });

    it('does NOT produce \\phantom when show is true', () => {
      const node = {
        type: 'phant' as const,
        show: true,
        e: [{ type: 'r' as const, text: 'x' }],
      };
      const latex = astToLatex(node);
      expect(latex).toBe('x');
      expect(latex).not.toContain('\\phantom');
    });
  });
});
