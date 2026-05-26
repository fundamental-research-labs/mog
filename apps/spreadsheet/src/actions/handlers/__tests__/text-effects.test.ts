/**
 * TextEffect Action Handlers Tests
 *
 * Unit tests for TextEffect action handlers in the Unified Action System.
 * Tests verify:
 * - Handler behavior and return values (handled/not_handled)
 * - Payload validation and error handling
 * - Correct delegation to Worksheet API (ws.textEffects.add, ws.textEffects.get + handle.update, ws.objects.remove)
 * - Correct delegation to Worksheet API for conversion operations
 * - UIStore state updates for editing and gallery management
 *
 * Test categories:
 * - INSERT_TEXT_EFFECT: Create a new TextEffect object
 * - DELETE_TEXT_EFFECT: Delete TextEffect object(s)
 * - UPDATE_TEXT_EFFECT_WARP: Update warp preset
 * - UPDATE_TEXT_EFFECT_FILL: Update fill style
 * - UPDATE_TEXT_EFFECT_OUTLINE: Update outline/stroke
 * - UPDATE_TEXT_EFFECT_EFFECTS: Update text effects
 * - EDIT_TEXT_EFFECT_TEXT: Start/stop text editing mode
 * - COMMIT_TEXT_EFFECT_TEXT: Commit text changes
 * - CANCEL_TEXT_EFFECT_EDIT: Cancel text editing without saving
 * - CONVERT_TO_TEXT_EFFECT: Convert text box to TextEffect
 * - CONVERT_TO_TEXTBOX: Convert TextEffect to text box
 * - OPEN_TEXT_EFFECT_GALLERY: Open TextEffect picker dialog
 * - CLOSE_TEXT_EFFECT_GALLERY: Close TextEffect picker dialog
 *
 * Engine Integration - Action Handler Tests
 */

import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import { sheetId, type SheetId } from '@mog-sdk/contracts/core';

import * as TextEffectHandlers from '../text-effects';
import { createMockPlatform, createMockShellService } from './test-helpers';

// =============================================================================
// TEST UTILITIES
// =============================================================================

// Store mock function references for assertions
const mockUIStoreMethods = {
  setEditingTextEffectId: jest.fn(),
  startTextEffectEditing: jest.fn(),
  stopTextEffectEditing: jest.fn(),
  openTextEffectGallery: jest.fn(),
  closeTextEffectGallery: jest.fn(),
  setGallerySelectedPreset: jest.fn(),
};

const mockObjectCommands = {
  selectObject: jest.fn(),
  deselectAll: jest.fn(),
};

// Mock TextEffect handle returned by ws.textEffects.add() and ws.textEffects.get()
const mockTextEffectHandle = {
  id: 'text-effects-new-123',
  update: jest.fn().mockResolvedValue(undefined),
  delete: jest.fn().mockResolvedValue(undefined),
};

// Mock worksheet methods for the Worksheet API (namespaced sub-APIs)
const mockObjectsApi = {
  get: jest.fn().mockResolvedValue(mockTextEffectHandle),
  delete: jest.fn().mockResolvedValue({ type: 'delete' }),
  convertToTextEffect: jest.fn().mockResolvedValue(undefined),
  convertToTextBox: jest.fn().mockResolvedValue(undefined),
};
const mockTextEffectApi = {
  add: jest.fn().mockResolvedValue(mockTextEffectHandle),
  get: jest.fn().mockResolvedValue(mockTextEffectHandle),
};
const mockWs = {
  objects: mockObjectsApi,
  textEffects: mockTextEffectApi,
};

const mockWorkbook = {
  getSheet: jest.fn(() => mockWs),
  getSheetById: jest.fn(() => mockWs),
  setPendingUndoDescription: jest.fn(),
};

/**
 * Create minimal mock action dependencies for testing.
 */
function createMockDeps(overrides?: Partial<ActionDependencies>): ActionDependencies & {
  mockUIStoreMethods: typeof mockUIStoreMethods;
} {
  // Reset mock functions before each test
  Object.values(mockUIStoreMethods).forEach((fn) => fn.mockClear());
  Object.values(mockObjectCommands).forEach((fn) => fn.mockClear());

  // Create mock UIStore - methods are on the getState() return value
  const mockUIStore = {
    getState: () => ({
      editingTextEffectId: null,
      isTextEffectGalleryOpen: false,
      gallerySelectedPreset: null,
      ...mockUIStoreMethods,
    }),
  };

  // Create mock coordinator (with objects property for getCoordinator helper)
  const mockCoordinator = {
    objects: {
      getObject: jest.fn(),
      createTextEffect: jest.fn(),
      deleteObject: jest.fn(),
    },
  };

  // Create mock ctx
  const mockCtx = {
    eventBus: {
      emit: jest.fn(),
      on: jest.fn(() => () => {}),
      off: jest.fn(),
    },
  };

  // Create mock accessors
  const mockAccessors = {
    selection: {
      getActiveCell: () => ({ row: 5, col: 3 }),
    },
    object: {
      getSelectedIds: () => [],
    },
  };

  // Create mock commands
  const mockCommands = {
    object: mockObjectCommands,
  };

  return {
    ctx: mockCtx,
    uiStore: mockUIStore,
    coordinator: mockCoordinator,
    workbook: mockWorkbook,
    getActiveSheetId: () => sheetId('sheet-1'),
    onUIAction: jest.fn(),
    accessors: mockAccessors,
    commands: mockCommands,
    // required deps.
    platform: createMockPlatform(),
    shellService: createMockShellService(),
    mockUIStoreMethods,
    ...overrides,
  } as unknown as ActionDependencies & { mockUIStoreMethods: typeof mockUIStoreMethods };
}

