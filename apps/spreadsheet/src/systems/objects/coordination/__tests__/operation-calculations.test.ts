/**
 * Operation Calculation Tests
 *
 * Tests for pure calculation functions that derive object state from operations.
 * These functions handle drag, resize, and rotate operations.
 *
 */

import {
  calculateDragState,
  calculateFinalStates,
  calculateResizeState,
  calculateRotateState,
  calculateStateFromOperation,
  type FloatingObjectOperation,
  type ObjectState,
} from '../operation-calculations';

// =============================================================================
// TEST HELPERS
// =============================================================================

/**
 * Create a test object state with default values.
 */
function createObjectState(overrides: Partial<ObjectState['bounds']> = {}): ObjectState {
  return {
    bounds: {
      x: 100,
      y: 100,
      width: 200,
      height: 100,
      rotation: 0,
      ...overrides,
    },
    rotation: 0,
  };
}

/**
 * Create a drag operation for testing.
 */
function createDragOperation(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  objectIds: string[] = ['obj1'],
  originalStates?: Map<string, ObjectState>,
): FloatingObjectOperation {
  const states = originalStates ?? new Map(objectIds.map((id) => [id, createObjectState()]));

  return {
    type: 'drag',
    objectIds,
    startPosition: { x: startX, y: startY },
    currentPosition: { x: currentX, y: currentY },
    originalStates: states,
  };
}

/**
 * Create a resize operation for testing.
 */
function createResizeOperation(
  handle: 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'nw',
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  originalState?: ObjectState,
): FloatingObjectOperation {
  const state = originalState ?? createObjectState();
  return {
    type: 'resize',
    objectIds: ['obj1'],
    startPosition: { x: startX, y: startY },
    currentPosition: { x: currentX, y: currentY },
    originalStates: new Map([['obj1', state]]),
    resizeHandle: handle,
  };
}

/**
 * Create a rotate operation for testing.
 */
function createRotateOperation(
  startX: number,
  startY: number,
  currentX: number,
  currentY: number,
  rotationCenterX: number,
  rotationCenterY: number,
  originalState?: ObjectState,
): FloatingObjectOperation {
  const state = originalState ?? createObjectState();
  return {
    type: 'rotate',
    objectIds: ['obj1'],
    startPosition: { x: startX, y: startY },
    currentPosition: { x: currentX, y: currentY },
    originalStates: new Map([['obj1', state]]),
    rotationCenter: { x: rotationCenterX, y: rotationCenterY },
  };
}

// =============================================================================
// DRAG STATE CALCULATION TESTS
// =============================================================================

describe('calculateDragState', () => {
  it('moves object by positive delta', () => {
    const operation = createDragOperation(0, 0, 50, 30);
    const original = createObjectState();

    const result = calculateDragState(operation, original);

    expect(result.bounds.x).toBe(150); // 100 + 50
    expect(result.bounds.y).toBe(130); // 100 + 30
    expect(result.bounds.width).toBe(200); // unchanged
    expect(result.bounds.height).toBe(100); // unchanged
    expect(result.rotation).toBe(0); // unchanged
  });

  it('moves object by negative delta', () => {
    const operation = createDragOperation(100, 100, 50, 70);
    const original = createObjectState();

    const result = calculateDragState(operation, original);

    expect(result.bounds.x).toBe(50); // 100 + (-50)
    expect(result.bounds.y).toBe(70); // 100 + (-30)
  });

  it('handles zero delta (no movement)', () => {
    const operation = createDragOperation(100, 100, 100, 100);
    const original = createObjectState();

    const result = calculateDragState(operation, original);

    expect(result.bounds.x).toBe(100); // unchanged
    expect(result.bounds.y).toBe(100); // unchanged
  });

  it('preserves existing rotation', () => {
    const operation = createDragOperation(0, 0, 50, 50);
    const original = createObjectState();
    original.rotation = 45;

    const result = calculateDragState(operation, original);

    expect(result.rotation).toBe(45); // preserved
  });

  it('allows negative coordinates', () => {
    const operation = createDragOperation(50, 50, 0, 0);
    const original = createObjectState({ x: 20, y: 20 });

    const result = calculateDragState(operation, original);

    expect(result.bounds.x).toBe(-30); // 20 + (-50)
    expect(result.bounds.y).toBe(-30); // 20 + (-50)
  });
});

