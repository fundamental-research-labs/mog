/**
 * Equation Mutations Tests
 *
 * Unit tests for Equation mutation functions that orchestrate write operations
 * using the handle-based Worksheet API (ws.equations.*, ws.objects.*).
 *
 * Tests verify:
 * - Correct mutation behavior and return values
 * - Event emission via workbook.emit()
 * - Error handling for missing objects
 * - Proper undo description setting
 *
 * Test categories:
 * - insertEquation() - Equation creation
 * - updateEquation() - Content updates
 * - deleteEquation() - Equation deletion
 * - updateEquationStyle() - Style changes
 * - Undo/redo verification
 *
 */

import { jest } from '@jest/globals';

import type { EquationStyle } from '@mog-sdk/contracts/equation';
import type { EquationObject, ObjectPosition } from '@mog-sdk/contracts/floating-objects';
import { sheetId } from '@mog-sdk/contracts/core';

import * as EquationMutations from '../equation';

const SHEET_ID = sheetId('sheet-1');
const MOCK_EQUATION_DEFAULT_STYLE: EquationStyle = {
  fontFamily: 'Cambria Math',
  fontSize: 11,
  color: '#000000',
  backgroundColor: 'transparent',
  justification: 'center',
  displayMode: true,
  smallFractions: false,
};

// =============================================================================
// TEST UTILITIES
// =============================================================================

/**
 * Create a mock EquationObject.
 */