/**
 * Create mock deps with selected objects.
 */
function createMockDepsWithSelectedObjects(
  objectIds: string[],
): ActionDependencies & { mockUIStoreMethods: typeof mockUIStoreMethods } {
  const deps = createMockDeps();
  (deps.accessors as any).object = {
    ...(deps.accessors as any).object,
    getSelectedIds: () => objectIds,
  };
  return deps;
}

// Reset mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
  // Reset ws mock implementations to default success values
  mockTextEffectHandle.id = 'text-effects-new-123';
  mockTextEffectHandle.update.mockResolvedValue(undefined);
  mockTextEffectHandle.delete.mockResolvedValue(undefined);
  mockTextEffectApi.add.mockResolvedValue(mockTextEffectHandle);
  mockTextEffectApi.get.mockResolvedValue(mockTextEffectHandle);
  mockObjectsApi.get.mockResolvedValue(mockTextEffectHandle);
  mockObjectsApi.delete.mockResolvedValue({ type: 'delete' });
  mockObjectsApi.convertToTextEffect.mockResolvedValue(undefined);
  mockObjectsApi.convertToTextBox.mockResolvedValue(undefined);
});

// =============================================================================
// INSERT_TEXT_EFFECT TESTS
// =============================================================================

describe('TextEffect Handlers - INSERT_TEXT_EFFECT', () => {
  it('should create TextEffect with default values', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.INSERT_TEXT_EFFECT(deps);

    expect(result.handled).toBe(true);
    expect(mockTextEffectApi.add).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Your text here',
        warpPreset: 'textArchUp',
        x: 100,
        y: 100,
        width: 300,
        height: 80,
      }),
    );
  });

  it('should use custom text and warp preset from payload', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.INSERT_TEXT_EFFECT(deps, {
      text: 'Custom Text',
      warpPreset: 'textWave1',
    });

    expect(result.handled).toBe(true);
    expect(mockTextEffectApi.add).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Custom Text',
        warpPreset: 'textWave1',
      }),
    );
  });

  it('should use custom position from payload', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.INSERT_TEXT_EFFECT(deps, {
      position: {
        anchorType: 'absolute',
        x: 200,
        y: 300,
        width: 400,
        height: 100,
      },
    });

    expect(result.handled).toBe(true);
    expect(mockTextEffectApi.add).toHaveBeenCalledWith(
      expect.objectContaining({
        x: 200,
        y: 300,
        width: 400,
        height: 100,
      }),
    );
  });

  it('should select newly created TextEffect', async () => {
    const deps = createMockDeps();
    await TextEffectHandlers.INSERT_TEXT_EFFECT(deps);

    expect(mockObjectCommands.selectObject).toHaveBeenCalledWith(
      'text-effects-new-123',
      false,
      false,
    );
  });

  it('should return disabled when no active sheet', async () => {
    const deps = createMockDeps({ getActiveSheetId: () => null as unknown as SheetId });
    const result = await TextEffectHandlers.INSERT_TEXT_EFFECT(deps);

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('disabled');
  });

  it('should handle mutation failure gracefully', async () => {
    mockTextEffectApi.add.mockRejectedValueOnce(new Error('Manager not available'));

    const deps = createMockDeps();
    const result = await TextEffectHandlers.INSERT_TEXT_EFFECT(deps);

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Manager not available');
  });
});

// =============================================================================
// DELETE_TEXT_EFFECT TESTS
// =============================================================================

