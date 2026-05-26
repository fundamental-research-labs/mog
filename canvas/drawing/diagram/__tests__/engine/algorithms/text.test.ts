/**
 * Tests for the Text layout algorithm.
 *
 * @see ECMA-376 Part 1, Section 21.4.4.9 (Text Algorithm)
 */

import type { VariableList } from '@mog-sdk/contracts/diagram';
import type {
  AlgorithmContext,
  LayoutNodeInstance,
} from '../../../src/engine/algorithms/algorithm-types';
import { TextAlgorithm } from '../../../src/engine/algorithms/text';
import { createResolvedConstraints } from '../../../src/engine/constraints/constraint-evaluator';

// =============================================================================
// Test Helpers
// =============================================================================

const DEFAULT_VARIABLES: VariableList = {
  orgChart: false,
  chMax: -1,
  chPref: -1,
  bulletEnabled: false,
  dir: 'norm',
  hierBranch: 'std',
  animOne: 'none',
  animLvl: 'none',
  resizeHandles: 'rel',
};

function makeContext(
  params: Record<string, string> = {},
  bounds: { width: number; height: number } = { width: 300, height: 200 },
  constraintOverrides: Record<string, number> = {},
  nodeOverrides: Partial<LayoutNodeInstance> = {},
): AlgorithmContext {
  const constraints = createResolvedConstraints();
  for (const [key, value] of Object.entries(constraintOverrides)) {
    constraints.values.set(key, value);
  }

  const paramMap = new Map<string, string>();
  for (const [k, v] of Object.entries(params)) {
    paramMap.set(k, v);
  }

  const node: LayoutNodeInstance = {
    name: 'textNode',
    constraints: [],
    rules: [],
    children: [],
    text: 'Hello World',
    dataPointId: 'dp_text',
    ...nodeOverrides,
  };

  return {
    node,
    constraints,
    children: [],
    params: paramMap,
    variables: DEFAULT_VARIABLES,
    bounds,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('TextAlgorithm', () => {
  let algo: TextAlgorithm;

  beforeEach(() => {
    algo = new TextAlgorithm();
  });

  it('should have type "tx"', () => {
    expect(algo.type).toBe('tx');
  });

  // ---------------------------------------------------------------------------
  // Basic output
  // ---------------------------------------------------------------------------

  describe('basic output', () => {
    it('should produce exactly one shape', () => {
      const ctx = makeContext();
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(1);
      expect(result.connectors).toHaveLength(0);
    });

    it('should use bounds as default dimensions', () => {
      const ctx = makeContext({}, { width: 400, height: 300 });
      const result = algo.compute(ctx);
      const shape = result.shapes[0];
      expect(shape.width).toBe(400);
      expect(shape.height).toBe(300);
    });

    it('should use constraint values for position and size when available', () => {
      const ctx = makeContext(
        {},
        { width: 400, height: 300 },
        {
          l: 10,
          t: 20,
          w: 200,
          h: 150,
        },
      );
      const result = algo.compute(ctx);
      const shape = result.shapes[0];
      expect(shape.x).toBe(10);
      expect(shape.y).toBe(20);
      expect(shape.width).toBe(200);
      expect(shape.height).toBe(150);
    });

    it('should set text from node text', () => {
      const ctx = makeContext();
      const result = algo.compute(ctx);
      expect(result.shapes[0].text).toBe('Hello World');
    });

    it('should set modelId from dataPointId', () => {
      const ctx = makeContext();
      const result = algo.compute(ctx);
      expect(result.shapes[0].modelId).toBe('dp_text');
    });

    it('should use presOfId when dataPointId is not available', () => {
      const ctx = makeContext(
        {},
        { width: 200, height: 100 },
        {},
        {
          dataPointId: undefined,
          presOfId: 'pres_1',
        },
      );
      const result = algo.compute(ctx);
      expect(result.shapes[0].modelId).toBe('pres_1');
    });
  });

  // ---------------------------------------------------------------------------
  // Shape type
  // ---------------------------------------------------------------------------

  describe('shape type', () => {
    it('should default to "rect" shape type', () => {
      const ctx = makeContext();
      const result = algo.compute(ctx);
      expect(result.shapes[0].shapeType).toBe('rect');
    });

    it('should use node shape type if defined', () => {
      const ctx = makeContext(
        {},
        { width: 200, height: 100 },
        {},
        {
          shape: { type: 'roundRect' },
        },
      );
      const result = algo.compute(ctx);
      expect(result.shapes[0].shapeType).toBe('roundRect');
    });
  });

  // ---------------------------------------------------------------------------
  // Text alignment (encoded in adjustments)
  // ---------------------------------------------------------------------------

  describe('text alignment', () => {
    it('should encode left alignment by default', () => {
      const ctx = makeContext();
      const result = algo.compute(ctx);
      const adj = result.shapes[0].adjustments;
      expect(adj).toBeDefined();
      expect(adj!.get('txAlign')).toBe(0); // l = 0
    });

    it('should encode center alignment', () => {
      const ctx = makeContext({ parTxLTRAlign: 'ctr' });
      const result = algo.compute(ctx);
      const adj = result.shapes[0].adjustments;
      expect(adj!.get('txAlign')).toBe(1); // ctr = 1
    });

    it('should encode right alignment', () => {
      const ctx = makeContext({ parTxLTRAlign: 'r' });
      const result = algo.compute(ctx);
      const adj = result.shapes[0].adjustments;
      expect(adj!.get('txAlign')).toBe(2); // r = 2
    });
  });

  // ---------------------------------------------------------------------------
  // Vertical anchor
  // ---------------------------------------------------------------------------

  describe('vertical anchor', () => {
    it('should encode top anchor by default', () => {
      const ctx = makeContext();
      const result = algo.compute(ctx);
      const adj = result.shapes[0].adjustments;
      expect(adj!.get('txAnchorVert')).toBe(0); // t = 0
    });

    it('should encode mid anchor', () => {
      const ctx = makeContext({ txAnchorVert: 'mid' });
      const result = algo.compute(ctx);
      const adj = result.shapes[0].adjustments;
      expect(adj!.get('txAnchorVert')).toBe(1); // mid = 1
    });

    it('should encode bottom anchor', () => {
      const ctx = makeContext({ txAnchorVert: 'b' });
      const result = algo.compute(ctx);
      const adj = result.shapes[0].adjustments;
      expect(adj!.get('txAnchorVert')).toBe(2); // b = 2
    });
  });

  // ---------------------------------------------------------------------------
  // Horizontal anchor
  // ---------------------------------------------------------------------------

  describe('horizontal anchor', () => {
    it('should encode none horizontal anchor by default', () => {
      const ctx = makeContext();
      const result = algo.compute(ctx);
      const adj = result.shapes[0].adjustments;
      expect(adj!.get('txAnchorHorz')).toBe(0); // none = 0
    });

    it('should encode center horizontal anchor', () => {
      const ctx = makeContext({ txAnchorHorz: 'ctr' });
      const result = algo.compute(ctx);
      const adj = result.shapes[0].adjustments;
      expect(adj!.get('txAnchorHorz')).toBe(1); // ctr = 1
    });
  });

  // ---------------------------------------------------------------------------
  // Bullet levels
  // ---------------------------------------------------------------------------

  describe('bullet levels', () => {
    it('should encode bullet level 0 (no bullets) by default', () => {
      const ctx = makeContext();
      const result = algo.compute(ctx);
      const adj = result.shapes[0].adjustments;
      expect(adj!.get('txBulletLvl')).toBe(0);
    });

    it('should encode non-zero bullet level', () => {
      const ctx = makeContext({ stBulletLvl: '3' });
      const result = algo.compute(ctx);
      const adj = result.shapes[0].adjustments;
      expect(adj!.get('txBulletLvl')).toBe(3);
    });
  });

  // ---------------------------------------------------------------------------
  // Text block direction
  // ---------------------------------------------------------------------------

  describe('text block direction', () => {
    it('should encode horizontal direction by default', () => {
      const ctx = makeContext();
      const result = algo.compute(ctx);
      const adj = result.shapes[0].adjustments;
      expect(adj!.get('txBlDir')).toBe(0); // horz = 0
    });

    it('should encode vertical direction', () => {
      const ctx = makeContext({ txBlDir: 'vert' });
      const result = algo.compute(ctx);
      const adj = result.shapes[0].adjustments;
      expect(adj!.get('txBlDir')).toBe(1); // vert = 1
    });
  });

  // ---------------------------------------------------------------------------
  // Auto-rotation
  // ---------------------------------------------------------------------------

  describe('auto-rotation', () => {
    it('should not rotate when autoTxRot=none (default)', () => {
      const ctx = makeContext();
      const result = algo.compute(ctx);
      const adj = result.shapes[0].adjustments;
      expect(adj!.get('txRotation')).toBe(0);
      expect(result.shapes[0].rotation).toBeUndefined();
    });

    it('should not rotate when autoTxRot=upr', () => {
      const ctx = makeContext({ autoTxRot: 'upr' });
      const result = algo.compute(ctx);
      const adj = result.shapes[0].adjustments;
      expect(adj!.get('txRotation')).toBe(0);
    });

    it('should rotate 180 degrees for gravity mode in bottom half', () => {
      // Shape center at y > bounds.height / 2
      const ctx = makeContext(
        { autoTxRot: 'grav' },
        { width: 300, height: 400 },
        { t: 250, h: 100 }, // center at 300, which is > 400/2 = 200
      );
      const result = algo.compute(ctx);
      const adj = result.shapes[0].adjustments;
      expect(adj!.get('txRotation')).toBe(180);
      expect(result.shapes[0].rotation).toBe(180);
    });

    it('should not rotate for gravity mode in top half', () => {
      const ctx = makeContext(
        { autoTxRot: 'grav' },
        { width: 300, height: 400 },
        { t: 0, h: 100 }, // center at 50, which is < 400/2 = 200
      );
      const result = algo.compute(ctx);
      const adj = result.shapes[0].adjustments;
      expect(adj!.get('txRotation')).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Line spacing
  // ---------------------------------------------------------------------------

  describe('line spacing', () => {
    it('should encode default line spacing of 100', () => {
      const ctx = makeContext();
      const result = algo.compute(ctx);
      const adj = result.shapes[0].adjustments;
      expect(adj!.get('txLnSpPar')).toBe(100);
      expect(adj!.get('txLnSpCh')).toBe(100);
    });

    it('should encode custom line spacing', () => {
      const ctx = makeContext({ lnSpPar: '120', lnSpCh: '80' });
      const result = algo.compute(ctx);
      const adj = result.shapes[0].adjustments;
      expect(adj!.get('txLnSpPar')).toBe(120);
      expect(adj!.get('txLnSpCh')).toBe(80);
    });

    it('should encode line spacing after paragraph', () => {
      const ctx = makeContext({ lnSpAfParP: '50', lnSpAfChP: '25' });
      const result = algo.compute(ctx);
      const adj = result.shapes[0].adjustments;
      expect(adj!.get('txLnSpAfParP')).toBe(50);
      expect(adj!.get('txLnSpAfChP')).toBe(25);
    });
  });

  // ---------------------------------------------------------------------------
  // Style label
  // ---------------------------------------------------------------------------

  describe('style label', () => {
    it('should pass style label through', () => {
      const ctx = makeContext(
        {},
        { width: 200, height: 100 },
        {},
        {
          styleLbl: 'revTx',
        },
      );
      const result = algo.compute(ctx);
      expect(result.shapes[0].styleLbl).toBe('revTx');
    });
  });

  // ---------------------------------------------------------------------------
  // Used bounds
  // ---------------------------------------------------------------------------

  describe('used bounds', () => {
    it('should report used bounds matching shape dimensions', () => {
      const ctx = makeContext({}, { width: 300, height: 200 });
      const result = algo.compute(ctx);
      expect(result.usedBounds.width).toBe(300);
      expect(result.usedBounds.height).toBe(200);
    });

    it('should use constraint values for used bounds', () => {
      const ctx = makeContext({}, { width: 300, height: 200 }, { w: 150, h: 100 });
      const result = algo.compute(ctx);
      expect(result.usedBounds.width).toBe(150);
      expect(result.usedBounds.height).toBe(100);
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle zero-size bounds', () => {
      const ctx = makeContext({}, { width: 0, height: 0 });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(1);
      expect(result.shapes[0].width).toBe(0);
      expect(result.shapes[0].height).toBe(0);
    });

    it('should handle node with no text', () => {
      const ctx = makeContext({}, { width: 200, height: 100 }, {}, { text: undefined });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(1);
      expect(result.shapes[0].text).toBeUndefined();
    });

    it('should handle empty text', () => {
      const ctx = makeContext({}, { width: 200, height: 100 }, {}, { text: '' });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(1);
      expect(result.shapes[0].text).toBe('');
    });

    it('should handle all parameters simultaneously', () => {
      const ctx = makeContext({
        parTxLTRAlign: 'ctr',
        txAnchorVert: 'mid',
        txAnchorHorz: 'ctr',
        stBulletLvl: '2',
        txBlDir: 'horz',
        autoTxRot: 'none',
        lnSpPar: '150',
        lnSpCh: '120',
        lnSpAfParP: '10',
        lnSpAfChP: '5',
      });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(1);

      const adj = result.shapes[0].adjustments;
      expect(adj!.get('txAlign')).toBe(1);
      expect(adj!.get('txAnchorVert')).toBe(1);
      expect(adj!.get('txAnchorHorz')).toBe(1);
      expect(adj!.get('txBulletLvl')).toBe(2);
      expect(adj!.get('txBlDir')).toBe(0);
      expect(adj!.get('txRotation')).toBe(0);
      expect(adj!.get('txLnSpPar')).toBe(150);
      expect(adj!.get('txLnSpCh')).toBe(120);
    });
  });
});
