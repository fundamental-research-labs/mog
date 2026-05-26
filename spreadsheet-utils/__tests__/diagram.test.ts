/**
 * Diagram Contracts Tests
 *
 * Tests for Diagram-related type guards, schema utilities, and selectors.
 */

import type { EquationId } from '@mog-sdk/contracts/equation/types';
import type { FloatingObject, DiagramObject } from '@mog-sdk/contracts/objects/floating-objects';
import { isDiagramObject } from '@mog/spreadsheet-utils/objects/floating-objects';
import type { Sheet } from '@mog-sdk/contracts/selectors';
import { diagramSelectors } from '@mog-sdk/contracts/selectors';
import type { NodeId, Diagram, DiagramNode } from '@mog-sdk/contracts/diagram-engine/types';
import { createNodeId } from '@mog/diagram-engine/types';
import {
  getRequiredDiagramFields,
  getRequiredDiagramNodeFields,
  getDiagramDefault,
  getDiagramDefaults,
  getDiagramNodeDefault,
  getDiagramNodeDefaults,
  isDiagramFieldRequired,
  isDiagramNodeFieldRequired,
  DIAGRAM_DIAGRAM_SCHEMA,
  DIAGRAM_NODE_SCHEMA,
} from '@mog/diagram-engine/defaults';

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create a base floating object for testing
 */
function createBaseObject(type: string) {
  return {
    id: 'test-123',
    type,
    sheetId: 'sheet-1',
    containerId: 'sheet-1',
    position: {
      anchorType: 'oneCell' as const,
      from: { cellId: 'cell-1', xOffset: 0, yOffset: 0 },
      width: 200,
      height: 100,
    },
    anchor: {
      anchorType: 'oneCell' as const,
      from: { cellId: 'cell-1', xOffset: 0, yOffset: 0 },
      width: 200,
      height: 100,
    },
    zIndex: 1,
    locked: false,
    printable: true,
  };
}

/**
 * Create a mock Diagram diagram for testing
 */
function createMockDiagram(): Diagram {
  const rootId = 'root-node-id' as NodeId;
  const childId = 'child-node-id' as NodeId;

  const rootNode: DiagramNode = {
    id: rootId,
    text: 'Root',
    level: 0,
    parentId: null,
    childIds: [childId],
    siblingOrder: 0,
  };

  const childNode: DiagramNode = {
    id: childId,
    text: 'Child',
    level: 1,
    parentId: rootId,
    childIds: [],
    siblingOrder: 0,
  };

  const nodes = new Map<NodeId, DiagramNode>();
  nodes.set(rootId, rootNode);
  nodes.set(childId, childNode);

  return {
    layoutId: 'hierarchy/org-chart',
    category: 'hierarchy',
    nodes,
    rootNodeIds: [rootId],
    quickStyleId: 'subtle-effect',
    colorThemeId: 'colorful-1',
    layoutOptions: {},
  };
}

/**
 * Create a mock Diagram object for testing
 */
function createMockDiagramObject(): DiagramObject {
  return {
    ...createBaseObject('diagram'),
    type: 'diagram',
    diagram: createMockDiagram(),
  };
}

// =============================================================================
// createNodeId Function Tests
// =============================================================================

describe('createNodeId', () => {
  it('should generate a valid UUID v4 format', () => {
    const nodeId = createNodeId();

    // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
    const uuidV4Regex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(nodeId).toMatch(uuidV4Regex);
  });

  it('should generate unique IDs', () => {
    const ids = new Set<NodeId>();
    const count = 100;

    for (let i = 0; i < count; i++) {
      ids.add(createNodeId());
    }

    // All generated IDs should be unique
    expect(ids.size).toBe(count);
  });

  it('should have correct version (4) bit', () => {
    const nodeId = createNodeId();
    // The 13th character (index 14, accounting for hyphens) should be '4'
    const parts = nodeId.split('-');
    expect(parts[2][0]).toBe('4');
  });

  it('should have correct variant bit', () => {
    const nodeId = createNodeId();
    // The first character of the 4th group should be 8, 9, a, or b
    const parts = nodeId.split('-');
    const variantChar = parts[3][0].toLowerCase();
    expect(['8', '9', 'a', 'b']).toContain(variantChar);
  });

  it('should return a string type with NodeId brand', () => {
    const nodeId = createNodeId();
    expect(typeof nodeId).toBe('string');
    // The branded type should still be usable as a string
    expect(nodeId.length).toBe(36); // UUID length with hyphens
  });
});

