/**
 * Diagram Mutations Tests
 *
 * Unit tests for Diagram mutation functions that orchestrate write operations.
 * Tests verify:
 * - Correct mutation behavior and return values
 * - Event emission via EventBus
 * - Error handling for missing objects/nodes
 * - Boundary conditions for node movement operations
 *
 * Test categories:
 * - createDiagram() - Diagram creation with default nodes
 * - deleteDiagram() - Diagram deletion
 * - addNode() - Node addition at various positions
 * - removeNode() - Node removal with edge cases
 * - updateNode() - Text and property updates
 * - moveNode() - Promote/demote/up/down with boundary conditions
 * - changeLayout() - Layout changes with compatible/incompatible layouts
 * - changeQuickStyle() / changeColorTheme() - Style updates
 *
 */

import { jest } from '@jest/globals';

import type { NodeMoveDirection, NodePosition, WorksheetDiagrams } from '@mog-sdk/contracts/api';
import { toCellId } from '@mog-sdk/contracts/cell-identity';
import { sheetId } from '@mog-sdk/contracts/core';
import type { DiagramObject } from '@mog-sdk/contracts/floating-objects';
import type { NodeId, Diagram, DiagramNode } from '@mog-sdk/contracts/diagram';

import * as DiagramMutations from '../diagram';

const SHEET_ID = sheetId('sheet-1');

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Create a mock Diagram node.
 */
function createMockNode(
  id: string,
  text: string,
  level: number = 0,
  parentId: string | null = null,
  childIds: string[] = [],
): DiagramNode {
  return {
    id: id as NodeId,
    text,
    level,
    parentId: parentId as NodeId | null,
    childIds: childIds as NodeId[],
    siblingOrder: 0,
  };
}

/**
 * Create a mock Diagram diagram.
 */
function createMockDiagram(nodeCount: number = 3): Diagram {
  const nodes = new Map<NodeId, DiagramNode>();
  const rootNodeIds: NodeId[] = [];

  // Create a simple hierarchy: root -> child1, child2
  const rootNode = createMockNode('node-1', 'Root', 0, null, ['node-2', 'node-3']);
  nodes.set('node-1' as NodeId, rootNode);
  rootNodeIds.push('node-1' as NodeId);

  if (nodeCount >= 2) {
    const child1 = createMockNode('node-2', 'Child 1', 1, 'node-1', []);
    nodes.set('node-2' as NodeId, child1);
  }

  if (nodeCount >= 3) {
    const child2 = createMockNode('node-3', 'Child 2', 1, 'node-1', []);
    nodes.set('node-3' as NodeId, child2);
  }

  return {
    layoutId: 'hierarchy/org-chart',
    category: 'hierarchy',
    nodes,
    rootNodeIds,
    quickStyleId: 'subtle-effect',
    colorThemeId: 'colorful-1',
    layoutOptions: {},
  };
}

/**
 * Create a mock Diagram object.
 */
function createMockDiagramObject(objectId: string, sheetIdValue: string): DiagramObject {
  const sid = sheetId(sheetIdValue);
  const position = {
    anchorType: 'oneCell' as const,
    from: { cellId: toCellId('cell-0-0'), xOffset: 100, yOffset: 100 },
    x: 100,
    y: 100,
    width: 400,
    height: 300,
  };

  return {
    id: objectId,
    sheetId: sid,
    containerId: sid,
    type: 'diagram' as const,
    diagram: createMockDiagram(),
    position,
    anchor: position,
    zIndex: 0,
    locked: false,
    printable: true,
  };
}

/**
 * Create a mock handle for a floating object.
 */
function createMockHandle(
  objectId: string,
  obj: ReturnType<typeof createMockDiagramObject>,
  objectsMap: Map<string, ReturnType<typeof createMockDiagramObject>>,
  duplicateObject?: (objectId: string) => Promise<{ id: string }>,
) {
  return {
    id: objectId,
    type: 'diagram',
    delete: jest.fn(async () => {
      objectsMap.delete(objectId);
      return { id: objectId };
    }),
    duplicate: jest.fn(async (_offsetX?: number, _offsetY?: number) => {
      const duplicate = duplicateObject
        ? await duplicateObject(objectId)
        : { id: `${objectId}-copy` };
      const newId = duplicate.id;
      const dup = objectsMap.get(newId) ?? ({ ...obj, id: newId } as typeof obj);
      objectsMap.set(newId, dup);
      return {
        id: newId,
        type: 'diagram',
        delete: jest.fn(),
        duplicate: jest.fn(),
        getData: jest.fn(),
      };
    }),
    getData: jest.fn(async () => obj),
    move: jest.fn(),
    resize: jest.fn(),
    rotate: jest.fn(),
    flip: jest.fn(),
    bringToFront: jest.fn(),
    sendToBack: jest.fn(),
    bringForward: jest.fn(),
    sendBackward: jest.fn(),
    isPicture: () => false,
    isChart: () => false,
    isDiagram: () => true,
  };
}