describe('TextEffect Handlers - DELETE_TEXT_EFFECT', () => {
  it('should delete TextEffect via ws API when objectId provided', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.DELETE_TEXT_EFFECT(deps, {
      objectId: 'text-effects-123',
    });

    expect(result.handled).toBe(true);
    expect(mockObjectsApi.get).toHaveBeenCalledWith('text-effects-123');
    expect(mockTextEffectHandle.delete).toHaveBeenCalled();
  });

  it('should delete all selected objects when no objectId provided', async () => {
    const deps = createMockDepsWithSelectedObjects([
      'text-effects-1',
      'text-effects-2',
      'text-effects-3',
    ]);
    const result = await TextEffectHandlers.DELETE_TEXT_EFFECT(deps, {});

    expect(result.handled).toBe(true);
    expect(mockObjectsApi.get).toHaveBeenCalledWith('text-effects-1');
    expect(mockObjectsApi.get).toHaveBeenCalledWith('text-effects-2');
    expect(mockObjectsApi.get).toHaveBeenCalledWith('text-effects-3');
    expect(mockTextEffectHandle.delete).toHaveBeenCalledTimes(3);
  });

  it('should clear selection after deletion', async () => {
    const deps = createMockDeps();
    await TextEffectHandlers.DELETE_TEXT_EFFECT(deps, { objectId: 'text-effects-123' });

    expect(mockObjectCommands.deselectAll).toHaveBeenCalled();
  });

  it('should return wrong_context when no objectId and no selection', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.DELETE_TEXT_EFFECT(deps, {});

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('wrong_context');
  });

  it('should return wrong_context when all deletions fail', async () => {
    mockObjectsApi.get.mockRejectedValue(new Error('Not found'));

    const deps = createMockDepsWithSelectedObjects(['text-effects-1']);
    const result = await TextEffectHandlers.DELETE_TEXT_EFFECT(deps, {});

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('wrong_context');
  });

  it('should continue deleting even if some fail', async () => {
    // First deletion fails, second succeeds
    mockObjectsApi.get
      .mockRejectedValueOnce(new Error('Not found'))
      .mockResolvedValueOnce(mockTextEffectHandle);

    const deps = createMockDepsWithSelectedObjects(['text-effects-1', 'text-effects-2']);
    const result = await TextEffectHandlers.DELETE_TEXT_EFFECT(deps, {});

    // Should still be handled because at least one succeeded
    expect(result.handled).toBe(true);
    expect(mockTextEffectHandle.delete).toHaveBeenCalledTimes(1);
  });
});

// =============================================================================
// UPDATE_TEXT_EFFECT_WARP TESTS
// =============================================================================

describe('TextEffect Handlers - UPDATE_TEXT_EFFECT_WARP', () => {
  it('should update warp preset via ws API', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.UPDATE_TEXT_EFFECT_WARP(deps, {
      objectId: 'text-effects-123',
      warpPreset: 'textWave2',
    });

    expect(result.handled).toBe(true);
    expect(mockTextEffectApi.get).toHaveBeenCalledWith('text-effects-123');
    expect(mockTextEffectHandle.update).toHaveBeenCalledWith(
      expect.objectContaining({ warp: 'textWave2' }),
    );
  });

  it('should pass adjustments when provided', async () => {
    const deps = createMockDeps();
    const adjustments = { adj1: 0.5, adj2: 0.3 };
    await TextEffectHandlers.UPDATE_TEXT_EFFECT_WARP(deps, {
      objectId: 'text-effects-123',
      warpPreset: 'textArchUp',
      adjustments,
    });

    expect(mockTextEffectHandle.update).toHaveBeenCalledWith(
      expect.objectContaining({
        warp: 'textArchUp',
        warpAdjustments: adjustments,
      }),
    );
  });

  it('should return error if objectId is missing', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.UPDATE_TEXT_EFFECT_WARP(deps, {
      warpPreset: 'textWave1',
    });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Missing objectId in payload');
  });

  it('should return error if warpPreset is missing', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.UPDATE_TEXT_EFFECT_WARP(deps, {
      objectId: 'text-effects-123',
    });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Missing warpPreset in payload');
  });

  it('should handle mutation failure', async () => {
    mockTextEffectHandle.update.mockRejectedValueOnce(
      new Error('Object does not have TextEffect styling'),
    );

    const deps = createMockDeps();
    const result = await TextEffectHandlers.UPDATE_TEXT_EFFECT_WARP(deps, {
      objectId: 'text-effects-123',
      warpPreset: 'textWave1',
    });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Object does not have TextEffect styling');
  });
});

// =============================================================================
// UPDATE_TEXT_EFFECT_FILL TESTS
// =============================================================================

describe('TextEffect Handlers - UPDATE_TEXT_EFFECT_FILL', () => {
  it('should update fill via ws API', async () => {
    const deps = createMockDeps();
    const fill = {
      type: 'solid' as const,
      color: '#FF0000',
      opacity: 1,
    };
    const result = await TextEffectHandlers.UPDATE_TEXT_EFFECT_FILL(deps, {
      objectId: 'text-effects-123',
      fill,
    });

    expect(result.handled).toBe(true);
    expect(mockTextEffectApi.get).toHaveBeenCalledWith('text-effects-123');
    expect(mockTextEffectHandle.update).toHaveBeenCalledWith(
      expect.objectContaining({ fill: { ...fill } }),
    );
  });

  it('should handle gradient fill', async () => {
    const deps = createMockDeps();
    const fill = {
      type: 'gradient' as const,
      gradientType: 'linear' as const,
      angle: 45,
      stops: [
        { position: 0, color: '#FF0000', opacity: 1 },
        { position: 100, color: '#0000FF', opacity: 1 },
      ],
    };
    const result = await TextEffectHandlers.UPDATE_TEXT_EFFECT_FILL(deps, {
      objectId: 'text-effects-123',
      fill,
    });

    expect(result.handled).toBe(true);
    expect(mockTextEffectHandle.update).toHaveBeenCalledWith(
      expect.objectContaining({ fill: { ...fill } }),
    );
  });

  it('should return error if objectId is missing', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.UPDATE_TEXT_EFFECT_FILL(deps, {
      fill: { type: 'solid', color: '#FF0000', opacity: 1 },
    });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Missing objectId in payload');
  });

  it('should return error if fill is missing', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.UPDATE_TEXT_EFFECT_FILL(deps, {
      objectId: 'text-effects-123',
    });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Missing fill in payload');
  });

  it('should handle mutation failure', async () => {
    mockTextEffectHandle.update.mockRejectedValueOnce(new Error('Object not found'));

    const deps = createMockDeps();
    const result = await TextEffectHandlers.UPDATE_TEXT_EFFECT_FILL(deps, {
      objectId: 'text-effects-123',
      fill: { type: 'solid', color: '#FF0000', opacity: 1 },
    });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Object not found');
  });
});

