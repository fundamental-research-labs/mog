/**
 * Diagram Action Handlers Tests
 *
 * Unit tests for Diagram action handlers in the Unified Action System.
 * Tests verify:
 * - Handler behavior and return values (handled/not_handled)
 * - Payload validation and error handling
 * - Correct delegation to Worksheet API (ws.diagrams.*)
 * - UIStore state updates
 *
 * Test categories:
 * - Diagram lifecycle actions (INSERT, DELETE)
 * - Node operations (ADD_NODE, REMOVE_NODE, UPDATE_NODE)
 * - Node hierarchy operations (PROMOTE_NODE, DEMOTE_NODE, MOVE_NODE_UP, MOVE_NODE_DOWN)
 * - Style operations (UPDATE_STYLE, UPDATE_LAYOUT)
 * - UI actions (OPEN_DIALOG, CLOSE_DIALOG, SELECT_NODE, TEXT_PANE, STOP_EDITING)
 *
 */

import { jest } from '@jest/globals';

import type { ActionDependencies } from '@mog-sdk/contracts/actions';
import { sheetId } from '@mog-sdk/contracts/core';

import * as DiagramHandlers from '../diagram';
import { createMockPlatform, createMockShellService } from './test-helpers';

// =============================================================================
// TEST UTILITIES
// =============================================================================

// Mock Diagram sub-API (ws.diagrams.*)
const mockDiagramApi = {
  add: jest.fn().mockResolvedValue({ id: 'diagram-new' }),
  get: jest.fn().mockResolvedValue({ layoutId: 'hierarchy/org-chart', nodes: new Map() }),
  remove: jest.fn().mockResolvedValue(undefined),
  list: jest.fn().mockResolvedValue([]),
  duplicate: jest.fn().mockResolvedValue('diagram-dup'),
  addNode: jest.fn().mockResolvedValue('node-new'),
  removeNode: jest.fn().mockResolvedValue(undefined),
  updateNode: jest.fn().mockResolvedValue(undefined),
  moveNode: jest.fn().mockResolvedValue(undefined),
  changeLayout: jest.fn().mockResolvedValue(undefined),
  changeQuickStyle: jest.fn().mockResolvedValue(undefined),
  changeColorTheme: jest.fn().mockResolvedValue(undefined),
  getComputedLayout: jest.fn().mockReturnValue(undefined),
  invalidateLayout: jest.fn(),
  invalidateAllLayouts: jest.fn(),
};

// Mock worksheet returned by workbook.getSheetById()
const mockObjectsApi = {
  get: jest.fn().mockResolvedValue({
    id: 'diagram-1',
    type: 'diagram',
    delete: jest
      .fn()
      .mockResolvedValue({ domain: 'floatingObject', action: 'remove', id: 'diagram-1' }),
  }),
};
const mockWs = {
  objects: mockObjectsApi,
  diagrams: mockDiagramApi,
};

const mockWorkbook = {
  getSheetById: jest.fn(() => mockWs),
  setPendingUndoDescription: jest.fn(),
};

// Store mock function references for assertions
const mockUIStoreMethods = {
  selectDiagram: jest.fn(),
  deselectDiagram: jest.fn(),
  openDiagramDialog: jest.fn(),
  closeDiagramDialog: jest.fn(),
  selectNode: jest.fn(),
  deselectNodes: jest.fn(),
  toggleTextPane: jest.fn(),
  stopEditingNode: jest.fn(),
};

/**
 * Create minimal mock action dependencies for testing.
 */
