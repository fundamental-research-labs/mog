/**
 * Validator Tests
 *
 * Tests OMML and AST validation.
 */

import type {
  FractionNode,
  MathNode,
  MathRun,
  RadicalNode,
} from '@mog-sdk/contracts/equation/omml-ast';
import { validateAST, validateOMML } from '../../src/diagnostics/validators';

describe('Validators', () => {
  describe('validateOMML', () => {
    it('validates valid simple OMML', () => {
      const result = validateOMML('<m:oMath><m:r><m:t>x</m:t></m:r></m:oMath>');
      expect(result.valid).toBe(true);
      expect(result.ast).toBeDefined();
      expect(result.issues).toHaveLength(0);
      expect(result.metrics.nodeCount).toBeGreaterThan(0);
    });

    it('validates valid fraction OMML', () => {
      const result = validateOMML(
        '<m:oMath><m:f><m:num><m:r><m:t>a</m:t></m:r></m:num><m:den><m:r><m:t>b</m:t></m:r></m:den></m:f></m:oMath>',
      );
      expect(result.valid).toBe(true);
      expect(result.metrics.nodeCount).toBeGreaterThan(0);
      expect(result.metrics.depth).toBeGreaterThan(0);
    });

    it('reports error for empty input', () => {
      const result = validateOMML('');
      expect(result.valid).toBe(false);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues[0].severity).toBe('error');
    });

    it('computes correct metrics for nested equation', () => {
      const result = validateOMML(`<m:oMath>
        <m:f>
          <m:num>
            <m:sSup>
              <m:e><m:r><m:t>x</m:t></m:r></m:e>
              <m:sup><m:r><m:t>2</m:t></m:r></m:sup>
            </m:sSup>
          </m:num>
          <m:den><m:r><m:t>y</m:t></m:r></m:den>
        </m:f>
      </m:oMath>`);
      expect(result.valid).toBe(true);
      expect(result.metrics.nodeCount).toBeGreaterThan(3);
      expect(result.metrics.depth).toBeGreaterThan(1);
      expect(result.metrics.complexity).toBeGreaterThan(0);
    });
  });

  describe('validateAST', () => {
    it('validates valid AST', () => {
      const nodes: MathNode[] = [{ type: 'r', text: 'x' } as MathRun];
      const result = validateAST(nodes);
      expect(result.valid).toBe(true);
      expect(result.issues).toHaveLength(0);
    });

    it('warns about empty fraction numerator', () => {
      const nodes: MathNode[] = [
        {
          type: 'f',
          fractionType: 'bar',
          num: [],
          den: [{ type: 'r', text: 'b' }],
        } as FractionNode,
      ];
      const result = validateAST(nodes);
      expect(result.issues.length).toBeGreaterThan(0);
      expect(result.issues.some((i) => i.code === 'EQUATION_EMPTY_NUMERATOR')).toBe(true);
    });

    it('warns about empty fraction denominator', () => {
      const nodes: MathNode[] = [
        {
          type: 'f',
          fractionType: 'bar',
          num: [{ type: 'r', text: 'a' }],
          den: [],
        } as FractionNode,
      ];
      const result = validateAST(nodes);
      expect(result.issues.some((i) => i.code === 'EQUATION_EMPTY_DENOMINATOR')).toBe(true);
    });

    it('warns about empty radical radicand', () => {
      const nodes: MathNode[] = [{ type: 'rad', deg: [], e: [] } as RadicalNode];
      const result = validateAST(nodes);
      expect(result.issues.some((i) => i.code === 'EQUATION_EMPTY_RADICAND')).toBe(true);
    });

    it('warns about empty superscript base', () => {
      const nodes: MathNode[] = [{ type: 'sSup', e: [], sup: [{ type: 'r', text: '2' }] } as any];
      const result = validateAST(nodes);
      expect(result.issues.some((i) => i.code === 'EQUATION_EMPTY_BASE')).toBe(true);
    });

    it('validates complex nested AST', () => {
      const nodes: MathNode[] = [
        {
          type: 'f',
          fractionType: 'bar',
          num: [
            {
              type: 'rad',
              deg: [],
              e: [{ type: 'r', text: 'x' } as MathRun],
            } as RadicalNode,
          ],
          den: [{ type: 'r', text: 'y' } as MathRun],
        } as FractionNode,
      ];
      const result = validateAST(nodes);
      expect(result.valid).toBe(true);
    });

    it('empty matrix generates warning', () => {
      const nodes: MathNode[] = [{ type: 'm', mr: [] } as any];
      const result = validateAST(nodes);
      expect(result.issues.some((i) => i.code === 'EQUATION_EMPTY_MATRIX')).toBe(true);
    });
  });
});
