import { testPointInPath, testPointInStroke } from '../src/canvas-hit-test';

// =============================================================================
// Mock Canvas Context
// =============================================================================

function createMockCtx(hitResult: boolean) {
  const calls: string[] = [];
  const ctx = {
    save: jest.fn(() => calls.push('save')),
    resetTransform: jest.fn(() => calls.push('resetTransform')),
    restore: jest.fn(() => calls.push('restore')),
    isPointInPath: jest.fn(() => {
      calls.push('isPointInPath');
      return hitResult;
    }),
    isPointInStroke: jest.fn(() => {
      calls.push('isPointInStroke');
      return hitResult;
    }),
    _calls: calls,
  };
  return ctx as unknown as CanvasRenderingContext2D & { _calls: string[] };
}

const mockPath = {} as Path2D;

// =============================================================================
// testPointInPath
// =============================================================================

describe('testPointInPath', () => {
  test('calls save, resetTransform, isPointInPath, restore in order', () => {
    const ctx = createMockCtx(true);
    testPointInPath(ctx, mockPath, 10, 20);
    expect(ctx._calls).toEqual(['save', 'resetTransform', 'isPointInPath', 'restore']);
  });

  test('returns true when isPointInPath returns true', () => {
    const ctx = createMockCtx(true);
    expect(testPointInPath(ctx, mockPath, 10, 20)).toBe(true);
  });

  test('returns false when isPointInPath returns false', () => {
    const ctx = createMockCtx(false);
    expect(testPointInPath(ctx, mockPath, 10, 20)).toBe(false);
  });

  test('passes correct arguments to isPointInPath', () => {
    const ctx = createMockCtx(false);
    testPointInPath(ctx, mockPath, 42, 99);
    expect(ctx.isPointInPath).toHaveBeenCalledWith(mockPath, 42, 99);
  });
});

// =============================================================================
// testPointInStroke
// =============================================================================

describe('testPointInStroke', () => {
  test('calls save, resetTransform, isPointInStroke, restore in order', () => {
    const ctx = createMockCtx(true);
    testPointInStroke(ctx, mockPath, 10, 20);
    expect(ctx._calls).toEqual(['save', 'resetTransform', 'isPointInStroke', 'restore']);
  });

  test('returns true when isPointInStroke returns true', () => {
    const ctx = createMockCtx(true);
    expect(testPointInStroke(ctx, mockPath, 10, 20)).toBe(true);
  });

  test('returns false when isPointInStroke returns false', () => {
    const ctx = createMockCtx(false);
    expect(testPointInStroke(ctx, mockPath, 10, 20)).toBe(false);
  });

  test('passes correct arguments to isPointInStroke', () => {
    const ctx = createMockCtx(false);
    testPointInStroke(ctx, mockPath, 42, 99);
    expect(ctx.isPointInStroke).toHaveBeenCalledWith(mockPath, 42, 99);
  });
});