function createMockDeps(overrides?: Partial<ActionDependencies>): ActionDependencies & {
  mockUIStoreMethods: typeof mockUIStoreMethods;
} {
  // Reset mock functions before each test
  Object.values(mockUIStoreMethods).forEach((fn) => fn.mockClear());

  // Create mock UIStore with Diagram state - methods are on the getState() return value
  const mockUIStore = {
    getState: () => ({
      diagram: {
        dialogOpen: false,
        selectedNodeId: null,
        editingNodeId: null,
        textPaneVisible: true,
      },
      ...mockUIStoreMethods,
    }),
  };

  // Create mock ctx
  const mockCtx = {
    eventBus: {
      emit: jest.fn(),
      on: jest.fn(() => () => {}),
      off: jest.fn(),
    },
  };

  return {
    ctx: mockCtx,
    uiStore: mockUIStore,
    workbook: mockWorkbook,
    getActiveSheetId: () => sheetId('sheet-1'),
    onUIAction: jest.fn(),
    accessors: {
      selection: {},
      editor: {},
      clipboard: {},
      chart: {},
      object: {},
    },
    commands: {
      selection: {},
      editor: {},
      clipboard: {},
      chart: {},
      object: {},
    },
    // required deps.
    platform: createMockPlatform(),
    shellService: createMockShellService(),
    mockUIStoreMethods,
    ...overrides,
  } as unknown as ActionDependencies & { mockUIStoreMethods: typeof mockUIStoreMethods };
}

// Reset mocks between tests
beforeEach(() => {
  jest.clearAllMocks();
  mockDiagramApi.add.mockResolvedValue({ id: 'diagram-new' });
  mockDiagramApi.get.mockResolvedValue({ layoutId: 'hierarchy/org-chart', nodes: new Map() });
  mockDiagramApi.addNode.mockResolvedValue('node-new');
});

// =============================================================================
// DIAGRAM LIFECYCLE ACTIONS
// =============================================================================

describe('Diagram Handlers - Lifecycle Actions', () => {
  describe('DIAGRAM_INSERT', () => {
    it('should return handled when layoutId is provided', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_INSERT(deps, {
        layoutId: 'hierarchy/org-chart',
        position: { x: 100, y: 100 },
      });

      expect(result.handled).toBe(true);
    });

    it('should return error when layoutId is missing', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_INSERT(deps, {
        position: { x: 100, y: 100 },
      });

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing layoutId in payload');
    });

    it('should return error when payload is undefined', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_INSERT(deps, undefined);

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing layoutId in payload');
    });

    it('should use default position when not provided', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_INSERT(deps, {
        layoutId: 'hierarchy/org-chart',
      });

      expect(result.handled).toBe(true);
    });

    it('should select newly created Diagram', async () => {
      const deps = createMockDeps();
      await DiagramHandlers.DIAGRAM_INSERT(deps, {
        layoutId: 'hierarchy/org-chart',
      });

      expect(deps.mockUIStoreMethods.selectDiagram).toHaveBeenCalled();
    });

    it('should close dialog after insertion', async () => {
      const deps = createMockDeps();
      await DiagramHandlers.DIAGRAM_INSERT(deps, {
        layoutId: 'hierarchy/org-chart',
      });

      expect(deps.mockUIStoreMethods.closeDiagramDialog).toHaveBeenCalled();
    });
  });

  describe('DIAGRAM_DELETE', () => {
    it('should return handled when objectId is provided', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_DELETE(deps, {
        objectId: 'diagram-1',
      });

      expect(result.handled).toBe(true);
    });

    it('should return error when objectId is missing', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_DELETE(deps, {});

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing objectId in payload');
    });

    it('should return error when payload is undefined', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_DELETE(deps, undefined);

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing objectId in payload');
    });

    it('should deselect Diagram after deletion', async () => {
      const deps = createMockDeps();
      await DiagramHandlers.DIAGRAM_DELETE(deps, {
        objectId: 'diagram-1',
      });

      expect(deps.mockUIStoreMethods.deselectDiagram).toHaveBeenCalled();
    });
  });
});

// =============================================================================
// NODE OPERATION ACTIONS
// =============================================================================