function createMockEquationObject(
  objectId: string,
  sheetId: string,
  latex: string = 'x^2',
  style?: Partial<EquationStyle>,
): EquationObject {
  const position = {
    anchorType: 'oneCell',
    x: 100,
    y: 100,
    width: 150,
    height: 50,
    from: { cellId: 'cell-1', xOffset: 0, yOffset: 0 },
  } as ObjectPosition;
  return {
    id: objectId,
    sheetId,
    containerId: sheetId,
    type: 'equation',
    position,
    anchor: position,
    zIndex: 1,
    locked: false,
    printable: true,
    name: `Equation ${objectId.slice(-4)}`,
    equation: {
      id: objectId as any,
      latex,
      omml: '',
      style: {
        ...MOCK_EQUATION_DEFAULT_STYLE,
        ...style,
      },
    },
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Create a mock non-equation floating object (for NOT_AN_EQUATION tests).
 */
function createMockTextBoxObject(objectId: string, sheetId: string) {
  const position = {
    anchorType: 'absolute',
    x: 100,
    y: 100,
    width: 200,
    height: 50,
    from: { cellId: 'cell-1', xOffset: 0, yOffset: 0 },
  };
  return {
    id: objectId,
    sheetId,
    containerId: sheetId,
    type: 'textbox' as const,
    content: 'Sample text',
    position,
    anchor: position,
    zIndex: 1,
    locked: false,
    printable: true,
    name: 'TextBox 1',
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
}

/**
 * Create a mock Workbook with handle-based Worksheet API for testing.
 *
 * The mock wires up:
 * - workbook.getSheetById(sheetId) -> returns mock Worksheet
 * - ws.equations.get(id) -> returns mock EquationHandle or null
 * - ws.equations.add(config) -> creates and returns mock EquationHandle
 * - ws.objects.get(id) -> returns mock FloatingObjectHandle or null
 */
function createMockWorkbook(
  objects: Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>,
) {
  const emittedEvents: unknown[] = [];
  let equationCounter = 0;

  // Mock equation handle
  function createEquationHandle(objectId: string) {
    return {
      id: objectId,
      type: 'equation' as const,
      getData: jest.fn(async () => objects.get(objectId)),
      update: jest.fn(async () => {}),
      delete: jest.fn(async () => {
        objects.delete(objectId);
        return { id: objectId, type: 'equation' };
      }),
    };
  }

  // Mock generic floating object handle
  function createObjectHandle(objectId: string) {
    const obj = objects.get(objectId);
    if (!obj) return null;
    return {
      id: objectId,
      type: obj.type,
      getData: jest.fn(async () => obj),
      delete: jest.fn(async () => {
        objects.delete(objectId);
        return { id: objectId, type: obj.type };
      }),
    };
  }

  const mockWorksheet = {
    equations: {
      get: jest.fn(async (id: string) => {
        const obj = objects.get(id);
        if (!obj || obj.type !== 'equation') return null;
        return createEquationHandle(id);
      }),
      add: jest.fn(async (config: any) => {
        const id = `eq-${Date.now()}-${++equationCounter}`;
        const defaults = await mockWorksheet.equations.getDefaultStyle();
        const obj = createMockEquationObject(id, 'sheet-1', config.latex ?? '', {
          ...defaults,
          ...config.style,
        });
        objects.set(id, obj);
        return createEquationHandle(id);
      }),
      getDefaultStyle: jest.fn(async () => ({ ...MOCK_EQUATION_DEFAULT_STYLE })),
      getDefaults: jest.fn(async () => ({
        style: { ...MOCK_EQUATION_DEFAULT_STYLE },
        width: 150,
        height: 50,
      })),
      list: jest.fn(async () => {
        return Array.from(objects.values())
          .filter((o) => o.type === 'equation')
          .map((o) => createEquationHandle(o.id));
      }),
    },
    objects: {
      get: jest.fn(async (id: string) => createObjectHandle(id)),
      list: jest.fn(async () => {
        return Array.from(objects.values()).map((o) => createObjectHandle(o.id));
      }),
      remove: jest.fn(async (id: string) => {
        objects.delete(id);
        return { id, type: 'equation' };
      }),
    },
  };

  const wb = {
    setPendingUndoDescription: jest.fn(),
    emit: jest.fn((event: unknown) => {
      emittedEvents.push(event);
    }),
    getSheet: jest.fn(() => mockWorksheet),
    getSheetById: jest.fn(() => mockWorksheet),
    getEmittedEvents: () => emittedEvents,
    clearEvents: () => {
      emittedEvents.length = 0;
    },
    _mockWorksheet: mockWorksheet,
  } as unknown as import('@mog-sdk/contracts/api').WorkbookInternal & {
    emit: jest.Mock;
    getSheet: jest.Mock;
    getSheetById: jest.Mock;
    getEmittedEvents: () => unknown[];
    clearEvents: () => void;
    _mockWorksheet: typeof mockWorksheet;
  };

  return wb;
}

// =============================================================================
// INSERT EQUATION TESTS
// =============================================================================

describe('Equation Mutations - insertEquation', () => {
  it('should create equation via ws.equations.add()', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const wb = createMockWorkbook(objects);

    const result = await EquationMutations.insertEquation(wb, SHEET_ID, 'x^2', {
      x: 100,
      y: 100,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(typeof result.value).toBe('string');
      // Verify the equation was added to objects
      expect(objects.size).toBe(1);
    }
  });

  it('should set pending undo description', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const wb = createMockWorkbook(objects);

    await EquationMutations.insertEquation(wb, SHEET_ID, 'x^2', {});

    expect((wb as any).setPendingUndoDescription).toHaveBeenCalledWith('Insert Equation');
  });

  it('should return success result with objectId', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const wb = createMockWorkbook(objects);

    const result = await EquationMutations.insertEquation(wb, SHEET_ID, 'x^2', {});

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.value).toBeDefined();
      expect(typeof result.value).toBe('string');
    }
  });

  it('should pass style to equations.add config', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const wb = createMockWorkbook(objects);
    const customStyle: Partial<EquationStyle> = {
      fontSize: 14,
      color: '#ff0000',
      displayMode: false,
    };

    await EquationMutations.insertEquation(wb, SHEET_ID, 'x^2', {}, customStyle);

    const mockWs = (wb as any)._mockWorksheet;
    expect(mockWs.equations.add).toHaveBeenCalledWith(
      expect.objectContaining({
        latex: 'x^2',
        style: customStyle,
      }),
    );
  });

  it('should handle empty LaTeX gracefully', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const wb = createMockWorkbook(objects);

    const result = await EquationMutations.insertEquation(wb, SHEET_ID, '', {});

    expect(result.success).toBe(true);
  });
});

// =============================================================================
// UPDATE EQUATION TESTS
// =============================================================================