// =============================================================================
// RESIZE STATE CALCULATION TESTS - ALL 8 HANDLES
// =============================================================================

describe('calculateResizeState', () => {
  describe('east (e) handle - right edge', () => {
    it('increases width when dragged right', () => {
      const operation = createResizeOperation('e', 300, 150, 350, 150);
      const original = createObjectState();

      const result = calculateResizeState(operation, original);

      expect(result.bounds.x).toBe(100); // unchanged
      expect(result.bounds.y).toBe(100); // unchanged
      expect(result.bounds.width).toBe(250); // 200 + 50
      expect(result.bounds.height).toBe(100); // unchanged
    });

    it('decreases width when dragged left', () => {
      const operation = createResizeOperation('e', 300, 150, 250, 150);
      const original = createObjectState();

      const result = calculateResizeState(operation, original);

      expect(result.bounds.width).toBe(150); // 200 - 50
    });
  });

  describe('west (w) handle - left edge', () => {
    it('increases width and moves left when dragged left', () => {
      const operation = createResizeOperation('w', 100, 150, 50, 150);
      const original = createObjectState();

      const result = calculateResizeState(operation, original);

      expect(result.bounds.x).toBe(50); // moved left by 50
      expect(result.bounds.width).toBe(250); // 200 + 50
    });

    it('decreases width and moves right when dragged right', () => {
      const operation = createResizeOperation('w', 100, 150, 150, 150);
      const original = createObjectState();

      const result = calculateResizeState(operation, original);

      expect(result.bounds.x).toBe(150); // moved right by 50
      expect(result.bounds.width).toBe(150); // 200 - 50
    });
  });

  describe('south (s) handle - bottom edge', () => {
    it('increases height when dragged down', () => {
      const operation = createResizeOperation('s', 200, 200, 200, 250);
      const original = createObjectState();

      const result = calculateResizeState(operation, original);

      expect(result.bounds.height).toBe(150); // 100 + 50
      expect(result.bounds.y).toBe(100); // unchanged
    });
  });

  describe('north (n) handle - top edge', () => {
    it('increases height and moves up when dragged up', () => {
      const operation = createResizeOperation('n', 200, 100, 200, 50);
      const original = createObjectState();

      const result = calculateResizeState(operation, original);

      expect(result.bounds.y).toBe(50); // moved up by 50
      expect(result.bounds.height).toBe(150); // 100 + 50
    });
  });

  describe('southeast (se) handle - corner', () => {
    it('increases both dimensions when dragged down-right', () => {
      const operation = createResizeOperation('se', 300, 200, 350, 250);
      const original = createObjectState();

      const result = calculateResizeState(operation, original);

      expect(result.bounds.width).toBe(250); // 200 + 50
      expect(result.bounds.height).toBe(150); // 100 + 50
      expect(result.bounds.x).toBe(100); // unchanged
      expect(result.bounds.y).toBe(100); // unchanged
    });
  });

  describe('northwest (nw) handle - corner', () => {
    it('changes position and size when dragged', () => {
      const operation = createResizeOperation('nw', 100, 100, 50, 50);
      const original = createObjectState();

      const result = calculateResizeState(operation, original);

      expect(result.bounds.x).toBe(50); // moved left by 50
      expect(result.bounds.y).toBe(50); // moved up by 50
      expect(result.bounds.width).toBe(250); // 200 + 50
      expect(result.bounds.height).toBe(150); // 100 + 50
    });
  });

  describe('northeast (ne) handle - corner', () => {
    it('changes y position and both dimensions', () => {
      const operation = createResizeOperation('ne', 300, 100, 350, 50);
      const original = createObjectState();

      const result = calculateResizeState(operation, original);

      expect(result.bounds.x).toBe(100); // unchanged
      expect(result.bounds.y).toBe(50); // moved up by 50
      expect(result.bounds.width).toBe(250); // 200 + 50
      expect(result.bounds.height).toBe(150); // 100 + 50
    });
  });

  describe('southwest (sw) handle - corner', () => {
    it('changes x position and both dimensions', () => {
      const operation = createResizeOperation('sw', 100, 200, 50, 250);
      const original = createObjectState();

      const result = calculateResizeState(operation, original);

      expect(result.bounds.x).toBe(50); // moved left by 50
      expect(result.bounds.y).toBe(100); // unchanged
      expect(result.bounds.width).toBe(250); // 200 + 50
      expect(result.bounds.height).toBe(150); // 100 + 50
    });
  });
});

