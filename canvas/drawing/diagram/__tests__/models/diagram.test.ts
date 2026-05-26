import type { Diagram, DiagramLayoutDefinition } from '@mog-sdk/contracts/diagram';
import {
  changeLayout,
  createDiagram,
  setColorTheme,
  setLayoutOptions,
  setQuickStyle,
} from '../../src/models/diagram';
import { addNodeToDiagram, createNode } from '../../src/models/node';

// Helper to create a minimal layout definition
function createLayoutDefinition(
  overrides?: Partial<DiagramLayoutDefinition>,
): DiagramLayoutDefinition {
  return {
    id: 'test-layout',
    name: 'Test Layout',
    description: 'A test layout',
    category: 'list',
    minNodes: 1,
    maxNodes: null,
    maxLevels: 5,
    supportsChildren: true,
    supportsPictures: false,
    defaultShapeType: 'rect',
    defaultConnectorType: 'straight',
    algorithm: 'linear-horizontal',
    thumbnail: '',
    ...overrides,
  };
}

// Helper to create a flat layout (no children)
function createFlatLayoutDefinition(): DiagramLayoutDefinition {
  return createLayoutDefinition({
    id: 'flat-layout',
    name: 'Flat Layout',
    supportsChildren: false,
  });
}

// Helper to create a hierarchical diagram with multiple levels
function createHierarchicalDiagram(): Diagram {
  const layout = createLayoutDefinition({ category: 'hierarchy' });
  let diagram = createDiagram(layout);

  const rootId = diagram.rootNodeIds[0];

  // Add children to the root
  const child1 = createNode({ text: 'Child 1' });
  diagram = addNodeToDiagram(diagram, child1, 'child', rootId);

  const child2 = createNode({ text: 'Child 2' });
  diagram = addNodeToDiagram(diagram, child2, 'child', rootId);

  // Add grandchild
  const grandchild = createNode({ text: 'Grandchild' });
  diagram = addNodeToDiagram(diagram, grandchild, 'child', child1.id);

  return diagram;
}

describe('createDiagram', () => {
  it('should create a diagram with one root node', () => {
    const layout = createLayoutDefinition();
    const diagram = createDiagram(layout);

    expect(diagram.layoutId).toBe(layout.id);
    expect(diagram.category).toBe(layout.category);
    expect(diagram.rootNodeIds.length).toBe(1);
    expect(diagram.nodes.size).toBe(1);
  });

  it('should set default quick style and color theme', () => {
    const layout = createLayoutDefinition();
    const diagram = createDiagram(layout);

    expect(diagram.quickStyleId).toBe('subtle-effect');
    expect(diagram.colorThemeId).toBe('colorful-1');
  });

  it('should create root node with default text', () => {
    const layout = createLayoutDefinition();
    const diagram = createDiagram(layout);

    const rootId = diagram.rootNodeIds[0];
    const rootNode = diagram.nodes.get(rootId);

    expect(rootNode?.text).toBe('[Text]');
    expect(rootNode?.level).toBe(0);
    expect(rootNode?.parentId).toBe(null);
  });

  it('should use layout category', () => {
    const hierarchyLayout = createLayoutDefinition({ category: 'hierarchy' });
    const diagram = createDiagram(hierarchyLayout);

    expect(diagram.category).toBe('hierarchy');
  });
});

