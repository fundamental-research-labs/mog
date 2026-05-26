/**
 * Tests for layoutToDrawingObjects() Output Converter
 *
 * NOTE: The layoutToDrawingObjects function is being created concurrently by
 * another agent at canvas/drawing/diagram/src/output/layout-to-drawing-objects.ts.
 * If it doesn't exist yet, these tests will fail to import -- that is expected.
 * The tests are written to the expected interface:
 *
 *   layoutToDrawingObjects(layout: ComputedLayout): DrawingObject[]
 *
 * It converts a ComputedLayout (Diagram shapes/connectors) into an array
 * of DrawingObject rendering primitives.
 */

import type { ComputedLayout, NodeId } from '@mog-sdk/contracts/diagram';
import { createTestComputedLayout, createTestComputedShape } from '../fixtures/mock-factories';

// Conditional import: the output module may not exist yet.
// We use a try/catch in a beforeAll to skip gracefully if needed.
let layoutToDrawingObjects: ((layout: ComputedLayout) => unknown[]) | null = null;
let importError: Error | null = null;

beforeAll(async () => {
  try {
    const outputModule = await import('../../src/output');
    layoutToDrawingObjects = outputModule.layoutToDrawingObjects;
  } catch (e) {
    importError = e as Error;
  }
});

/**
 * Helper that skips test if the module is not available yet.
 */
function requireModule(): (layout: ComputedLayout) => unknown[] {
  if (!layoutToDrawingObjects) {
    throw new Error(
      `layoutToDrawingObjects not available: ${importError?.message ?? 'module not found'}`,
    );
  }
  return layoutToDrawingObjects;
}

// =============================================================================
// Basic Output
// =============================================================================

describe('layoutToDrawingObjects - basic output', () => {
  it('should return correct number of DrawingObjects for shapes and connectors', () => {
    const fn = requireModule();
    const layout = createTestComputedLayout(3);

    // 3 shapes + 2 connectors = 5 DrawingObjects
    const result = fn(layout);
    expect(result).toHaveLength(5);
  });

  it('each shape DrawingObject should have geometry, fill, and stroke', () => {
    const fn = requireModule();
    const layout = createTestComputedLayout(2);

    // 2 shapes + 1 connector = 3 DrawingObjects
    // Output order: connectors first, then shapes
    const result = fn(layout) as Array<{
      geometry: unknown;
      fill: unknown;
      stroke: unknown;
    }>;

    // Last 2 should be shapes (connectors come first)
    const shapeObjects = result.slice(1);
    expect(shapeObjects).toHaveLength(2);
    shapeObjects.forEach((obj) => {
      expect(obj.geometry).toBeDefined();
      expect(obj.fill).toBeDefined();
      expect(obj.stroke).toBeDefined();
    });
  });

  it('connector DrawingObjects should have geometry and stroke, fill type none', () => {
    const fn = requireModule();
    const layout = createTestComputedLayout(3);

    // 3 shapes + 2 connectors = 5 DrawingObjects
    // Output order: [conn0, conn1, shape0, shape1, shape2]
    const result = fn(layout) as Array<{
      geometry: unknown;
      fill?: { type: string };
      stroke: unknown;
    }>;

    // First 2 should be connectors
    const connectorObjects = result.slice(0, 2);
    connectorObjects.forEach((obj) => {
      expect(obj.geometry).toBeDefined();
      expect(obj.stroke).toBeDefined();
      // Connectors have fill with type 'none'
      expect(obj.fill).toBeDefined();
      expect(obj.fill!.type).toBe('none');
    });
  });
});

// =============================================================================
// Position Mapping
// =============================================================================

describe('layoutToDrawingObjects - position mapping', () => {
  it('should map shape position to DrawingObject transform', () => {
    const fn = requireModule();
    const layout: ComputedLayout = {
      shapes: [
        createTestComputedShape({
          nodeId: 'n1' as NodeId,
          x: 100,
          y: 200,
          width: 80,
          height: 60,
          rotation: 0,
        }),
      ],
      connectors: [],
      bounds: { width: 180, height: 260 },
      version: 1,
    };

    const result = fn(layout) as Array<{
      transform?: { tx: number; ty: number };
    }>;
    expect(result).toHaveLength(1);

    const obj = result[0];
    expect(obj.transform).toBeDefined();
    expect(obj.transform!.tx).toBe(100);
    expect(obj.transform!.ty).toBe(200);
  });

  it('should encode rotation in transform via affine matrix', () => {
    const fn = requireModule();
    const layout: ComputedLayout = {
      shapes: [
        createTestComputedShape({
          nodeId: 'n1' as NodeId,
          x: 0,
          y: 0,
          width: 100,
          height: 60,
          rotation: 45,
        }),
      ],
      connectors: [],
      bounds: { width: 100, height: 60 },
      version: 1,
    };

    const result = fn(layout) as Array<{
      transform?: { a: number; b: number; c: number; d: number; tx: number; ty: number };
    }>;
    expect(result).toHaveLength(1);

    const obj = result[0];
    expect(obj.transform).toBeDefined();

    // For a 45-degree rotation, the affine matrix entries a and d should
    // equal cos(45deg) = ~0.707, and b should equal sin(45deg) = ~0.707
    const cos45 = Math.cos((45 * Math.PI) / 180);
    const sin45 = Math.sin((45 * Math.PI) / 180);
    expect(obj.transform!.a).toBeCloseTo(cos45, 5);
    expect(obj.transform!.b).toBeCloseTo(sin45, 5);
    expect(obj.transform!.c).toBeCloseTo(-sin45, 5);
    expect(obj.transform!.d).toBeCloseTo(cos45, 5);
  });
});