/**
 * Create a mock Workbook with getSheetById() that returns a worksheet
 * with objects.get() and diagram.add() methods.
 */
function createMockWorkbook(
  diagramObjects: Map<string, ReturnType<typeof createMockDiagramObject>> = new Map(),
) {
  const emittedEvents: unknown[] = [];

  const mockDiagramAdd = jest.fn(
    async (config: {
      layoutId: string;
      x?: number;
      y?: number;
      width?: number;
      height?: number;
    }) => {
      const id = `diagram-${Date.now()}`;
      const obj = createMockDiagramObject(id, 'sheet-1');
      // Override diagram layoutId with config
      (obj.diagram as any).layoutId = config.layoutId;
      obj.position = {
        ...obj.position,
        x: config.x ?? obj.position.x,
        y: config.y ?? obj.position.y,
        width: config.width ?? obj.position.width,
        height: config.height ?? obj.position.height,
      };
      obj.anchor = obj.position;
      diagramObjects.set(id, obj);
      return obj;
    },
  );

  const mockObjectsDelete = jest.fn(async (objectId: string) => {
    diagramObjects.delete(objectId);
    return { id: objectId };
  });

  const mockObjectsDuplicate = jest.fn(async (objectId: string) => {
    const newId = `${objectId}-copy`;
    const original = diagramObjects.get(objectId);
    if (original) {
      diagramObjects.set(newId, { ...original, id: newId });
    }
    return { id: newId };
  });

  const mockObjectsGet = jest.fn(async (objectId: string) => {
    const obj = diagramObjects.get(objectId);
    if (!obj) return null;
    return createMockHandle(objectId, obj, diagramObjects, mockObjectsDuplicate);
  });

  const mockWorksheet = {
    objects: {
      get: mockObjectsGet,
      remove: mockObjectsDelete,
      duplicate: mockObjectsDuplicate,
    },
    diagrams: {
      add: mockDiagramAdd,
    },
  };

  return {
    setPendingUndoDescription: jest.fn(),
    emit: jest.fn((event: unknown) => {
      emittedEvents.push(event);
    }),
    getSheetById: jest.fn(() => mockWorksheet),
    getSheet: jest.fn(() => mockWorksheet),
    getEmittedEvents: () => emittedEvents,
    clearEvents: () => {
      emittedEvents.length = 0;
    },
    _mockWorksheet: mockWorksheet,
  } as unknown as import('@mog-sdk/contracts/api').WorkbookInternal & {
    emit: jest.Mock;
    getSheetById: jest.Mock;
    getSheet: jest.Mock;
    getEmittedEvents: () => unknown[];
    clearEvents: () => void;
    _mockWorksheet: typeof mockWorksheet;
  };
}

/**
 * Create a mock DiagramBridge.
 */
function createMockDiagramBridge(diagrams: Map<string, Diagram>): WorksheetDiagrams {
  let nodeCounter = 100;

  return {
    add: jest.fn(async () => createMockDiagramObject(`diagram-${Date.now()}`, 'sheet-1')),
    get: jest.fn(async () => null),
    remove: jest.fn(async () => {}),
    list: jest.fn(async () => []),
    duplicate: jest.fn(async () => `diagram-dup`),

    getDiagram: jest.fn((objectId: string) => diagrams.get(objectId) ?? null),
    getDiagramsOnSheet: jest.fn(() => Array.from(diagrams.values())),

    addNode: jest.fn(
      (objectId: string, text: string, _position: NodePosition, referenceNodeId: NodeId | null) => {
        const newNodeId = `node-${++nodeCounter}` as NodeId;
        const diagram = diagrams.get(objectId);
        if (diagram) {
          const newNode = createMockNode(newNodeId, text, 0, referenceNodeId);
          diagram.nodes.set(newNodeId, newNode);
        }
        return newNodeId;
      },
    ),

    removeNode: jest.fn((objectId: string, nodeId: NodeId) => {
      const diagram = diagrams.get(objectId);
      if (diagram) {
        diagram.nodes.delete(nodeId);
      }
    }),

    updateNode: jest.fn((objectId: string, nodeId: NodeId, updates: Partial<DiagramNode>) => {
      const diagram = diagrams.get(objectId);
      if (diagram) {
        const node = diagram.nodes.get(nodeId);
        if (node) {
          Object.assign(node, updates);
        }
      }
    }),

    moveNode: jest.fn((_objectId: string, _nodeId: NodeId, _direction: NodeMoveDirection) => {
      // Mock implementation - actual movement logic would be in bridge implementation
    }),

    getNode: jest.fn((objectId: string, nodeId: NodeId) => {
      const diagram = diagrams.get(objectId);
      return diagram?.nodes.get(nodeId);
    }),

    changeLayout: jest.fn((objectId: string, newLayoutId: string) => {
      const diagram = diagrams.get(objectId);
      if (diagram) {
        (diagram as any).layoutId = newLayoutId;
      }
    }),

    changeQuickStyle: jest.fn((objectId: string, quickStyleId: string) => {
      const diagram = diagrams.get(objectId);
      if (diagram) {
        (diagram as any).quickStyleId = quickStyleId;
      }
    }),

    changeColorTheme: jest.fn((objectId: string, colorThemeId: string) => {
      const diagram = diagrams.get(objectId);
      if (diagram) {
        (diagram as any).colorThemeId = colorThemeId;
      }
    }),

    getComputedLayout: jest.fn(() => undefined),
    invalidateLayout: jest.fn(),
    invalidateAllLayouts: jest.fn(),
  };
}