describe('Equation Mutations - updateEquation', () => {
  it('should update LaTeX content via handle.update()', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const obj = createMockEquationObject('eq-1', 'sheet-1', 'x^2');
    objects.set('eq-1', obj);
    const wb = createMockWorkbook(objects);

    const result = await EquationMutations.updateEquation(wb, SHEET_ID, 'eq-1', 'x^3');

    expect(result.success).toBe(true);
  });

  it('should update with OMML when provided', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const obj = createMockEquationObject('eq-1', 'sheet-1', 'x^2');
    objects.set('eq-1', obj);
    const wb = createMockWorkbook(objects);

    const result = await EquationMutations.updateEquation(
      wb,
      SHEET_ID,
      'eq-1',
      'x^3',
      '<omml>test</omml>',
    );

    expect(result.success).toBe(true);
  });

  it('should set pending undo description', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const obj = createMockEquationObject('eq-1', 'sheet-1', 'x^2');
    objects.set('eq-1', obj);
    const wb = createMockWorkbook(objects);

    await EquationMutations.updateEquation(wb, SHEET_ID, 'eq-1', 'x^3');

    expect((wb as any).setPendingUndoDescription).toHaveBeenCalledWith('Edit Equation');
  });

  it('should emit floatingObject:updated event', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const obj = createMockEquationObject('eq-1', 'sheet-1', 'x^2');
    objects.set('eq-1', obj);
    const wb = createMockWorkbook(objects);

    await EquationMutations.updateEquation(wb, SHEET_ID, 'eq-1', 'x^3');

    const emittedEvent = (wb as any).getEmittedEvents()[0] as {
      type: string;
      objectId: string;
      sheetId: string;
      source: string;
    };
    expect(emittedEvent.type).toBe('floatingObject:updated');
    expect(emittedEvent.objectId).toBe('eq-1');
    expect(emittedEvent.sheetId).toBe('sheet-1');
    expect(emittedEvent.source).toBe('user');
  });

  it('should return OBJECT_NOT_FOUND error when equation does not exist', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const wb = createMockWorkbook(objects);

    const result = await EquationMutations.updateEquation(wb, SHEET_ID, 'nonexistent', 'x');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('OBJECT_NOT_FOUND');
      expect(result.error.objectId).toBe('nonexistent');
    }
  });

  it('should return NOT_AN_EQUATION error when object is not an equation', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const textBox = createMockTextBoxObject('textbox-1', 'sheet-1');
    objects.set('textbox-1', textBox);
    const wb = createMockWorkbook(objects);

    const result = await EquationMutations.updateEquation(wb, SHEET_ID, 'textbox-1', 'x^2');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('NOT_AN_EQUATION');
    }
  });
});

// =============================================================================
// DELETE EQUATION TESTS
// =============================================================================

describe('Equation Mutations - deleteEquation', () => {
  it('should remove equation via handle.delete()', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const obj = createMockEquationObject('eq-1', 'sheet-1', 'x^2');
    objects.set('eq-1', obj);
    const wb = createMockWorkbook(objects);

    const result = await EquationMutations.deleteEquation(wb, SHEET_ID, 'eq-1');

    expect(result.success).toBe(true);
  });

  it('should set pending undo description', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const obj = createMockEquationObject('eq-1', 'sheet-1', 'x^2');
    objects.set('eq-1', obj);
    const wb = createMockWorkbook(objects);

    await EquationMutations.deleteEquation(wb, SHEET_ID, 'eq-1');

    expect((wb as any).setPendingUndoDescription).toHaveBeenCalledWith('Delete Equation');
  });

  it('should emit floatingObject:deleted event', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const obj = createMockEquationObject('eq-1', 'sheet-1', 'x^2');
    objects.set('eq-1', obj);
    const wb = createMockWorkbook(objects);

    await EquationMutations.deleteEquation(wb, SHEET_ID, 'eq-1');

    const emittedEvent = (wb as any).getEmittedEvents()[0] as {
      type: string;
      objectId: string;
      objectType: string;
      sheetId: string;
      source: string;
    };
    expect(emittedEvent.type).toBe('floatingObject:deleted');
    expect(emittedEvent.objectId).toBe('eq-1');
    expect(emittedEvent.objectType).toBe('equation');
    expect(emittedEvent.sheetId).toBe('sheet-1');
    expect(emittedEvent.source).toBe('user');
  });

  it('should return OBJECT_NOT_FOUND error when equation does not exist', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const wb = createMockWorkbook(objects);

    const result = await EquationMutations.deleteEquation(wb, SHEET_ID, 'nonexistent');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('OBJECT_NOT_FOUND');
      expect(result.error.objectId).toBe('nonexistent');
    }
  });

  it('should return NOT_AN_EQUATION error when object is not an equation', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const textBox = createMockTextBoxObject('textbox-1', 'sheet-1');
    objects.set('textbox-1', textBox);
    const wb = createMockWorkbook(objects);

    const result = await EquationMutations.deleteEquation(wb, SHEET_ID, 'textbox-1');

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('NOT_AN_EQUATION');
    }
  });
});

// =============================================================================
// UPDATE EQUATION STYLE TESTS
// =============================================================================