// =============================================================================
// Fill Mapping
// =============================================================================

describe('layoutToDrawingObjects - fill mapping', () => {
  it('should map shape fill color to solid fill DrawingObject', () => {
    const fn = requireModule();
    const layout: ComputedLayout = {
      shapes: [
        createTestComputedShape({
          nodeId: 'n1' as NodeId,
          fill: '#FF0000',
        }),
      ],
      connectors: [],
      bounds: { width: 100, height: 60 },
      version: 1,
    };

    const result = fn(layout) as Array<{
      fill?: { type: string; color: string };
    }>;
    expect(result).toHaveLength(1);

    const obj = result[0];
    expect(obj.fill).toBeDefined();
    expect(obj.fill!.type).toBe('solid');
    expect(obj.fill!.color).toBe('#FF0000');
  });
});

// =============================================================================
// Stroke Mapping
// =============================================================================

describe('layoutToDrawingObjects - stroke mapping', () => {
  it('should map shape stroke to DrawingObject stroke', () => {
    const fn = requireModule();
    const layout: ComputedLayout = {
      shapes: [
        createTestComputedShape({
          nodeId: 'n1' as NodeId,
          stroke: '#333333',
          strokeWidth: 2,
        }),
      ],
      connectors: [],
      bounds: { width: 100, height: 60 },
      version: 1,
    };

    const result = fn(layout) as Array<{
      stroke?: { color: string; width: number };
    }>;
    expect(result).toHaveLength(1);

    const obj = result[0];
    expect(obj.stroke).toBeDefined();
    expect(obj.stroke!.color).toBe('#333333');
    expect(obj.stroke!.width).toBe(2);
  });
});

// =============================================================================
// Effects Mapping
// =============================================================================

describe('layoutToDrawingObjects - effects mapping', () => {
  it('should map shadow effect to DrawingEffects.outerShadow', () => {
    const fn = requireModule();
    const layout: ComputedLayout = {
      shapes: [
        createTestComputedShape({
          nodeId: 'n1' as NodeId,
          effects: {
            shadow: {
              color: 'rgb(0,0,0)',
              blur: 8,
              offsetX: 3,
              offsetY: 3,
              opacity: 0.4,
            },
          },
        }),
      ],
      connectors: [],
      bounds: { width: 100, height: 60 },
      version: 1,
    };

    const result = fn(layout) as Array<{
      effects?: {
        outerShadow?: Array<{
          blur: number;
          offsetX: number;
          offsetY: number;
        }>;
      };
    }>;

    expect(result).toHaveLength(1);
    const obj = result[0];
    expect(obj.effects).toBeDefined();
    expect(obj.effects!.outerShadow).toBeDefined();
    expect(obj.effects!.outerShadow!.length).toBeGreaterThan(0);
  });

  it('should map glow effect to DrawingEffects.glow', () => {
    const fn = requireModule();
    const layout: ComputedLayout = {
      shapes: [
        createTestComputedShape({
          nodeId: 'n1' as NodeId,
          effects: {
            glow: {
              color: 'rgb(255,255,255)',
              radius: 4,
              opacity: 0.3,
            },
          },
        }),
      ],
      connectors: [],
      bounds: { width: 100, height: 60 },
      version: 1,
    };

    const result = fn(layout) as Array<{
      effects?: {
        glow?: { radius: number };
      };
    }>;

    expect(result).toHaveLength(1);
    const obj = result[0];
    expect(obj.effects).toBeDefined();
    expect(obj.effects!.glow).toBeDefined();
  });
});

// =============================================================================
// Text Mapping
// =============================================================================