// =============================================================================
// UPDATE_TEXT_EFFECT_OUTLINE TESTS
// =============================================================================

describe('TextEffect Handlers - UPDATE_TEXT_EFFECT_OUTLINE', () => {
  it('should update outline via ws API', async () => {
    const deps = createMockDeps();
    const outline = {
      color: '#000000',
      width: 2,
      opacity: 1,
    };
    const result = await TextEffectHandlers.UPDATE_TEXT_EFFECT_OUTLINE(deps, {
      objectId: 'text-effects-123',
      outline,
    });

    expect(result.handled).toBe(true);
    expect(mockTextEffectApi.get).toHaveBeenCalledWith('text-effects-123');
    expect(mockTextEffectHandle.update).toHaveBeenCalledWith(expect.objectContaining({ outline }));
  });

  it('should allow removing outline by passing undefined', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.UPDATE_TEXT_EFFECT_OUTLINE(deps, {
      objectId: 'text-effects-123',
      // outline not provided, will be undefined
    });

    expect(result.handled).toBe(true);
    expect(mockTextEffectHandle.update).toHaveBeenCalledWith(
      expect.objectContaining({ outline: undefined }),
    );
  });

  it('should return error if objectId is missing', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.UPDATE_TEXT_EFFECT_OUTLINE(deps, {
      outline: { color: '#000000', width: 1, opacity: 1 },
    });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Missing objectId in payload');
  });

  it('should handle mutation failure', async () => {
    mockTextEffectHandle.update.mockRejectedValueOnce(new Error('Object is not TextEffect'));

    const deps = createMockDeps();
    const result = await TextEffectHandlers.UPDATE_TEXT_EFFECT_OUTLINE(deps, {
      objectId: 'text-effects-123',
      outline: { color: '#000000', width: 1, opacity: 1 },
    });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Object is not TextEffect');
  });
});

// =============================================================================
// UPDATE_TEXT_EFFECT_EFFECTS TESTS
// =============================================================================

describe('TextEffect Handlers - UPDATE_TEXT_EFFECT_EFFECTS', () => {
  it('should update effects via ws API', async () => {
    const deps = createMockDeps();
    const effects = {
      outerShadow: {
        blurRadius: 50800,
        distance: 38100,
        direction: 45,
        color: '#000000',
        opacity: 0.35,
      },
    };
    const result = await TextEffectHandlers.UPDATE_TEXT_EFFECT_EFFECTS(deps, {
      objectId: 'text-effects-123',
      effects,
    });

    expect(result.handled).toBe(true);
    expect(mockTextEffectApi.get).toHaveBeenCalledWith('text-effects-123');
    expect(mockTextEffectHandle.update).toHaveBeenCalledWith(expect.objectContaining({ effects }));
  });

  it('should handle glow and reflection effects', async () => {
    const deps = createMockDeps();
    const effects = {
      glow: {
        radius: 10,
        color: '#FFD700',
        opacity: 0.5,
      },
      reflection: {
        blurRadius: 5,
        distance: 2,
        direction: 90,
        opacity: 0.5,
        size: 50,
      },
    };
    const result = await TextEffectHandlers.UPDATE_TEXT_EFFECT_EFFECTS(deps, {
      objectId: 'text-effects-123',
      effects,
    });

    expect(result.handled).toBe(true);
    expect(mockTextEffectHandle.update).toHaveBeenCalledWith(expect.objectContaining({ effects }));
  });

  it('should return error if objectId is missing', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.UPDATE_TEXT_EFFECT_EFFECTS(deps, {
      effects: { outerShadow: { blurRadius: 10 } },
    });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Missing objectId in payload');
  });

  it('should return error if effects is missing', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.UPDATE_TEXT_EFFECT_EFFECTS(deps, {
      objectId: 'text-effects-123',
    });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Missing effects in payload');
  });

  it('should handle mutation failure', async () => {
    mockTextEffectHandle.update.mockRejectedValueOnce(new Error('Invalid effects configuration'));

    const deps = createMockDeps();
    const result = await TextEffectHandlers.UPDATE_TEXT_EFFECT_EFFECTS(deps, {
      objectId: 'text-effects-123',
      effects: { outerShadow: { blurRadius: -1 } }, // Invalid
    });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Invalid effects configuration');
  });
});

// =============================================================================
// EDIT_TEXT_EFFECT_TEXT TESTS
// =============================================================================