describe('Diagram Handlers - Node Operations', () => {
  describe('DIAGRAM_ADD_NODE', () => {
    it('should return handled when objectId is provided', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_ADD_NODE(deps, {
        objectId: 'diagram-1',
        text: 'New Node',
        position: 'after',
        referenceNodeId: 'node-1',
      });

      expect(result.handled).toBe(true);
    });

    it('should return error when objectId is missing', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_ADD_NODE(deps, {
        text: 'New Node',
      });

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing objectId in payload');
    });

    it('should use default position "after" when not specified', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_ADD_NODE(deps, {
        objectId: 'diagram-1',
      });

      expect(result.handled).toBe(true);
    });

    it('should use empty string for text when not specified', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_ADD_NODE(deps, {
        objectId: 'diagram-1',
        position: 'after',
      });

      expect(result.handled).toBe(true);
    });

    it('should select newly created node', async () => {
      const deps = createMockDeps();
      await DiagramHandlers.DIAGRAM_ADD_NODE(deps, {
        objectId: 'diagram-1',
        text: 'New Node',
      });

      expect(deps.mockUIStoreMethods.selectNode).toHaveBeenCalled();
    });
  });

  describe('DIAGRAM_REMOVE_NODE', () => {
    it('should return handled when objectId and nodeId are provided', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_REMOVE_NODE(deps, {
        objectId: 'diagram-1',
        nodeId: 'node-1',
      });

      expect(result.handled).toBe(true);
    });

    it('should return error when objectId is missing', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_REMOVE_NODE(deps, {
        nodeId: 'node-1',
      });

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing objectId in payload');
    });

    it('should return error when nodeId is missing', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_REMOVE_NODE(deps, {
        objectId: 'diagram-1',
      });

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing nodeId in payload');
    });

    it('should deselect nodes after removal', async () => {
      const deps = createMockDeps();
      await DiagramHandlers.DIAGRAM_REMOVE_NODE(deps, {
        objectId: 'diagram-1',
        nodeId: 'node-1',
      });

      expect(deps.mockUIStoreMethods.deselectNodes).toHaveBeenCalled();
    });
  });

  describe('DIAGRAM_UPDATE_NODE', () => {
    it('should return handled when all required fields are provided', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_UPDATE_NODE(deps, {
        objectId: 'diagram-1',
        nodeId: 'node-1',
        updates: { text: 'Updated Text' },
      });

      expect(result.handled).toBe(true);
    });

    it('should return error when objectId is missing', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_UPDATE_NODE(deps, {
        nodeId: 'node-1',
        updates: { text: 'Updated' },
      });

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing objectId in payload');
    });

    it('should return error when nodeId is missing', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_UPDATE_NODE(deps, {
        objectId: 'diagram-1',
        updates: { text: 'Updated' },
      });

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing nodeId in payload');
    });

    it('should return error when updates is missing', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_UPDATE_NODE(deps, {
        objectId: 'diagram-1',
        nodeId: 'node-1',
      });

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing updates in payload');
    });
  });
});

// =============================================================================
// NODE HIERARCHY OPERATIONS
// =============================================================================

describe('Diagram Handlers - Node Hierarchy Operations', () => {
  describe('DIAGRAM_PROMOTE_NODE', () => {
    it('should return handled when objectId and nodeId are provided', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_PROMOTE_NODE(deps, {
        objectId: 'diagram-1',
        nodeId: 'node-1',
      });

      expect(result.handled).toBe(true);
      expect(mockDiagramApi.moveNode).toHaveBeenCalledWith('diagram-1', 'node-1', 'promote');
    });

    it('should return error when objectId is missing', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_PROMOTE_NODE(deps, {
        nodeId: 'node-1',
      });

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing objectId in payload');
    });

    it('should return error when nodeId is missing', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_PROMOTE_NODE(deps, {
        objectId: 'diagram-1',
      });

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing nodeId in payload');
    });
  });

  describe('DIAGRAM_DEMOTE_NODE', () => {
    it('should return handled when objectId and nodeId are provided', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_DEMOTE_NODE(deps, {
        objectId: 'diagram-1',
        nodeId: 'node-1',
      });

      expect(result.handled).toBe(true);
      expect(mockDiagramApi.moveNode).toHaveBeenCalledWith('diagram-1', 'node-1', 'demote');
    });

    it('should return error when objectId is missing', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_DEMOTE_NODE(deps, {
        nodeId: 'node-1',
      });

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing objectId in payload');
    });

    it('should return error when nodeId is missing', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_DEMOTE_NODE(deps, {
        objectId: 'diagram-1',
      });

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing nodeId in payload');
    });
  });

  describe('DIAGRAM_MOVE_NODE_UP', () => {
    it('should return handled when objectId and nodeId are provided', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_MOVE_NODE_UP(deps, {
        objectId: 'diagram-1',
        nodeId: 'node-1',
      });

      expect(result.handled).toBe(true);
      expect(mockDiagramApi.moveNode).toHaveBeenCalledWith('diagram-1', 'node-1', 'move-up');
    });

    it('should return error when objectId is missing', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_MOVE_NODE_UP(deps, {
        nodeId: 'node-1',
      });

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing objectId in payload');
    });

    it('should return error when nodeId is missing', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_MOVE_NODE_UP(deps, {
        objectId: 'diagram-1',
      });

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing nodeId in payload');
    });
  });

  describe('DIAGRAM_MOVE_NODE_DOWN', () => {
    it('should return handled when objectId and nodeId are provided', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_MOVE_NODE_DOWN(deps, {
        objectId: 'diagram-1',
        nodeId: 'node-1',
      });

      expect(result.handled).toBe(true);
      expect(mockDiagramApi.moveNode).toHaveBeenCalledWith('diagram-1', 'node-1', 'move-down');
    });

    it('should return error when objectId is missing', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_MOVE_NODE_DOWN(deps, {
        nodeId: 'node-1',
      });

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing objectId in payload');
    });

    it('should return error when nodeId is missing', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_MOVE_NODE_DOWN(deps, {
        objectId: 'diagram-1',
      });

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing nodeId in payload');
    });
  });
});

