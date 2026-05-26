/**
 * Tests for the Connector layout algorithm.
 *
 * @see ECMA-376 Part 1, Section 21.4.4.8 (Connector Algorithm)
 */

import type { VariableList } from '@mog-sdk/contracts/diagram';
import type {
  AlgorithmContext,
  LayoutNodeInstance,
} from '../../../src/engine/algorithms/algorithm-types';
import { ConnectorAlgorithm } from '../../../src/engine/algorithms/connector';
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

function makeChild(name: string, overrides?: Partial<LayoutNodeInstance>): LayoutNodeInstance {
  return {
    name,
    constraints: [],
    rules: [],
    children: [],
    dataPointId: `dp_${name}`,
    ...overrides,
  };
}

function makeContext(
  params: Record<string, string> = {},
  children: LayoutNodeInstance[] = [],
  bounds: { width: number; height: number } = { width: 1000, height: 800 },
  constraintOverrides: Record<string, number> = {},
): AlgorithmContext {
  const constraints = createResolvedConstraints();
  for (const [key, value] of Object.entries(constraintOverrides)) {
    constraints.values.set(key, value);
  }

  const paramMap = new Map<string, string>();
  for (const [k, v] of Object.entries(params)) {
    paramMap.set(k, v);
  }

  return {
    node: {
      name: 'connectorNode',
      constraints: [],
      rules: [],
      children,
    },
    constraints,
    children,
    params: paramMap,
    variables: DEFAULT_VARIABLES,
    bounds,
  };
}

/**
 * Set up constraints to define source and destination shape bounds.
 */
function makeConstraintsForNodes(
  srcName: string,
  srcBounds: { l: number; t: number; w: number; h: number },
  dstName: string,
  dstBounds: { l: number; t: number; w: number; h: number },
): Record<string, number> {
  return {
    [`${srcName}:l`]: srcBounds.l,
    [`${srcName}:t`]: srcBounds.t,
    [`${srcName}:w`]: srcBounds.w,
    [`${srcName}:h`]: srcBounds.h,
    [`${dstName}:l`]: dstBounds.l,
    [`${dstName}:t`]: dstBounds.t,
    [`${dstName}:w`]: dstBounds.w,
    [`${dstName}:h`]: dstBounds.h,
  };
}

// =============================================================================
// Tests
// =============================================================================