describe('TextEffect Handlers - EDIT_TEXT_EFFECT_TEXT', () => {
  it('should start editing via UIStore', () => {
    const deps = createMockDeps();
    const result = TextEffectHandlers.EDIT_TEXT_EFFECT_TEXT(deps, { objectId: 'text-effects-123' });

    expect(result.handled).toBe(true);
    expect(deps.mockUIStoreMethods.startTextEffectEditing).toHaveBeenCalledWith(
      'text-effects-123',
      0,
    );
  });

  it('should stop editing when objectId is null', () => {
    const deps = createMockDeps();
    const result = TextEffectHandlers.EDIT_TEXT_EFFECT_TEXT(deps, { objectId: null });

    expect(result.handled).toBe(true);
    expect(deps.mockUIStoreMethods.stopTextEffectEditing).toHaveBeenCalled();
  });

  it('should stop editing when no objectId provided', () => {
    const deps = createMockDeps();
    const result = TextEffectHandlers.EDIT_TEXT_EFFECT_TEXT(deps, {});

    expect(result.handled).toBe(true);
    expect(deps.mockUIStoreMethods.stopTextEffectEditing).toHaveBeenCalled();
  });

  it('should use custom cursor position from payload', () => {
    const deps = createMockDeps();
    const result = TextEffectHandlers.EDIT_TEXT_EFFECT_TEXT(deps, {
      objectId: 'text-effects-123',
      cursorPosition: 5,
    });

    expect(result.handled).toBe(true);
    expect(deps.mockUIStoreMethods.startTextEffectEditing).toHaveBeenCalledWith(
      'text-effects-123',
      5,
    );
  });

  it('should return disabled when UIStore is not available', () => {
    const deps = createMockDeps({ uiStore: undefined });
    const result = TextEffectHandlers.EDIT_TEXT_EFFECT_TEXT(deps, { objectId: 'text-effects-123' });

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('disabled');
  });
});

// =============================================================================
// COMMIT_TEXT_EFFECT_TEXT TESTS
// =============================================================================

describe('TextEffect Handlers - COMMIT_TEXT_EFFECT_TEXT', () => {
  it('should update TextEffect text via ws API', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.COMMIT_TEXT_EFFECT_TEXT(deps, {
      objectId: 'text-effects-123',
      text: 'Updated Text',
    });

    expect(result.handled).toBe(true);
    expect(mockTextEffectApi.get).toHaveBeenCalledWith('text-effects-123');
    expect(mockTextEffectHandle.update).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Updated Text' }),
    );
  });

  it('should exit editing mode after commit', async () => {
    const deps = createMockDeps();
    await TextEffectHandlers.COMMIT_TEXT_EFFECT_TEXT(deps, {
      objectId: 'text-effects-123',
      text: 'Updated Text',
    });

    expect(deps.mockUIStoreMethods.stopTextEffectEditing).toHaveBeenCalled();
  });

  it('should allow empty text', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.COMMIT_TEXT_EFFECT_TEXT(deps, {
      objectId: 'text-effects-123',
      text: '',
    });

    expect(result.handled).toBe(true);
    expect(mockTextEffectHandle.update).toHaveBeenCalledWith(expect.objectContaining({ text: '' }));
  });

  it('should return error if objectId is missing', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.COMMIT_TEXT_EFFECT_TEXT(deps, { text: 'Some text' });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Missing objectId in payload');
  });

  it('should return error if text is missing', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.COMMIT_TEXT_EFFECT_TEXT(deps, {
      objectId: 'text-effects-123',
    });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Missing text in payload');
  });

  it('should handle mutation failure', async () => {
    mockTextEffectHandle.update.mockRejectedValueOnce(new Error('Object not found'));

    const deps = createMockDeps();
    const result = await TextEffectHandlers.COMMIT_TEXT_EFFECT_TEXT(deps, {
      objectId: 'text-effects-123',
      text: 'New text',
    });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Object not found');
  });
});

// =============================================================================
// CANCEL_TEXT_EFFECT_EDIT TESTS
// =============================================================================

describe('TextEffect Handlers - CANCEL_TEXT_EFFECT_EDIT', () => {
  it('should clear editing state without saving', () => {
    const deps = createMockDeps();
    const result = TextEffectHandlers.CANCEL_TEXT_EFFECT_EDIT(deps);

    expect(result.handled).toBe(true);
    expect(deps.mockUIStoreMethods.stopTextEffectEditing).toHaveBeenCalled();
    // Should NOT call update on the handle
    expect(mockTextEffectHandle.update).not.toHaveBeenCalled();
  });

  it('should return disabled when UIStore is not available', () => {
    const deps = createMockDeps({ uiStore: undefined });
    const result = TextEffectHandlers.CANCEL_TEXT_EFFECT_EDIT(deps);

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('disabled');
  });
});

// =============================================================================
// CONVERT_TO_TEXT_EFFECT TESTS
// =============================================================================