// =============================================================================
// CREATE DIAGRAM TESTS
// =============================================================================

describe('Diagram Mutations - createDiagram', () => {
  it('should create Diagram and return success result with objectId', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const wb = createMockWorkbook(diagramObjects);

    const result = await DiagramMutations.createDiagram(
      wb,
      SHEET_ID,
      { x: 100, y: 100, width: 400, height: 300 },
      'hierarchy/org-chart',
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBeDefined();
      expect(typeof result.value).toBe('string');
    }
  });

  it('should set pending undo description', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const wb = createMockWorkbook(diagramObjects);

    await DiagramMutations.createDiagram(wb, SHEET_ID, { x: 100, y: 100 }, 'hierarchy/org-chart');

    expect((wb as any).setPendingUndoDescription).toHaveBeenCalledWith('Insert Diagram');
  });

  it('should call ws.diagrams.add with correct config', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const wb = createMockWorkbook(diagramObjects);

    await DiagramMutations.createDiagram(wb, SHEET_ID, { x: 100, y: 100 }, 'hierarchy/org-chart');

    const mockWs = (wb as any)._mockWorksheet;
    expect(mockWs.diagrams.add).toHaveBeenCalledWith(
      expect.objectContaining({
        layoutId: 'hierarchy/org-chart',
        x: 100,
        y: 100,
      }),
    );
  });
});

// =============================================================================
// DELETE DIAGRAM TESTS
// =============================================================================

describe('Diagram Mutations - deleteDiagram', () => {
  it('should delete Diagram and return success', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);

    const result = await DiagramMutations.deleteDiagram(wb, SHEET_ID, 'diagram-1');

    expect(result.success).toBe(true);
    expect(diagramObjects.has('diagram-1')).toBe(false);
  });

  it('should set pending undo description', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);

    await DiagramMutations.deleteDiagram(wb, SHEET_ID, 'diagram-1');

    expect((wb as any).setPendingUndoDescription).toHaveBeenCalledWith('Delete Diagram');
  });

  it('should emit diagram:deleted event', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);

    await DiagramMutations.deleteDiagram(wb, SHEET_ID, 'diagram-1');

    const emittedEvent = (wb as any).getEmittedEvents()[0] as any;
    expect(emittedEvent.type).toBe('diagram:deleted');
    expect(emittedEvent.objectId).toBe('diagram-1');
    expect(emittedEvent.sheetId).toBe('sheet-1');
    expect(emittedEvent.source).toBe('user');
  });

  it('should return DIAGRAM_NOT_FOUND error when object does not exist', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const wb = createMockWorkbook(diagramObjects);

    const result = await DiagramMutations.deleteDiagram(wb, SHEET_ID, 'nonexistent');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('DIAGRAM_NOT_FOUND');
      expect(result.error.objectId).toBe('nonexistent');
    }
  });
});

// =============================================================================
// ADD NODE TESTS
// =============================================================================