describe('ConnectorAlgorithm', () => {
  let algo: ConnectorAlgorithm;

  beforeEach(() => {
    algo = new ConnectorAlgorithm();
  });

  it('should have type "conn"', () => {
    expect(algo.type).toBe('conn');
  });

  // ---------------------------------------------------------------------------
  // Missing parameters
  // ---------------------------------------------------------------------------

  describe('missing parameters', () => {
    it('should return empty result when srcNode is missing', () => {
      const ctx = makeContext({ dstNode: 'B' });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(0);
      expect(result.connectors).toHaveLength(0);
    });

    it('should return empty result when dstNode is missing', () => {
      const ctx = makeContext({ srcNode: 'A' });
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(0);
      expect(result.connectors).toHaveLength(0);
    });

    it('should return empty result when both nodes are missing', () => {
      const ctx = makeContext({});
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(0);
      expect(result.connectors).toHaveLength(0);
    });

    it('should return empty result when source node bounds cannot be resolved', () => {
      const ctx = makeContext(
        { srcNode: 'A', dstNode: 'B' },
        [makeChild('B')],
        { width: 500, height: 500 },
        makeConstraintsForNodes('X', { l: 0, t: 0, w: 100, h: 100 }, 'B', {
          l: 200,
          t: 200,
          w: 100,
          h: 100,
        }),
      );
      const result = algo.compute(ctx);
      expect(result.connectors).toHaveLength(0);
    });

    it('should return empty result when destination node bounds cannot be resolved', () => {
      const ctx = makeContext(
        { srcNode: 'A', dstNode: 'B' },
        [makeChild('A')],
        { width: 500, height: 500 },
        makeConstraintsForNodes('A', { l: 0, t: 0, w: 100, h: 100 }, 'X', {
          l: 200,
          t: 200,
          w: 100,
          h: 100,
        }),
      );
      const result = algo.compute(ctx);
      expect(result.connectors).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Straight routing
  // ---------------------------------------------------------------------------

  describe('straight routing (stra)', () => {
    it('should create a straight connector with 2 points', () => {
      const constraintMap = makeConstraintsForNodes('src', { l: 0, t: 0, w: 100, h: 100 }, 'dst', {
        l: 300,
        t: 300,
        w: 100,
        h: 100,
      });
      const ctx = makeContext(
        { srcNode: 'src', dstNode: 'dst', connRout: 'stra' },
        [makeChild('src'), makeChild('dst')],
        { width: 500, height: 500 },
        constraintMap,
      );
      const result = algo.compute(ctx);

      expect(result.connectors).toHaveLength(1);
      const conn = result.connectors[0];
      expect(conn.routingType).toBe('stra');
      expect(conn.points).toHaveLength(2);
      expect(conn.fromId).toBe('src');
      expect(conn.toId).toBe('dst');
    });

    it('should default to straight routing', () => {
      const constraintMap = makeConstraintsForNodes('A', { l: 0, t: 0, w: 50, h: 50 }, 'B', {
        l: 200,
        t: 0,
        w: 50,
        h: 50,
      });
      const ctx = makeContext(
        { srcNode: 'A', dstNode: 'B' },
        [makeChild('A'), makeChild('B')],
        { width: 500, height: 500 },
        constraintMap,
      );
      const result = algo.compute(ctx);
      expect(result.connectors[0].routingType).toBe('stra');
    });

    it('should produce no shapes for 1D connectors', () => {
      const constraintMap = makeConstraintsForNodes('A', { l: 0, t: 0, w: 100, h: 100 }, 'B', {
        l: 200,
        t: 0,
        w: 100,
        h: 100,
      });
      const ctx = makeContext(
        { srcNode: 'A', dstNode: 'B', dim: '1D' },
        [makeChild('A'), makeChild('B')],
        { width: 500, height: 500 },
        constraintMap,
      );
      const result = algo.compute(ctx);
      expect(result.shapes).toHaveLength(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Bend routing
  // ---------------------------------------------------------------------------

  describe('bend routing', () => {
    it('should create a bend connector with 3-4 points', () => {
      const constraintMap = makeConstraintsForNodes('A', { l: 0, t: 0, w: 100, h: 100 }, 'B', {
        l: 300,
        t: 300,
        w: 100,
        h: 100,
      });
      const ctx = makeContext(
        { srcNode: 'A', dstNode: 'B', connRout: 'bend' },
        [makeChild('A'), makeChild('B')],
        { width: 500, height: 500 },
        constraintMap,
      );
      const result = algo.compute(ctx);

      expect(result.connectors).toHaveLength(1);
      const conn = result.connectors[0];
      expect(conn.routingType).toBe('bend');
      expect(conn.points.length).toBeGreaterThanOrEqual(3);
    });

    it('should support bendPt=beg', () => {
      const constraintMap = makeConstraintsForNodes('A', { l: 0, t: 0, w: 100, h: 100 }, 'B', {
        l: 300,
        t: 300,
        w: 100,
        h: 100,
      });
      const ctx = makeContext(
        { srcNode: 'A', dstNode: 'B', connRout: 'bend', bendPt: 'beg' },
        [makeChild('A'), makeChild('B')],
        { width: 500, height: 500 },
        constraintMap,
      );
      const result = algo.compute(ctx);

      const conn = result.connectors[0];
      expect(conn.points).toHaveLength(3);

      // Bend at beginning: x of bend point should match start x
      expect(conn.points[1].x).toBe(conn.points[0].x);
    });

    it('should support bendPt=end', () => {
      const constraintMap = makeConstraintsForNodes('A', { l: 0, t: 0, w: 100, h: 100 }, 'B', {
        l: 300,
        t: 300,
        w: 100,
        h: 100,
      });
      const ctx = makeContext(
        { srcNode: 'A', dstNode: 'B', connRout: 'bend', bendPt: 'end' },
        [makeChild('A'), makeChild('B')],
        { width: 500, height: 500 },
        constraintMap,
      );
      const result = algo.compute(ctx);

      const conn = result.connectors[0];
      expect(conn.points).toHaveLength(3);

      // Bend at end: x of bend point should match end x
      expect(conn.points[1].x).toBe(conn.points[2].x);
    });

    it('should support bendPt=def (midpoint bend)', () => {
      const constraintMap = makeConstraintsForNodes('A', { l: 0, t: 0, w: 100, h: 100 }, 'B', {
        l: 300,
        t: 300,
        w: 100,
        h: 100,
      });
      const ctx = makeContext(
        { srcNode: 'A', dstNode: 'B', connRout: 'bend', bendPt: 'def' },
        [makeChild('A'), makeChild('B')],
        { width: 500, height: 500 },
        constraintMap,
      );
      const result = algo.compute(ctx);

      const conn = result.connectors[0];
      // def bend has 4 points: start, horizontal midpoint, vertical midpoint, end
      expect(conn.points).toHaveLength(4);
    });
  });

  // ---------------------------------------------------------------------------
  // Curve routing
  // ---------------------------------------------------------------------------

  describe('curve routing', () => {
    it('should create a curve connector with 4 control points', () => {
      const constraintMap = makeConstraintsForNodes('A', { l: 0, t: 0, w: 100, h: 100 }, 'B', {
        l: 300,
        t: 0,
        w: 100,
        h: 100,
      });
      const ctx = makeContext(
        { srcNode: 'A', dstNode: 'B', connRout: 'curve' },
        [makeChild('A'), makeChild('B')],
        { width: 500, height: 500 },
        constraintMap,
      );
      const result = algo.compute(ctx);

      expect(result.connectors).toHaveLength(1);
      const conn = result.connectors[0];
      expect(conn.routingType).toBe('curve');
      expect(conn.points).toHaveLength(4); // start, cp1, cp2, end
    });

    it('should create a long curve connector with wider control points', () => {
      const constraintMap = makeConstraintsForNodes('A', { l: 0, t: 0, w: 100, h: 100 }, 'B', {
        l: 400,
        t: 0,
        w: 100,
        h: 100,
      });
      const ctx = makeContext(
        { srcNode: 'A', dstNode: 'B', connRout: 'longCurve' },
        [makeChild('A'), makeChild('B')],
        { width: 600, height: 500 },
        constraintMap,
      );
      const result = algo.compute(ctx);

      expect(result.connectors).toHaveLength(1);
      expect(result.connectors[0].routingType).toBe('longCurve');
      expect(result.connectors[0].points).toHaveLength(4);
    });
  });

  // ---------------------------------------------------------------------------
  // Connection points
  // ---------------------------------------------------------------------------

  describe('connection points', () => {
    const srcBounds = { l: 0, t: 0, w: 100, h: 100 };
    const dstBounds = { l: 300, t: 300, w: 100, h: 100 };

    function getConnectorPoints(begPts: string, endPts: string) {
      const constraintMap = makeConstraintsForNodes('A', srcBounds, 'B', dstBounds);
      const ctx = makeContext(
        { srcNode: 'A', dstNode: 'B', begPts, endPts },
        [makeChild('A'), makeChild('B')],
        { width: 500, height: 500 },
        constraintMap,
      );
      const result = algo.compute(ctx);
      return result.connectors[0].points;
    }

    it('should use tCtr for top center', () => {
      const points = getConnectorPoints('tCtr', 'auto');
      expect(points[0].x).toBe(50); // center of src
      expect(points[0].y).toBe(0); // top edge
    });

    it('should use bCtr for bottom center', () => {
      const points = getConnectorPoints('bCtr', 'auto');
      expect(points[0].x).toBe(50);
      expect(points[0].y).toBe(100);
    });

    it('should use midL for middle left', () => {
      const points = getConnectorPoints('midL', 'auto');
      expect(points[0].x).toBe(0);
      expect(points[0].y).toBe(50);
    });

    it('should use midR for middle right', () => {
      const points = getConnectorPoints('midR', 'auto');
      expect(points[0].x).toBe(100);
      expect(points[0].y).toBe(50);
    });

    it('should use ctr for center', () => {
      const points = getConnectorPoints('ctr', 'auto');
      expect(points[0].x).toBe(50);
      expect(points[0].y).toBe(50);
    });

    it('should use tL for top left corner', () => {
      const points = getConnectorPoints('tL', 'auto');
      expect(points[0].x).toBe(0);
      expect(points[0].y).toBe(0);
    });

    it('should use tR for top right corner', () => {
      const points = getConnectorPoints('tR', 'auto');
      expect(points[0].x).toBe(100);
      expect(points[0].y).toBe(0);
    });

    it('should use bL for bottom left corner', () => {
      const points = getConnectorPoints('bL', 'auto');
      expect(points[0].x).toBe(0);
      expect(points[0].y).toBe(100);
    });

    it('should use bR for bottom right corner', () => {
      const points = getConnectorPoints('bR', 'auto');
      expect(points[0].x).toBe(100);
      expect(points[0].y).toBe(100);
    });

    it('should use auto to pick closest edge for end points', () => {
      const points = getConnectorPoints('auto', 'auto');
      // Auto should pick the closest edge to the other shape
      // src center is (50, 50), dst center is (350, 350)
      // Closest src edge to dst center: bottom center (50, 100) or right center (100, 50)
      const startPt = points[0];
      // Should be bottom center or right center
      const isBotCenter = startPt.x === 50 && startPt.y === 100;
      const isRightCenter = startPt.x === 100 && startPt.y === 50;
      expect(isBotCenter || isRightCenter).toBe(true);
    });

    it('should use radial connection point', () => {
      const constraintMap = makeConstraintsForNodes('A', { l: 0, t: 0, w: 100, h: 100 }, 'B', {
        l: 200,
        t: 0,
        w: 100,
        h: 100,
      });
      const ctx = makeContext(
        { srcNode: 'A', dstNode: 'B', begPts: 'radial', endPts: 'radial' },
        [makeChild('A'), makeChild('B')],
        { width: 500, height: 500 },
        constraintMap,
      );
      const result = algo.compute(ctx);
      const conn = result.connectors[0];

      // Radial from A to B (B is to the right): should be on right edge
      expect(conn.points[0].x).toBe(100); // right edge of A
    });
  });

  // ---------------------------------------------------------------------------
  // 2D Connectors
  // ---------------------------------------------------------------------------

  describe('2D connectors', () => {
    it('should create a shape for 2D connectors', () => {
      const constraintMap = makeConstraintsForNodes('A', { l: 0, t: 0, w: 100, h: 100 }, 'B', {
        l: 300,
        t: 300,
        w: 100,
        h: 100,
      });
      const ctx = makeContext(
        { srcNode: 'A', dstNode: 'B', dim: '2D' },
        [makeChild('A'), makeChild('B')],
        { width: 500, height: 500 },
        constraintMap,
      );
      const result = algo.compute(ctx);

      expect(result.shapes).toHaveLength(1);
      expect(result.connectors).toHaveLength(1);

      // The 2D shape should span the connector path
      const shape = result.shapes[0];
      expect(shape.width).toBeGreaterThan(0);
      expect(shape.height).toBeGreaterThan(0);
    });

    it('should use node shape type for 2D connector shape', () => {
      const constraintMap = makeConstraintsForNodes('A', { l: 0, t: 0, w: 100, h: 100 }, 'B', {
        l: 200,
        t: 0,
        w: 100,
        h: 100,
      });
      const ctx = makeContext(
        { srcNode: 'A', dstNode: 'B', dim: '2D' },
        [makeChild('A'), makeChild('B')],
        { width: 500, height: 500 },
        constraintMap,
      );
      ctx.node.shape = { type: 'rightArrow' };
      const result = algo.compute(ctx);

      expect(result.shapes[0].shapeType).toBe('rightArrow');
    });
  });

  // ---------------------------------------------------------------------------
  // Style label
  // ---------------------------------------------------------------------------

  describe('style label', () => {
    it('should pass style label to connector', () => {
      const constraintMap = makeConstraintsForNodes('A', { l: 0, t: 0, w: 100, h: 100 }, 'B', {
        l: 200,
        t: 0,
        w: 100,
        h: 100,
      });
      const ctx = makeContext(
        { srcNode: 'A', dstNode: 'B' },
        [makeChild('A'), makeChild('B')],
        { width: 500, height: 500 },
        constraintMap,
      );
      ctx.node.styleLbl = 'sibTrans2D1';
      const result = algo.compute(ctx);

      expect(result.connectors[0].styleLbl).toBe('sibTrans2D1');
    });
  });

  // ---------------------------------------------------------------------------
  // Used bounds
  // ---------------------------------------------------------------------------

  describe('used bounds', () => {
    it('should report used bounds based on connector extent', () => {
      const constraintMap = makeConstraintsForNodes('A', { l: 0, t: 0, w: 100, h: 100 }, 'B', {
        l: 300,
        t: 200,
        w: 100,
        h: 100,
      });
      const ctx = makeContext(
        { srcNode: 'A', dstNode: 'B' },
        [makeChild('A'), makeChild('B')],
        { width: 500, height: 500 },
        constraintMap,
      );
      const result = algo.compute(ctx);

      expect(result.usedBounds.width).toBeGreaterThan(0);
      expect(result.usedBounds.height).toBeGreaterThan(0);
    });

    it('should report zero used bounds when no connectors are created', () => {
      const ctx = makeContext({});
      const result = algo.compute(ctx);
      expect(result.usedBounds.width).toBe(0);
      expect(result.usedBounds.height).toBe(0);
    });
  });

  // ---------------------------------------------------------------------------
  // Horizontally aligned shapes
  // ---------------------------------------------------------------------------

  describe('horizontal connector', () => {
    it('should connect shapes side-by-side horizontally', () => {
      const constraintMap = makeConstraintsForNodes('A', { l: 0, t: 100, w: 80, h: 80 }, 'B', {
        l: 200,
        t: 100,
        w: 80,
        h: 80,
      });
      const ctx = makeContext(
        { srcNode: 'A', dstNode: 'B', begPts: 'midR', endPts: 'midL' },
        [makeChild('A'), makeChild('B')],
        { width: 500, height: 500 },
        constraintMap,
      );
      const result = algo.compute(ctx);

      const conn = result.connectors[0];
      expect(conn.points[0].x).toBe(80); // right edge of A
      expect(conn.points[0].y).toBe(140); // vertical center of A
      expect(conn.points[conn.points.length - 1].x).toBe(200); // left edge of B
      expect(conn.points[conn.points.length - 1].y).toBe(140); // vertical center of B
    });
  });

  // ---------------------------------------------------------------------------
  // Vertically aligned shapes
  // ---------------------------------------------------------------------------

  describe('vertical connector', () => {
    it('should connect shapes stacked vertically', () => {
      const constraintMap = makeConstraintsForNodes('A', { l: 100, t: 0, w: 80, h: 80 }, 'B', {
        l: 100,
        t: 200,
        w: 80,
        h: 80,
      });
      const ctx = makeContext(
        { srcNode: 'A', dstNode: 'B', begPts: 'bCtr', endPts: 'tCtr' },
        [makeChild('A'), makeChild('B')],
        { width: 500, height: 500 },
        constraintMap,
      );
      const result = algo.compute(ctx);

      const conn = result.connectors[0];
      expect(conn.points[0].x).toBe(140); // horizontal center
      expect(conn.points[0].y).toBe(80); // bottom of A
      expect(conn.points[conn.points.length - 1].x).toBe(140);
      expect(conn.points[conn.points.length - 1].y).toBe(200); // top of B
    });
  });

  // ---------------------------------------------------------------------------
  // Edge cases
  // ---------------------------------------------------------------------------

  describe('edge cases', () => {
    it('should handle overlapping shapes', () => {
      const constraintMap = makeConstraintsForNodes('A', { l: 0, t: 0, w: 200, h: 200 }, 'B', {
        l: 100,
        t: 100,
        w: 200,
        h: 200,
      });
      const ctx = makeContext(
        { srcNode: 'A', dstNode: 'B' },
        [makeChild('A'), makeChild('B')],
        { width: 500, height: 500 },
        constraintMap,
      );
      const result = algo.compute(ctx);
      expect(result.connectors).toHaveLength(1);
    });

    it('should handle same-position shapes', () => {
      const constraintMap = makeConstraintsForNodes('A', { l: 0, t: 0, w: 100, h: 100 }, 'B', {
        l: 0,
        t: 0,
        w: 100,
        h: 100,
      });
      const ctx = makeContext(
        { srcNode: 'A', dstNode: 'B' },
        [makeChild('A'), makeChild('B')],
        { width: 500, height: 500 },
        constraintMap,
      );
      const result = algo.compute(ctx);
      expect(result.connectors).toHaveLength(1);
    });

    it('should handle zero-size shapes', () => {
      const constraintMap = makeConstraintsForNodes('A', { l: 50, t: 50, w: 0, h: 0 }, 'B', {
        l: 200,
        t: 200,
        w: 0,
        h: 0,
      });
      const ctx = makeContext(
        { srcNode: 'A', dstNode: 'B', begPts: 'ctr', endPts: 'ctr' },
        [makeChild('A'), makeChild('B')],
        { width: 500, height: 500 },
        constraintMap,
      );
      const result = algo.compute(ctx);
      expect(result.connectors).toHaveLength(1);
      expect(result.connectors[0].points[0]).toEqual({ x: 50, y: 50 });
    });
  });
});