describe('TextEffect Handlers - CONVERT_TO_TEXT_EFFECT', () => {
  it('should convert text box to TextEffect via worksheet API', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.CONVERT_TO_TEXT_EFFECT(deps, {
      objectId: 'textbox-123',
    });

    expect(result.handled).toBe(true);
    expect(mockObjectsApi.convertToTextEffect).toHaveBeenCalledWith(
      'textbox-123',
      'textPlain', // Default preset
    );
  });

  it('should use custom warp preset from payload', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.CONVERT_TO_TEXT_EFFECT(deps, {
      objectId: 'textbox-123',
      warpPreset: 'textWave1',
    });

    expect(result.handled).toBe(true);
    expect(mockObjectsApi.convertToTextEffect).toHaveBeenCalledWith('textbox-123', 'textWave1');
  });

  it('should return error if objectId is missing', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.CONVERT_TO_TEXT_EFFECT(deps, {
      warpPreset: 'textWave1',
    });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Missing objectId in payload');
  });

  it('should handle worksheet API failure for already TextEffect', async () => {
    mockObjectsApi.convertToTextEffect.mockRejectedValueOnce(
      new Error('Object already has TextEffect styling'),
    );

    const deps = createMockDeps();
    const result = await TextEffectHandlers.CONVERT_TO_TEXT_EFFECT(deps, {
      objectId: 'text-effects-123',
    });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Object already has TextEffect styling');
  });
});

// =============================================================================
// CONVERT_TO_TEXTBOX TESTS
// =============================================================================

describe('TextEffect Handlers - CONVERT_TO_TEXTBOX', () => {
  it('should convert TextEffect to text box via worksheet API', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.CONVERT_TO_TEXTBOX(deps, {
      objectId: 'text-effects-123',
    });

    expect(result.handled).toBe(true);
    expect(mockObjectsApi.convertToTextBox).toHaveBeenCalledWith('text-effects-123');
  });

  it('should return error if objectId is missing', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.CONVERT_TO_TEXTBOX(deps, {});

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Missing objectId in payload');
  });

  it('should return error if payload is undefined', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.CONVERT_TO_TEXTBOX(deps, undefined);

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Missing objectId in payload');
  });

  it('should handle worksheet API failure for non-TextEffect', async () => {
    mockObjectsApi.convertToTextBox.mockRejectedValueOnce(
      new Error('Object does not have TextEffect styling'),
    );

    const deps = createMockDeps();
    const result = await TextEffectHandlers.CONVERT_TO_TEXTBOX(deps, { objectId: 'textbox-123' });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Object does not have TextEffect styling');
  });
});

// =============================================================================
// OPEN_TEXT_EFFECT_GALLERY TESTS
// =============================================================================

describe('TextEffect Handlers - OPEN_TEXT_EFFECT_GALLERY', () => {
  it('should open gallery via UIStore', () => {
    const deps = createMockDeps();
    const result = TextEffectHandlers.OPEN_TEXT_EFFECT_GALLERY(deps);

    expect(result.handled).toBe(true);
    expect(deps.mockUIStoreMethods.openTextEffectGallery).toHaveBeenCalled();
  });

  it('should return disabled when UIStore is not available', () => {
    const deps = createMockDeps({ uiStore: undefined });
    const result = TextEffectHandlers.OPEN_TEXT_EFFECT_GALLERY(deps);

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('disabled');
  });
});

// =============================================================================
// CLOSE_TEXT_EFFECT_GALLERY TESTS
// =============================================================================

describe('TextEffect Handlers - CLOSE_TEXT_EFFECT_GALLERY', () => {
  it('should close gallery via UIStore', () => {
    const deps = createMockDeps();
    const result = TextEffectHandlers.CLOSE_TEXT_EFFECT_GALLERY(deps);

    expect(result.handled).toBe(true);
    expect(deps.mockUIStoreMethods.closeTextEffectGallery).toHaveBeenCalled();
  });

  it('should return disabled when UIStore is not available', () => {
    const deps = createMockDeps({ uiStore: undefined });
    const result = TextEffectHandlers.CLOSE_TEXT_EFFECT_GALLERY(deps);

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('disabled');
  });
});

// =============================================================================
// SET_TEXT_EFFECT_GALLERY_PRESET TESTS
// =============================================================================

describe('TextEffect Handlers - SET_TEXT_EFFECT_GALLERY_PRESET', () => {
  it('should set gallery selected preset via UIStore', () => {
    const deps = createMockDeps();
    const result = TextEffectHandlers.SET_TEXT_EFFECT_GALLERY_PRESET(deps, {
      presetId: 'textArchUp',
    });

    expect(result.handled).toBe(true);
    expect(deps.mockUIStoreMethods.setGallerySelectedPreset).toHaveBeenCalledWith('textArchUp');
  });

  it('should return error when presetId is missing', () => {
    const deps = createMockDeps();
    const result = TextEffectHandlers.SET_TEXT_EFFECT_GALLERY_PRESET(deps, {});

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Missing presetId in payload');
  });

  it('should return error when payload is undefined', () => {
    const deps = createMockDeps();
    const result = TextEffectHandlers.SET_TEXT_EFFECT_GALLERY_PRESET(deps, undefined);

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Missing presetId in payload');
  });

  it('should return disabled when UIStore is not available', () => {
    const deps = createMockDeps({ uiStore: undefined });
    const result = TextEffectHandlers.SET_TEXT_EFFECT_GALLERY_PRESET(deps, {
      presetId: 'textArchUp',
    });

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('disabled');
  });
});

