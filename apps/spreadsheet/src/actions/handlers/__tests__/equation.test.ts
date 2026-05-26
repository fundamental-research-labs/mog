/**
 * Equation Action Handlers Tests
 *
 * Unit tests for equation action handlers in the Unified Action System.
 * Tests verify:
 * - Handler behavior and return values (handled/not_handled)
 * - Payload validation and error handling
 * - Correct delegation to Worksheet API (ws.equations, ws.objects)
 * - UIStore state updates for dialog management
 *
 * Test categories:
 * - INSERT_EQUATION: Opens dialog in insert mode
 * - EDIT_EQUATION: Opens dialog in edit mode for existing equation
 * - UPDATE_EQUATION: Creates or updates equation content
 * - DELETE_EQUATION: Deletes equation object(s)
 * - Dialog actions: OPEN_EQUATION_DIALOG, CLOSE_EQUATION_DIALOG
 *
 * Engine Integration - Action Handler Tests
 */

import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import type { ObjectAccessor, SelectionAccessor } from '@mog-sdk/contracts/actors';
import { sheetId, type SheetId } from '@mog-sdk/contracts/core';

import * as EquationHandlers from '../equation';
import { createMockPlatform, createMockShellService } from './test-helpers';

// =============================================================================
// TEST UTILITIES
// =============================================================================

// Store mock function references for assertions
const mockUIStoreMethods = {
  openEquationDialog: jest.fn(),
  openEquationDialogForEdit: jest.fn(),
  closeEquationDialog: jest.fn(),
};

const mockObjectCommands = {
  selectObject: jest.fn(),
  deselectAll: jest.fn(),
};

// Mock EquationHandle returned by ws.equations.get() and ws.equations.add()
const mockEquationHandle = {
  id: 'eq-new-123',
  getData: jest.fn().mockResolvedValue({
    id: 'eq-123',
    type: 'equation',
    sheetId: 'sheet-1',
    position: { x: 100, y: 100, width: 150, height: 50, anchorType: 'oneCell' },
    equation: {
      latex: '\\frac{a}{b}',
      omml: '<m:oMath>...</m:oMath>',
      style: {},
    },
  }),
  update: jest.fn().mockResolvedValue(undefined),
};

// Mock equations sub-API (handle-based)
const mockEquationsApi = {
  get: jest.fn().mockResolvedValue(mockEquationHandle),
  add: jest.fn().mockResolvedValue({ id: 'eq-new-123' }),
};

// Mock objects sub-API (data-based)
const mockObjectsApi = {
  get: jest.fn(async (id: string) => ({
    id,
    type: 'equation',
    sheetId: 'sheet-1',
    delete: () => mockObjectsApi.delete(id),
  })),
  delete: jest.fn().mockResolvedValue({ success: true }),
};

// Mock worksheet returned by workbook.getSheetById()
const mockWs = {
  equations: mockEquationsApi,
  objects: mockObjectsApi,
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
      equationDialog: {
        isOpen: false,
        mode: 'insert',
        equationId: null,
        targetRow: 0,
        targetCol: 0,
        initialLatex: '',
      },
      ...mockUIStoreMethods,
    }),
  };

  // Create mock workbook
  const mockWorkbook = {
    getSheetById: jest.fn(() => mockWs),
    setPendingUndoDescription: jest.fn(),
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
  deps.accessors = {
    ...deps.accessors,
    object: {
      getSelectedIds: () => objectIds,
    } as unknown as ObjectAccessor,
  };
  return deps;
}

// Reset mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
  // Reset mock implementations to default success values
  mockEquationsApi.get.mockResolvedValue(mockEquationHandle);
  mockEquationsApi.add.mockResolvedValue({ id: 'eq-new-123' });
  mockEquationHandle.getData.mockResolvedValue({
    id: 'eq-123',
    type: 'equation',
    sheetId: 'sheet-1',
    position: { x: 100, y: 100, width: 150, height: 50, anchorType: 'oneCell' },
    equation: {
      latex: '\\frac{a}{b}',
      omml: '<m:oMath>...</m:oMath>',
      style: {},
    },
  });
  mockEquationHandle.update.mockResolvedValue(undefined);
  mockObjectsApi.get.mockImplementation(async (id: string) => ({
    id,
    type: 'equation',
    sheetId: 'sheet-1',
    delete: () => mockObjectsApi.delete(id),
  }));
  mockObjectsApi.delete.mockResolvedValue({ success: true });
});

// =============================================================================
// INSERT_EQUATION TESTS
// =============================================================================

