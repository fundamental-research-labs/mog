/**
 * Edge Cases Tests
 *
 * Tests for edge cases: empty expressions, deeply nested, malformed input.
 */

import { parseLatex } from '../../src/parser/latex-parser';
import { parseOMML } from '../../src/parser/omml-parser';

describe('Edge Cases', () => {
  describe('OMML edge cases', () => {
    it('handles empty oMath', () => {
      const result = parseOMML('<m:oMath></m:oMath>');
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value).toHaveLength(1);
        const oMath = result.value[0] as any;
        expect(oMath.children).toHaveLength(0);
      }
    });

    it('handles empty fraction parts', () => {
      const result = parseOMML('<m:oMath><m:f><m:num></m:num><m:den></m:den></m:f></m:oMath>');
      expect(result.ok).toBe(true);
      if (result.ok) {
        const frac = (result.value[0] as any).children[0];
        expect(frac.num).toHaveLength(0);
        expect(frac.den).toHaveLength(0);
      }
    });

    it('handles deeply nested fractions', () => {
      // 5 levels deep: frac{frac{frac{frac{frac{a}{b}}{c}}{d}}{e}}{f}
      let omml = '<m:r><m:t>a</m:t></m:r>';
      for (let i = 0; i < 5; i++) {
        omml = `<m:f><m:num>${omml}</m:num><m:den><m:r><m:t>${String.fromCharCode(98 + i)}</m:t></m:r></m:den></m:f>`;
      }
      omml = `<m:oMath>${omml}</m:oMath>`;

      const result = parseOMML(omml);
      expect(result.ok).toBe(true);
    });

    it('handles multiple text runs in sequence', () => {
      const result = parseOMML(
        '<m:oMath><m:r><m:t>x</m:t></m:r><m:r><m:t>+</m:t></m:r><m:r><m:t>y</m:t></m:r></m:oMath>',
      );
      expect(result.ok).toBe(true);
      if (result.ok) {
        const oMath = result.value[0] as any;
        expect(oMath.children).toHaveLength(3);
      }
    });

    it('handles XML entities', () => {
      const result = parseOMML('<m:oMath><m:r><m:t>&lt;&gt;&amp;</m:t></m:r></m:oMath>');
      expect(result.ok).toBe(true);
      if (result.ok) {
        const run = (result.value[0] as any).children[0];
        expect(run.text).toBe('<>&');
      }
    });

    it('handles whitespace in XML', () => {
      const result = parseOMML(`
        <m:oMath>
          <m:r>
            <m:t>x</m:t>
          </m:r>
        </m:oMath>
      `);
      expect(result.ok).toBe(true);
    });

    it('handles self-closing empty elements', () => {
      const result = parseOMML(
        '<m:oMath><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad></m:oMath>',
      );
      expect(result.ok).toBe(true);
    });
  });

  describe('LaTeX edge cases', () => {
    it('handles empty braces', () => {
      const result = parseLatex('\\frac{}{}');
      expect(result.ok).toBe(true);
    });

    it('handles consecutive operators', () => {
      const result = parseLatex('a + b - c');
      expect(result.ok).toBe(true);
    });

    it('handles nested fractions', () => {
      const result = parseLatex('\\frac{\\frac{a}{b}}{c}');
      expect(result.ok).toBe(true);
      if (result.ok) {
        const outerFrac = result.value[0] as any;
        expect(outerFrac.type).toBe('f');
        const innerFrac = outerFrac.num[0];
        expect(innerFrac.type).toBe('f');
      }
    });

    it('handles escaped characters', () => {
      const result = parseLatex('\\{x\\}');
      expect(result.ok).toBe(true);
    });

    it('handles single backslash at end', () => {
      const result = parseLatex('x\\');
      expect(result.ok).toBe(true);
    });

    it('handles unclosed brace gracefully', () => {
      const result = parseLatex('\\frac{a}{');
      expect(result.ok).toBe(true);
    });

    it('handles multiple scripts in sequence', () => {
      const result = parseLatex('a^2 + b^2');
      expect(result.ok).toBe(true);
      if (result.ok) {
        // Should have at least 3 nodes: a^2, +, b^2
        expect(result.value.length).toBeGreaterThanOrEqual(3);
      }
    });

    it('handles empty input', () => {
      const result = parseLatex('');
      expect(result.ok).toBe(false);
    });

    it('handles whitespace only (treated as empty)', () => {
      const result = parseLatex('   ');
      // Whitespace is trimmed, resulting in empty input
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe('EMPTY_INPUT');
      }
    });
  });
});