describe('layoutToDrawingObjects - text mapping', () => {
  it('should map shape text to DrawingObject text body', () => {
    const fn = requireModule();
    const layout: ComputedLayout = {
      shapes: [
        createTestComputedShape({
          nodeId: 'n1' as NodeId,
          text: 'Hello',
        }),
      ],
      connectors: [],
      bounds: { width: 100, height: 60 },
      version: 1,
    };

    const result = fn(layout) as Array<{
      text?: {
        paragraphs: Array<{
          runs: Array<{ text: string }>;
        }>;
      };
    }>;

    expect(result).toHaveLength(1);
    const obj = result[0];
    expect(obj.text).toBeDefined();
    expect(obj.text!.paragraphs).toBeDefined();
    expect(obj.text!.paragraphs.length).toBeGreaterThan(0);
    expect(obj.text!.paragraphs[0].runs.length).toBeGreaterThan(0);
    expect(obj.text!.paragraphs[0].runs[0].text).toBe('Hello');
  });

  it('should handle empty text', () => {
    const fn = requireModule();
    const layout: ComputedLayout = {
      shapes: [
        createTestComputedShape({
          nodeId: 'n1' as NodeId,
          text: '',
        }),
      ],
      connectors: [],
      bounds: { width: 100, height: 60 },
      version: 1,
    };

    const result = fn(layout);
    expect(result).toHaveLength(1);

    // Should still produce a valid DrawingObject even with empty text
    const obj = result[0] as { text?: { paragraphs: unknown[] } };
    // Text may be omitted or have empty paragraphs -- both are valid
    if (obj.text) {
      expect(Array.isArray(obj.text.paragraphs)).toBe(true);
    }
  });
});

// =============================================================================
// Empty Layout
// =============================================================================

describe('layoutToDrawingObjects - empty layout', () => {
  it('should return empty array for empty shapes and connectors', () => {
    const fn = requireModule();
    const layout: ComputedLayout = {
      shapes: [],
      connectors: [],
      bounds: { width: 0, height: 0 },
      version: 1,
    };

    const result = fn(layout);
    expect(result).toEqual([]);
  });
});

// =============================================================================
// Connector Path Types
// =============================================================================

describe('layoutToDrawingObjects - connector path types', () => {
  it('should handle line-type connector paths', () => {
    const fn = requireModule();
    const layout: ComputedLayout = {
      shapes: [
        createTestComputedShape({ nodeId: 'a' as NodeId, x: 0, y: 0 }),
        createTestComputedShape({ nodeId: 'b' as NodeId, x: 200, y: 0 }),
      ],
      connectors: [
        {
          fromNodeId: 'a' as NodeId,
          toNodeId: 'b' as NodeId,
          connectorType: 'straight',
          path: {
            type: 'line',
            points: [
              { x: 100, y: 30 },
              { x: 200, y: 30 },
            ],
          },
          stroke: '#666',
          strokeWidth: 1,
        },
      ],
      bounds: { width: 300, height: 60 },
      version: 1,
    };

    const result = fn(layout);
    // 2 shapes + 1 connector
    expect(result).toHaveLength(3);
  });

  it('should handle bezier-type connector paths', () => {
    const fn = requireModule();
    const layout: ComputedLayout = {
      shapes: [
        createTestComputedShape({ nodeId: 'a' as NodeId, x: 0, y: 0 }),
        createTestComputedShape({ nodeId: 'b' as NodeId, x: 200, y: 0 }),
      ],
      connectors: [
        {
          fromNodeId: 'a' as NodeId,
          toNodeId: 'b' as NodeId,
          connectorType: 'curved',
          path: {
            type: 'bezier',
            points: [
              { x: 100, y: 30 },
              { x: 200, y: 30 },
            ],
            controlPoints: [
              { x: 130, y: -10 },
              { x: 170, y: 70 },
            ],
          },
          stroke: '#666',
          strokeWidth: 1,
        },
      ],
      bounds: { width: 300, height: 60 },
      version: 1,
    };

    const result = fn(layout);
    expect(result).toHaveLength(3);

    // Connector is first in the output (connectors come before shapes)
    const connectorObj = result[0] as { geometry: unknown };
    expect(connectorObj.geometry).toBeDefined();
  });

  it('should handle polyline-type connector paths', () => {
    const fn = requireModule();
    const layout: ComputedLayout = {
      shapes: [
        createTestComputedShape({ nodeId: 'a' as NodeId, x: 0, y: 0 }),
        createTestComputedShape({ nodeId: 'b' as NodeId, x: 200, y: 100 }),
      ],
      connectors: [
        {
          fromNodeId: 'a' as NodeId,
          toNodeId: 'b' as NodeId,
          connectorType: 'elbow',
          path: {
            type: 'polyline',
            points: [
              { x: 100, y: 30 },
              { x: 150, y: 30 },
              { x: 150, y: 130 },
              { x: 200, y: 130 },
            ],
          },
          stroke: '#666',
          strokeWidth: 1,
        },
      ],
      bounds: { width: 300, height: 160 },
      version: 1,
    };

    const result = fn(layout);
    expect(result).toHaveLength(3);

    // Connector is first in the output
    const connectorObj = result[0] as { geometry: unknown };
    expect(connectorObj.geometry).toBeDefined();
  });
});
