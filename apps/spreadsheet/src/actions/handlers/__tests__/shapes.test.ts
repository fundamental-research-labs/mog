/**
 * Shape Action Handlers Tests
 *
 * Unit tests for shape action handlers in the Unified Action System.
 * Tests handler behavior, payload validation, and delegation to Worksheet API.
 *
 * Test categories:
 * - INSERT_SHAPE: shape creation with smart positioning
 * - FLIP_SHAPE_HORIZONTAL/VERTICAL: shape transformations via ws.objects.flip()
 * - SET_SHAPE_*: fill, outline, text, shadow property updates via ws.shapes handle
 * - COPY_SHAPE, CUT_SHAPE, PASTE_SHAPE: clipboard operations via ws.objects.get()
 */

import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';

import * as ObjectHandlers from '../object';
import { createMockPlatform, createMockShellService } from './test-helpers';

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Create minimal mock action dependencies for testing.
 */
function createMockDeps(overrides?: Partial<ActionDependencies>): ActionDependencies {
  // Mock shape handle with update method
  const mockShapeHandle = {
    update: jest.fn().mockResolvedValue(undefined),
  };
  const mockObjectHandle = {
    id: 'shape-123',
    type: 'shape',
    getData: jest.fn().mockResolvedValue({ id: 'shape-123', type: 'shape', rotation: 0 }),
    delete: jest.fn().mockResolvedValue({ id: 'shape-123', deleted: true }),
    flip: jest.fn().mockResolvedValue(undefined),
  };

  // Mock worksheet with namespaced sub-APIs matching the Worksheet interface
  const mockWorksheet = {
    objects: {
      duplicate: jest.fn().mockResolvedValue({ id: 'shape-copy' }),
      get: jest.fn().mockResolvedValue(mockObjectHandle),
      getInfo: jest.fn().mockResolvedValue({ id: 'shape-123', type: 'shape' }),
      updateShape: jest.fn().mockResolvedValue(undefined),
      updatePicture: jest.fn().mockResolvedValue(undefined),
      bringToFront: jest.fn().mockResolvedValue(undefined),
      bringForward: jest.fn().mockResolvedValue(undefined),
      sendToBack: jest.fn().mockResolvedValue(undefined),
      sendBackward: jest.fn().mockResolvedValue(undefined),
      group: jest.fn().mockResolvedValue(undefined),
      ungroup: jest.fn().mockResolvedValue(undefined),
      rotate: jest.fn().mockResolvedValue(undefined),
    },
    shapes: {
      add: jest.fn().mockResolvedValue({ id: 'shape-new' }),
      get: jest.fn().mockResolvedValue(mockShapeHandle),
    },
    charts: {
      get: jest.fn().mockResolvedValue(null),
      list: jest.fn().mockResolvedValue([]),
      add: jest.fn().mockResolvedValue('chart-new'),
      update: jest.fn().mockResolvedValue(undefined),
      remove: jest.fn().mockResolvedValue(undefined),
    },
  };

  const mockWorkbook = {
    getSheetById: jest.fn().mockReturnValue(mockWorksheet),
    setPendingUndoDescription: jest.fn(),
  };

  const mockSetObjectClipboard = jest.fn();
  const mockClearObjectClipboard = jest.fn();

  return {
    ctx: {},
    workbook: mockWorkbook,
    coordinator: {},
    uiStore: {
      getState: () => ({
        objectClipboard: null,
        setObjectClipboard: mockSetObjectClipboard,
        clearObjectClipboard: mockClearObjectClipboard,
      }),
    },
    accessors: {
      selection: {
        getDataBoundedRanges: jest.fn().mockReturnValue([]),
      },
      object: {
        getFirstSelectedId: jest.fn().mockReturnValue(null),
        getSelectedIds: jest.fn().mockReturnValue([]),
      },
    },
    actors: {
      selectionActor: { send: jest.fn(), getSnapshot: () => ({}) },
      editorActor: { send: jest.fn(), getSnapshot: () => ({}) },
      clipboardActor: { send: jest.fn(), getSnapshot: () => ({}) },
      objectInteractionActor: { send: jest.fn(), getSnapshot: () => ({}) },
      chartActor: { send: jest.fn(), getSnapshot: () => ({}) },
      findReplaceActor: null,
      commentActor: { send: jest.fn(), getSnapshot: () => ({}) },
      paneFocusActor: null,
    },
    getActiveSheetId: () => 'sheet1',
    onUIAction: jest.fn(),
    // required deps.
    platform: createMockPlatform(),
    shellService: createMockShellService(),
    ...overrides,
  } as unknown as ActionDependencies;
}

// =============================================================================
// INSERT_SHAPE TESTS
// =============================================================================