// =============================================================================
// isDiagramObject Type Guard Tests
// =============================================================================

describe('isDiagramObject', () => {
  it('should return true for Diagram objects', () => {
    const diagramObj = createMockDiagramObject();
    expect(isDiagramObject(diagramObj)).toBe(true);
  });

  it('should return false for picture objects', () => {
    const pictureObj: FloatingObject = {
      ...createBaseObject('picture'),
      type: 'picture',
      src: 'data:image/png;base64,...',
      originalWidth: 400,
      originalHeight: 300,
    };
    expect(isDiagramObject(pictureObj)).toBe(false);
  });

  it('should return false for textbox objects', () => {
    const textboxObj: FloatingObject = {
      ...createBaseObject('textbox'),
      type: 'textbox',
      content: 'Hello World',
    };
    expect(isDiagramObject(textboxObj)).toBe(false);
  });

  it('should return false for shape objects', () => {
    const shapeObj: FloatingObject = {
      ...createBaseObject('shape'),
      type: 'shape',
      shapeType: 'rect',
    };
    expect(isDiagramObject(shapeObj)).toBe(false);
  });

  it('should return false for chart objects', () => {
    const chartObj: FloatingObject = {
      ...createBaseObject('chart'),
      type: 'chart',
      chartType: 'bar',
      anchorMode: 'oneCell',
      widthCells: 8,
      heightCells: 15,
      chartConfig: { series: [] },
    };
    expect(isDiagramObject(chartObj)).toBe(false);
  });

  it('should return false for equation objects', () => {
    const equationObj: FloatingObject = {
      ...createBaseObject('equation'),
      type: 'equation',
      equation: {
        id: 'eq-1' as EquationId,
        omml: '<m:oMath/>',
        style: {
          fontFamily: 'Cambria Math',
          fontSize: 11,
          color: '#000000',
          backgroundColor: 'transparent',
          justification: 'center',
          displayMode: true,
          smallFractions: false,
        },
      },
    };
    expect(isDiagramObject(equationObj)).toBe(false);
  });

  it('should allow type narrowing after guard', () => {
    const obj: FloatingObject = createMockDiagramObject();

    if (isDiagramObject(obj)) {
      // TypeScript should allow accessing Diagram-specific properties
      expect(obj.diagram).toBeDefined();
      expect(obj.diagram.layoutId).toBe('hierarchy/org-chart');
      expect(obj.diagram.category).toBe('hierarchy');
    }
  });
});

// =============================================================================
// Diagram Node Schema Utilities Tests
// =============================================================================