describe('Equation Mutations - updateEquationStyle', () => {
  it('should update style via handle.update()', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const obj = createMockEquationObject('eq-1', 'sheet-1', 'x^2');
    objects.set('eq-1', obj);
    const wb = createMockWorkbook(objects);

    const newStyle: Partial<EquationStyle> = {
      fontSize: 16,
      color: '#0000ff',
    };

    const result = await EquationMutations.updateEquationStyle(wb, SHEET_ID, 'eq-1', newStyle);

    expect(result.success).toBe(true);
  });

  it('should set pending undo description', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const obj = createMockEquationObject('eq-1', 'sheet-1', 'x^2');
    objects.set('eq-1', obj);
    const wb = createMockWorkbook(objects);

    await EquationMutations.updateEquationStyle(wb, SHEET_ID, 'eq-1', { fontSize: 14 });

    expect((wb as any).setPendingUndoDescription).toHaveBeenCalledWith('Update Equation Style');
  });

  it('should emit floatingObject:updated event', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const obj = createMockEquationObject('eq-1', 'sheet-1', 'x^2');
    objects.set('eq-1', obj);
    const wb = createMockWorkbook(objects);

    await EquationMutations.updateEquationStyle(wb, SHEET_ID, 'eq-1', { fontSize: 14 });

    const emittedEvent = (wb as any).getEmittedEvents()[0] as {
      type: string;
      objectId: string;
      sheetId: string;
      source: string;
    };
    expect(emittedEvent.type).toBe('floatingObject:updated');
    expect(emittedEvent.objectId).toBe('eq-1');
  });

  it('should return OBJECT_NOT_FOUND error when equation does not exist', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const wb = createMockWorkbook(objects);

    const result = await EquationMutations.updateEquationStyle(wb, SHEET_ID, 'nonexistent', {
      fontSize: 14,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('OBJECT_NOT_FOUND');
    }
  });

  it('should return NOT_AN_EQUATION error when object is not an equation', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const textBox = createMockTextBoxObject('textbox-1', 'sheet-1');
    objects.set('textbox-1', textBox);
    const wb = createMockWorkbook(objects);

    const result = await EquationMutations.updateEquationStyle(wb, SHEET_ID, 'textbox-1', {
      fontSize: 14,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.code).toBe('NOT_AN_EQUATION');
    }
  });
});

// =============================================================================
// ERROR HANDLING TESTS
// =============================================================================

describe('Equation Mutations - Error Handling', () => {
  describe('OBJECT_NOT_FOUND', () => {
    it('should return error for updateEquation when object does not exist', async () => {
      const objects = new Map<
        string,
        EquationObject | ReturnType<typeof createMockTextBoxObject>
      >();
      const wb = createMockWorkbook(objects);

      const result = await EquationMutations.updateEquation(wb, SHEET_ID, 'nonexistent', 'x');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OBJECT_NOT_FOUND');
      }
    });

    it('should return error for deleteEquation when object does not exist', async () => {
      const objects = new Map<
        string,
        EquationObject | ReturnType<typeof createMockTextBoxObject>
      >();
      const wb = createMockWorkbook(objects);

      const result = await EquationMutations.deleteEquation(wb, SHEET_ID, 'nonexistent');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OBJECT_NOT_FOUND');
      }
    });

    it('should return error for updateEquationStyle when object does not exist', async () => {
      const objects = new Map<
        string,
        EquationObject | ReturnType<typeof createMockTextBoxObject>
      >();
      const wb = createMockWorkbook(objects);

      const result = await EquationMutations.updateEquationStyle(wb, SHEET_ID, 'nonexistent', {});

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('OBJECT_NOT_FOUND');
      }
    });
  });

  describe('NOT_AN_EQUATION', () => {
    it('should return error for updateEquation when object is not an equation', async () => {
      const objects = new Map<
        string,
        EquationObject | ReturnType<typeof createMockTextBoxObject>
      >();
      const textBox = createMockTextBoxObject('textbox-1', 'sheet-1');
      objects.set('textbox-1', textBox);
      const wb = createMockWorkbook(objects);

      const result = await EquationMutations.updateEquation(wb, SHEET_ID, 'textbox-1', 'x');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_AN_EQUATION');
      }
    });

    it('should return error for deleteEquation when object is not an equation', async () => {
      const objects = new Map<
        string,
        EquationObject | ReturnType<typeof createMockTextBoxObject>
      >();
      const textBox = createMockTextBoxObject('textbox-1', 'sheet-1');
      objects.set('textbox-1', textBox);
      const wb = createMockWorkbook(objects);

      const result = await EquationMutations.deleteEquation(wb, SHEET_ID, 'textbox-1');

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_AN_EQUATION');
      }
    });

    it('should return error for updateEquationStyle when object is not an equation', async () => {
      const objects = new Map<
        string,
        EquationObject | ReturnType<typeof createMockTextBoxObject>
      >();
      const textBox = createMockTextBoxObject('textbox-1', 'sheet-1');
      objects.set('textbox-1', textBox);
      const wb = createMockWorkbook(objects);

      const result = await EquationMutations.updateEquationStyle(wb, SHEET_ID, 'textbox-1', {});

      expect(result.success).toBe(false);
      if (!result.success) {
        expect(result.error.code).toBe('NOT_AN_EQUATION');
      }
    });
  });
});