// =============================================================================
// STYLE OPERATION ACTIONS
// =============================================================================

describe('Diagram Handlers - Style Operations', () => {
  describe('DIAGRAM_UPDATE_STYLE', () => {
    it('should return handled when quickStyleId is provided', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_UPDATE_STYLE(deps, {
        objectId: 'diagram-1',
        quickStyleId: 'intense-effect',
      });

      expect(result.handled).toBe(true);
    });

    it('should return handled when colorThemeId is provided', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_UPDATE_STYLE(deps, {
        objectId: 'diagram-1',
        colorThemeId: 'accent-2',
      });

      expect(result.handled).toBe(true);
    });

    it('should return handled when both quickStyleId and colorThemeId are provided', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_UPDATE_STYLE(deps, {
        objectId: 'diagram-1',
        quickStyleId: 'intense-effect',
        colorThemeId: 'accent-2',
      });

      expect(result.handled).toBe(true);
    });

    it('should return error when objectId is missing', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_UPDATE_STYLE(deps, {
        quickStyleId: 'intense-effect',
      });

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing objectId in payload');
    });

    it('should return error when neither quickStyleId nor colorThemeId provided', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_UPDATE_STYLE(deps, {
        objectId: 'diagram-1',
      });

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Must provide quickStyleId or colorThemeId');
    });
  });

  describe('DIAGRAM_UPDATE_LAYOUT', () => {
    it('should return handled when objectId and layoutId are provided', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_UPDATE_LAYOUT(deps, {
        objectId: 'diagram-1',
        layoutId: 'process/basic-process',
      });

      expect(result.handled).toBe(true);
    });

    it('should return error when objectId is missing', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_UPDATE_LAYOUT(deps, {
        layoutId: 'process/basic-process',
      });

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing objectId in payload');
    });

    it('should return error when layoutId is missing', async () => {
      const deps = createMockDeps();
      const result = await DiagramHandlers.DIAGRAM_UPDATE_LAYOUT(deps, {
        objectId: 'diagram-1',
      });

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing layoutId in payload');
    });
  });
});

// =============================================================================
// UI DIALOG ACTIONS
// =============================================================================

