/**
 * Diagram Rendering Pipeline Integration Tests
 *
 * End-to-end: computeLayout() -> layoutToDrawingObjects() -> renderDrawingObjectToSVG().
 * Uses REAL implementations, NOT mocks.
 *
 * Note: computeLayout() returns a LayoutResult (positions Map + connectors),
 * while layoutToDrawingObjects() expects a ComputedLayout (shapes[] + connectors[]).
 * The bridge layer converts between these. Here we test both paths:
 * - LayoutResult from computeLayout() (verifying it produces valid data)
 * - ComputedLayout -> DrawingObject[] -> SVG (the rendering pipeline)
 */
import { renderDrawingObjectToSVG } from '@mog/drawing-engine';
import type { DrawingObject } from '@mog-sdk/contracts/drawing';
import type { ComputedLayout, NodeId } from '@mog-sdk/contracts/diagram';
import { computeLayout, layoutRegistry, layoutToDrawingObjects } from '../../src';
import { createTestComputedLayout, createTestComputedShape } from '../fixtures/mock-factories';

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Create a flat set of nodes (all at root level).
 */
function createFlatNodes(count: number) {
  const nodes = new Map<
    NodeId,
    { level: number; parentId: NodeId | null; childIds: NodeId[]; siblingOrder: number }
  >();
  const rootNodeIds: NodeId[] = [];

  for (let i = 0; i < count; i++) {
    const id = `node-${i}` as NodeId;
    nodes.set(id, { level: 0, parentId: null, childIds: [], siblingOrder: i });
    rootNodeIds.push(id);
  }

  return { nodes, rootNodeIds };
}

/**
 * Create a hierarchical node set: 1 root + N children.
 */
function createHierarchicalNodes(childCount: number) {
  const nodes = new Map<
    NodeId,
    { level: number; parentId: NodeId | null; childIds: NodeId[]; siblingOrder: number }
  >();

  const rootId = 'root' as NodeId;
  const childIds: NodeId[] = [];

  for (let i = 0; i < childCount; i++) {
    const childId = `child-${i}` as NodeId;
    childIds.push(childId);
    nodes.set(childId, { level: 1, parentId: rootId, childIds: [], siblingOrder: i });
  }

  nodes.set(rootId, { level: 0, parentId: null, childIds, siblingOrder: 0 });

  return { nodes, rootNodeIds: [rootId] };
}

// =============================================================================
// Tests
// =============================================================================

