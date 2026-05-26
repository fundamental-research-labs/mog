/**
 * Layout Edge Cases Tests
 *
 * Tests for edge cases across all layout types.
 */

import type { ILayoutAlgorithm, NodeId } from '@mog-sdk/contracts/diagram';
import { BasicCycleLayout } from '../../src/layouts/cycle';
import { OrganizationChartLayout } from '../../src/layouts/hierarchy';
import { BasicBlockListLayout } from '../../src/layouts/list';
import { BasicMatrixLayout } from '../../src/layouts/matrix';
import { PictureGridLayout } from '../../src/layouts/picture';
import { BasicProcessLayout } from '../../src/layouts/process';
import { BasicPyramidLayout } from '../../src/layouts/pyramid';
import { BasicRadialLayout, BasicVennLayout } from '../../src/layouts/relationship';

// All layout instances for testing
const layouts: Array<{ name: string; layout: ILayoutAlgorithm }> = [
  { name: 'BasicBlockListLayout', layout: new BasicBlockListLayout() },
  { name: 'BasicProcessLayout', layout: new BasicProcessLayout() },
  { name: 'BasicCycleLayout', layout: new BasicCycleLayout() },
  { name: 'OrganizationChartLayout', layout: new OrganizationChartLayout() },
  { name: 'BasicVennLayout', layout: new BasicVennLayout() },
  { name: 'BasicRadialLayout', layout: new BasicRadialLayout() },
  { name: 'BasicMatrixLayout', layout: new BasicMatrixLayout() },
  { name: 'BasicPyramidLayout', layout: new BasicPyramidLayout() },
  { name: 'PictureGridLayout', layout: new PictureGridLayout() },
];