// =============================================================================
// RESIZE CONSTRAINT TESTS
// =============================================================================

describe('calculateResizeState - Object Type Constraints', () => {
  describe('image constraint (aspect ratio preservation)', () => {
    it('preserves aspect ratio on corner resize (se)', () => {
      // 200x100 = 2:1 aspect ratio
      const operation = createResizeOperation('se', 300, 200, 400, 200);
      const original = createObjectState();

      const result = calculateResizeState(operation, original, 'image');

      // Width changed by 100, so height should also scale to maintain 2:1
      expect(result.bounds.width).toBe(300); // 200 + 100
      expect(result.bounds.height).toBe(150); // 300 / 2 (aspect ratio)
    });

    it('preserves aspect ratio on corner resize (nw)', () => {
      const operation = createResizeOperation('nw', 100, 100, 0, 100);
      const original = createObjectState();

      const result = calculateResizeState(operation, original, 'image');

      // Width increased by 100 (moved left), aspect ratio 2:1
      expect(result.bounds.width).toBe(300);
      expect(result.bounds.height).toBe(150);
    });

    it('preserves aspect ratio on edge resize (e)', () => {
      const operation = createResizeOperation('e', 300, 150, 400, 150);
      const original = createObjectState();

      const result = calculateResizeState(operation, original, 'image');

      expect(result.bounds.width).toBe(300); // 200 + 100
      expect(result.bounds.height).toBe(150); // 300 / 2
    });

    it('preserves aspect ratio on edge resize (n)', () => {
      const operation = createResizeOperation('n', 200, 100, 200, 50);
      const original = createObjectState();

      const result = calculateResizeState(operation, original, 'image');

      // Height increased by 50
      expect(result.bounds.height).toBe(150); // 100 + 50
      expect(result.bounds.width).toBe(300); // 150 * 2
    });
  });

  describe('chart constraint (minimum size)', () => {
    it('enforces minimum width', () => {
      // Try to resize to 50px wide (below 100px minimum)
      const operation = createResizeOperation('e', 300, 150, 150, 150);
      const original = createObjectState();

      const result = calculateResizeState(operation, original, 'chart');

      expect(result.bounds.width).toBe(100); // Clamped to minimum
    });

    it('enforces minimum height', () => {
      // Try to resize to 50px tall (below 80px minimum)
      const operation = createResizeOperation('s', 200, 200, 200, 150);
      const original = createObjectState();

      const result = calculateResizeState(operation, original, 'chart');

      expect(result.bounds.height).toBe(80); // Clamped to minimum
    });

    it('allows larger sizes', () => {
      const operation = createResizeOperation('se', 300, 200, 500, 400);
      const original = createObjectState();

      const result = calculateResizeState(operation, original, 'chart');

      expect(result.bounds.width).toBe(400); // 200 + 200
      expect(result.bounds.height).toBe(300); // 100 + 200
    });
  });

  describe('shape constraint (free resize)', () => {
    it('allows free resize without constraints', () => {
      const operation = createResizeOperation('se', 300, 200, 400, 300);
      const original = createObjectState();

      const result = calculateResizeState(operation, original, 'shape');

      expect(result.bounds.width).toBe(300); // 200 + 100
      expect(result.bounds.height).toBe(200); // 100 + 100
    });

    it('allows non-proportional resize', () => {
      const operation = createResizeOperation('e', 300, 150, 500, 150);
      const original = createObjectState();

      const result = calculateResizeState(operation, original, 'shape');

      expect(result.bounds.width).toBe(400); // 200 + 200
      expect(result.bounds.height).toBe(100); // unchanged
    });
  });

  describe('minimum bounds for all types', () => {
    it('enforces minimum dimension of 1 for shapes', () => {
      // Try to make width 0 or negative
      const operation = createResizeOperation('e', 300, 150, 50, 150);
      const original = createObjectState();

      const result = calculateResizeState(operation, original, 'shape');

      expect(result.bounds.width).toBeGreaterThanOrEqual(1);
    });

    it('enforces minimum dimension of 1 for images', () => {
      // Create a very small resize
      const original = createObjectState({ width: 10, height: 10 });
      const operation = createResizeOperation('se', 110, 110, 100, 100);
      operation.originalStates.set('obj1', original);

      const result = calculateResizeState(operation, original, 'image');

      expect(result.bounds.width).toBeGreaterThanOrEqual(1);
      expect(result.bounds.height).toBeGreaterThanOrEqual(1);
    });
  });
});