// =============================================================================
// EVENT EMISSION TESTS
// =============================================================================

describe('Equation Mutations - Event Emission', () => {
  it('should emit events with source set to user', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const obj = createMockEquationObject('eq-1', 'sheet-1', 'x^2');
    objects.set('eq-1', obj);
    const wb = createMockWorkbook(objects);

    await EquationMutations.updateEquation(wb, SHEET_ID, 'eq-1', 'x^3');

    const emittedEvent = (wb as any).getEmittedEvents()[0] as { source: string };
    expect(emittedEvent.source).toBe('user');
  });

  it('should include objectType in deletion events', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const obj = createMockEquationObject('eq-1', 'sheet-1', 'x^2');
    objects.set('eq-1', obj);
    const wb = createMockWorkbook(objects);

    await EquationMutations.deleteEquation(wb, SHEET_ID, 'eq-1');

    const emittedEvent = (wb as any).getEmittedEvents()[0] as { objectType: string };
    expect(emittedEvent.objectType).toBe('equation');
  });
});

// =============================================================================
// UNDO/REDO TESTS (Verification)
// =============================================================================

describe('Equation Mutations - Undo/Redo Verification', () => {
  /**
   * Note: These tests verify that the mutations call setPendingUndoDescription,
   * which is how undo descriptions are captured in the coordinator pattern.
   * The actual undo/redo behavior is tested in integration tests with real Yjs UndoManager.
   */

  it('insertEquation sets undo description before mutation', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const wb = createMockWorkbook(objects);
    const callOrder: string[] = [];

    // Track call order
    ((wb as any).setPendingUndoDescription as jest.Mock).mockImplementation(() => {
      callOrder.push('undo');
    });
    const mockWs = (wb as any)._mockWorksheet;
    const origAdd = mockWs.equations.add;
    mockWs.equations.add = jest.fn(async (config: any) => {
      callOrder.push('mutation');
      return origAdd(config);
    });

    await EquationMutations.insertEquation(wb, SHEET_ID, 'x^2', {});

    expect(callOrder).toEqual(['undo', 'mutation']);
    expect((wb as any).setPendingUndoDescription).toHaveBeenCalledWith('Insert Equation');
  });

  it('updateEquation sets undo description for edits', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const obj = createMockEquationObject('eq-1', 'sheet-1', 'x^2');
    objects.set('eq-1', obj);
    const wb = createMockWorkbook(objects);

    await EquationMutations.updateEquation(wb, SHEET_ID, 'eq-1', 'x^3');

    expect((wb as any).setPendingUndoDescription).toHaveBeenCalledWith('Edit Equation');
  });

  it('deleteEquation sets undo description', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const obj = createMockEquationObject('eq-1', 'sheet-1', 'x^2');
    objects.set('eq-1', obj);
    const wb = createMockWorkbook(objects);

    await EquationMutations.deleteEquation(wb, SHEET_ID, 'eq-1');

    expect((wb as any).setPendingUndoDescription).toHaveBeenCalledWith('Delete Equation');
  });

  it('updateEquationStyle sets undo description', async () => {
    const objects = new Map<string, EquationObject | ReturnType<typeof createMockTextBoxObject>>();
    const obj = createMockEquationObject('eq-1', 'sheet-1', 'x^2');
    objects.set('eq-1', obj);
    const wb = createMockWorkbook(objects);

    await EquationMutations.updateEquationStyle(wb, SHEET_ID, 'eq-1', { fontSize: 14 });

    expect((wb as any).setPendingUndoDescription).toHaveBeenCalledWith('Update Equation Style');
  });
});