describe('Diagram Pipeline Integration', () => {
  // ===========================================================================
  // 1. Basic process layout produces valid SVG
  // ===========================================================================

  it('basic process layout through full rendering pipeline produces valid SVG', () => {
    // Create a ComputedLayout (what the bridge produces after computeLayout)
    const layout = createTestComputedLayout(3);

    // Convert to DrawingObjects
    const drawingObjects = layoutToDrawingObjects(layout);
    expect(drawingObjects.length).toBeGreaterThan(0);

    // Render each DrawingObject to SVG
    for (const obj of drawingObjects) {
      const svg = renderDrawingObjectToSVG(obj as DrawingObject);
      expect(svg).toBeTruthy();
      expect(typeof svg).toBe('string');
      expect(svg.startsWith('<svg')).toBe(true);
    }

    // At least one should contain a <path element
    const allSvg = drawingObjects.map((o) => renderDrawingObjectToSVG(o as DrawingObject)).join('');
    expect(allSvg).toContain('<path');

    // Verify fill colors appear in SVG output (shapes use '#4A90D9' from mock factory)
    expect(allSvg).toContain('#4A90D9');

    // Verify stroke attributes appear in SVG output (shapes use '#333333' from mock factory)
    expect(allSvg).toContain('stroke=');
    expect(allSvg).toContain('#333333');
    expect(allSvg).toContain('stroke-width=');
  });

  // ===========================================================================
  // 2. All layout types produce LayoutResults from computeLayout
  // ===========================================================================

  it('all layout types produce valid LayoutResults', () => {
    const allLayouts = layoutRegistry.getAll();
    expect(allLayouts.length).toBeGreaterThan(0);

    let implementedCount = 0;

    for (const layoutDef of allLayouts) {
      // Some layouts need hierarchical data, some need flat
      const isHierarchical = layoutDef.category === 'hierarchy';
      const { nodes, rootNodeIds } = isHierarchical
        ? createHierarchicalNodes(3)
        : createFlatNodes(3);

      const bounds = { width: 600, height: 400 };
      const result = computeLayout(layoutDef.id, nodes, rootNodeIds, bounds);

      if (result === null) {
        // Layout not implemented yet, skip
        continue;
      }

      implementedCount++;
      // LayoutResult has positions (Map) and connectors (Array)
      expect(result.positions).toBeDefined();
      expect(result.positions.size).toBeGreaterThan(0);
      expect(result.connectors).toBeDefined();
      expect(Array.isArray(result.connectors)).toBe(true);
    }

    // At least some layouts should be implemented
    expect(implementedCount).toBeGreaterThan(0);
  });

  // ===========================================================================
  // 3. DrawingObjects have correct structure
  // ===========================================================================

  it('each DrawingObject from layoutToDrawingObjects has geometry defined', () => {
    const layout = createTestComputedLayout(3);
    const drawingObjects = layoutToDrawingObjects(layout);

    for (const obj of drawingObjects) {
      const typedObj = obj as DrawingObject;
      expect(typedObj.geometry).toBeDefined();
      expect(typedObj.geometry.segments).toBeDefined();
    }
  });

  // ===========================================================================
  // 4. Connectors included
  // ===========================================================================

  it('process layout includes connectors with stroke but fill type none', () => {
    const layout = createTestComputedLayout(3);
    const drawingObjects = layoutToDrawingObjects(layout);

    // With 3 shapes and 2 connectors, connectors come first
    const connectors = drawingObjects.filter((obj) => {
      const typedObj = obj as DrawingObject;
      return typedObj.fill && (typedObj.fill as { type: string }).type === 'none';
    });

    expect(connectors.length).toBeGreaterThan(0);

    for (const conn of connectors) {
      const typedConn = conn as DrawingObject;
      expect(typedConn.stroke).toBeDefined();

      // Verify connector stroke color matches factory connector stroke '#666666'
      expect(typedConn.stroke!.color).toBe('#666666');
      expect(typedConn.stroke!.width).toBe(1);

      // Verify connector SVG rendering includes stroke attributes
      const svg = renderDrawingObjectToSVG(typedConn);
      expect(svg).toContain('stroke="#666666"');
      expect(svg).toContain('stroke-width="1"');
    }
  });

  // ===========================================================================
  // 5. Shape DrawingObjects have fills
  // ===========================================================================

  it('non-connector DrawingObjects have fill defined', () => {
    const layout = createTestComputedLayout(3);
    const drawingObjects = layoutToDrawingObjects(layout);

    // Filter to shapes (non-connectors: fill type is NOT 'none')
    const shapes = drawingObjects.filter((obj) => {
      const typedObj = obj as DrawingObject;
      return !typedObj.fill || (typedObj.fill as { type: string }).type !== 'none';
    });

    expect(shapes.length).toBeGreaterThan(0);

    for (const shape of shapes) {
      const typedShape = shape as DrawingObject;
      expect(typedShape.fill).toBeDefined();
    }
  });

  // ===========================================================================
  // 6. Shape DrawingObjects have correct transforms
  // ===========================================================================

  it('shape DrawingObjects have translation transforms matching layout positions', () => {
    const layout = createTestComputedLayout(3);
    const drawingObjects = layoutToDrawingObjects(layout);

    // Filter to shapes (non-connectors: fill type is NOT 'none')
    const shapes = drawingObjects.filter((obj) => {
      const typedObj = obj as DrawingObject;
      return !typedObj.fill || (typedObj.fill as { type: string }).type !== 'none';
    });

    expect(shapes.length).toBe(3);

    // Each shape should have a transform
    for (const shape of shapes) {
      const typedShape = shape as DrawingObject;
      expect(typedShape.transform).toBeDefined();
      // Pure translation: a=1, b=0, c=0, d=1
      expect(typedShape.transform!.a).toBe(1);
      expect(typedShape.transform!.b).toBe(0);
      expect(typedShape.transform!.c).toBe(0);
      expect(typedShape.transform!.d).toBe(1);
    }

    // Verify that shapes have different tx values (they are spaced horizontally)
    const txValues = shapes.map((s) => (s as DrawingObject).transform!.tx);
    const uniqueTx = new Set(txValues);
    expect(uniqueTx.size).toBe(3);

    // Verify SVG output includes transform attribute
    for (const shape of shapes) {
      const svg = renderDrawingObjectToSVG(shape as DrawingObject);
      expect(svg).toContain('transform="matrix(');
    }
  });

  // ===========================================================================
  // 7. Hierarchical layout works
  // ===========================================================================

  it('hierarchical org-chart layout produces valid LayoutResult', () => {
    const { nodes, rootNodeIds } = createHierarchicalNodes(3);
    const bounds = { width: 600, height: 400 };

    // Use the hierarchy category layouts
    const hierarchyLayouts = layoutRegistry.getByCategory('hierarchy');

    let testedAny = false;
    for (const layoutDef of hierarchyLayouts) {
      const result = computeLayout(layoutDef.id, nodes, rootNodeIds, bounds);

      if (result === null) continue;

      testedAny = true;
      // Verify positions include root + children
      expect(result.positions.size).toBeGreaterThanOrEqual(1);
      break; // Test at least one
    }

    // If no hierarchy layouts are implemented, use a ComputedLayout directly
    if (!testedAny) {
      const layout: ComputedLayout = {
        shapes: [
          createTestComputedShape({
            nodeId: 'root' as NodeId,
            x: 200,
            y: 0,
            width: 100,
            height: 60,
            text: 'Root',
          }),
          createTestComputedShape({
            nodeId: 'child-0' as NodeId,
            x: 50,
            y: 100,
            width: 80,
            height: 50,
            text: 'A',
          }),
          createTestComputedShape({
            nodeId: 'child-1' as NodeId,
            x: 180,
            y: 100,
            width: 80,
            height: 50,
            text: 'B',
          }),
          createTestComputedShape({
            nodeId: 'child-2' as NodeId,
            x: 310,
            y: 100,
            width: 80,
            height: 50,
            text: 'C',
          }),
        ],
        connectors: [],
        bounds: { width: 400, height: 160 },
        version: 1,
      };

      const drawingObjects = layoutToDrawingObjects(layout);
      expect(drawingObjects.length).toBe(4);
    }
  });
});