describe('Diagram Mutations - addNode', () => {
  it('should add node and return success with new nodeId', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    const result = await DiagramMutations.addNode(
      wb,
      SHEET_ID,
      bridge,
      'diagram-1',
      'New Node',
      'after',
      'node-1' as NodeId,
    );

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBeDefined();
      expect(typeof result.value).toBe('string');
    }
  });

  it('should set pending undo description', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    await DiagramMutations.addNode(wb, SHEET_ID, bridge, 'diagram-1', 'New Node', 'after', null);

    expect((wb as any).setPendingUndoDescription).toHaveBeenCalledWith('Add Diagram node');
  });

  it('should emit diagram:node-added event', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    const result = await DiagramMutations.addNode(
      wb,
      SHEET_ID,
      bridge,
      'diagram-1',
      'New Node',
      'child',
      'node-1' as NodeId,
    );

    const emittedEvent = (wb as any).getEmittedEvents()[0] as any;
    expect(emittedEvent.type).toBe('diagram:node-added');
    expect(emittedEvent.objectId).toBe('diagram-1');
    expect(emittedEvent.position).toBe('child');
    expect(emittedEvent.parentId).toBe('node-1');
    if (result.success) {
      expect(emittedEvent.nodeId).toBe(result.value);
    }
  });

  it.each(['before', 'after', 'above', 'below', 'child'] as NodePosition[])(
    'should support position: %s',
    async (position) => {
      const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
      const obj = createMockDiagramObject('diagram-1', 'sheet-1');
      diagramObjects.set('diagram-1', obj);
      const wb = createMockWorkbook(diagramObjects);
      const diagrams = new Map([['diagram-1', obj.diagram]]);
      const bridge = createMockDiagramBridge(diagrams);

      const result = await DiagramMutations.addNode(
        wb,
        SHEET_ID,
        bridge,
        'diagram-1',
        'New Node',
        position,
        'node-1' as NodeId,
      );

      expect(result.success).toBe(true);
      expect(bridge.addNode).toHaveBeenCalledWith('diagram-1', 'New Node', position, 'node-1');
    },
  );

  it('should return DIAGRAM_NOT_FOUND error when object does not exist', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const wb = createMockWorkbook(diagramObjects);
    const bridge = createMockDiagramBridge(new Map());

    const result = await DiagramMutations.addNode(
      wb,
      SHEET_ID,
      bridge,
      'nonexistent',
      'New Node',
      'after',
      null,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('DIAGRAM_NOT_FOUND');
    }
  });

  it('should return BRIDGE_NOT_AVAILABLE error when bridge is undefined', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);

    const result = await DiagramMutations.addNode(
      wb,
      SHEET_ID,
      undefined,
      'diagram-1',
      'New Node',
      'after',
      null,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('BRIDGE_NOT_AVAILABLE');
    }
  });
});

// =============================================================================
// REMOVE NODE TESTS
// =============================================================================

describe('Diagram Mutations - removeNode', () => {
  it('should remove node and return success', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    const result = await DiagramMutations.removeNode(
      wb,
      SHEET_ID,
      bridge,
      'diagram-1',
      'node-2' as NodeId,
    );

    expect(result.success).toBe(true);
    expect(bridge.removeNode).toHaveBeenCalledWith('diagram-1', 'node-2');
  });

  it('should set pending undo description', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    await DiagramMutations.removeNode(wb, SHEET_ID, bridge, 'diagram-1', 'node-2' as NodeId);

    expect((wb as any).setPendingUndoDescription).toHaveBeenCalledWith('Remove Diagram node');
  });

  it('should emit diagram:node-removed event', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    await DiagramMutations.removeNode(wb, SHEET_ID, bridge, 'diagram-1', 'node-2' as NodeId);

    const emittedEvent = (wb as any).getEmittedEvents()[0] as any;
    expect(emittedEvent.type).toBe('diagram:node-removed');
    expect(emittedEvent.objectId).toBe('diagram-1');
    expect(emittedEvent.nodeId).toBe('node-2');
    expect(emittedEvent.source).toBe('user');
  });

  it('should return NODE_NOT_FOUND error when node does not exist', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    // Make bridge.getNode return undefined for nonexistent node
    (bridge.getNode as jest.Mock).mockReturnValueOnce(undefined);

    const result = await DiagramMutations.removeNode(
      wb,
      SHEET_ID,
      bridge,
      'diagram-1',
      'nonexistent-node' as NodeId,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('NODE_NOT_FOUND');
      expect(result.error.nodeId).toBe('nonexistent-node');
    }
  });

  it('should return CANNOT_REMOVE_LAST_NODE error when trying to remove the only node', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    // Create diagram with only one node
    obj.diagram.nodes.clear();
    obj.diagram.nodes.set('node-1' as NodeId, createMockNode('node-1', 'Only Node', 0, null, []));
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    const result = await DiagramMutations.removeNode(
      wb,
      SHEET_ID,
      bridge,
      'diagram-1',
      'node-1' as NodeId,
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('CANNOT_REMOVE_LAST_NODE');
    }
  });
});

