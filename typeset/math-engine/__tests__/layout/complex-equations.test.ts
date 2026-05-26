/**
 * Complex Equation Layout Tests
 *
 * Tests multi-level nested equations and common mathematical expressions.
 */

import { layoutEquation } from '../../src/layout/layout-engine';
import { parseLatex } from '../../src/parser/latex-parser';
import { parseOMML } from '../../src/parser/omml-parser';
import {
  createEulersIdentity,
  createPythagoreanTheorem,
  createQuadraticFormula,
  createSummationNotation,
} from '../../src/templates/template-library';

function layoutFromNodes(nodes: any[], fontSize: number = 12) {
  return layoutEquation(nodes, fontSize);
}

function layoutFromOMML(omml: string, fontSize: number = 12) {
  const result = parseOMML(omml);
  if (!result.ok) throw new Error(`Parse failed: ${result.error.message}`);
  const nodes = result.value[0].type === 'oMath' ? (result.value[0] as any).children : result.value;
  return layoutEquation(nodes, fontSize);
}

describe('Complex Equation Layouts', () => {
  describe('template layouts', () => {
    it('quadratic formula produces valid layout', () => {
      const nodes = createQuadraticFormula();
      const layout = layoutFromNodes(nodes);
      expect(layout.width).toBeGreaterThan(0);
      expect(layout.height).toBeGreaterThan(0);
      expect(layout.baseline).toBeGreaterThan(0);
    });

    it('Pythagorean theorem produces valid layout', () => {
      const nodes = createPythagoreanTheorem();
      const layout = layoutFromNodes(nodes);
      expect(layout.width).toBeGreaterThan(0);
      expect(layout.height).toBeGreaterThan(0);
    });

    it('Euler identity produces valid layout', () => {
      const nodes = createEulersIdentity();
      const layout = layoutFromNodes(nodes);
      expect(layout.width).toBeGreaterThan(0);
      expect(layout.height).toBeGreaterThan(0);
    });

    it('summation notation produces valid layout', () => {
      const nodes = createSummationNotation();
      const layout = layoutFromNodes(nodes);
      expect(layout.width).toBeGreaterThan(0);
      expect(layout.height).toBeGreaterThan(0);
    });
  });

  describe('snapshot tests for standard equations', () => {
    it('snapshot: quadratic formula', () => {
      const nodes = createQuadraticFormula();
      const layout = layoutFromNodes(nodes);
      expect({
        width: Math.round(layout.width),
        height: Math.round(layout.height),
        baseline: Math.round(layout.baseline),
        childCount: layout.children.length,
      }).toMatchSnapshot();
    });

    it('snapshot: Pythagorean theorem', () => {
      const nodes = createPythagoreanTheorem();
      const layout = layoutFromNodes(nodes);
      expect({
        width: Math.round(layout.width),
        height: Math.round(layout.height),
        baseline: Math.round(layout.baseline),
      }).toMatchSnapshot();
    });

    it('snapshot: Euler identity', () => {
      const nodes = createEulersIdentity();
      const layout = layoutFromNodes(nodes);
      expect({
        width: Math.round(layout.width),
        height: Math.round(layout.height),
        baseline: Math.round(layout.baseline),
      }).toMatchSnapshot();
    });
  });

  describe('nested equation layouts', () => {
    it('fraction inside radical has proper dimensions', () => {
      const omml = `<m:oMath><m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:e></m:rad></m:oMath>`;
      const layout = layoutFromOMML(omml);
      expect(layout.width).toBeGreaterThan(0);
      expect(layout.height).toBeGreaterThan(0);
    });

    it('superscript on a fraction', () => {
      const omml = `<m:oMath><m:sSup><m:e><m:d><m:dPr><m:begChr m:val="("/><m:endChr m:val=")"/></m:dPr><m:e><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:e></m:d></m:e><m:sup><m:r><m:t>2</m:t></m:r></m:sup></m:sSup></m:oMath>`;
      const layout = layoutFromOMML(omml);
      expect(layout.width).toBeGreaterThan(0);
      expect(layout.height).toBeGreaterThan(0);
    });

    it('scaling: larger font produces larger layout', () => {
      const omml =
        '<m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>';
      const small = layoutFromOMML(omml, 10);
      const large = layoutFromOMML(omml, 20);
      expect(large.width).toBeGreaterThan(small.width);
      expect(large.height).toBeGreaterThan(small.height);
    });
  });

  describe('LaTeX parsed layouts', () => {
    it('LaTeX fraction layout', () => {
      const result = parseLatex('\\frac{x+1}{y-1}');
      expect(result.ok).toBe(true);
      if (result.ok) {
        const layout = layoutFromNodes(result.value);
        expect(layout.width).toBeGreaterThan(0);
        expect(layout.height).toBeGreaterThan(0);
      }
    });

    it('LaTeX complex expression layout', () => {
      const result = parseLatex('\\sum_{i=0}^{n} \\frac{1}{i!}');
      expect(result.ok).toBe(true);
      if (result.ok) {
        const layout = layoutFromNodes(result.value);
        expect(layout.width).toBeGreaterThan(0);
        expect(layout.height).toBeGreaterThan(0);
      }
    });
  });
});