describe('Diagram Handlers - Dialog Actions', () => {
  describe('OPEN_DIAGRAM_DIALOG', () => {
    it('should return handled and call openDiagramDialog', async () => {
      const deps = createMockDeps();
      const result = DiagramHandlers.OPEN_DIAGRAM_DIALOG(deps);

      expect(result.handled).toBe(true);
      expect(deps.mockUIStoreMethods.openDiagramDialog).toHaveBeenCalled();
    });

    it('should return disabled when uiStore is not available', async () => {
      const deps = createMockDeps({ uiStore: undefined });
      const result = DiagramHandlers.OPEN_DIAGRAM_DIALOG(deps);

      expect(result.handled).toBe(false);
      expect(result.reason).toBe('disabled');
    });
  });

  describe('CLOSE_DIAGRAM_DIALOG', () => {
    it('should return handled and call closeDiagramDialog', async () => {
      const deps = createMockDeps();
      const result = DiagramHandlers.CLOSE_DIAGRAM_DIALOG(deps);

      expect(result.handled).toBe(true);
      expect(deps.mockUIStoreMethods.closeDiagramDialog).toHaveBeenCalled();
    });

    it('should return disabled when uiStore is not available', async () => {
      const deps = createMockDeps({ uiStore: undefined });
      const result = DiagramHandlers.CLOSE_DIAGRAM_DIALOG(deps);

      expect(result.handled).toBe(false);
      expect(result.reason).toBe('disabled');
    });
  });
});

// =============================================================================
// UI SELECTION ACTIONS
// =============================================================================

describe('Diagram Handlers - Selection Actions', () => {
  describe('DIAGRAM_SELECT_NODE', () => {
    it('should return handled when nodeId is provided', async () => {
      const deps = createMockDeps();
      const result = DiagramHandlers.DIAGRAM_SELECT_NODE(deps, {
        nodeId: 'node-1',
      });

      expect(result.handled).toBe(true);
      expect(deps.mockUIStoreMethods.selectNode).toHaveBeenCalledWith('node-1');
    });

    it('should return error when nodeId is missing', async () => {
      const deps = createMockDeps();
      const result = DiagramHandlers.DIAGRAM_SELECT_NODE(deps, {});

      expect(result.handled).toBe(false);
      expect(result.error).toBe('Missing nodeId in payload');
    });

    it('should return disabled when uiStore is not available', async () => {
      const deps = createMockDeps({ uiStore: undefined });
      const result = DiagramHandlers.DIAGRAM_SELECT_NODE(deps, {
        nodeId: 'node-1',
      });

      expect(result.handled).toBe(false);
      expect(result.reason).toBe('disabled');
    });
  });

  describe('DIAGRAM_DESELECT_NODE', () => {
    it('should return handled and call deselectNodes', async () => {
      const deps = createMockDeps();
      const result = DiagramHandlers.DIAGRAM_DESELECT_NODE(deps);

      expect(result.handled).toBe(true);
      expect(deps.mockUIStoreMethods.deselectNodes).toHaveBeenCalled();
    });

    it('should return disabled when uiStore is not available', async () => {
      const deps = createMockDeps({ uiStore: undefined });
      const result = DiagramHandlers.DIAGRAM_DESELECT_NODE(deps);

      expect(result.handled).toBe(false);
      expect(result.reason).toBe('disabled');
    });
  });
});

// =============================================================================
// UI TEXT PANE ACTIONS
// =============================================================================

describe('Diagram Handlers - Text Pane Actions', () => {
  describe('TOGGLE_DIAGRAM_TEXT_PANE', () => {
    it('should return handled and call toggleTextPane', async () => {
      const deps = createMockDeps();
      const result = DiagramHandlers.TOGGLE_DIAGRAM_TEXT_PANE(deps);

      expect(result.handled).toBe(true);
      expect(deps.mockUIStoreMethods.toggleTextPane).toHaveBeenCalled();
    });

    it('should return disabled when uiStore is not available', async () => {
      const deps = createMockDeps({ uiStore: undefined });
      const result = DiagramHandlers.TOGGLE_DIAGRAM_TEXT_PANE(deps);

      expect(result.handled).toBe(false);
      expect(result.reason).toBe('disabled');
    });
  });
});

// =============================================================================
// STOP EDITING ACTION
// =============================================================================

describe('Diagram Handlers - Stop Editing', () => {
  describe('DIAGRAM_STOP_EDITING', () => {
    it('should return handled and call stopEditingNode', async () => {
      const deps = createMockDeps();
      const result = DiagramHandlers.DIAGRAM_STOP_EDITING(deps);

      expect(result.handled).toBe(true);
      expect(deps.mockUIStoreMethods.stopEditingNode).toHaveBeenCalled();
    });

    it('should return disabled when uiStore is not available', async () => {
      const deps = createMockDeps({ uiStore: undefined });
      const result = DiagramHandlers.DIAGRAM_STOP_EDITING(deps);

      expect(result.handled).toBe(false);
      expect(result.reason).toBe('disabled');
    });
  });
});