// =============================================================================
// UPDATE NODE TESTS
// =============================================================================

describe('Diagram Mutations - updateNode', () => {
  it('should update node text and return success', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    const result = await DiagramMutations.updateNode(
      wb,
      SHEET_ID,
      bridge,
      'diagram-1',
      'node-1' as NodeId,
      { text: 'Updated Text' },
    );

    expect(result.success).toBe(true);
    expect(bridge.updateNode).toHaveBeenCalledWith('diagram-1', 'node-1', {
      text: 'Updated Text',
    });
  });

  it('should set pending undo description', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    await DiagramMutations.updateNode(wb, SHEET_ID, bridge, 'diagram-1', 'node-1' as NodeId, {
      text: 'New',
    });

    expect((wb as any).setPendingUndoDescription).toHaveBeenCalledWith('Update Diagram node');
  });

  it('should emit diagram:node-updated event with changes', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    await DiagramMutations.updateNode(wb, SHEET_ID, bridge, 'diagram-1', 'node-1' as NodeId, {
      text: 'Updated',
      fillColor: '#ff0000',
    });

    const emittedEvent = (wb as any).getEmittedEvents()[0] as any;
    expect(emittedEvent.type).toBe('diagram:node-updated');
    expect(emittedEvent.objectId).toBe('diagram-1');
    expect(emittedEvent.nodeId).toBe('node-1');
    expect(emittedEvent.changes).toEqual({ text: 'Updated', fillColor: '#ff0000' });
    expect(emittedEvent.source).toBe('user');
  });

  it('should update multiple properties at once', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    const updates = {
      text: 'New Text',
      fillColor: '#ff0000',
      fontFamily: 'Arial',
      fontSize: 14,
    };

    await DiagramMutations.updateNode(
      wb,
      SHEET_ID,
      bridge,
      'diagram-1',
      'node-1' as NodeId,
      updates,
    );

    expect(bridge.updateNode).toHaveBeenCalledWith('diagram-1', 'node-1', updates);
  });

  it('should return NODE_NOT_FOUND error when node does not exist', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    (bridge.getNode as jest.Mock).mockReturnValueOnce(undefined);

    const result = await DiagramMutations.updateNode(
      wb,
      SHEET_ID,
      bridge,
      'diagram-1',
      'nonexistent' as NodeId,
      { text: 'Updated' },
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('NODE_NOT_FOUND');
    }
  });
});

// =============================================================================
// MOVE NODE TESTS
// =============================================================================