describe('Equation Handlers - INSERT_EQUATION', () => {
  it('should open equation dialog in insert mode', () => {
    const deps = createMockDeps();
    const result = EquationHandlers.INSERT_EQUATION(deps);

    expect(result.handled).toBe(true);
    expect(deps.mockUIStoreMethods.openEquationDialog).toHaveBeenCalled();
  });

  it('should use active cell position for dialog', () => {
    const deps = createMockDeps();
    EquationHandlers.INSERT_EQUATION(deps);

    // The handler uses getActiveCell() which returns { row: 5, col: 3 }
    expect(deps.mockUIStoreMethods.openEquationDialog).toHaveBeenCalledWith(5, 3);
  });

  it('should use default position when no active cell', () => {
    const deps = createMockDeps();
    deps.accessors = {
      ...deps.accessors,
      selection: {
        getActiveCell: () => null,
      } as unknown as SelectionAccessor,
    };

    EquationHandlers.INSERT_EQUATION(deps);

    expect(deps.mockUIStoreMethods.openEquationDialog).toHaveBeenCalledWith(0, 0);
  });

  it('should return disabled when no active sheet', () => {
    const deps = createMockDeps({ getActiveSheetId: () => null as unknown as SheetId });
    const result = EquationHandlers.INSERT_EQUATION(deps);

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('disabled');
  });
});

// =============================================================================
// EDIT_EQUATION TESTS
// =============================================================================

describe('Equation Handlers - EDIT_EQUATION', () => {
  it('should open equation dialog in edit mode with existing equation data', async () => {
    const deps = createMockDeps();
    const result = await EquationHandlers.EDIT_EQUATION(deps, { objectId: 'eq-123' });

    expect(result.handled).toBe(true);
    expect(deps.mockUIStoreMethods.openEquationDialogForEdit).toHaveBeenCalledWith(
      'eq-123',
      0, // Default row
      0, // Default col
      '\\frac{a}{b}', // LaTeX from mock object
    );
  });

  it('should return not handled when objectId is missing', async () => {
    const deps = createMockDeps();
    const result = await EquationHandlers.EDIT_EQUATION(deps, {});

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('wrong_context');
  });

  it('should return not handled when payload is undefined', async () => {
    const deps = createMockDeps();
    const result = await EquationHandlers.EDIT_EQUATION(deps, undefined);

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('wrong_context');
  });

  it('should return not handled when equation not found', async () => {
    // equations.get returns null when not found
    mockEquationsApi.get.mockResolvedValueOnce(null);

    const deps = createMockDeps();
    const result = await EquationHandlers.EDIT_EQUATION(deps, { objectId: 'eq-nonexistent' });

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('wrong_context');
  });

  it('should return not handled when object is not an equation', async () => {
    // Handle's getData returns non-equation type
    const nonEquationHandle = {
      ...mockEquationHandle,
      getData: jest.fn().mockResolvedValue({
        id: 'shape-123',
        type: 'shape',
        sheetId: 'sheet-1',
        position: { x: 100, y: 100 },
      }),
    };
    mockEquationsApi.get.mockResolvedValueOnce(nonEquationHandle);

    const deps = createMockDeps();
    const result = await EquationHandlers.EDIT_EQUATION(deps, { objectId: 'shape-123' });

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('wrong_context');
  });

  it('should return disabled when no active sheet', async () => {
    const deps = createMockDeps({ getActiveSheetId: () => null as unknown as SheetId });
    const result = await EquationHandlers.EDIT_EQUATION(deps, { objectId: 'eq-123' });

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('disabled');
  });
});

// =============================================================================
// UPDATE_EQUATION TESTS
// =============================================================================

describe('Equation Handlers - UPDATE_EQUATION', () => {
  it('should create new equation when objectId is null (insert mode)', async () => {
    const deps = createMockDeps();
    const result = await EquationHandlers.UPDATE_EQUATION(deps, {
      objectId: null,
      latex: '\\frac{a}{b}',
    });

    expect(result.handled).toBe(true);
    expect(mockEquationsApi.add).toHaveBeenCalled();
    expect(deps.mockUIStoreMethods.closeEquationDialog).toHaveBeenCalled();
  });

  it('should update existing equation when objectId provided (edit mode)', async () => {
    const deps = createMockDeps();
    const result = await EquationHandlers.UPDATE_EQUATION(deps, {
      objectId: 'eq-123',
      latex: 'x^2 + y^2 = z^2',
    });

    expect(result.handled).toBe(true);
    expect(mockEquationsApi.get).toHaveBeenCalledWith('eq-123');
    expect(mockEquationHandle.update).toHaveBeenCalled();
    expect(deps.mockUIStoreMethods.closeEquationDialog).toHaveBeenCalled();
  });

  it('should pass omml when provided', async () => {
    const deps = createMockDeps();
    await EquationHandlers.UPDATE_EQUATION(deps, {
      objectId: 'eq-123',
      latex: 'x^2',
      omml: '<m:oMath>...</m:oMath>',
    });

    expect(mockEquationHandle.update).toHaveBeenCalledWith({
      latex: 'x^2',
      omml: '<m:oMath>...</m:oMath>',
    });
  });

  it('should return not handled when latex is missing', async () => {
    const deps = createMockDeps();
    const result = await EquationHandlers.UPDATE_EQUATION(deps, {
      objectId: null,
    });

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('wrong_context');
  });

  it('should return disabled when no active sheet', async () => {
    const deps = createMockDeps({ getActiveSheetId: () => null as unknown as SheetId });
    const result = await EquationHandlers.UPDATE_EQUATION(deps, {
      objectId: null,
      latex: '\\sqrt{2}',
    });

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('disabled');
  });

  it('should select newly created equation', async () => {
    const deps = createMockDeps();
    await EquationHandlers.UPDATE_EQUATION(deps, {
      objectId: null,
      latex: '\\pi',
    });

    expect(mockObjectCommands.selectObject).toHaveBeenCalledWith('eq-new-123', false, false);
  });

  it('should handle mutation failure gracefully', async () => {
    mockEquationsApi.add.mockRejectedValueOnce(new Error('Invalid LaTeX'));

    const deps = createMockDeps();
    const result = await EquationHandlers.UPDATE_EQUATION(deps, {
      objectId: null,
      latex: 'invalid{{{',
    });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Invalid LaTeX');
  });
});