// =============================================================================
// HANDLER PATTERN VERIFICATION
// =============================================================================

describe('TextEffect Handlers - Pattern Verification', () => {
  it('all TextEffect handlers should be exported as functions', () => {
    expect(typeof TextEffectHandlers.INSERT_TEXT_EFFECT).toBe('function');
    expect(typeof TextEffectHandlers.DELETE_TEXT_EFFECT).toBe('function');
    expect(typeof TextEffectHandlers.UPDATE_TEXT_EFFECT_WARP).toBe('function');
    expect(typeof TextEffectHandlers.UPDATE_TEXT_EFFECT_FILL).toBe('function');
    expect(typeof TextEffectHandlers.UPDATE_TEXT_EFFECT_OUTLINE).toBe('function');
    expect(typeof TextEffectHandlers.UPDATE_TEXT_EFFECT_EFFECTS).toBe('function');
    expect(typeof TextEffectHandlers.EDIT_TEXT_EFFECT_TEXT).toBe('function');
    expect(typeof TextEffectHandlers.COMMIT_TEXT_EFFECT_TEXT).toBe('function');
    expect(typeof TextEffectHandlers.CANCEL_TEXT_EFFECT_EDIT).toBe('function');
    expect(typeof TextEffectHandlers.CONVERT_TO_TEXT_EFFECT).toBe('function');
    expect(typeof TextEffectHandlers.CONVERT_TO_TEXTBOX).toBe('function');
    expect(typeof TextEffectHandlers.OPEN_TEXT_EFFECT_GALLERY).toBe('function');
    expect(typeof TextEffectHandlers.CLOSE_TEXT_EFFECT_GALLERY).toBe('function');
    expect(typeof TextEffectHandlers.SET_TEXT_EFFECT_GALLERY_PRESET).toBe('function');
  });

  it('all handlers should return ActionResult with handled property', async () => {
    const deps = createMockDeps();

    // Test successful calls return handled: true
    expect((await TextEffectHandlers.INSERT_TEXT_EFFECT(deps)).handled).toBe(true);
    expect(
      (await TextEffectHandlers.DELETE_TEXT_EFFECT(deps, { objectId: 'text-effects-1' })).handled,
    ).toBe(true);
    expect(
      (
        await TextEffectHandlers.UPDATE_TEXT_EFFECT_WARP(deps, {
          objectId: 'text-effects-1',
          warpPreset: 'textWave1',
        })
      ).handled,
    ).toBe(true);
    expect(
      (
        await TextEffectHandlers.UPDATE_TEXT_EFFECT_FILL(deps, {
          objectId: 'text-effects-1',
          fill: { type: 'solid', color: '#FF0000', opacity: 1 },
        })
      ).handled,
    ).toBe(true);
    expect(
      (await TextEffectHandlers.UPDATE_TEXT_EFFECT_OUTLINE(deps, { objectId: 'text-effects-1' }))
        .handled,
    ).toBe(true);
    expect(
      (
        await TextEffectHandlers.UPDATE_TEXT_EFFECT_EFFECTS(deps, {
          objectId: 'text-effects-1',
          effects: {},
        })
      ).handled,
    ).toBe(true);
    expect(
      TextEffectHandlers.EDIT_TEXT_EFFECT_TEXT(deps, { objectId: 'text-effects-1' }).handled,
    ).toBe(true);
    expect(
      (
        await TextEffectHandlers.COMMIT_TEXT_EFFECT_TEXT(deps, {
          objectId: 'text-effects-1',
          text: 'test',
        })
      ).handled,
    ).toBe(true);
    expect(TextEffectHandlers.CANCEL_TEXT_EFFECT_EDIT(deps).handled).toBe(true);
    expect(
      (await TextEffectHandlers.CONVERT_TO_TEXT_EFFECT(deps, { objectId: 'textbox-1' })).handled,
    ).toBe(true);
    expect(
      (await TextEffectHandlers.CONVERT_TO_TEXTBOX(deps, { objectId: 'text-effects-1' })).handled,
    ).toBe(true);
    expect(TextEffectHandlers.OPEN_TEXT_EFFECT_GALLERY(deps).handled).toBe(true);
    expect(TextEffectHandlers.CLOSE_TEXT_EFFECT_GALLERY(deps).handled).toBe(true);
    expect(
      TextEffectHandlers.SET_TEXT_EFFECT_GALLERY_PRESET(deps, { presetId: 'textArchUp' }).handled,
    ).toBe(true);
  });

  it('handlers with missing required params should return handled: false', async () => {
    const deps = createMockDeps();

    // Test missing required parameters return handled: false
    expect((await TextEffectHandlers.DELETE_TEXT_EFFECT(deps, {})).handled).toBe(false); // No selection or objectId
    expect((await TextEffectHandlers.UPDATE_TEXT_EFFECT_WARP(deps, {})).handled).toBe(false);
    expect((await TextEffectHandlers.UPDATE_TEXT_EFFECT_FILL(deps, {})).handled).toBe(false);
    expect((await TextEffectHandlers.UPDATE_TEXT_EFFECT_OUTLINE(deps, {})).handled).toBe(false); // Missing objectId
    expect((await TextEffectHandlers.UPDATE_TEXT_EFFECT_EFFECTS(deps, {})).handled).toBe(false);
    expect((await TextEffectHandlers.COMMIT_TEXT_EFFECT_TEXT(deps, {})).handled).toBe(false);
    expect((await TextEffectHandlers.CONVERT_TO_TEXT_EFFECT(deps, {})).handled).toBe(false);
    expect((await TextEffectHandlers.CONVERT_TO_TEXTBOX(deps, {})).handled).toBe(false);
    expect(TextEffectHandlers.SET_TEXT_EFFECT_GALLERY_PRESET(deps, {}).handled).toBe(false); // Missing presetId
  });
});

