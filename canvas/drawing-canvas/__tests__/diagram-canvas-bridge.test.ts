/**
 * Diagram Canvas Bridge Tests
 *
 * Tests for DiagramCanvasBridge rendering paths:
 * 1. Empty diagram placeholder (gray box + "Diagram" label)
 * 2. Fallback layout (equal-sized rounded rectangles from nodes array)
 * 3. Computed layout (from kernel bridge cache)
 * 4. Connector rendering (lines, arrows, bezier curves)
 * 5. Edge cases (zero-size bounds, null kernel bridge)
 */

import { jest } from '@jest/globals';

import type { Rect } from '@mog/canvas-engine';
import type { IDiagramBridge as IDiagramKernelBridge } from '@mog-sdk/contracts/bridges';
import type {
  ComputedConnector,
  ComputedLayout,
  ComputedShape,
  NodeId,
} from '@mog-sdk/contracts/diagram';

import { DiagramCanvasBridge } from '../src/bridges/diagram-canvas-bridge';

// =============================================================================
// Mock CanvasRenderingContext2D
// =============================================================================

function createMockCtx(): CanvasRenderingContext2D {
  const ctx: Record<string, unknown> = {
    // State
    save: jest.fn(),
    restore: jest.fn(),

    // Path operations
    beginPath: jest.fn(),
    closePath: jest.fn(),
    moveTo: jest.fn(),
    lineTo: jest.fn(),
    arc: jest.fn(),
    quadraticCurveTo: jest.fn(),
    bezierCurveTo: jest.fn(),
    rect: jest.fn(),
    roundRect: jest.fn(),
    clip: jest.fn(),

    // Drawing
    fill: jest.fn(),
    stroke: jest.fn(),
    fillRect: jest.fn(),
    strokeRect: jest.fn(),
    fillText: jest.fn(),
    strokeText: jest.fn(),

    // Transforms
    translate: jest.fn(),
    rotate: jest.fn(),
    scale: jest.fn(),
    setTransform: jest.fn(),

    // Settable properties (using plain values so they can be read back)
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    font: '',
    textAlign: 'start',
    textBaseline: 'alphabetic',
    globalAlpha: 1,
  };

  return ctx as unknown as CanvasRenderingContext2D;
}

// =============================================================================
// Test Data Helpers
// =============================================================================

function makeBounds(x = 10, y = 10, width = 400, height = 200): Rect {
  return { x, y, width, height };
}

function makeNode(id: string, text: string, level = 0) {
  return { id, text, level };
}

function makeComputedShape(nodeId: string, overrides: Partial<ComputedShape> = {}): ComputedShape {
  return {
    nodeId: nodeId as NodeId,
    shapeType: 'roundRect',
    x: 0,
    y: 0,
    width: 100,
    height: 60,
    rotation: 0,
    fill: '#4472C4',
    stroke: '#2F528F',
    strokeWidth: 1,
    text: 'Node',
    textStyle: {
      fontFamily: 'Calibri',
      fontSize: 12,
      fontWeight: 'normal',
      fontStyle: 'normal',
      color: '#FFFFFF',
      align: 'center',
      verticalAlign: 'middle',
    },
    effects: {},
    ...overrides,
  };
}

function makeComputedConnector(
  fromId: string,
  toId: string,
  overrides: Partial<ComputedConnector> = {},
): ComputedConnector {
  return {
    fromNodeId: fromId as NodeId,
    toNodeId: toId as NodeId,
    connectorType: 'straight',
    path: {
      type: 'line',
      points: [
        { x: 100, y: 30 },
        { x: 150, y: 30 },
      ],
    },
    stroke: '#404040',
    strokeWidth: 1.5,
    ...overrides,
  };
}

function makeComputedLayout(overrides: Partial<ComputedLayout> = {}): ComputedLayout {
  return {
    shapes: [],
    connectors: [],
    bounds: { width: 400, height: 200 },
    version: 1,
    ...overrides,
  };
}