// =============================================================================
// DELETE_EQUATION TESTS
// =============================================================================

describe('Equation Handlers - DELETE_EQUATION', () => {
  it('should delete equation via worksheet API when objectId provided', async () => {
    const deps = createMockDeps();
    const result = await EquationHandlers.DELETE_EQUATION(deps, { objectId: 'eq-123' });

    expect(result.handled).toBe(true);
    expect(mockObjectsApi.get).toHaveBeenCalledWith('eq-123');
    expect(mockObjectsApi.delete).toHaveBeenCalledWith('eq-123');
  });

  it('should delete all selected equation objects when no objectId provided', async () => {
    const deps = createMockDepsWithSelectedObjects(['eq-1', 'eq-2', 'eq-3']);
    const result = await EquationHandlers.DELETE_EQUATION(deps, {});

    expect(result.handled).toBe(true);
    expect(mockObjectsApi.delete).toHaveBeenCalledTimes(3);
    expect(mockObjectsApi.delete).toHaveBeenCalledWith('eq-1');
    expect(mockObjectsApi.delete).toHaveBeenCalledWith('eq-2');
    expect(mockObjectsApi.delete).toHaveBeenCalledWith('eq-3');
  });

  it('should clear selection after deletion', async () => {
    const deps = createMockDeps();
    await EquationHandlers.DELETE_EQUATION(deps, { objectId: 'eq-123' });

    expect(mockObjectCommands.deselectAll).toHaveBeenCalled();
  });

  it('should return not handled when no objectId and no selection', async () => {
    const deps = createMockDeps();
    const result = await EquationHandlers.DELETE_EQUATION(deps, {});

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('wrong_context');
  });

  it('should return not handled when all deletions fail', async () => {
    mockObjectsApi.get.mockResolvedValue({
      id: 'eq-1',
      type: 'equation',
      sheetId: 'sheet-1',
      delete: () => mockObjectsApi.delete('eq-1'),
    });
    mockObjectsApi.delete.mockRejectedValue(new Error('Object not found'));

    const deps = createMockDepsWithSelectedObjects(['eq-1']);
    const result = await EquationHandlers.DELETE_EQUATION(deps, {});

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('wrong_context');
  });
});

// =============================================================================
// DIALOG ACTIONS TESTS
// =============================================================================

describe('Equation Handlers - Dialog Actions', () => {
  describe('OPEN_EQUATION_DIALOG', () => {
    it('should open dialog in insert mode by default', () => {
      const deps = createMockDeps();
      const result = EquationHandlers.OPEN_EQUATION_DIALOG(deps, {});

      expect(result.handled).toBe(true);
      expect(deps.mockUIStoreMethods.openEquationDialog).toHaveBeenCalledWith(0, 0);
    });

    it('should open dialog in edit mode when specified', () => {
      const deps = createMockDeps();
      const result = EquationHandlers.OPEN_EQUATION_DIALOG(deps, {
        mode: 'edit',
        equationId: 'eq-123',
        row: 10,
        col: 5,
        latex: '\\alpha + \\beta',
      });

      expect(result.handled).toBe(true);
      expect(deps.mockUIStoreMethods.openEquationDialogForEdit).toHaveBeenCalledWith(
        'eq-123',
        10,
        5,
        '\\alpha + \\beta',
      );
    });

    it('should use provided row and col for insert mode', () => {
      const deps = createMockDeps();
      EquationHandlers.OPEN_EQUATION_DIALOG(deps, {
        mode: 'insert',
        row: 15,
        col: 8,
      });

      expect(deps.mockUIStoreMethods.openEquationDialog).toHaveBeenCalledWith(15, 8);
    });
  });

  describe('CLOSE_EQUATION_DIALOG', () => {
    it('should close the equation dialog', () => {
      const deps = createMockDeps();
      const result = EquationHandlers.CLOSE_EQUATION_DIALOG(deps);

      expect(result.handled).toBe(true);
      expect(deps.mockUIStoreMethods.closeEquationDialog).toHaveBeenCalled();
    });
  });
});