// =============================================================================
// ERROR HANDLING VERIFICATION
// =============================================================================

describe('TextEffect Handlers - Error Handling', () => {
  it('INSERT_TEXT_EFFECT should handle no coordinator available', async () => {
    mockTextEffectApi.add.mockRejectedValueOnce(new Error('Manager not available'));

    const deps = createMockDeps();
    const result = await TextEffectHandlers.INSERT_TEXT_EFFECT(deps);

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Manager not available');
  });

  it('DELETE_TEXT_EFFECT should handle multiple failures gracefully', async () => {
    // All deletions fail
    mockObjectsApi.get
      .mockRejectedValueOnce(new Error('Not found 1'))
      .mockRejectedValueOnce(new Error('Not found 2'));

    const deps = createMockDepsWithSelectedObjects(['obj-1', 'obj-2']);
    const result = await TextEffectHandlers.DELETE_TEXT_EFFECT(deps);

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('wrong_context');
  });

  it('UPDATE_TEXT_EFFECT_WARP should pass through mutation errors', async () => {
    mockTextEffectHandle.update.mockRejectedValueOnce(new Error('Object is not a text box'));

    const deps = createMockDeps();
    const result = await TextEffectHandlers.UPDATE_TEXT_EFFECT_WARP(deps, {
      objectId: 'shape-123',
      warpPreset: 'textWave1',
    });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Object is not a text box');
  });

  it('COMMIT_TEXT_EFFECT_TEXT should still exit editing mode even if UIStore missing', async () => {
    const deps = createMockDeps({ uiStore: undefined });
    const result = await TextEffectHandlers.COMMIT_TEXT_EFFECT_TEXT(deps, {
      objectId: 'text-effects-123',
      text: 'New text',
    });

    // Should still call the ws API
    expect(result.handled).toBe(true);
    expect(mockTextEffectHandle.update).toHaveBeenCalled();
    // UIStore methods won't be called since it's undefined, but handler still succeeds
  });
});

// =============================================================================
// EDGE CASES
// =============================================================================

describe('TextEffect Handlers - Edge Cases', () => {
  it('INSERT_TEXT_EFFECT should handle undefined payload', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.INSERT_TEXT_EFFECT(deps, undefined);

    expect(result.handled).toBe(true);
    // Should use all default values
    expect(mockTextEffectApi.add).toHaveBeenCalledWith(
      expect.objectContaining({
        text: 'Your text here',
        warpPreset: 'textArchUp',
      }),
    );
  });

  it('DELETE_TEXT_EFFECT should handle undefined payload', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.DELETE_TEXT_EFFECT(deps, undefined);

    // No objectId and no selected objects
    expect(result.handled).toBe(false);
    expect(result.reason).toBe('wrong_context');
  });

  it('EDIT_TEXT_EFFECT_TEXT should handle undefined payload', () => {
    const deps = createMockDeps();
    const result = TextEffectHandlers.EDIT_TEXT_EFFECT_TEXT(deps, undefined);

    expect(result.handled).toBe(true);
    // Should stop editing (exit editing mode)
    expect(deps.mockUIStoreMethods.stopTextEffectEditing).toHaveBeenCalled();
  });

  it('COMMIT_TEXT_EFFECT_TEXT should distinguish between missing text and empty text', async () => {
    const deps = createMockDeps();

    // Empty string is valid
    const result1 = await TextEffectHandlers.COMMIT_TEXT_EFFECT_TEXT(deps, {
      objectId: 'text-effects-123',
      text: '',
    });
    expect(result1.handled).toBe(true);

    // Undefined text is invalid
    const result2 = await TextEffectHandlers.COMMIT_TEXT_EFFECT_TEXT(deps, {
      objectId: 'text-effects-123',
    });
    expect(result2.handled).toBe(false);
    expect(result2.error).toBe('Missing text in payload');
  });

  it('UPDATE_TEXT_EFFECT_OUTLINE should work with null outline (removal)', async () => {
    const deps = createMockDeps();
    const result = await TextEffectHandlers.UPDATE_TEXT_EFFECT_OUTLINE(deps, {
      objectId: 'text-effects-123',
      outline: null,
    });

    expect(result.handled).toBe(true);
    expect(mockTextEffectHandle.update).toHaveBeenCalledWith(
      expect.objectContaining({ outline: null }),
    );
  });
});