describe('Diagram Node Schema Utilities', () => {
  describe('getDiagramNodeDefault', () => {
    it('should return correct default for text', () => {
      expect(getDiagramNodeDefault('text')).toBe('');
    });

    it('should return correct default for level', () => {
      expect(getDiagramNodeDefault('level')).toBe(0);
    });

    it('should return correct default for parentId', () => {
      expect(getDiagramNodeDefault('parentId')).toBe(null);
    });

    it('should return correct default for siblingOrder', () => {
      expect(getDiagramNodeDefault('siblingOrder')).toBe(0);
    });

    it('should return correct default for imageFit', () => {
      expect(getDiagramNodeDefault('imageFit')).toBe('cover');
    });

    it('should return undefined for fields without defaults', () => {
      // id has no default - it's required and must be generated
      expect(getDiagramNodeDefault('id')).toBeUndefined();

      // Optional styling fields have no defaults
      expect(getDiagramNodeDefault('fillColor')).toBeUndefined();
      expect(getDiagramNodeDefault('borderColor')).toBeUndefined();
      expect(getDiagramNodeDefault('textColor')).toBeUndefined();
      expect(getDiagramNodeDefault('fontFamily')).toBeUndefined();
      expect(getDiagramNodeDefault('fontSize')).toBeUndefined();
      expect(getDiagramNodeDefault('fontWeight')).toBeUndefined();
      expect(getDiagramNodeDefault('imageUrl')).toBeUndefined();
    });
  });

  describe('getDiagramNodeDefaults', () => {
    it('should return all default values', () => {
      const defaults = getDiagramNodeDefaults();

      expect(defaults.text).toBe('');
      expect(defaults.level).toBe(0);
      expect(defaults.parentId).toBe(null);
      expect(defaults.siblingOrder).toBe(0);
      expect(defaults.imageFit).toBe('cover');
    });

    it('should not include fields without defaults', () => {
      const defaults = getDiagramNodeDefaults();

      expect(defaults).not.toHaveProperty('id');
      expect(defaults).not.toHaveProperty('fillColor');
      expect(defaults).not.toHaveProperty('borderColor');
      expect(defaults).not.toHaveProperty('textColor');
    });

    it('should return consistent values on multiple calls', () => {
      const defaults1 = getDiagramNodeDefaults();
      const defaults2 = getDiagramNodeDefaults();

      expect(defaults1.text).toBe(defaults2.text);
      expect(defaults1.level).toBe(defaults2.level);
      expect(defaults1.siblingOrder).toBe(defaults2.siblingOrder);
    });
  });

  describe('isDiagramNodeFieldRequired', () => {
    it('should return true for required fields', () => {
      expect(isDiagramNodeFieldRequired('id')).toBe(true);
      expect(isDiagramNodeFieldRequired('childIds')).toBe(true);
    });

    it('should return false for optional fields', () => {
      expect(isDiagramNodeFieldRequired('text')).toBe(false);
      expect(isDiagramNodeFieldRequired('level')).toBe(false);
      expect(isDiagramNodeFieldRequired('parentId')).toBe(false);
      expect(isDiagramNodeFieldRequired('siblingOrder')).toBe(false);
      expect(isDiagramNodeFieldRequired('fillColor')).toBe(false);
      expect(isDiagramNodeFieldRequired('borderColor')).toBe(false);
      expect(isDiagramNodeFieldRequired('textColor')).toBe(false);
      expect(isDiagramNodeFieldRequired('fontFamily')).toBe(false);
      expect(isDiagramNodeFieldRequired('fontSize')).toBe(false);
      expect(isDiagramNodeFieldRequired('fontWeight')).toBe(false);
      expect(isDiagramNodeFieldRequired('imageUrl')).toBe(false);
      expect(isDiagramNodeFieldRequired('imageFit')).toBe(false);
    });
  });

  describe('getRequiredDiagramNodeFields', () => {
    it('should return array of required field names', () => {
      const requiredFields = getRequiredDiagramNodeFields();

      expect(requiredFields).toContain('id');
      expect(requiredFields).toContain('childIds');
    });

    it('should not include optional fields', () => {
      const requiredFields = getRequiredDiagramNodeFields();

      expect(requiredFields).not.toContain('text');
      expect(requiredFields).not.toContain('level');
      expect(requiredFields).not.toContain('fillColor');
    });

    it('should return an array', () => {
      const requiredFields = getRequiredDiagramNodeFields();
      expect(Array.isArray(requiredFields)).toBe(true);
    });

    it('should have consistent length with schema', () => {
      const requiredFields = getRequiredDiagramNodeFields();
      const schemaRequiredCount = Object.values(DIAGRAM_NODE_SCHEMA).filter(
        (def) => def.required,
      ).length;
      expect(requiredFields.length).toBe(schemaRequiredCount);
    });
  });

  describe('DIAGRAM_NODE_SCHEMA structure', () => {
    it('should have all expected fields', () => {
      expect(DIAGRAM_NODE_SCHEMA).toHaveProperty('id');
      expect(DIAGRAM_NODE_SCHEMA).toHaveProperty('text');
      expect(DIAGRAM_NODE_SCHEMA).toHaveProperty('level');
      expect(DIAGRAM_NODE_SCHEMA).toHaveProperty('parentId');
      expect(DIAGRAM_NODE_SCHEMA).toHaveProperty('childIds');
      expect(DIAGRAM_NODE_SCHEMA).toHaveProperty('siblingOrder');
      expect(DIAGRAM_NODE_SCHEMA).toHaveProperty('fillColor');
      expect(DIAGRAM_NODE_SCHEMA).toHaveProperty('borderColor');
      expect(DIAGRAM_NODE_SCHEMA).toHaveProperty('textColor');
      expect(DIAGRAM_NODE_SCHEMA).toHaveProperty('fontFamily');
      expect(DIAGRAM_NODE_SCHEMA).toHaveProperty('fontSize');
      expect(DIAGRAM_NODE_SCHEMA).toHaveProperty('fontWeight');
      expect(DIAGRAM_NODE_SCHEMA).toHaveProperty('imageUrl');
      expect(DIAGRAM_NODE_SCHEMA).toHaveProperty('imageFit');
    });

    it('should have correct copy strategy for id-related fields', () => {
      // ID fields should be skipped on copy (regenerated/remapped)
      expect(DIAGRAM_NODE_SCHEMA.id.copy).toBe('skip');
      expect(DIAGRAM_NODE_SCHEMA.parentId.copy).toBe('skip');
      expect(DIAGRAM_NODE_SCHEMA.childIds.copy).toBe('skip');
    });

    it('should have shallow copy strategy for data fields', () => {
      expect(DIAGRAM_NODE_SCHEMA.text.copy).toBe('shallow');
      expect(DIAGRAM_NODE_SCHEMA.level.copy).toBe('shallow');
      expect(DIAGRAM_NODE_SCHEMA.siblingOrder.copy).toBe('shallow');
      expect(DIAGRAM_NODE_SCHEMA.fillColor.copy).toBe('shallow');
    });

    it('should have childIds as Y.Array type', () => {
      expect(DIAGRAM_NODE_SCHEMA.childIds.type).toBe('Y.Array');
    });
  });
});