// =============================================================================
// ROTATE STATE CALCULATION TESTS
// =============================================================================

describe('calculateRotateState', () => {
  it('calculates rotation for 90 degree clockwise rotation', () => {
    // Rotation center at (200, 150) - center of 200x100 object at (100, 100)
    // Start at 3 o'clock position (right of center)
    // End at 6 o'clock position (below center)
    const operation = createRotateOperation(300, 150, 200, 250, 200, 150);
    const original = createObjectState();

    const result = calculateRotateState(operation, original);

    // Should rotate 90 degrees clockwise
    expect(result.rotation).toBeCloseTo(90, 0);
    expect(result.bounds).toEqual(original.bounds); // bounds unchanged
  });

  it('calculates rotation for 90 degree counter-clockwise rotation', () => {
    // Start at 3 o'clock, end at 12 o'clock
    const operation = createRotateOperation(300, 150, 200, 50, 200, 150);
    const original = createObjectState();

    const result = calculateRotateState(operation, original);

    // Should rotate -90 degrees (counter-clockwise)
    expect(result.rotation).toBeCloseTo(-90, 0);
  });

  it('calculates rotation for 180 degree rotation', () => {
    // Start at 3 o'clock, end at 9 o'clock
    const operation = createRotateOperation(300, 150, 100, 150, 200, 150);
    const original = createObjectState();

    const result = calculateRotateState(operation, original);

    // Should rotate 180 degrees
    expect(Math.abs(result.rotation)).toBeCloseTo(180, 0);
  });

  it('handles zero rotation (no movement)', () => {
    const operation = createRotateOperation(300, 150, 300, 150, 200, 150);
    const original = createObjectState();

    const result = calculateRotateState(operation, original);

    expect(result.rotation).toBeCloseTo(0, 5);
  });

  it('adds to existing rotation', () => {
    const operation = createRotateOperation(300, 150, 200, 250, 200, 150);
    const original = createObjectState();
    original.rotation = 45;

    const result = calculateRotateState(operation, original);

    // 45 + 90 = 135 degrees
    expect(result.rotation).toBeCloseTo(135, 0);
  });

  it('handles small angle changes', () => {
    // Move just a small amount (approximately 5 degrees)
    const centerX = 200;
    const centerY = 150;
    const radius = 100;
    const startAngle = 0;
    const endAngle = (5 * Math.PI) / 180; // 5 degrees

    const startX = centerX + radius * Math.cos(startAngle);
    const startY = centerY + radius * Math.sin(startAngle);
    const endX = centerX + radius * Math.cos(endAngle);
    const endY = centerY + radius * Math.sin(endAngle);

    const operation = createRotateOperation(startX, startY, endX, endY, centerX, centerY);
    const original = createObjectState();

    const result = calculateRotateState(operation, original);

    expect(result.rotation).toBeCloseTo(5, 0);
  });
});