// =============================================================================
// HANDLER PATTERN VERIFICATION
// =============================================================================

describe('Equation Handlers - Pattern Verification', () => {
  it('all equation handlers should be exported as functions', () => {
    expect(typeof EquationHandlers.INSERT_EQUATION).toBe('function');
    expect(typeof EquationHandlers.EDIT_EQUATION).toBe('function');
    expect(typeof EquationHandlers.UPDATE_EQUATION).toBe('function');
    expect(typeof EquationHandlers.DELETE_EQUATION).toBe('function');
    expect(typeof EquationHandlers.OPEN_EQUATION_DIALOG).toBe('function');
    expect(typeof EquationHandlers.CLOSE_EQUATION_DIALOG).toBe('function');
  });

  it('all handlers should return ActionResult with handled property', async () => {
    const deps = createMockDeps();

    // Test successful calls return handled: true
    expect(EquationHandlers.INSERT_EQUATION(deps).handled).toBe(true);
    expect((await EquationHandlers.EDIT_EQUATION(deps, { objectId: 'eq-1' })).handled).toBe(true);
    expect(
      (await EquationHandlers.UPDATE_EQUATION(deps, { objectId: null, latex: 'x' })).handled,
    ).toBe(true);
    expect((await EquationHandlers.DELETE_EQUATION(deps, { objectId: 'eq-1' })).handled).toBe(true);
    expect(EquationHandlers.OPEN_EQUATION_DIALOG(deps, {}).handled).toBe(true);
    expect(EquationHandlers.CLOSE_EQUATION_DIALOG(deps).handled).toBe(true);
  });

  it('handlers with missing required params should return handled: false', async () => {
    const deps = createMockDeps();

    // Test missing required parameters return handled: false
    expect((await EquationHandlers.EDIT_EQUATION(deps, {})).handled).toBe(false);
    expect((await EquationHandlers.UPDATE_EQUATION(deps, { objectId: null })).handled).toBe(false);
    expect((await EquationHandlers.DELETE_EQUATION(deps, {})).handled).toBe(false); // No selection
  });
});

// =============================================================================
// ERROR HANDLING VERIFICATION
// =============================================================================

describe('Equation Handlers - Error Handling', () => {
  it('EDIT_EQUATION should handle no active sheet', async () => {
    const deps = createMockDeps({ getActiveSheetId: () => null as unknown as SheetId });
    const result = await EquationHandlers.EDIT_EQUATION(deps, { objectId: 'eq-1' });

    expect(result.handled).toBe(false);
    expect(result.reason).toBe('disabled');
  });

  it('UPDATE_EQUATION should handle insert mutation failure', async () => {
    mockEquationsApi.add.mockRejectedValueOnce(new Error('Manager not available'));

    const deps = createMockDeps();
    const result = await EquationHandlers.UPDATE_EQUATION(deps, {
      objectId: null,
      latex: 'x',
    });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Manager not available');
  });

  it('UPDATE_EQUATION should handle update mutation failure', async () => {
    mockEquationHandle.update.mockRejectedValueOnce(new Error('Object eq-1 not found'));

    const deps = createMockDeps();
    const result = await EquationHandlers.UPDATE_EQUATION(deps, {
      objectId: 'eq-1',
      latex: 'x',
    });

    expect(result.handled).toBe(false);
    expect(result.error).toBe('Object eq-1 not found');
  });

  it('DELETE_EQUATION should continue deleting even if some fail', async () => {
    // First deletion fails (object exists but delete throws), second succeeds
    mockObjectsApi.get.mockResolvedValue({
      id: 'eq-1',
      type: 'equation',
      sheetId: 'sheet-1',
      delete: () => mockObjectsApi.delete('eq-1'),
    });
    mockObjectsApi.delete
      .mockRejectedValueOnce(new Error('Not found'))
      .mockResolvedValueOnce({ success: true });

    const deps = createMockDepsWithSelectedObjects(['eq-1', 'eq-2']);
    const result = await EquationHandlers.DELETE_EQUATION(deps, {});

    // Should still be handled because at least one succeeded
    expect(result.handled).toBe(true);
    expect(mockObjectsApi.delete).toHaveBeenCalledTimes(2);
  });
});