// =============================================================================
// Diagram Diagram Schema Utilities Tests
// =============================================================================

describe('Diagram Diagram Schema Utilities', () => {
  describe('getDiagramDefault', () => {
    it('should return correct default for quickStyleId', () => {
      expect(getDiagramDefault('quickStyleId')).toBe('subtle-effect');
    });

    it('should return correct default for colorThemeId', () => {
      expect(getDiagramDefault('colorThemeId')).toBe('colorful-1');
    });

    it('should return undefined for fields without defaults', () => {
      expect(getDiagramDefault('layoutId')).toBeUndefined();
      expect(getDiagramDefault('category')).toBeUndefined();
      expect(getDiagramDefault('nodeMap')).toBeUndefined();
      expect(getDiagramDefault('rootNodeIds')).toBeUndefined();
      expect(getDiagramDefault('layoutOptions')).toBeUndefined();
    });
  });

  describe('getDiagramDefaults', () => {
    it('should return all default values', () => {
      const defaults = getDiagramDefaults();

      expect(defaults.quickStyleId).toBe('subtle-effect');
      expect(defaults.colorThemeId).toBe('colorful-1');
    });

    it('should not include fields without defaults', () => {
      const defaults = getDiagramDefaults();

      expect(defaults).not.toHaveProperty('layoutId');
      expect(defaults).not.toHaveProperty('category');
      expect(defaults).not.toHaveProperty('nodeMap');
      expect(defaults).not.toHaveProperty('rootNodeIds');
    });

    it('should return consistent values on multiple calls', () => {
      const defaults1 = getDiagramDefaults();
      const defaults2 = getDiagramDefaults();

      expect(defaults1.quickStyleId).toBe(defaults2.quickStyleId);
      expect(defaults1.colorThemeId).toBe(defaults2.colorThemeId);
    });
  });

  describe('isDiagramFieldRequired', () => {
    it('should return true for required fields', () => {
      expect(isDiagramFieldRequired('layoutId')).toBe(true);
      expect(isDiagramFieldRequired('category')).toBe(true);
      expect(isDiagramFieldRequired('nodeMap')).toBe(true);
      expect(isDiagramFieldRequired('rootNodeIds')).toBe(true);
      expect(isDiagramFieldRequired('quickStyleId')).toBe(true);
      expect(isDiagramFieldRequired('colorThemeId')).toBe(true);
    });

    it('should return false for optional fields', () => {
      expect(isDiagramFieldRequired('layoutOptions')).toBe(false);
    });
  });

  describe('getRequiredDiagramFields', () => {
    it('should return array of required field names', () => {
      const requiredFields = getRequiredDiagramFields();

      expect(requiredFields).toContain('layoutId');
      expect(requiredFields).toContain('category');
      expect(requiredFields).toContain('nodeMap');
      expect(requiredFields).toContain('rootNodeIds');
      expect(requiredFields).toContain('quickStyleId');
      expect(requiredFields).toContain('colorThemeId');
    });

    it('should not include optional fields', () => {
      const requiredFields = getRequiredDiagramFields();

      expect(requiredFields).not.toContain('layoutOptions');
    });

    it('should return an array', () => {
      const requiredFields = getRequiredDiagramFields();
      expect(Array.isArray(requiredFields)).toBe(true);
    });

    it('should have consistent length with schema', () => {
      const requiredFields = getRequiredDiagramFields();
      const schemaRequiredCount = Object.values(DIAGRAM_DIAGRAM_SCHEMA).filter(
        (def) => def.required,
      ).length;
      expect(requiredFields.length).toBe(schemaRequiredCount);
    });
  });

  describe('DIAGRAM_DIAGRAM_SCHEMA structure', () => {
    it('should have all expected fields', () => {
      expect(DIAGRAM_DIAGRAM_SCHEMA).toHaveProperty('layoutId');
      expect(DIAGRAM_DIAGRAM_SCHEMA).toHaveProperty('category');
      expect(DIAGRAM_DIAGRAM_SCHEMA).toHaveProperty('nodeMap');
      expect(DIAGRAM_DIAGRAM_SCHEMA).toHaveProperty('rootNodeIds');
      expect(DIAGRAM_DIAGRAM_SCHEMA).toHaveProperty('quickStyleId');
      expect(DIAGRAM_DIAGRAM_SCHEMA).toHaveProperty('colorThemeId');
      expect(DIAGRAM_DIAGRAM_SCHEMA).toHaveProperty('layoutOptions');
    });

    it('should have nodeMap as Y.Map type', () => {
      expect(DIAGRAM_DIAGRAM_SCHEMA.nodeMap.type).toBe('Y.Map');
    });

    it('should have rootNodeIds as Y.Array type', () => {
      expect(DIAGRAM_DIAGRAM_SCHEMA.rootNodeIds.type).toBe('Y.Array');
    });

    it('should have correct copy strategies', () => {
      expect(DIAGRAM_DIAGRAM_SCHEMA.layoutId.copy).toBe('shallow');
      expect(DIAGRAM_DIAGRAM_SCHEMA.category.copy).toBe('shallow');
      expect(DIAGRAM_DIAGRAM_SCHEMA.nodeMap.copy).toBe('deep');
      expect(DIAGRAM_DIAGRAM_SCHEMA.rootNodeIds.copy).toBe('deep');
      expect(DIAGRAM_DIAGRAM_SCHEMA.quickStyleId.copy).toBe('shallow');
      expect(DIAGRAM_DIAGRAM_SCHEMA.colorThemeId.copy).toBe('shallow');
      expect(DIAGRAM_DIAGRAM_SCHEMA.layoutOptions.copy).toBe('deep');
    });

    it('should have layoutOptions as lazy init', () => {
      expect(DIAGRAM_DIAGRAM_SCHEMA.layoutOptions.lazyInit).toBe(true);
    });
  });
});