// =============================================================================
// MAIN DISPATCH FUNCTION TESTS
// =============================================================================

describe('calculateStateFromOperation', () => {
  it('dispatches to drag calculation for drag operations', () => {
    const operation = createDragOperation(0, 0, 50, 50);

    const result = calculateStateFromOperation(operation, 'obj1');

    expect(result.bounds.x).toBe(150); // 100 + 50
    expect(result.bounds.y).toBe(150); // 100 + 50
  });

  it('dispatches to resize calculation for resize operations', () => {
    const operation = createResizeOperation('se', 300, 200, 350, 250);

    const result = calculateStateFromOperation(operation, 'obj1');

    expect(result.bounds.width).toBe(250);
    expect(result.bounds.height).toBe(150);
  });

  it('dispatches to rotate calculation for rotate operations', () => {
    const operation = createRotateOperation(300, 150, 200, 250, 200, 150);

    const result = calculateStateFromOperation(operation, 'obj1');

    expect(result.rotation).toBeCloseTo(90, 0);
  });

  it('throws error for unknown object ID', () => {
    const operation = createDragOperation(0, 0, 50, 50);

    expect(() => calculateStateFromOperation(operation, 'unknown')).toThrow(
      'No original state for object unknown',
    );
  });

  it('applies object type constraints for resize', () => {
    const operation = createResizeOperation('e', 300, 150, 400, 150);

    const imageResult = calculateStateFromOperation(operation, 'obj1', 'image');
    const shapeResult = calculateStateFromOperation(operation, 'obj1', 'shape');

    // Image should have aspect ratio preserved
    expect(imageResult.bounds.height).toBe(150); // 300 / 2
    // Shape should have original height
    expect(shapeResult.bounds.height).toBe(100); // unchanged
  });
});

// =============================================================================
// CALCULATE FINAL STATES TESTS
// =============================================================================

