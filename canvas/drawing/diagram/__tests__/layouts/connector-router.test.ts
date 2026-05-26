/**
 * Connector Router Tests
 *
 * Tests for the connector routing system used by Diagram layouts.
 */

import type { NodeId } from '@mog-sdk/contracts/diagram';
import {
  BezierConnectorRouter,
  DirectConnectorRouter,
  OrthogonalConnectorRouter,
  type ConnectionPoint,
  type NodePosition,
} from '../../src/layouts/connector-router';

/** Helper to cast a string literal to the branded NodeId type in tests. */
const nid = (s: string): NodeId => s as NodeId;

describe('DirectConnectorRouter', () => {
  const router = new DirectConnectorRouter();

  const createPositions = (): Map<NodeId, NodePosition> => {
    return new Map<NodeId, NodePosition>([
      [nid('node1'), { x: 0, y: 0, width: 100, height: 50 }],
      [nid('node2'), { x: 200, y: 0, width: 100, height: 50 }],
      [nid('node3'), { x: 100, y: 100, width: 100, height: 50 }],
    ]);
  };

  describe('route', () => {
    it('should route from right to left side', () => {
      const positions = createPositions();
      const from: ConnectionPoint = { nodeId: nid('node1'), side: 'right' };
      const to: ConnectionPoint = { nodeId: nid('node2'), side: 'left' };

      const path = router.route(from, to, positions, []);

      expect(path.type).toBe('line');
      expect(path.points.length).toBe(2);
      expect(path.points[0]).toEqual({ x: 100, y: 25 }); // right side of node1
      expect(path.points[1]).toEqual({ x: 200, y: 25 }); // left side of node2
    });

    it('should route from bottom to top side', () => {
      const positions = createPositions();
      const from: ConnectionPoint = { nodeId: nid('node1'), side: 'bottom' };
      const to: ConnectionPoint = { nodeId: nid('node3'), side: 'top' };

      const path = router.route(from, to, positions, []);

      expect(path.type).toBe('line');
      expect(path.points.length).toBe(2);
      expect(path.points[0]).toEqual({ x: 50, y: 50 }); // bottom of node1
      expect(path.points[1]).toEqual({ x: 150, y: 100 }); // top of node3
    });

    it('should route from center to center', () => {
      const positions = createPositions();
      const from: ConnectionPoint = { nodeId: nid('node1'), side: 'center' };
      const to: ConnectionPoint = { nodeId: nid('node2'), side: 'center' };

      const path = router.route(from, to, positions, []);

      expect(path.type).toBe('line');
      expect(path.points[0]).toEqual({ x: 50, y: 25 }); // center of node1
      expect(path.points[1]).toEqual({ x: 250, y: 25 }); // center of node2
    });

    it('should handle missing source node gracefully', () => {
      const positions = createPositions();
      const from: ConnectionPoint = { nodeId: nid('nonexistent'), side: 'right' };
      const to: ConnectionPoint = { nodeId: nid('node2'), side: 'left' };

      const path = router.route(from, to, positions, []);

      expect(path.type).toBe('line');
      expect(path.points).toEqual([]);
    });

    it('should handle missing target node gracefully', () => {
      const positions = createPositions();
      const from: ConnectionPoint = { nodeId: nid('node1'), side: 'right' };
      const to: ConnectionPoint = { nodeId: nid('nonexistent'), side: 'left' };

      const path = router.route(from, to, positions, []);

      expect(path.type).toBe('line');
      expect(path.points).toEqual([]);
    });

    it('should apply offset to connection point', () => {
      const positions = createPositions();
      const from: ConnectionPoint = {
        nodeId: nid('node1'),
        side: 'right',
        offset: { x: 10, y: 5 },
      };
      const to: ConnectionPoint = { nodeId: nid('node2'), side: 'left' };

      const path = router.route(from, to, positions, []);

      expect(path.points[0]).toEqual({ x: 110, y: 30 }); // right + offset
    });

    it('should route from all sides correctly', () => {
      const positions = createPositions();
      const sides: Array<'top' | 'bottom' | 'left' | 'right' | 'center'> = [
        'top',
        'bottom',
        'left',
        'right',
        'center',
      ];

      for (const side of sides) {
        const from: ConnectionPoint = { nodeId: nid('node1'), side };
        const to: ConnectionPoint = { nodeId: nid('node2'), side: 'center' };

        const path = router.route(from, to, positions, []);

        expect(path.type).toBe('line');
        expect(path.points.length).toBe(2);
      }
    });
  });
});

