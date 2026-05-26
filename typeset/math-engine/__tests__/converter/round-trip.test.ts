/**
 * Round-Trip Tests
 *
 * Tests that OMML -> AST -> OMML -> AST preserves semantics.
 */

import { astToLatex } from '../../src/converter/omml-to-latex';
import { compareEquations } from '../../src/diagnostics/comparators';
import { roundTripCheck } from '../../src/diagnostics/round-trip';
import { parseLatex } from '../../src/parser/latex-parser';

describe('Round-Trip Tests', () => {
  describe('OMML round-trip', () => {
    it('preserves simple fraction', () => {
      const omml =
        '<m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>';
      const result = roundTripCheck(omml);
      expect(result.preserves).toBe(true);
      expect(result.differences).toHaveLength(0);
    });

    it('preserves square root', () => {
      const omml =
        '<m:oMath><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:r><m:t>x</m:t></m:r></m:e></m:rad></m:oMath>';
      const result = roundTripCheck(omml);
      expect(result.preserves).toBe(true);
    });

    it('preserves superscript', () => {
      const omml =
        '<m:oMath><m:sSup><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>';
      const result = roundTripCheck(omml);
      expect(result.preserves).toBe(true);
    });

    it('preserves subscript', () => {
      const omml =
        '<m:oMath><m:sSub><m:e><m:r><m:t>x</m:t></m:r></m:e><m:sub><m:r><m:t>n</m:t></m:r></m:sub></m:sSub></m:oMath>';
      const result = roundTripCheck(omml);
      expect(result.preserves).toBe(true);
    });

    it('preserves accent', () => {
      const omml =
        '<m:oMath><m:acc><m:accPr><m:chr m:val="\u0302"/></m:accPr><m:e><m:r><m:t>x</m:t></m:r></m:e></m:acc></m:oMath>';
      const result = roundTripCheck(omml);
      expect(result.preserves).toBe(true);
    });

    it('preserves bar', () => {
      const omml =
        '<m:oMath><m:bar><m:barPr><m:pos m:val="top"/></m:barPr><m:e><m:r><m:t>x</m:t></m:r></m:e></m:bar></m:oMath>';
      const result = roundTripCheck(omml);
      expect(result.preserves).toBe(true);
    });

    it('preserves nary operator', () => {
      const omml =
        '<m:oMath><m:nary><m:naryPr><m:chr m:val="\u2211"/></m:naryPr><m:sub><m:r><m:t>i</m:t></m:r></m:sub><m:sup><m:r><m:t>n</m:t></m:r></m:sup><m:e><m:r><m:t>i</m:t></m:r></m:e></m:nary></m:oMath>';
      const result = roundTripCheck(omml);
      expect(result.preserves).toBe(true);
    });

    it('preserves delimiter', () => {
      const omml =
        '<m:oMath><m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr><m:e><m:r><m:t>x</m:t></m:r></m:e></m:d></m:oMath>';
      const result = roundTripCheck(omml);
      expect(result.preserves).toBe(true);
    });

    it('preserves function', () => {
      const omml =
        '<m:oMath><m:func><m:fName><m:r><m:t>sin</m:t></m:r></m:fName><m:e><m:r><m:t>x</m:t></m:r></m:e></m:func></m:oMath>';
      const result = roundTripCheck(omml);
      expect(result.preserves).toBe(true);
    });

    it('preserves nested fraction in radical', () => {
      const omml = `<m:oMath><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:e></m:rad></m:oMath>`;
      const result = roundTripCheck(omml);
      expect(result.preserves).toBe(true);
    });
  });

  describe('LaTeX semantic round-trip', () => {
    // LaTeX -> AST -> LaTeX -> AST should preserve structure

    it('preserves simple fraction through LaTeX', () => {
      const latex1 = '\\frac{a}{b}';
      const result1 = parseLatex(latex1);
      expect(result1.ok).toBe(true);
      if (!result1.ok) return;

      const latexBack = astToLatex(result1.value);
      const result2 = parseLatex(latexBack);
      expect(result2.ok).toBe(true);
      if (!result2.ok) return;

      const comparison = compareEquations(result1.value, result2.value);
      expect(comparison.match).toBe(true);
    });

    it('preserves square root through LaTeX', () => {
      const latex1 = '\\sqrt{x}';
      const result1 = parseLatex(latex1);
      expect(result1.ok).toBe(true);
      if (!result1.ok) return;

      const latexBack = astToLatex(result1.value);
      const result2 = parseLatex(latexBack);
      expect(result2.ok).toBe(true);
      if (!result2.ok) return;

      const comparison = compareEquations(result1.value, result2.value);
      expect(comparison.match).toBe(true);
    });
  });

  describe('round-trip check diagnostic', () => {
    it('reports failure for invalid OMML', () => {
      const result = roundTripCheck('not-xml');
      expect(result.preserves).toBe(false);
      expect(result.differences.length).toBeGreaterThan(0);
    });

    it('returns original and round-tripped OMML', () => {
      const omml = '<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>';
      const result = roundTripCheck(omml);
      expect(result.original).toBe(omml);
      expect(result.roundTripped).toBeTruthy();
      expect(result.originalAst).toBeDefined();
      expect(result.roundTrippedAst).toBeDefined();
    });
  });

  describe('comparator detects styling differences', () => {
    it('detects sty (bold vs italic) difference in rPr', () => {
      const a = [{ type: 'r' as const, text: 'x', rPr: { sty: 'b' as const } }];
      const b = [{ type: 'r' as const, text: 'x', rPr: { sty: 'i' as const } }];
      const result = compareEquations(a, b);
      expect(result.match).toBe(false);
      expect(result.differences.some((d) => d.path.includes('rPr/sty'))).toBe(true);
    });

    it('detects nor (normal text) difference in rPr', () => {
      const a = [{ type: 'r' as const, text: 'x', rPr: { nor: true } }];
      const b = [{ type: 'r' as const, text: 'x' }];
      const result = compareEquations(a, b);
      expect(result.match).toBe(false);
      expect(result.differences.some((d) => d.path.includes('rPr/nor'))).toBe(true);
    });

    it('detects aln (alignment) difference in rPr', () => {
      const a = [{ type: 'r' as const, text: 'x', rPr: { aln: true } }];
      const b = [{ type: 'r' as const, text: 'x', rPr: { aln: undefined } }];
      const result = compareEquations(a, b);
      expect(result.match).toBe(false);
      expect(result.differences.some((d) => d.path.includes('rPr/aln'))).toBe(true);
    });

    it('reports no difference when rPr matches', () => {
      const a = [{ type: 'r' as const, text: 'x', rPr: { sty: 'b' as const, nor: false } }];
      const b = [{ type: 'r' as const, text: 'x', rPr: { sty: 'b' as const, nor: false } }];
      const result = compareEquations(a, b);
      expect(result.match).toBe(true);
    });
  });
});