describe('Shape Handlers - INSERT_SHAPE', () => {
  it('should succeed via Worksheet API when valid payload is provided', async () => {
    const deps = createMockDeps();
    const payload = {
      shapeType: 'rect',
      position: { x: 100, y: 100 },
    };

    const result = await ObjectHandlers.INSERT_SHAPE(deps, payload);

    expect(result.handled).toBe(true);
  });

  it('should succeed via Worksheet API with fill and outline', async () => {
    const deps = createMockDeps();
    const payload = {
      shapeType: 'ellipse',
      position: { x: 50, y: 50 },
      fill: { type: 'solid', color: '#ff0000' },
      outline: { color: '#000000', width: 2 },
    };

    const result = await ObjectHandlers.INSERT_SHAPE(deps, payload);

    expect(result.handled).toBe(true);
  });

  it('should return error when shapeType is missing', async () => {
    const deps = createMockDeps();
    const result = await ObjectHandlers.INSERT_SHAPE(deps, {
      position: { x: 100, y: 100 },
    });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Missing shapeType');
  });

  it('should succeed with smart positioning when position is not provided', async () => {
    const deps = createMockDeps();
    const result = await ObjectHandlers.INSERT_SHAPE(deps, { shapeType: 'rect' });

    expect(result.handled).toBe(true);
  });

  it('should return error when payload is undefined', async () => {
    const deps = createMockDeps();
    const result = await ObjectHandlers.INSERT_SHAPE(deps, undefined);

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Missing shapeType');
  });
});

// =============================================================================
// FLIP_SHAPE TESTS
// =============================================================================

describe('Shape Handlers - FLIP_SHAPE_HORIZONTAL', () => {
  it('should succeed via Worksheet API when objectId is provided', async () => {
    const deps = createMockDeps();
    const result = await ObjectHandlers.FLIP_SHAPE_HORIZONTAL(deps, { objectId: 'shape-123' });

    expect(result.handled).toBe(true);
  });

  it('should return error when objectId is missing', async () => {
    const deps = createMockDeps();
    const result = await ObjectHandlers.FLIP_SHAPE_HORIZONTAL(deps, {});

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Missing objectId in payload');
  });
});

describe('Shape Handlers - FLIP_SHAPE_VERTICAL', () => {
  it('should succeed via Worksheet API when objectId is provided', async () => {
    const deps = createMockDeps();
    const result = await ObjectHandlers.FLIP_SHAPE_VERTICAL(deps, { objectId: 'shape-456' });

    expect(result.handled).toBe(true);
  });

  it('should return error when objectId is missing', async () => {
    const deps = createMockDeps();
    const result = await ObjectHandlers.FLIP_SHAPE_VERTICAL(deps, {});

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Missing objectId in payload');
  });
});

// =============================================================================
// SET_SHAPE_* TESTS
// =============================================================================

describe('Shape Handlers - SET_SHAPE_FILL', () => {
  it('should succeed via Worksheet API when objectId is provided', async () => {
    const deps = createMockDeps();
    const fill = { type: 'solid', color: '#00ff00' };
    const result = await ObjectHandlers.SET_SHAPE_FILL(deps, { objectId: 'shape-123', fill });

    expect(result.handled).toBe(true);
  });

  it('should return error when objectId is missing', async () => {
    const deps = createMockDeps();
    const result = await ObjectHandlers.SET_SHAPE_FILL(deps, {
      fill: { type: 'solid', color: '#00ff00' },
    });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Missing objectId in payload');
  });

  it('should succeed via Worksheet API when fill is undefined', async () => {
    const deps = createMockDeps();
    const result = await ObjectHandlers.SET_SHAPE_FILL(deps, { objectId: 'shape-123' });

    expect(result.handled).toBe(true);
  });
});

describe('Shape Handlers - SET_SHAPE_OUTLINE', () => {
  it('should succeed via Worksheet API when objectId is provided', async () => {
    const deps = createMockDeps();
    const outline = { color: '#000000', width: 2, style: 'solid' };
    const result = await ObjectHandlers.SET_SHAPE_OUTLINE(deps, { objectId: 'shape-123', outline });

    expect(result.handled).toBe(true);
  });

  it('should return error when objectId is missing', async () => {
    const deps = createMockDeps();
    const result = await ObjectHandlers.SET_SHAPE_OUTLINE(deps, { outline: { color: '#000000' } });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Missing objectId in payload');
  });
});

describe('Shape Handlers - SET_SHAPE_TEXT', () => {
  it('should succeed via Worksheet API when objectId is provided', async () => {
    const deps = createMockDeps();
    const text = { content: 'Hello World', fontSize: 12, fontFamily: 'Arial' };
    const result = await ObjectHandlers.SET_SHAPE_TEXT(deps, { objectId: 'shape-123', text });

    expect(result.handled).toBe(true);
  });

  it('should return error when objectId is missing', async () => {
    const deps = createMockDeps();
    const result = await ObjectHandlers.SET_SHAPE_TEXT(deps, { text: { content: 'Test' } });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Missing objectId in payload');
  });
});

describe('Shape Handlers - SET_SHAPE_SHADOW', () => {
  it('should succeed via Worksheet API when objectId is provided', async () => {
    const deps = createMockDeps();
    const shadow = { color: '#000000', offsetX: 5, offsetY: 5, blur: 10 };
    const result = await ObjectHandlers.SET_SHAPE_SHADOW(deps, { objectId: 'shape-123', shadow });

    expect(result.handled).toBe(true);
  });

  it('should return error when objectId is missing', async () => {
    const deps = createMockDeps();
    const result = await ObjectHandlers.SET_SHAPE_SHADOW(deps, { shadow: {} });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Missing objectId in payload');
  });
});