describe('changeLayout', () => {
  it('should change the layout id and category', () => {
    const layout1 = createLayoutDefinition({ id: 'layout-1', category: 'list' });
    const layout2 = createLayoutDefinition({ id: 'layout-2', category: 'process' });

    const diagram = createDiagram(layout1);
    const result = changeLayout(diagram, layout2);

    expect(result.layoutId).toBe('layout-2');
    expect(result.category).toBe('process');
  });

  it('should preserve nodes when changing layout', () => {
    const layout1 = createLayoutDefinition();
    const layout2 = createLayoutDefinition({ id: 'layout-2' });

    let diagram = createDiagram(layout1);
    const rootId = diagram.rootNodeIds[0];

    // Add a child
    const child = createNode({ text: 'Child' });
    diagram = addNodeToDiagram(diagram, child, 'child', rootId);

    const result = changeLayout(diagram, layout2);

    // Should still have 2 nodes
    expect(result.nodes.size).toBe(2);
    expect(result.nodes.has(rootId)).toBe(true);
    expect(result.nodes.has(child.id)).toBe(true);
  });

  it('should flatten hierarchy when new layout does not support children', () => {
    const hierarchicalDiagram = createHierarchicalDiagram();
    const flatLayout = createFlatLayoutDefinition();

    // Should have hierarchical structure
    expect(Array.from(hierarchicalDiagram.nodes.values()).some((n) => n.level > 0)).toBe(true);

    const result = changeLayout(hierarchicalDiagram, flatLayout);

    // All nodes should be at level 0
    result.nodes.forEach((node) => {
      expect(node.level).toBe(0);
      expect(node.parentId).toBe(null);
      expect(node.childIds).toEqual([]);
    });

    // All nodes should be roots
    expect(result.rootNodeIds.length).toBe(result.nodes.size);
  });

  it('should preserve node count when flattening', () => {
    const hierarchicalDiagram = createHierarchicalDiagram();
    const originalCount = hierarchicalDiagram.nodes.size;
    const flatLayout = createFlatLayoutDefinition();

    const result = changeLayout(hierarchicalDiagram, flatLayout);

    expect(result.nodes.size).toBe(originalCount);
  });

  it('should preserve node text when flattening', () => {
    const hierarchicalDiagram = createHierarchicalDiagram();
    const originalTexts = Array.from(hierarchicalDiagram.nodes.values()).map((n) => n.text);
    const flatLayout = createFlatLayoutDefinition();

    const result = changeLayout(hierarchicalDiagram, flatLayout);
    const resultTexts = Array.from(result.nodes.values()).map((n) => n.text);

    originalTexts.forEach((text) => {
      expect(resultTexts).toContain(text);
    });
  });

  it('should maintain document order when flattening', () => {
    const hierarchicalDiagram = createHierarchicalDiagram();
    const flatLayout = createFlatLayoutDefinition();

    const result = changeLayout(hierarchicalDiagram, flatLayout);

    // Verify siblingOrder is sequential
    result.rootNodeIds.forEach((id, index) => {
      expect(result.nodes.get(id)?.siblingOrder).toBe(index);
    });
  });

  it('should not flatten when new layout supports children', () => {
    const hierarchicalDiagram = createHierarchicalDiagram();
    const hierarchicalLayout = createLayoutDefinition({
      id: 'another-hierarchy',
      supportsChildren: true,
    });

    const result = changeLayout(hierarchicalDiagram, hierarchicalLayout);

    // Should preserve hierarchy
    expect(Array.from(result.nodes.values()).some((n) => n.level > 0)).toBe(true);
  });
});

describe('setQuickStyle', () => {
  it('should change the quick style id', () => {
    const layout = createLayoutDefinition();
    const diagram = createDiagram(layout);

    const result = setQuickStyle(diagram, 'intense-effect');

    expect(result.quickStyleId).toBe('intense-effect');
  });

  it('should preserve other diagram properties', () => {
    const layout = createLayoutDefinition();
    const diagram = createDiagram(layout);

    const result = setQuickStyle(diagram, 'new-style');

    expect(result.layoutId).toBe(diagram.layoutId);
    expect(result.nodes).toBe(diagram.nodes);
    expect(result.colorThemeId).toBe(diagram.colorThemeId);
  });
});

describe('setColorTheme', () => {
  it('should change the color theme id', () => {
    const layout = createLayoutDefinition();
    const diagram = createDiagram(layout);

    const result = setColorTheme(diagram, 'accent-2');

    expect(result.colorThemeId).toBe('accent-2');
  });

  it('should preserve other diagram properties', () => {
    const layout = createLayoutDefinition();
    const diagram = createDiagram(layout);

    const result = setColorTheme(diagram, 'new-theme');

    expect(result.layoutId).toBe(diagram.layoutId);
    expect(result.nodes).toBe(diagram.nodes);
    expect(result.quickStyleId).toBe(diagram.quickStyleId);
  });
});

describe('setLayoutOptions', () => {
  it('should set layout options', () => {
    const layout = createLayoutDefinition();
    const diagram = createDiagram(layout);

    const result = setLayoutOptions(diagram, { spacing: 20, direction: 'horizontal' });

    expect(result.layoutOptions).toEqual({ spacing: 20, direction: 'horizontal' });
  });

  it('should merge with existing options', () => {
    const layout = createLayoutDefinition();
    let diagram = createDiagram(layout);
    diagram = setLayoutOptions(diagram, { spacing: 20 });

    const result = setLayoutOptions(diagram, { direction: 'vertical' });

    expect(result.layoutOptions).toEqual({ spacing: 20, direction: 'vertical' });
  });

  it('should override existing options with same key', () => {
    const layout = createLayoutDefinition();
    let diagram = createDiagram(layout);
    diagram = setLayoutOptions(diagram, { spacing: 20 });

    const result = setLayoutOptions(diagram, { spacing: 30 });

    expect(result.layoutOptions).toEqual({ spacing: 30 });
  });
});