// =============================================================================
// Diagram Selectors Tests
// =============================================================================

describe('Diagram Selectors', () => {
  describe('getDiagramById', () => {
    it('should return Diagram object when found', () => {
      const diagram = createMockDiagramObject();
      const sheet: Sheet = {
        floatingObjects: [diagram],
      };

      const result = diagramSelectors.getDiagramById(sheet, 'test-123');
      expect(result).toBe(diagram);
    });

    it('should return undefined when not found', () => {
      const sheet: Sheet = {
        floatingObjects: [],
      };

      const result = diagramSelectors.getDiagramById(sheet, 'non-existent');
      expect(result).toBeUndefined();
    });

    it('should return undefined when ID matches non-Diagram object', () => {
      const pictureObj: FloatingObject = {
        ...createBaseObject('picture'),
        type: 'picture',
        src: 'data:image/png;base64,...',
        originalWidth: 400,
        originalHeight: 300,
      };
      const sheet: Sheet = {
        floatingObjects: [pictureObj],
      };

      const result = diagramSelectors.getDiagramById(sheet, 'test-123');
      expect(result).toBeUndefined();
    });

    it('should handle undefined floatingObjects', () => {
      const sheet: Sheet = {};

      const result = diagramSelectors.getDiagramById(sheet, 'test-123');
      expect(result).toBeUndefined();
    });
  });

  describe('getFirstDiagram', () => {
    it('should return first Diagram object', () => {
      const diagram = createMockDiagramObject();
      const sheet: Sheet = {
        floatingObjects: [diagram],
      };

      const result = diagramSelectors.getFirstDiagram(sheet);
      expect(result).toBe(diagram);
    });

    it('should return undefined when no Diagram exists', () => {
      const pictureObj: FloatingObject = {
        ...createBaseObject('picture'),
        type: 'picture',
        src: 'data:image/png;base64,...',
        originalWidth: 400,
        originalHeight: 300,
      };
      const sheet: Sheet = {
        floatingObjects: [pictureObj],
      };

      const result = diagramSelectors.getFirstDiagram(sheet);
      expect(result).toBeUndefined();
    });

    it('should handle empty floatingObjects array', () => {
      const sheet: Sheet = {
        floatingObjects: [],
      };

      const result = diagramSelectors.getFirstDiagram(sheet);
      expect(result).toBeUndefined();
    });

    it('should handle undefined floatingObjects', () => {
      const sheet: Sheet = {};

      const result = diagramSelectors.getFirstDiagram(sheet);
      expect(result).toBeUndefined();
    });
  });

  describe('getAllDiagrams', () => {
    it('should return all Diagram objects', () => {
      const diagram1: DiagramObject = {
        ...createBaseObject('diagram'),
        id: 'diagram-1',
        type: 'diagram',
        diagram: createMockDiagram(),
      };
      const diagram2: DiagramObject = {
        ...createBaseObject('diagram'),
        id: 'diagram-2',
        type: 'diagram',
        diagram: createMockDiagram(),
      };
      const pictureObj: FloatingObject = {
        ...createBaseObject('picture'),
        id: 'picture-1',
        type: 'picture',
        src: 'data:image/png;base64,...',
        originalWidth: 400,
        originalHeight: 300,
      };

      const sheet: Sheet = {
        floatingObjects: [diagram1, pictureObj, diagram2],
      };

      const result = diagramSelectors.getAllDiagrams(sheet);
      expect(result).toHaveLength(2);
      expect(result).toContain(diagram1);
      expect(result).toContain(diagram2);
    });

    it('should return empty array when no Diagram objects exist', () => {
      const pictureObj: FloatingObject = {
        ...createBaseObject('picture'),
        type: 'picture',
        src: 'data:image/png;base64,...',
        originalWidth: 400,
        originalHeight: 300,
      };
      const sheet: Sheet = {
        floatingObjects: [pictureObj],
      };

      const result = diagramSelectors.getAllDiagrams(sheet);
      expect(result).toEqual([]);
    });

    it('should return empty array for empty floatingObjects', () => {
      const sheet: Sheet = {
        floatingObjects: [],
      };

      const result = diagramSelectors.getAllDiagrams(sheet);
      expect(result).toEqual([]);
    });

    it('should return empty array for undefined floatingObjects', () => {
      const sheet: Sheet = {};

      const result = diagramSelectors.getAllDiagrams(sheet);
      expect(result).toEqual([]);
    });
  });
});