// =============================================================================
// CLIPBOARD TESTS
// =============================================================================

describe('Shape Handlers - COPY_SHAPE', () => {
  it('should succeed when objectId is provided and object exists', async () => {
    const deps = createMockDeps();
    const result = await ObjectHandlers.COPY_SHAPE(deps, { objectId: 'shape-123' });

    expect(result.handled).toBe(true);
  });

  it('should return error when objectId is missing', async () => {
    const deps = createMockDeps();
    const result = await ObjectHandlers.COPY_SHAPE(deps, {});

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Missing objectId in payload');
  });

  it('should return error when object is not found', async () => {
    const deps = createMockDeps();
    // Override objects.getInfo to return null for this test
    const ws = (deps.workbook as any).getSheetById('sheet1');
    ws.objects.getInfo.mockResolvedValue(null);

    const result = await ObjectHandlers.COPY_SHAPE(deps, { objectId: 'nonexistent' });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Object not found');
  });
});

describe('Shape Handlers - CUT_SHAPE', () => {
  it('should succeed when objectId is provided and object exists', async () => {
    const deps = createMockDeps();
    const result = await ObjectHandlers.CUT_SHAPE(deps, { objectId: 'shape-456' });

    expect(result.handled).toBe(true);
  });

  it('should return error when objectId is missing', async () => {
    const deps = createMockDeps();
    const result = await ObjectHandlers.CUT_SHAPE(deps, {});

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Missing objectId in payload');
  });

  it('should return error when object is not found', async () => {
    const deps = createMockDeps();
    const ws = (deps.workbook as any).getSheetById('sheet1');
    ws.objects.getInfo.mockResolvedValue(null);

    const result = await ObjectHandlers.CUT_SHAPE(deps, { objectId: 'nonexistent' });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Object not found');
  });
});

describe('Shape Handlers - PASTE_SHAPE', () => {
  it('should return disabled when clipboard is empty', async () => {
    const deps = createMockDeps();
    const result = await ObjectHandlers.PASTE_SHAPE(deps);

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('disabled');
  });
});

// =============================================================================
// HANDLER PATTERN VERIFICATION
// =============================================================================

describe('Shape Handlers - Pattern Verification', () => {
  it('all shape handlers should be exported', () => {
    expect(typeof ObjectHandlers.INSERT_SHAPE).toBe('function');
    expect(typeof ObjectHandlers.FLIP_SHAPE_HORIZONTAL).toBe('function');
    expect(typeof ObjectHandlers.FLIP_SHAPE_VERTICAL).toBe('function');
    expect(typeof ObjectHandlers.SET_SHAPE_FILL).toBe('function');
    expect(typeof ObjectHandlers.SET_SHAPE_OUTLINE).toBe('function');
    expect(typeof ObjectHandlers.SET_SHAPE_TEXT).toBe('function');
    expect(typeof ObjectHandlers.SET_SHAPE_SHADOW).toBe('function');
    expect(typeof ObjectHandlers.COPY_SHAPE).toBe('function');
    expect(typeof ObjectHandlers.CUT_SHAPE).toBe('function');
    expect(typeof ObjectHandlers.PASTE_SHAPE).toBe('function');
  });

  it('all handlers should return ActionResult with handled property', async () => {
    const deps = createMockDeps();

    // Handlers that use Worksheet API directly succeed with valid mock workbook
    expect(
      (
        await ObjectHandlers.INSERT_SHAPE(deps, {
          shapeType: 'rect',
          position: { x: 0, y: 0 },
        })
      ).handled,
    ).toBe(true);
    expect((await ObjectHandlers.FLIP_SHAPE_HORIZONTAL(deps, { objectId: 'test' })).handled).toBe(
      true,
    );
    expect((await ObjectHandlers.FLIP_SHAPE_VERTICAL(deps, { objectId: 'test' })).handled).toBe(
      true,
    );
    expect((await ObjectHandlers.SET_SHAPE_FILL(deps, { objectId: 'test' })).handled).toBe(true);
    expect((await ObjectHandlers.SET_SHAPE_OUTLINE(deps, { objectId: 'test' })).handled).toBe(true);
    expect((await ObjectHandlers.SET_SHAPE_TEXT(deps, { objectId: 'test' })).handled).toBe(true);
    expect((await ObjectHandlers.SET_SHAPE_SHADOW(deps, { objectId: 'test' })).handled).toBe(true);
    // Clipboard handlers now use ws.objects.get() + uiStore (succeed with mocks)
    expect((await ObjectHandlers.COPY_SHAPE(deps, { objectId: 'test' })).handled).toBe(true);
    expect((await ObjectHandlers.CUT_SHAPE(deps, { objectId: 'test' })).handled).toBe(true);
    // PASTE_SHAPE returns disabled when clipboard is empty
    expect((await ObjectHandlers.PASTE_SHAPE(deps)).handled).toBe(false);
  });
});