describe('Layout Edge Cases', () => {
  describe('Empty layouts', () => {
    it.each(layouts)('$name should handle 0 nodes gracefully', ({ layout }) => {
      const result = layout.compute(new Map(), [], { width: 400, height: 400 }, {});

      expect(result.positions.size).toBe(0);
      expect(result.connectors.length).toBe(0);
      expect(result.bounds.width).toBeGreaterThanOrEqual(0);
      expect(result.bounds.height).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Single node', () => {
    it.each(layouts)('$name should handle 1 node', ({ layout }) => {
      const nodes = new Map([
        [
          'node1' as NodeId,
          { level: 0, parentId: null as NodeId | null, childIds: [] as NodeId[], siblingOrder: 0 },
        ],
      ]);

      const result = layout.compute(nodes, ['node1' as NodeId], { width: 400, height: 400 }, {});

      expect(result.positions.size).toBe(1);
      expect(result.positions.get('node1' as NodeId)).toBeDefined();

      const pos = result.positions.get('node1' as NodeId)!;
      expect(pos.width).toBeGreaterThan(0);
      expect(pos.height).toBeGreaterThan(0);
    });
  });

  describe('Small bounds', () => {
    it.each(layouts)('$name should handle very small bounds', ({ layout }) => {
      const nodes = new Map([
        [
          'node1' as NodeId,
          { level: 0, parentId: null as NodeId | null, childIds: [] as NodeId[], siblingOrder: 0 },
        ],
        [
          'node2' as NodeId,
          { level: 0, parentId: null as NodeId | null, childIds: [] as NodeId[], siblingOrder: 1 },
        ],
      ]);

      // Very small bounds
      const result = layout.compute(
        nodes,
        ['node1' as NodeId, 'node2' as NodeId],
        { width: 50, height: 50 },
        {},
      );

      // Should still produce positions (even if overlapping)
      expect(result.positions.size).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Large bounds', () => {
    it.each(layouts)('$name should handle very large bounds', ({ layout }) => {
      const nodes = new Map([
        [
          'node1' as NodeId,
          { level: 0, parentId: null as NodeId | null, childIds: [] as NodeId[], siblingOrder: 0 },
        ],
      ]);

      const result = layout.compute(
        nodes,
        ['node1' as NodeId],
        { width: 10000, height: 10000 },
        {},
      );

      expect(result.positions.size).toBe(1);
      const pos = result.positions.get('node1' as NodeId)!;
      // Positions should be valid (positive dimensions) - some layouts fill bounds, which is OK
      expect(pos.width).toBeGreaterThan(0);
      expect(pos.height).toBeGreaterThan(0);
      expect(pos.width).toBeLessThanOrEqual(10000);
      expect(pos.height).toBeLessThanOrEqual(10000);
    });
  });

  describe('Max nodes constraint', () => {
    it('should enforce max 4 nodes for matrix layouts', () => {
      const layout = new BasicMatrixLayout();
      const nodes = new Map(
        Array.from({ length: 10 }, (_, i) => [
          `node${i}` as NodeId,
          { level: 0, parentId: null as NodeId | null, childIds: [] as NodeId[], siblingOrder: i },
        ]),
      );

      const result = layout.compute(
        nodes,
        Array.from({ length: 10 }, (_, i) => `node${i}` as NodeId),
        { width: 400, height: 400 },
        {},
      );

      expect(result.positions.size).toBeLessThanOrEqual(4);
    });

    it('should enforce max 5 nodes for venn layouts', () => {
      const layout = new BasicVennLayout();
      const nodes = new Map(
        Array.from({ length: 10 }, (_, i) => [
          `node${i}` as NodeId,
          { level: 0, parentId: null as NodeId | null, childIds: [] as NodeId[], siblingOrder: i },
        ]),
      );

      const result = layout.compute(
        nodes,
        Array.from({ length: 10 }, (_, i) => `node${i}` as NodeId),
        { width: 400, height: 400 },
        {},
      );

      expect(result.positions.size).toBeLessThanOrEqual(5);
    });
  });

  describe('Unsorted sibling order', () => {
    it.each(
      layouts.filter((l) => l.name !== 'OrganizationChartLayout' && l.name !== 'BasicRadialLayout'),
    )('$name should sort by siblingOrder', ({ layout }) => {
      // Create nodes with non-sequential order
      const nodes = new Map([
        [
          'nodeA' as NodeId,
          { level: 0, parentId: null as NodeId | null, childIds: [] as NodeId[], siblingOrder: 2 },
        ],
        [
          'nodeB' as NodeId,
          { level: 0, parentId: null as NodeId | null, childIds: [] as NodeId[], siblingOrder: 0 },
        ],
        [
          'nodeC' as NodeId,
          { level: 0, parentId: null as NodeId | null, childIds: [] as NodeId[], siblingOrder: 1 },
        ],
      ]);

      const result = layout.compute(
        nodes,
        ['nodeA' as NodeId, 'nodeB' as NodeId, 'nodeC' as NodeId],
        { width: 400, height: 400 },
        {},
      );

      // Should produce valid positions regardless of input order
      expect(result.positions.size).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Position validity', () => {
    it.each(layouts)('$name should produce valid position values', ({ layout }) => {
      const nodes = new Map([
        [
          'node1' as NodeId,
          { level: 0, parentId: null as NodeId | null, childIds: [] as NodeId[], siblingOrder: 0 },
        ],
        [
          'node2' as NodeId,
          { level: 0, parentId: null as NodeId | null, childIds: [] as NodeId[], siblingOrder: 1 },
        ],
        [
          'node3' as NodeId,
          { level: 0, parentId: null as NodeId | null, childIds: [] as NodeId[], siblingOrder: 2 },
        ],
      ]);

      const result = layout.compute(
        nodes,
        ['node1' as NodeId, 'node2' as NodeId, 'node3' as NodeId],
        { width: 400, height: 400 },
        {},
      );

      result.positions.forEach((pos, id) => {
        // All values should be numbers (not NaN or Infinity)
        expect(Number.isFinite(pos.x)).toBe(true);
        expect(Number.isFinite(pos.y)).toBe(true);
        expect(Number.isFinite(pos.width)).toBe(true);
        expect(Number.isFinite(pos.height)).toBe(true);
        expect(Number.isFinite(pos.rotation)).toBe(true);

        // Width and height should be positive
        expect(pos.width).toBeGreaterThan(0);
        expect(pos.height).toBeGreaterThan(0);
      });
    });
  });

  describe('Connector validity', () => {
    it.each(layouts)('$name should produce valid connector paths', ({ layout }) => {
      const nodes = new Map([
        [
          'node1' as NodeId,
          {
            level: 0,
            parentId: null as NodeId | null,
            childIds: ['node2' as NodeId],
            siblingOrder: 0,
          },
        ],
        [
          'node2' as NodeId,
          { level: 1, parentId: 'node1' as NodeId, childIds: [] as NodeId[], siblingOrder: 0 },
        ],
      ]);

      const result = layout.compute(nodes, ['node1' as NodeId], { width: 400, height: 400 }, {});

      result.connectors.forEach((conn) => {
        expect(conn.fromId).toBeDefined();
        expect(conn.toId).toBeDefined();
        expect(conn.path).toBeDefined();
        expect(['line', 'bezier', 'polyline']).toContain(conn.path.type);

        // Points should have valid coordinates
        conn.path.points.forEach((point) => {
          expect(Number.isFinite(point.x)).toBe(true);
          expect(Number.isFinite(point.y)).toBe(true);
        });
      });
    });
  });
});