describe('calculateFinalStates', () => {
  it('calculates states for multiple objects in drag operation', async () => {
    const states = new Map<string, ObjectState>([
      ['obj1', createObjectState({ x: 100, y: 100 })],
      ['obj2', createObjectState({ x: 200, y: 200 })],
      ['obj3', createObjectState({ x: 300, y: 300 })],
    ]);

    const operation: FloatingObjectOperation = {
      type: 'drag',
      objectIds: ['obj1', 'obj2', 'obj3'],
      startPosition: { x: 0, y: 0 },
      currentPosition: { x: 50, y: 50 },
      originalStates: states,
    };

    const results = await calculateFinalStates(operation);

    expect(results.size).toBe(3);
    expect(results.get('obj1')?.bounds.x).toBe(150);
    expect(results.get('obj2')?.bounds.x).toBe(250);
    expect(results.get('obj3')?.bounds.x).toBe(350);
  });

  it('applies object type constraints when getObjectType is provided', async () => {
    const states = new Map<string, ObjectState>([
      ['image1', createObjectState()],
      ['chart1', createObjectState()],
    ]);

    const operation: FloatingObjectOperation = {
      type: 'resize',
      objectIds: ['image1', 'chart1'],
      startPosition: { x: 300, y: 150 },
      currentPosition: { x: 350, y: 150 }, // Only horizontal resize
      originalStates: states,
      resizeHandle: 'e',
    };

    const getObjectType = (id: string) => {
      if (id === 'image1') return 'image' as const;
      if (id === 'chart1') return 'chart' as const;
      return undefined;
    };

    const results = await calculateFinalStates(operation, getObjectType);

    // Image should have aspect ratio preserved (width 250, height adjusted)
    expect(results.get('image1')?.bounds.width).toBe(250);
    expect(results.get('image1')?.bounds.height).toBe(125); // 250 / 2

    // Chart should have free resize
    expect(results.get('chart1')?.bounds.width).toBe(250);
    expect(results.get('chart1')?.bounds.height).toBe(100); // unchanged
  });

  it('handles empty object list', async () => {
    const operation: FloatingObjectOperation = {
      type: 'drag',
      objectIds: [],
      startPosition: { x: 0, y: 0 },
      currentPosition: { x: 50, y: 50 },
      originalStates: new Map(),
    };

    const results = await calculateFinalStates(operation);

    expect(results.size).toBe(0);
  });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe('Edge Cases', () => {
  describe('zero delta operations', () => {
    it('handles zero delta drag', () => {
      const operation = createDragOperation(100, 100, 100, 100);
      const original = createObjectState();

      const result = calculateDragState(operation, original);

      expect(result.bounds.x).toBe(original.bounds.x);
      expect(result.bounds.y).toBe(original.bounds.y);
    });

    it('handles zero delta resize', () => {
      const operation = createResizeOperation('se', 300, 200, 300, 200);
      const original = createObjectState();

      const result = calculateResizeState(operation, original);

      expect(result.bounds.width).toBe(original.bounds.width);
      expect(result.bounds.height).toBe(original.bounds.height);
    });

    it('handles zero delta rotate', () => {
      const operation = createRotateOperation(300, 150, 300, 150, 200, 150);
      const original = createObjectState();

      const result = calculateRotateState(operation, original);

      expect(result.rotation).toBeCloseTo(0, 5);
    });
  });

  describe('extreme values', () => {
    it('handles very large drag deltas', () => {
      const operation = createDragOperation(0, 0, 10000, 10000);
      const original = createObjectState();

      const result = calculateDragState(operation, original);

      expect(result.bounds.x).toBe(10100);
      expect(result.bounds.y).toBe(10100);
    });

    it('handles very small resize that would go below minimum', () => {
      const operation = createResizeOperation('se', 300, 200, 100, 100);
      const original = createObjectState();

      const result = calculateResizeState(operation, original, 'shape');

      expect(result.bounds.width).toBeGreaterThanOrEqual(1);
      expect(result.bounds.height).toBeGreaterThanOrEqual(1);
    });

    it('handles full 360 degree rotation', () => {
      // Rotate full circle
      const centerX = 200;
      const centerY = 150;
      const startX = 300; // right of center
      const startY = 150;

      // End at same position after theoretical 360 rotation
      // (same position means 0 delta angle, but test the math works)
      const operation = createRotateOperation(startX, startY, startX, startY, centerX, centerY);
      const original = createObjectState();
      original.rotation = 360;

      const result = calculateRotateState(operation, original);

      expect(result.rotation).toBeCloseTo(360, 0); // No change
    });
  });

  describe('aspect ratio edge cases', () => {
    it('handles square aspect ratio (1:1)', () => {
      const original = createObjectState({ width: 100, height: 100 });
      const operation = createResizeOperation('se', 200, 200, 250, 200);
      operation.originalStates.set('obj1', original);

      const result = calculateResizeState(operation, original, 'image');

      expect(result.bounds.width).toBe(result.bounds.height); // 1:1 preserved
    });

    it('handles very wide aspect ratio', () => {
      const original = createObjectState({ width: 400, height: 50 }); // 8:1
      const operation = createResizeOperation('e', 500, 125, 600, 125);
      operation.originalStates.set('obj1', original);

      const result = calculateResizeState(operation, original, 'image');

      const newAspectRatio = result.bounds.width / result.bounds.height;
      expect(newAspectRatio).toBeCloseTo(8, 1);
    });

    it('handles very tall aspect ratio', () => {
      const original = createObjectState({ width: 50, height: 400 }); // 1:8
      const operation = createResizeOperation('s', 125, 500, 125, 600);
      operation.originalStates.set('obj1', original);

      const result = calculateResizeState(operation, original, 'image');

      const newAspectRatio = result.bounds.width / result.bounds.height;
      expect(newAspectRatio).toBeCloseTo(0.125, 2);
    });
  });
});