// =============================================================================
// HANDLER RESULT PATTERN VERIFICATION
// =============================================================================

describe('Diagram Handlers - Pattern Verification', () => {
  it('all handlers should be exported as functions', async () => {
    expect(typeof DiagramHandlers.DIAGRAM_INSERT).toBe('function');
    expect(typeof DiagramHandlers.DIAGRAM_DELETE).toBe('function');
    expect(typeof DiagramHandlers.DIAGRAM_ADD_NODE).toBe('function');
    expect(typeof DiagramHandlers.DIAGRAM_REMOVE_NODE).toBe('function');
    expect(typeof DiagramHandlers.DIAGRAM_UPDATE_NODE).toBe('function');
    expect(typeof DiagramHandlers.DIAGRAM_UPDATE_STYLE).toBe('function');
    expect(typeof DiagramHandlers.DIAGRAM_UPDATE_LAYOUT).toBe('function');
    expect(typeof DiagramHandlers.DIAGRAM_PROMOTE_NODE).toBe('function');
    expect(typeof DiagramHandlers.DIAGRAM_DEMOTE_NODE).toBe('function');
    expect(typeof DiagramHandlers.DIAGRAM_MOVE_NODE_UP).toBe('function');
    expect(typeof DiagramHandlers.DIAGRAM_MOVE_NODE_DOWN).toBe('function');
    expect(typeof DiagramHandlers.DIAGRAM_STOP_EDITING).toBe('function');
    expect(typeof DiagramHandlers.OPEN_DIAGRAM_DIALOG).toBe('function');
    expect(typeof DiagramHandlers.CLOSE_DIAGRAM_DIALOG).toBe('function');
    expect(typeof DiagramHandlers.DIAGRAM_SELECT_NODE).toBe('function');
    expect(typeof DiagramHandlers.DIAGRAM_DESELECT_NODE).toBe('function');
    expect(typeof DiagramHandlers.TOGGLE_DIAGRAM_TEXT_PANE).toBe('function');
  });

  it('all handlers should return ActionResult with handled property', async () => {
    const deps = createMockDeps();

    // Test successful calls return handled: true
    expect((await DiagramHandlers.DIAGRAM_INSERT(deps, { layoutId: 'test' })).handled).toBe(true);
    expect((await DiagramHandlers.DIAGRAM_DELETE(deps, { objectId: 'test' })).handled).toBe(true);
    expect((await DiagramHandlers.DIAGRAM_ADD_NODE(deps, { objectId: 'test' })).handled).toBe(true);
    expect(
      (await DiagramHandlers.DIAGRAM_REMOVE_NODE(deps, { objectId: 'test', nodeId: 'node' }))
        .handled,
    ).toBe(true);
    expect(
      (
        await DiagramHandlers.DIAGRAM_UPDATE_NODE(deps, {
          objectId: 'test',
          nodeId: 'node',
          updates: {},
        })
      ).handled,
    ).toBe(true);
    expect(
      (
        await DiagramHandlers.DIAGRAM_UPDATE_STYLE(deps, {
          objectId: 'test',
          quickStyleId: 'style',
        })
      ).handled,
    ).toBe(true);
    expect(
      (
        await DiagramHandlers.DIAGRAM_UPDATE_LAYOUT(deps, {
          objectId: 'test',
          layoutId: 'layout',
        })
      ).handled,
    ).toBe(true);
    expect(
      (
        await DiagramHandlers.DIAGRAM_PROMOTE_NODE(deps, {
          objectId: 'test',
          nodeId: 'node',
        })
      ).handled,
    ).toBe(true);
    expect(
      (
        await DiagramHandlers.DIAGRAM_DEMOTE_NODE(deps, {
          objectId: 'test',
          nodeId: 'node',
        })
      ).handled,
    ).toBe(true);
    expect(
      (
        await DiagramHandlers.DIAGRAM_MOVE_NODE_UP(deps, {
          objectId: 'test',
          nodeId: 'node',
        })
      ).handled,
    ).toBe(true);
    expect(
      (
        await DiagramHandlers.DIAGRAM_MOVE_NODE_DOWN(deps, {
          objectId: 'test',
          nodeId: 'node',
        })
      ).handled,
    ).toBe(true);
    expect(DiagramHandlers.OPEN_DIAGRAM_DIALOG(deps).handled).toBe(true);
    expect(DiagramHandlers.CLOSE_DIAGRAM_DIALOG(deps).handled).toBe(true);
    expect(DiagramHandlers.DIAGRAM_SELECT_NODE(deps, { nodeId: 'node' }).handled).toBe(true);
    expect(DiagramHandlers.DIAGRAM_DESELECT_NODE(deps).handled).toBe(true);
    expect(DiagramHandlers.TOGGLE_DIAGRAM_TEXT_PANE(deps).handled).toBe(true);
    expect(DiagramHandlers.DIAGRAM_STOP_EDITING(deps).handled).toBe(true);
  });

  it('handlers with missing required params should return handled: false', async () => {
    const deps = createMockDeps();

    // Test missing required parameters return handled: false
    expect((await DiagramHandlers.DIAGRAM_INSERT(deps, {})).handled).toBe(false);
    expect((await DiagramHandlers.DIAGRAM_DELETE(deps, {})).handled).toBe(false);
    expect((await DiagramHandlers.DIAGRAM_ADD_NODE(deps, {})).handled).toBe(false);
    expect((await DiagramHandlers.DIAGRAM_REMOVE_NODE(deps, {})).handled).toBe(false);
    expect((await DiagramHandlers.DIAGRAM_REMOVE_NODE(deps, { objectId: 'test' })).handled).toBe(
      false,
    );
    expect((await DiagramHandlers.DIAGRAM_UPDATE_NODE(deps, {})).handled).toBe(false);
    expect((await DiagramHandlers.DIAGRAM_UPDATE_STYLE(deps, {})).handled).toBe(false);
    expect((await DiagramHandlers.DIAGRAM_UPDATE_STYLE(deps, { objectId: 'test' })).handled).toBe(
      false,
    );
    expect((await DiagramHandlers.DIAGRAM_UPDATE_LAYOUT(deps, {})).handled).toBe(false);
    expect((await DiagramHandlers.DIAGRAM_UPDATE_LAYOUT(deps, { objectId: 'test' })).handled).toBe(
      false,
    );
    expect((await DiagramHandlers.DIAGRAM_PROMOTE_NODE(deps, {})).handled).toBe(false);
    expect((await DiagramHandlers.DIAGRAM_PROMOTE_NODE(deps, { objectId: 'test' })).handled).toBe(
      false,
    );
    expect((await DiagramHandlers.DIAGRAM_DEMOTE_NODE(deps, {})).handled).toBe(false);
    expect((await DiagramHandlers.DIAGRAM_DEMOTE_NODE(deps, { objectId: 'test' })).handled).toBe(
      false,
    );
    expect((await DiagramHandlers.DIAGRAM_MOVE_NODE_UP(deps, {})).handled).toBe(false);
    expect((await DiagramHandlers.DIAGRAM_MOVE_NODE_UP(deps, { objectId: 'test' })).handled).toBe(
      false,
    );
    expect((await DiagramHandlers.DIAGRAM_MOVE_NODE_DOWN(deps, {})).handled).toBe(false);
    expect((await DiagramHandlers.DIAGRAM_MOVE_NODE_DOWN(deps, { objectId: 'test' })).handled).toBe(
      false,
    );
    expect(DiagramHandlers.DIAGRAM_SELECT_NODE(deps, {}).handled).toBe(false);
  });

  it('UI handlers should return disabled when uiStore is unavailable', async () => {
    const deps = createMockDeps({ uiStore: undefined });

    expect(DiagramHandlers.OPEN_DIAGRAM_DIALOG(deps).reason).toBe('disabled');
    expect(DiagramHandlers.CLOSE_DIAGRAM_DIALOG(deps).reason).toBe('disabled');
    expect(DiagramHandlers.DIAGRAM_SELECT_NODE(deps, { nodeId: 'node' }).reason).toBe('disabled');
    expect(DiagramHandlers.DIAGRAM_DESELECT_NODE(deps).reason).toBe('disabled');
    expect(DiagramHandlers.TOGGLE_DIAGRAM_TEXT_PANE(deps).reason).toBe('disabled');
    expect(DiagramHandlers.DIAGRAM_STOP_EDITING(deps).reason).toBe('disabled');
  });
});