describe('Diagram Mutations - moveNode', () => {
  it.each(['promote', 'demote', 'move-up', 'move-down'] as NodeMoveDirection[])(
    'should move node with direction: %s',
    async (direction) => {
      const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
      const obj = createMockDiagramObject('diagram-1', 'sheet-1');
      diagramObjects.set('diagram-1', obj);
      const wb = createMockWorkbook(diagramObjects);
      const diagrams = new Map([['diagram-1', obj.diagram]]);
      const bridge = createMockDiagramBridge(diagrams);

      const result = await DiagramMutations.moveNode(
        wb,
        SHEET_ID,
        bridge,
        'diagram-1',
        'node-2' as NodeId,
        direction,
      );

      expect(result.success).toBe(true);
      expect(bridge.moveNode).toHaveBeenCalledWith('diagram-1', 'node-2', direction);
    },
  );

  it('should set correct undo description for promote', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    await DiagramMutations.moveNode(
      wb,
      SHEET_ID,
      bridge,
      'diagram-1',
      'node-2' as NodeId,
      'promote',
    );

    expect((wb as any).setPendingUndoDescription).toHaveBeenCalledWith('Promote Diagram node');
  });

  it('should set correct undo description for demote', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    await DiagramMutations.moveNode(
      wb,
      SHEET_ID,
      bridge,
      'diagram-1',
      'node-2' as NodeId,
      'demote',
    );

    expect((wb as any).setPendingUndoDescription).toHaveBeenCalledWith('Demote Diagram node');
  });

  it('should emit diagram:node-moved event', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    await DiagramMutations.moveNode(
      wb,
      SHEET_ID,
      bridge,
      'diagram-1',
      'node-2' as NodeId,
      'move-up',
    );

    const emittedEvent = (wb as any).getEmittedEvents()[0] as any;
    expect(emittedEvent.type).toBe('diagram:node-moved');
    expect(emittedEvent.objectId).toBe('diagram-1');
    expect(emittedEvent.nodeId).toBe('node-2');
    expect(emittedEvent.direction).toBe('move-up');
    expect(emittedEvent.source).toBe('user');
  });

  it('should return NODE_NOT_FOUND error when node does not exist', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    (bridge.getNode as jest.Mock).mockReturnValueOnce(undefined);

    const result = await DiagramMutations.moveNode(
      wb,
      SHEET_ID,
      bridge,
      'diagram-1',
      'nonexistent' as NodeId,
      'promote',
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('NODE_NOT_FOUND');
    }
  });

  // Boundary condition tests - these verify error handling at hierarchy boundaries
  describe('boundary conditions', () => {
    it('should handle promote on root node gracefully', async () => {
      const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
      const obj = createMockDiagramObject('diagram-1', 'sheet-1');
      diagramObjects.set('diagram-1', obj);
      const wb = createMockWorkbook(diagramObjects);
      const diagrams = new Map([['diagram-1', obj.diagram]]);
      const bridge = createMockDiagramBridge(diagrams);

      // Promote root node - should succeed (bridge handles no-op)
      const result = await DiagramMutations.moveNode(
        wb,
        SHEET_ID,
        bridge,
        'diagram-1',
        'node-1' as NodeId, // root node
        'promote',
      );

      // The bridge handles boundary conditions, mutation just calls bridge
      expect(result.success).toBe(true);
      expect(bridge.moveNode).toHaveBeenCalledWith('diagram-1', 'node-1', 'promote');
    });

    it('should handle move-up on first sibling gracefully', async () => {
      const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
      const obj = createMockDiagramObject('diagram-1', 'sheet-1');
      diagramObjects.set('diagram-1', obj);
      const wb = createMockWorkbook(diagramObjects);
      const diagrams = new Map([['diagram-1', obj.diagram]]);
      const bridge = createMockDiagramBridge(diagrams);

      // Move up first sibling - bridge handles boundary
      const result = await DiagramMutations.moveNode(
        wb,
        SHEET_ID,
        bridge,
        'diagram-1',
        'node-2' as NodeId, // first child
        'move-up',
      );

      expect(result.success).toBe(true);
    });

    it('should handle move-down on last sibling gracefully', async () => {
      const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
      const obj = createMockDiagramObject('diagram-1', 'sheet-1');
      diagramObjects.set('diagram-1', obj);
      const wb = createMockWorkbook(diagramObjects);
      const diagrams = new Map([['diagram-1', obj.diagram]]);
      const bridge = createMockDiagramBridge(diagrams);

      // Move down last sibling - bridge handles boundary
      const result = await DiagramMutations.moveNode(
        wb,
        SHEET_ID,
        bridge,
        'diagram-1',
        'node-3' as NodeId, // last child
        'move-down',
      );

      expect(result.success).toBe(true);
    });

    it('should handle demote on node with no siblings gracefully', async () => {
      const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
      const obj = createMockDiagramObject('diagram-1', 'sheet-1');
      // Create diagram with single child
      obj.diagram.nodes.get('node-1' as NodeId)!.childIds = ['node-2' as NodeId];
      obj.diagram.nodes.delete('node-3' as NodeId);
      diagramObjects.set('diagram-1', obj);
      const wb = createMockWorkbook(diagramObjects);
      const diagrams = new Map([['diagram-1', obj.diagram]]);
      const bridge = createMockDiagramBridge(diagrams);

      // Demote node with no previous sibling - bridge handles boundary
      const result = await DiagramMutations.moveNode(
        wb,
        SHEET_ID,
        bridge,
        'diagram-1',
        'node-2' as NodeId,
        'demote',
      );

      expect(result.success).toBe(true);
    });
  });
});

// =============================================================================
// CHANGE LAYOUT TESTS
// =============================================================================

describe('Diagram Mutations - changeLayout', () => {
  it('should change layout and return success', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    const result = await DiagramMutations.changeLayout(
      wb,
      SHEET_ID,
      bridge,
      'diagram-1',
      'process/basic-process',
    );

    expect(result.success).toBe(true);
    expect(bridge.changeLayout).toHaveBeenCalledWith('diagram-1', 'process/basic-process');
  });

  it('should set pending undo description', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    await DiagramMutations.changeLayout(wb, SHEET_ID, bridge, 'diagram-1', 'cycle/basic-cycle');

    expect((wb as any).setPendingUndoDescription).toHaveBeenCalledWith('Change Diagram layout');
  });

  it('should emit diagram:layout-changed event', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    await DiagramMutations.changeLayout(wb, SHEET_ID, bridge, 'diagram-1', 'process/basic-process');

    const emittedEvent = (wb as any).getEmittedEvents()[0] as any;
    expect(emittedEvent.type).toBe('diagram:layout-changed');
    expect(emittedEvent.objectId).toBe('diagram-1');
    expect(emittedEvent.previousLayoutId).toBe('hierarchy/org-chart');
    expect(emittedEvent.newLayoutId).toBe('process/basic-process');
    expect(emittedEvent.source).toBe('user');
  });

  it('should return DIAGRAM_NOT_FOUND error when object does not exist', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const wb = createMockWorkbook(diagramObjects);
    const bridge = createMockDiagramBridge(new Map());

    const result = await DiagramMutations.changeLayout(
      wb,
      SHEET_ID,
      bridge,
      'nonexistent',
      'process/basic-process',
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('DIAGRAM_NOT_FOUND');
    }
  });
});