describe('OrthogonalConnectorRouter', () => {
  const router = new OrthogonalConnectorRouter();

  const createPositions = (): Map<NodeId, NodePosition> => {
    return new Map<NodeId, NodePosition>([
      [nid('node1'), { x: 0, y: 0, width: 100, height: 50 }],
      [nid('node2'), { x: 0, y: 100, width: 100, height: 50 }],
      [nid('node3'), { x: 200, y: 0, width: 100, height: 50 }],
    ]);
  };

  describe('route', () => {
    it('should create elbow path for bottom to top connection', () => {
      const positions = createPositions();
      const from: ConnectionPoint = { nodeId: nid('node1'), side: 'bottom' };
      const to: ConnectionPoint = { nodeId: nid('node2'), side: 'top' };

      const path = router.route(from, to, positions, []);

      expect(path.type).toBe('polyline');
      expect(path.points.length).toBe(4); // start, mid1, mid2, end
      expect(path.points[0]).toEqual({ x: 50, y: 50 }); // bottom of node1
      expect(path.points[path.points.length - 1]).toEqual({ x: 50, y: 100 }); // top of node2
    });

    it('should create elbow path for right to left connection', () => {
      const positions = createPositions();
      const from: ConnectionPoint = { nodeId: nid('node1'), side: 'right' };
      const to: ConnectionPoint = { nodeId: nid('node3'), side: 'left' };

      const path = router.route(from, to, positions, []);

      expect(path.type).toBe('polyline');
      expect(path.points[0]).toEqual({ x: 100, y: 25 }); // right of node1
      expect(path.points[path.points.length - 1]).toEqual({ x: 200, y: 25 }); // left of node3
    });

    it('should handle missing nodes gracefully', () => {
      const positions = createPositions();
      const from: ConnectionPoint = { nodeId: nid('nonexistent'), side: 'right' };
      const to: ConnectionPoint = { nodeId: nid('node2'), side: 'left' };

      const path = router.route(from, to, positions, []);

      expect(path.type).toBe('polyline');
      expect(path.points).toEqual([]);
    });

    it('should handle center to center connection', () => {
      const positions = createPositions();
      const from: ConnectionPoint = { nodeId: nid('node1'), side: 'center' };
      const to: ConnectionPoint = { nodeId: nid('node3'), side: 'center' };

      const path = router.route(from, to, positions, []);

      expect(path.type).toBe('polyline');
      expect(path.points.length).toBeGreaterThanOrEqual(2);
    });
  });
});

describe('BezierConnectorRouter', () => {
  const router = new BezierConnectorRouter();

  const createPositions = (): Map<NodeId, NodePosition> => {
    return new Map<NodeId, NodePosition>([
      [nid('node1'), { x: 0, y: 0, width: 100, height: 50 }],
      [nid('node2'), { x: 200, y: 100, width: 100, height: 50 }],
    ]);
  };

  describe('route', () => {
    it('should create bezier path with control points', () => {
      const positions = createPositions();
      const from: ConnectionPoint = { nodeId: nid('node1'), side: 'bottom' };
      const to: ConnectionPoint = { nodeId: nid('node2'), side: 'top' };

      const path = router.route(from, to, positions, []);

      expect(path.type).toBe('bezier');
      expect(path.points.length).toBe(2);
      expect(path.controlPoints).toBeDefined();
      expect(path.controlPoints?.length).toBe(2);
    });

    it('should calculate control points extending from connection side', () => {
      const positions = createPositions();
      const from: ConnectionPoint = { nodeId: nid('node1'), side: 'right' };
      const to: ConnectionPoint = { nodeId: nid('node2'), side: 'left' };

      const path = router.route(from, to, positions, []);

      // Control point should extend in the direction of the connection side
      const fromPos = path.points[0];
      const toPos = path.points[1];
      const cp1 = path.controlPoints![0];
      const cp2 = path.controlPoints![1];

      // From right side, control point should be to the right of connection point
      expect(cp1.x).toBeGreaterThan(fromPos.x);

      // From left side, control point should be to the left of connection point
      expect(cp2.x).toBeLessThan(toPos.x);
    });

    it('should handle missing nodes gracefully', () => {
      const positions = createPositions();
      const from: ConnectionPoint = { nodeId: nid('nonexistent'), side: 'right' };
      const to: ConnectionPoint = { nodeId: nid('node2'), side: 'left' };

      const path = router.route(from, to, positions, []);

      expect(path.type).toBe('bezier');
      expect(path.points).toEqual([]);
      expect(path.controlPoints).toEqual([]);
    });

    it('should handle center connections', () => {
      const positions = createPositions();
      const from: ConnectionPoint = { nodeId: nid('node1'), side: 'center' };
      const to: ConnectionPoint = { nodeId: nid('node2'), side: 'center' };

      const path = router.route(from, to, positions, []);

      expect(path.type).toBe('bezier');
      expect(path.points.length).toBe(2);
      // Center connections have control points at same position
      expect(path.controlPoints![0]).toEqual(path.points[0]);
      expect(path.controlPoints![1]).toEqual(path.points[1]);
    });
  });
});