// =============================================================================
// ERROR MESSAGE VERIFICATION
// =============================================================================

describe('Diagram Handlers - Error Messages', () => {
  it('should provide clear error messages for missing parameters', async () => {
    const deps = createMockDeps();

    expect((await DiagramHandlers.DIAGRAM_INSERT(deps, {})).error).toBe(
      'Missing layoutId in payload',
    );
    expect((await DiagramHandlers.DIAGRAM_DELETE(deps, {})).error).toBe(
      'Missing objectId in payload',
    );
    expect((await DiagramHandlers.DIAGRAM_ADD_NODE(deps, {})).error).toBe(
      'Missing objectId in payload',
    );
    expect((await DiagramHandlers.DIAGRAM_REMOVE_NODE(deps, {})).error).toBe(
      'Missing objectId in payload',
    );
    expect((await DiagramHandlers.DIAGRAM_REMOVE_NODE(deps, { objectId: 'test' })).error).toBe(
      'Missing nodeId in payload',
    );
    expect((await DiagramHandlers.DIAGRAM_UPDATE_NODE(deps, {})).error).toBe(
      'Missing objectId in payload',
    );
    expect((await DiagramHandlers.DIAGRAM_UPDATE_NODE(deps, { objectId: 'test' })).error).toBe(
      'Missing nodeId in payload',
    );
    expect(
      (await DiagramHandlers.DIAGRAM_UPDATE_NODE(deps, { objectId: 'test', nodeId: 'node' })).error,
    ).toBe('Missing updates in payload');
    expect((await DiagramHandlers.DIAGRAM_UPDATE_STYLE(deps, {})).error).toBe(
      'Missing objectId in payload',
    );
    expect((await DiagramHandlers.DIAGRAM_UPDATE_STYLE(deps, { objectId: 'test' })).error).toBe(
      'Must provide quickStyleId or colorThemeId',
    );
    expect((await DiagramHandlers.DIAGRAM_UPDATE_LAYOUT(deps, {})).error).toBe(
      'Missing objectId in payload',
    );
    expect((await DiagramHandlers.DIAGRAM_UPDATE_LAYOUT(deps, { objectId: 'test' })).error).toBe(
      'Missing layoutId in payload',
    );
    expect((await DiagramHandlers.DIAGRAM_PROMOTE_NODE(deps, {})).error).toBe(
      'Missing objectId in payload',
    );
    expect((await DiagramHandlers.DIAGRAM_PROMOTE_NODE(deps, { objectId: 'test' })).error).toBe(
      'Missing nodeId in payload',
    );
    expect((await DiagramHandlers.DIAGRAM_DEMOTE_NODE(deps, {})).error).toBe(
      'Missing objectId in payload',
    );
    expect((await DiagramHandlers.DIAGRAM_DEMOTE_NODE(deps, { objectId: 'test' })).error).toBe(
      'Missing nodeId in payload',
    );
    expect((await DiagramHandlers.DIAGRAM_MOVE_NODE_UP(deps, {})).error).toBe(
      'Missing objectId in payload',
    );
    expect((await DiagramHandlers.DIAGRAM_MOVE_NODE_UP(deps, { objectId: 'test' })).error).toBe(
      'Missing nodeId in payload',
    );
    expect((await DiagramHandlers.DIAGRAM_MOVE_NODE_DOWN(deps, {})).error).toBe(
      'Missing objectId in payload',
    );
    expect((await DiagramHandlers.DIAGRAM_MOVE_NODE_DOWN(deps, { objectId: 'test' })).error).toBe(
      'Missing nodeId in payload',
    );
    expect(DiagramHandlers.DIAGRAM_SELECT_NODE(deps, {}).error).toBe('Missing nodeId in payload');
  });
});