// =============================================================================
// CHANGE QUICK STYLE TESTS
// =============================================================================

describe('Diagram Mutations - changeQuickStyle', () => {
  it('should change quick style and return success', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    const result = await DiagramMutations.changeQuickStyle(
      wb,
      SHEET_ID,
      bridge,
      'diagram-1',
      'intense-effect',
    );

    expect(result.success).toBe(true);
    expect(bridge.changeQuickStyle).toHaveBeenCalledWith('diagram-1', 'intense-effect');
  });

  it('should set pending undo description', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    await DiagramMutations.changeQuickStyle(wb, SHEET_ID, bridge, 'diagram-1', 'intense-effect');

    expect((wb as any).setPendingUndoDescription).toHaveBeenCalledWith('Change Diagram style');
  });

  it('should emit diagram:style-changed event', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    await DiagramMutations.changeQuickStyle(wb, SHEET_ID, bridge, 'diagram-1', 'intense-effect');

    const emittedEvent = (wb as any).getEmittedEvents()[0] as any;
    expect(emittedEvent.type).toBe('diagram:style-changed');
    expect(emittedEvent.objectId).toBe('diagram-1');
    expect(emittedEvent.changeType).toBe('quick-style');
    expect(emittedEvent.previousValue).toBe('subtle-effect');
    expect(emittedEvent.newValue).toBe('intense-effect');
  });
});

// =============================================================================
// CHANGE COLOR THEME TESTS
// =============================================================================

describe('Diagram Mutations - changeColorTheme', () => {
  it('should change color theme and return success', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    const result = await DiagramMutations.changeColorTheme(
      wb,
      SHEET_ID,
      bridge,
      'diagram-1',
      'accent-2',
    );

    expect(result.success).toBe(true);
    expect(bridge.changeColorTheme).toHaveBeenCalledWith('diagram-1', 'accent-2');
  });

  it('should set pending undo description', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    await DiagramMutations.changeColorTheme(wb, SHEET_ID, bridge, 'diagram-1', 'accent-2');

    expect((wb as any).setPendingUndoDescription).toHaveBeenCalledWith('Change Diagram colors');
  });

  it('should emit diagram:style-changed event', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);
    const diagrams = new Map([['diagram-1', obj.diagram]]);
    const bridge = createMockDiagramBridge(diagrams);

    await DiagramMutations.changeColorTheme(wb, SHEET_ID, bridge, 'diagram-1', 'accent-2');

    const emittedEvent = (wb as any).getEmittedEvents()[0] as any;
    expect(emittedEvent.type).toBe('diagram:style-changed');
    expect(emittedEvent.objectId).toBe('diagram-1');
    expect(emittedEvent.changeType).toBe('color-theme');
    expect(emittedEvent.previousValue).toBe('colorful-1');
    expect(emittedEvent.newValue).toBe('accent-2');
  });
});

// =============================================================================
// DUPLICATE DIAGRAM TESTS
// =============================================================================

describe('Diagram Mutations - duplicateDiagram', () => {
  it('should duplicate Diagram and return new objectId', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);

    const result = await DiagramMutations.duplicateDiagram(wb, SHEET_ID, 'diagram-1');

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBe('diagram-1-copy');
      expect(diagramObjects.has('diagram-1-copy')).toBe(true);
    }
  });

  it('should set pending undo description', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);

    await DiagramMutations.duplicateDiagram(wb, SHEET_ID, 'diagram-1');

    expect((wb as any).setPendingUndoDescription).toHaveBeenCalledWith('Duplicate Diagram');
  });

  it('should emit diagram:created event for duplicate', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);

    await DiagramMutations.duplicateDiagram(wb, SHEET_ID, 'diagram-1');

    const emittedEvent = (wb as any).getEmittedEvents()[0] as any;
    expect(emittedEvent.type).toBe('diagram:created');
    expect(emittedEvent.objectId).toBe('diagram-1-copy');
    expect(emittedEvent.sheetId).toBe('sheet-1');
    expect(emittedEvent.source).toBe('user');
  });

  it('should accept custom offset', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const obj = createMockDiagramObject('diagram-1', 'sheet-1');
    diagramObjects.set('diagram-1', obj);
    const wb = createMockWorkbook(diagramObjects);

    await DiagramMutations.duplicateDiagram(wb, SHEET_ID, 'diagram-1', {
      dx: 50,
      dy: 50,
    });

    // Verify duplicate was called via ws.objects.duplicate
    const mockWs = (wb as any)._mockWorksheet;
    expect(mockWs.objects.duplicate).toHaveBeenCalledWith('diagram-1');
  });

  it('should return DIAGRAM_NOT_FOUND error when object does not exist', async () => {
    const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
    const wb = createMockWorkbook(diagramObjects);

    const result = await DiagramMutations.duplicateDiagram(wb, SHEET_ID, 'nonexistent');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('DIAGRAM_NOT_FOUND');
    }
  });
});