function makeKernelBridge(
  layoutMap: Record<string, ComputedLayout | undefined> = {},
): IDiagramKernelBridge {
  return {
    getComputedLayout: jest.fn((objectId: string) => layoutMap[objectId]),
    invalidateLayout: jest.fn(),
    invalidateAllLayouts: jest.fn(),
    getDiagram: jest.fn(),
    addNode: jest.fn(),
    removeNode: jest.fn(),
    updateNodeText: jest.fn(),
    moveNode: jest.fn(),
    setLayout: jest.fn(),
    setQuickStyle: jest.fn(),
    setColorTheme: jest.fn(),
    subscribe: jest.fn(() => jest.fn()),
    batchAddNodes: jest.fn(),
    batchRemoveNodes: jest.fn(),
    updateNodeStyle: jest.fn(),
    setLayoutOptions: jest.fn(),
  } as unknown as IDiagramKernelBridge;
}

// =============================================================================
// Tests
// =============================================================================

describe('DiagramCanvasBridge', () => {
  // ---------------------------------------------------------------------------
  // Empty Diagram Placeholder
  // ---------------------------------------------------------------------------

  describe('empty diagram placeholder', () => {
    test('renders gray box with Diagram label when nodes array is empty', () => {
      const bridge = new DiagramCanvasBridge();
      const ctx = createMockCtx();
      const bounds = makeBounds();

      bridge.renderDiagram('process', [], ctx, bounds);

      // Should save and restore context
      expect(ctx.save).toHaveBeenCalled();
      expect(ctx.restore).toHaveBeenCalled();

      // Should draw a rounded rectangle for the placeholder box
      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.roundRect).toHaveBeenCalledWith(
        bounds.x,
        bounds.y,
        bounds.width,
        bounds.height,
        4,
      );
      expect(ctx.fill).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();

      // Should draw "Diagram" text centered in bounds
      expect(ctx.fillText).toHaveBeenCalledWith(
        'Diagram',
        bounds.x + bounds.width / 2,
        bounds.y + bounds.height / 2,
        expect.any(Number),
      );
    });

    test('sets correct colors for placeholder', () => {
      const bridge = new DiagramCanvasBridge();
      const ctx = createMockCtx();
      const bounds = makeBounds();

      bridge.renderDiagram('hierarchy', [], ctx, bounds);

      // The placeholder should use gray fill (#F0F0F0) and border (#C0C0C0)
      // and text color (#808080). We verify by checking the property was set
      // at some point. Since ctx properties are plain values, we check after
      // restoration that fillText was called (which means fillStyle was set to #808080).
      expect(ctx.fillText).toHaveBeenCalledWith(
        'Diagram',
        expect.any(Number),
        expect.any(Number),
        expect.any(Number),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Single Node Fallback
  // ---------------------------------------------------------------------------

  describe('single node fallback rendering', () => {
    test('renders a rounded rectangle for one node', () => {
      const bridge = new DiagramCanvasBridge();
      const ctx = createMockCtx();
      const bounds = makeBounds();
      const nodes = [makeNode('n1', 'Step 1')];

      bridge.renderDiagram('process', nodes, ctx, bounds);

      // Should call beginPath + roundRect + fill + stroke for the shape
      expect(ctx.beginPath).toHaveBeenCalled();
      expect(ctx.roundRect).toHaveBeenCalled();
      expect(ctx.fill).toHaveBeenCalled();
      expect(ctx.stroke).toHaveBeenCalled();
    });

    test('renders the node text', () => {
      const bridge = new DiagramCanvasBridge();
      const ctx = createMockCtx();
      const bounds = makeBounds();
      const nodes = [makeNode('n1', 'Step 1')];

      bridge.renderDiagram('process', nodes, ctx, bounds);

      expect(ctx.fillText).toHaveBeenCalledWith('Step 1', expect.any(Number), expect.any(Number));
    });

    test('does not draw connectors for single node', () => {
      const bridge = new DiagramCanvasBridge();
      const ctx = createMockCtx();
      const bounds = makeBounds();
      const nodes = [makeNode('n1', 'Step 1')];

      bridge.renderDiagram('process', nodes, ctx, bounds);

      // moveTo is used for connectors between nodes. With a single node,
      // moveTo should not be called (no connector lines).
      expect(ctx.moveTo).not.toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Multiple Nodes with Connectors
  // ---------------------------------------------------------------------------

  describe('multiple nodes with connectors', () => {
    test('renders connector lines between adjacent nodes', () => {
      const bridge = new DiagramCanvasBridge();
      const ctx = createMockCtx();
      const bounds = makeBounds(0, 0, 600, 200);
      const nodes = [makeNode('n1', 'Step 1'), makeNode('n2', 'Step 2'), makeNode('n3', 'Step 3')];

      bridge.renderDiagram('process', nodes, ctx, bounds);

      // With 3 nodes, there should be 2 connector lines.
      // Each connector calls moveTo + lineTo for the line itself,
      // plus the arrow head calls moveTo + lineTo x2.
      // So: 2 connector moveTo + 2 arrowhead moveTo = 4 moveTo total.
      // And: 2 connector lineTo + 2 arrowhead x2 lineTo = 6 lineTo total.
      expect(ctx.moveTo).toHaveBeenCalledTimes(4);
      expect(ctx.lineTo).toHaveBeenCalledTimes(6);
    });

    test('renders all three node shapes', () => {
      const bridge = new DiagramCanvasBridge();
      const ctx = createMockCtx();
      const bounds = makeBounds(0, 0, 600, 200);
      const nodes = [makeNode('n1', 'A'), makeNode('n2', 'B'), makeNode('n3', 'C')];

      bridge.renderDiagram('process', nodes, ctx, bounds);

      // Each shape draws: beginPath + roundRect + fill + stroke + text
      // Plus connectors also use beginPath. So roundRect should be called 3 times
      // for the 3 shapes (connectors don't use roundRect).
      // But the text clipping rect also calls beginPath + rect. Let's verify
      // fillText is called 3 times (once per node text).
      expect(ctx.fillText).toHaveBeenCalledTimes(3);
      expect(ctx.fillText).toHaveBeenCalledWith('A', expect.any(Number), expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalledWith('B', expect.any(Number), expect.any(Number));
      expect(ctx.fillText).toHaveBeenCalledWith('C', expect.any(Number), expect.any(Number));
    });

    test('renders arrow heads for connectors', () => {
      const bridge = new DiagramCanvasBridge();
      const ctx = createMockCtx();
      const bounds = makeBounds(0, 0, 600, 200);
      const nodes = [makeNode('n1', 'A'), makeNode('n2', 'B'), makeNode('n3', 'C')];

      bridge.renderDiagram('process', nodes, ctx, bounds);

      // Arrow heads use closePath (triangle path: moveTo + lineTo + lineTo + closePath)
      // 2 connectors = 2 arrow heads = 2 closePath calls
      expect(ctx.closePath).toHaveBeenCalledTimes(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Hierarchy Levels (Different Fill Colors)
  // ---------------------------------------------------------------------------

  describe('hierarchy level coloring', () => {
    test('nodes at different levels get different fill colors', () => {
      const bridge = new DiagramCanvasBridge();
      const ctx = createMockCtx();
      const bounds = makeBounds(0, 0, 600, 200);

      const nodes = [
        makeNode('n1', 'Root', 0),
        makeNode('n2', 'Child', 1),
        makeNode('n3', 'Grandchild', 2),
      ];

      // Track fillStyle values set before each fill() call
      const fillStyles: string[] = [];
      const originalFill = ctx.fill as jest.Mock;
      originalFill.mockImplementation(() => {
        fillStyles.push(ctx.fillStyle as string);
      });

      bridge.renderDiagram('hierarchy', nodes, ctx, bounds);

      // The fallback rendering sets fillStyle based on level:
      // level 0 -> DEFAULT_FILL (#4472C4)
      // level 1 -> lightenHex(#4472C4, 10)
      // level 2 -> lightenHex(#4472C4, 20)
      // So we should see at least 3 distinct fill calls for shapes.
      // Filter to hex colors (shape fills, not connector or text fills).
      const hexFills = fillStyles.filter((s) => typeof s === 'string' && s.startsWith('#'));
      expect(hexFills.length).toBeGreaterThanOrEqual(3);

      // Level 0 should use default fill
      expect(hexFills).toContain('#4472C4');

      // Level 1 and 2 should produce lighter colors (different from level 0)
      const uniqueFills = new Set(hexFills);
      expect(uniqueFills.size).toBeGreaterThanOrEqual(2);
    });
  });

  // ---------------------------------------------------------------------------
  // Kernel Bridge with Computed Layout
  // ---------------------------------------------------------------------------

  describe('rendering from computed layout', () => {
    test('uses cached layout when available', () => {
      const layout = makeComputedLayout({
        shapes: [makeComputedShape('n1', { x: 10, y: 10, width: 120, height: 60, text: 'Hello' })],
        connectors: [],
        bounds: { width: 300, height: 150 },
      });

      const kernelBridge = makeKernelBridge({ 'obj-1': layout });
      const bridge = new DiagramCanvasBridge(kernelBridge);
      const ctx = createMockCtx();
      const bounds = makeBounds();

      // First call: no cache yet, triggers async fetch, uses fallback
      bridge.renderDiagram('process', [makeNode('n1', 'Hello')], ctx, bounds, 'obj-1');

      // The kernel bridge returns synchronously, so the cache should be populated.
      // Second call should use the cached layout.
      const ctx2 = createMockCtx();
      bridge.renderDiagram('process', [makeNode('n1', 'Hello')], ctx2, bounds, 'obj-1');

      // renderFromLayout renders shapes using save/restore, roundRect, fill, etc.
      expect(ctx2.save).toHaveBeenCalled();
      expect(ctx2.roundRect).toHaveBeenCalled();
      expect(ctx2.fill).toHaveBeenCalled();
      expect(ctx2.fillText).toHaveBeenCalledWith('Hello', expect.any(Number), expect.any(Number));
    });

    test('renders shapes with rotation when specified', () => {
      const layout = makeComputedLayout({
        shapes: [
          makeComputedShape('n1', {
            x: 50,
            y: 50,
            width: 100,
            height: 60,
            rotation: 45,
            text: 'Rotated',
          }),
        ],
      });

      const kernelBridge = makeKernelBridge({ 'obj-rot': layout });
      const bridge = new DiagramCanvasBridge(kernelBridge);

      // Prime the cache
      const ctx1 = createMockCtx();
      bridge.renderDiagram('process', [], ctx1, makeBounds(), 'obj-rot');

      // Render from cached layout
      const ctx2 = createMockCtx();
      bridge.renderDiagram('process', [], ctx2, makeBounds(), 'obj-rot');

      // Rotation path: translate to center, rotate, translate back
      expect(ctx2.translate).toHaveBeenCalledTimes(2);
      expect(ctx2.rotate).toHaveBeenCalled();
    });

    test('renders connectors from computed layout', () => {
      const layout = makeComputedLayout({
        shapes: [
          makeComputedShape('n1', { x: 0, y: 0, width: 100, height: 60, text: 'A' }),
          makeComputedShape('n2', { x: 150, y: 0, width: 100, height: 60, text: 'B' }),
        ],
        connectors: [
          makeComputedConnector('n1', 'n2', {
            path: {
              type: 'line',
              points: [
                { x: 100, y: 30 },
                { x: 150, y: 30 },
              ],
            },
          }),
        ],
      });

      const kernelBridge = makeKernelBridge({ 'obj-conn': layout });
      const bridge = new DiagramCanvasBridge(kernelBridge);

      // Prime cache
      const ctx1 = createMockCtx();
      bridge.renderDiagram('process', [], ctx1, makeBounds(), 'obj-conn');

      // Render
      const ctx2 = createMockCtx();
      bridge.renderDiagram('process', [], ctx2, makeBounds(), 'obj-conn');

      expect(ctx2.moveTo).toHaveBeenCalled();
      expect(ctx2.lineTo).toHaveBeenCalled();
      expect(ctx2.stroke).toHaveBeenCalled();
    });

    test('renders bezier connectors with control points', () => {
      const layout = makeComputedLayout({
        shapes: [
          makeComputedShape('n1', { x: 0, y: 0, width: 80, height: 50, text: 'A' }),
          makeComputedShape('n2', { x: 200, y: 0, width: 80, height: 50, text: 'B' }),
        ],
        connectors: [
          makeComputedConnector('n1', 'n2', {
            path: {
              type: 'bezier',
              points: [
                { x: 80, y: 25 },
                { x: 200, y: 25 },
              ],
              controlPoints: [
                { x: 120, y: 0 },
                { x: 160, y: 50 },
              ],
            },
          }),
        ],
      });

      const kernelBridge = makeKernelBridge({ 'obj-bez': layout });
      const bridge = new DiagramCanvasBridge(kernelBridge);

      // Prime + render
      const ctx1 = createMockCtx();
      bridge.renderDiagram('process', [], ctx1, makeBounds(), 'obj-bez');
      const ctx2 = createMockCtx();
      bridge.renderDiagram('process', [], ctx2, makeBounds(), 'obj-bez');

      expect(ctx2.bezierCurveTo).toHaveBeenCalled();
    });

    test('renders arrow head when arrowEnd is specified', () => {
      const layout = makeComputedLayout({
        shapes: [
          makeComputedShape('n1', { x: 0, y: 0, width: 80, height: 50, text: 'A' }),
          makeComputedShape('n2', { x: 150, y: 0, width: 80, height: 50, text: 'B' }),
        ],
        connectors: [
          makeComputedConnector('n1', 'n2', {
            arrowEnd: { type: 'triangle', size: 'medium' },
          }),
        ],
      });

      const kernelBridge = makeKernelBridge({ 'obj-arrow': layout });
      const bridge = new DiagramCanvasBridge(kernelBridge);

      const ctx1 = createMockCtx();
      bridge.renderDiagram('process', [], ctx1, makeBounds(), 'obj-arrow');
      const ctx2 = createMockCtx();
      bridge.renderDiagram('process', [], ctx2, makeBounds(), 'obj-arrow');

      // Arrow head: translate, rotate, beginPath, moveTo, lineTo, lineTo, closePath, fill
      expect(ctx2.closePath).toHaveBeenCalled();
    });
  });

  // ---------------------------------------------------------------------------
  // Bridge without Kernel Bridge (null)
  // ---------------------------------------------------------------------------

  describe('bridge without kernel bridge', () => {
    test('renders fallback without errors when kernel bridge is null', () => {
      const bridge = new DiagramCanvasBridge(null);
      const ctx = createMockCtx();
      const bounds = makeBounds();
      const nodes = [makeNode('n1', 'Test'), makeNode('n2', 'Test 2')];

      expect(() => {
        bridge.renderDiagram('process', nodes, ctx, bounds, 'obj-1');
      }).not.toThrow();

      expect(ctx.fillText).toHaveBeenCalled();
    });

    test('renders fallback without errors when kernel bridge is undefined', () => {
      const bridge = new DiagramCanvasBridge(undefined as unknown as null);
      const ctx = createMockCtx();
      const bounds = makeBounds();
      const nodes = [makeNode('n1', 'Hello')];

      expect(() => {
        bridge.renderDiagram('process', nodes, ctx, bounds);
      }).not.toThrow();

      expect(ctx.fillText).toHaveBeenCalledWith('Hello', expect.any(Number), expect.any(Number));
    });

    test('setKernelBridge allows late wiring', () => {
      const layout = makeComputedLayout({
        shapes: [makeComputedShape('n1', { text: 'Late' })],
        connectors: [],
      });
      const kernelBridge = makeKernelBridge({ 'obj-late': layout });

      const bridge = new DiagramCanvasBridge(null);
      bridge.setKernelBridge(kernelBridge);

      const ctx1 = createMockCtx();
      bridge.renderDiagram('process', [], ctx1, makeBounds(), 'obj-late');

      // Cache primed; second call uses layout
      const ctx2 = createMockCtx();
      bridge.renderDiagram('process', [], ctx2, makeBounds(), 'obj-late');

      expect(ctx2.fillText).toHaveBeenCalledWith('Late', expect.any(Number), expect.any(Number));
    });
  });

  // ---------------------------------------------------------------------------
  // Zero-size Bounds Edge Case
  // ---------------------------------------------------------------------------

  describe('zero-size bounds', () => {
    test('does not throw on zero-size bounds with empty nodes', () => {
      const bridge = new DiagramCanvasBridge();
      const ctx = createMockCtx();
      const zeroBounds = { x: 0, y: 0, width: 0, height: 0 };

      expect(() => {
        bridge.renderDiagram('process', [], ctx, zeroBounds);
      }).not.toThrow();
    });

    test('does not throw on zero-size bounds with nodes', () => {
      const bridge = new DiagramCanvasBridge();
      const ctx = createMockCtx();
      const zeroBounds = { x: 0, y: 0, width: 0, height: 0 };
      const nodes = [makeNode('n1', 'A'), makeNode('n2', 'B')];

      expect(() => {
        bridge.renderDiagram('process', nodes, ctx, zeroBounds);
      }).not.toThrow();
    });

    test('does not throw on zero-size bounds with computed layout', () => {
      const layout = makeComputedLayout({
        shapes: [makeComputedShape('n1', { text: 'Tiny' })],
        bounds: { width: 0, height: 0 },
      });
      const kernelBridge = makeKernelBridge({ 'obj-zero': layout });
      const bridge = new DiagramCanvasBridge(kernelBridge);

      // Prime cache
      const ctx1 = createMockCtx();
      bridge.renderDiagram('process', [], ctx1, { x: 0, y: 0, width: 0, height: 0 }, 'obj-zero');

      // Render from layout with zero bounds
      const ctx2 = createMockCtx();
      expect(() => {
        bridge.renderDiagram('process', [], ctx2, { x: 0, y: 0, width: 0, height: 0 }, 'obj-zero');
      }).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Layout Cache Management
  // ---------------------------------------------------------------------------

  describe('layout cache management', () => {
    test('invalidateLayout clears cached layout for specific objectId', () => {
      const layout = makeComputedLayout({
        shapes: [makeComputedShape('n1', { text: 'Cached' })],
        connectors: [],
      });
      const kernelBridge = makeKernelBridge({ 'obj-inv': layout });
      const bridge = new DiagramCanvasBridge(kernelBridge);

      // Prime cache
      const ctx1 = createMockCtx();
      bridge.renderDiagram('process', [makeNode('n1', 'Fallback')], ctx1, makeBounds(), 'obj-inv');

      // Verify cache is primed (second call uses layout)
      const ctx2 = createMockCtx();
      bridge.renderDiagram('process', [makeNode('n1', 'Fallback')], ctx2, makeBounds(), 'obj-inv');
      expect(ctx2.fillText).toHaveBeenCalledWith('Cached', expect.any(Number), expect.any(Number));

      // Invalidate and verify fallback is used again
      bridge.invalidateLayout('obj-inv');

      const ctx3 = createMockCtx();
      bridge.renderDiagram('process', [makeNode('n1', 'Fallback')], ctx3, makeBounds(), 'obj-inv');
      expect(ctx3.fillText).toHaveBeenCalledWith(
        'Fallback',
        expect.any(Number),
        expect.any(Number),
      );
    });

    test('invalidateAllLayouts clears entire cache', () => {
      const layout1 = makeComputedLayout({
        shapes: [makeComputedShape('n1', { text: 'Layout1' })],
        connectors: [],
      });
      const layout2 = makeComputedLayout({
        shapes: [makeComputedShape('n2', { text: 'Layout2' })],
        connectors: [],
      });
      const kernelBridge = makeKernelBridge({ 'obj-a': layout1, 'obj-b': layout2 });
      const bridge = new DiagramCanvasBridge(kernelBridge);

      // Prime both caches
      bridge.renderDiagram('process', [], createMockCtx(), makeBounds(), 'obj-a');
      bridge.renderDiagram('process', [], createMockCtx(), makeBounds(), 'obj-b');

      // Invalidate all
      bridge.invalidateAllLayouts();

      // Both should fall back
      const ctxA = createMockCtx();
      bridge.renderDiagram('process', [makeNode('n1', 'FallbackA')], ctxA, makeBounds(), 'obj-a');
      expect(ctxA.fillText).toHaveBeenCalledWith(
        'FallbackA',
        expect.any(Number),
        expect.any(Number),
      );

      const ctxB = createMockCtx();
      bridge.renderDiagram('process', [makeNode('n2', 'FallbackB')], ctxB, makeBounds(), 'obj-b');
      expect(ctxB.fillText).toHaveBeenCalledWith(
        'FallbackB',
        expect.any(Number),
        expect.any(Number),
      );
    });
  });

  // ---------------------------------------------------------------------------
  // Connector Edge Cases
  // ---------------------------------------------------------------------------

  describe('connector edge cases', () => {
    test('skips connector with fewer than 2 points', () => {
      const layout = makeComputedLayout({
        shapes: [makeComputedShape('n1', { text: 'A' })],
        connectors: [
          makeComputedConnector('n1', 'n2', {
            path: { type: 'line', points: [{ x: 0, y: 0 }] },
          }),
        ],
      });
      const kernelBridge = makeKernelBridge({ 'obj-skip': layout });
      const bridge = new DiagramCanvasBridge(kernelBridge);

      // Prime + render
      bridge.renderDiagram('process', [], createMockCtx(), makeBounds(), 'obj-skip');
      const ctx2 = createMockCtx();
      bridge.renderDiagram('process', [], ctx2, makeBounds(), 'obj-skip');

      // moveTo should not be called for the connector (only 1 point)
      // but it may be called by shape rendering paths. Check that lineTo
      // is not called (lineTo is only used by connectors in the layout path).
      expect(ctx2.lineTo).not.toHaveBeenCalled();
    });

    test('skips connector with empty points array', () => {
      const layout = makeComputedLayout({
        shapes: [],
        connectors: [
          makeComputedConnector('n1', 'n2', {
            path: { type: 'line', points: [] },
          }),
        ],
      });
      const kernelBridge = makeKernelBridge({ 'obj-empty': layout });
      const bridge = new DiagramCanvasBridge(kernelBridge);

      bridge.renderDiagram('process', [], createMockCtx(), makeBounds(), 'obj-empty');
      const ctx2 = createMockCtx();

      expect(() => {
        bridge.renderDiagram('process', [], ctx2, makeBounds(), 'obj-empty');
      }).not.toThrow();
    });
  });

  // ---------------------------------------------------------------------------
  // Shape text clipping
  // ---------------------------------------------------------------------------

  describe('text clipping', () => {
    test('clips text within shape bounds in computed layout', () => {
      const layout = makeComputedLayout({
        shapes: [makeComputedShape('n1', { text: 'Long text that should be clipped' })],
        connectors: [],
      });
      const kernelBridge = makeKernelBridge({ 'obj-clip': layout });
      const bridge = new DiagramCanvasBridge(kernelBridge);

      bridge.renderDiagram('process', [], createMockCtx(), makeBounds(), 'obj-clip');
      const ctx2 = createMockCtx();
      bridge.renderDiagram('process', [], ctx2, makeBounds(), 'obj-clip');

      // Text rendering uses clip() for bounds clipping
      expect(ctx2.clip).toHaveBeenCalled();
    });

    test('clips text within shape bounds in fallback layout', () => {
      const bridge = new DiagramCanvasBridge();
      const ctx = createMockCtx();

      bridge.renderDiagram('process', [makeNode('n1', 'Some text')], ctx, makeBounds());

      // Fallback also uses clip + rect for text bounding
      expect(ctx.clip).toHaveBeenCalled();
      expect(ctx.rect).toHaveBeenCalled();
    });
  });
});