// =============================================================================
// ERROR HANDLING TESTS
// =============================================================================

describe('Diagram Mutations - Error Handling', () => {
  describe('BRIDGE_NOT_AVAILABLE', () => {
    it('should return error for addNode when bridge is undefined', async () => {
      const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
      const obj = createMockDiagramObject('diagram-1', 'sheet-1');
      diagramObjects.set('diagram-1', obj);
      const wb = createMockWorkbook(diagramObjects);

      const result = await DiagramMutations.addNode(
        wb,
        SHEET_ID,
        undefined,
        'diagram-1',
        'text',
        'after',
        null,
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('BRIDGE_NOT_AVAILABLE');
      }
    });

    it('should return error for removeNode when bridge is undefined', async () => {
      const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
      const obj = createMockDiagramObject('diagram-1', 'sheet-1');
      diagramObjects.set('diagram-1', obj);
      const wb = createMockWorkbook(diagramObjects);

      const result = await DiagramMutations.removeNode(
        wb,
        SHEET_ID,
        undefined,
        'diagram-1',
        'node-1' as NodeId,
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('BRIDGE_NOT_AVAILABLE');
      }
    });

    it('should return error for updateNode when bridge is undefined', async () => {
      const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
      const obj = createMockDiagramObject('diagram-1', 'sheet-1');
      diagramObjects.set('diagram-1', obj);
      const wb = createMockWorkbook(diagramObjects);

      const result = await DiagramMutations.updateNode(
        wb,
        SHEET_ID,
        undefined,
        'diagram-1',
        'node-1' as NodeId,
        {},
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('BRIDGE_NOT_AVAILABLE');
      }
    });

    it('should return error for moveNode when bridge is undefined', async () => {
      const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
      const obj = createMockDiagramObject('diagram-1', 'sheet-1');
      diagramObjects.set('diagram-1', obj);
      const wb = createMockWorkbook(diagramObjects);

      const result = await DiagramMutations.moveNode(
        wb,
        SHEET_ID,
        undefined,
        'diagram-1',
        'node-1' as NodeId,
        'promote',
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('BRIDGE_NOT_AVAILABLE');
      }
    });

    it('should return error for changeLayout when bridge is undefined', async () => {
      const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
      const obj = createMockDiagramObject('diagram-1', 'sheet-1');
      diagramObjects.set('diagram-1', obj);
      const wb = createMockWorkbook(diagramObjects);

      const result = await DiagramMutations.changeLayout(
        wb,
        SHEET_ID,
        undefined,
        'diagram-1',
        'new-layout',
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('BRIDGE_NOT_AVAILABLE');
      }
    });

    it('should return error for changeQuickStyle when bridge is undefined', async () => {
      const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
      const obj = createMockDiagramObject('diagram-1', 'sheet-1');
      diagramObjects.set('diagram-1', obj);
      const wb = createMockWorkbook(diagramObjects);

      const result = await DiagramMutations.changeQuickStyle(
        wb,
        SHEET_ID,
        undefined,
        'diagram-1',
        'new-style',
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('BRIDGE_NOT_AVAILABLE');
      }
    });

    it('should return error for changeColorTheme when bridge is undefined', async () => {
      const diagramObjects = new Map<string, ReturnType<typeof createMockDiagramObject>>();
      const obj = createMockDiagramObject('diagram-1', 'sheet-1');
      diagramObjects.set('diagram-1', obj);
      const wb = createMockWorkbook(diagramObjects);

      const result = await DiagramMutations.changeColorTheme(
        wb,
        SHEET_ID,
        undefined,
        'diagram-1',
        'new-theme',
      );

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('BRIDGE_NOT_AVAILABLE');
      }
    });
  });
});
