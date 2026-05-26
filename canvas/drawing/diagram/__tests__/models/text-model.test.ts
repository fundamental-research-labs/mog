import type { Diagram } from '@mog-sdk/contracts/diagram';
import { addNodeToDiagram, createNode } from '../../src/models/node';
import {
  applyOutlineToDiagram,
  diagramToOutline,
  OutlineNode,
  parseOutline,
} from '../../src/models/text-model';

// Helper to create a minimal empty diagram
function createEmptyDiagram(): Diagram {
  return {
    layoutId: 'test-layout',
    category: 'list',
    nodes: new Map(),
    rootNodeIds: [],
    quickStyleId: 'subtle-effect',
    colorThemeId: 'colorful-1',
    layoutOptions: {},
  };
}

// Helper to create a single-node diagram
function createSingleNodeDiagram(): Diagram {
  const node = createNode({ text: 'Root', level: 0, parentId: null });
  return {
    layoutId: 'test-layout',
    category: 'list',
    nodes: new Map([[node.id, node]]),
    rootNodeIds: [node.id],
    quickStyleId: 'subtle-effect',
    colorThemeId: 'colorful-1',
    layoutOptions: {},
  };
}

// Helper to create a hierarchical diagram
function createHierarchicalDiagram(): Diagram {
  let diagram = createEmptyDiagram();

  const root1 = createNode({ text: 'Root 1' });
  diagram = addNodeToDiagram(diagram, root1, 'after');

  const child1 = createNode({ text: 'Child 1' });
  diagram = addNodeToDiagram(diagram, child1, 'child', root1.id);

  const grandchild = createNode({ text: 'Grandchild' });
  diagram = addNodeToDiagram(diagram, grandchild, 'child', child1.id);

  const child2 = createNode({ text: 'Child 2' });
  diagram = addNodeToDiagram(diagram, child2, 'child', root1.id);

  const root2 = createNode({ text: 'Root 2' });
  diagram = addNodeToDiagram(diagram, root2, 'after');

  return diagram;
}

describe('parseOutline', () => {
  it('should parse simple flat outline', () => {
    const text = `First
Second
Third`;
    const result = parseOutline(text);

    expect(result).toEqual([
      { text: 'First', level: 0 },
      { text: 'Second', level: 0 },
      { text: 'Third', level: 0 },
    ]);
  });

  it('should parse outline with tab indentation', () => {
    const text = `Root
\tChild 1
\t\tGrandchild
\tChild 2`;
    const result = parseOutline(text);

    expect(result).toEqual([
      { text: 'Root', level: 0 },
      { text: 'Child 1', level: 1 },
      { text: 'Grandchild', level: 2 },
      { text: 'Child 2', level: 1 },
    ]);
  });

  it('should parse outline with space indentation (2 spaces per level)', () => {
    const text = `Root
  Child 1
    Grandchild
  Child 2`;
    const result = parseOutline(text);

    expect(result).toEqual([
      { text: 'Root', level: 0 },
      { text: 'Child 1', level: 1 },
      { text: 'Grandchild', level: 2 },
      { text: 'Child 2', level: 1 },
    ]);
  });

  it('should strip bullet prefixes (dash)', () => {
    const text = `- First
- Second
- Third`;
    const result = parseOutline(text);

    expect(result).toEqual([
      { text: 'First', level: 0 },
      { text: 'Second', level: 0 },
      { text: 'Third', level: 0 },
    ]);
  });

  it('should strip bullet prefixes (bullet character)', () => {
    const text = `\u2022 First
\u2022 Second`;
    const result = parseOutline(text);

    expect(result).toEqual([
      { text: 'First', level: 0 },
      { text: 'Second', level: 0 },
    ]);
  });

  it('should handle mixed indentation and bullets', () => {
    const text = `- Root
\t- Child 1
\t\t- Grandchild`;
    const result = parseOutline(text);

    expect(result).toEqual([
      { text: 'Root', level: 0 },
      { text: 'Child 1', level: 1 },
      { text: 'Grandchild', level: 2 },
    ]);
  });

  it('should skip empty lines', () => {
    const text = `First

Second

Third`;
    const result = parseOutline(text);

    expect(result).toEqual([
      { text: 'First', level: 0 },
      { text: 'Second', level: 0 },
      { text: 'Third', level: 0 },
    ]);
  });

  it('should skip lines with only whitespace', () => {
    const text = `First

Second`;
    const result = parseOutline(text);

    expect(result).toEqual([
      { text: 'First', level: 0 },
      { text: 'Second', level: 0 },
    ]);
  });

  it('should return empty array for empty string', () => {
    expect(parseOutline('')).toEqual([]);
  });

  it('should return empty array for whitespace only', () => {
    expect(parseOutline('   \n\t\n   ')).toEqual([]);
  });
});

describe('applyOutlineToDiagram', () => {
  it('should create nodes from outline', () => {
    const diagram = createEmptyDiagram();
    const outline: OutlineNode[] = [
      { text: 'First', level: 0 },
      { text: 'Second', level: 0 },
      { text: 'Third', level: 0 },
    ];

    const result = applyOutlineToDiagram(diagram, outline);

    expect(result.nodes.size).toBe(3);
    expect(result.rootNodeIds.length).toBe(3);
  });

  it('should create hierarchical structure', () => {
    const diagram = createEmptyDiagram();
    const outline: OutlineNode[] = [
      { text: 'Root', level: 0 },
      { text: 'Child 1', level: 1 },
      { text: 'Grandchild', level: 2 },
      { text: 'Child 2', level: 1 },
    ];

    const result = applyOutlineToDiagram(diagram, outline);

    expect(result.rootNodeIds.length).toBe(1);

    const root = result.nodes.get(result.rootNodeIds[0])!;
    expect(root.text).toBe('Root');
    expect(root.childIds.length).toBe(2);

    const child1 = result.nodes.get(root.childIds[0])!;
    expect(child1.text).toBe('Child 1');
    expect(child1.level).toBe(1);
    expect(child1.childIds.length).toBe(1);

    const grandchild = result.nodes.get(child1.childIds[0])!;
    expect(grandchild.text).toBe('Grandchild');
    expect(grandchild.level).toBe(2);
  });

  it('should set correct parent references', () => {
    const diagram = createEmptyDiagram();
    const outline: OutlineNode[] = [
      { text: 'Root', level: 0 },
      { text: 'Child', level: 1 },
    ];

    const result = applyOutlineToDiagram(diagram, outline);

    const rootId = result.rootNodeIds[0];
    const root = result.nodes.get(rootId)!;
    const childId = root.childIds[0];
    const child = result.nodes.get(childId)!;

    expect(child.parentId).toBe(rootId);
  });

  it('should set correct sibling orders', () => {
    const diagram = createEmptyDiagram();
    const outline: OutlineNode[] = [
      { text: 'Root', level: 0 },
      { text: 'Child 1', level: 1 },
      { text: 'Child 2', level: 1 },
      { text: 'Child 3', level: 1 },
    ];

    const result = applyOutlineToDiagram(diagram, outline);

    const root = result.nodes.get(result.rootNodeIds[0])!;
    root.childIds.forEach((childId, index) => {
      const child = result.nodes.get(childId)!;
      expect(child.siblingOrder).toBe(index);
    });
  });

  it('should handle multiple roots', () => {
    const diagram = createEmptyDiagram();
    const outline: OutlineNode[] = [
      { text: 'Root 1', level: 0 },
      { text: 'Child of Root 1', level: 1 },
      { text: 'Root 2', level: 0 },
      { text: 'Child of Root 2', level: 1 },
    ];

    const result = applyOutlineToDiagram(diagram, outline);

    expect(result.rootNodeIds.length).toBe(2);

    const root1 = result.nodes.get(result.rootNodeIds[0])!;
    const root2 = result.nodes.get(result.rootNodeIds[1])!;

    expect(root1.text).toBe('Root 1');
    expect(root2.text).toBe('Root 2');
    expect(root1.childIds.length).toBe(1);
    expect(root2.childIds.length).toBe(1);
  });

  it('should replace existing nodes', () => {
    const diagram = createSingleNodeDiagram();
    const outline: OutlineNode[] = [{ text: 'New Node', level: 0 }];

    const result = applyOutlineToDiagram(diagram, outline);

    // Should have new node, not old one
    expect(result.nodes.size).toBe(1);
    const node = result.nodes.get(result.rootNodeIds[0])!;
    expect(node.text).toBe('New Node');
  });

  it('should handle empty outline', () => {
    const diagram = createSingleNodeDiagram();
    const result = applyOutlineToDiagram(diagram, []);

    expect(result.nodes.size).toBe(0);
    expect(result.rootNodeIds.length).toBe(0);
  });

  it('should preserve diagram properties', () => {
    const diagram = createSingleNodeDiagram();
    diagram.quickStyleId = 'custom-style';
    diagram.colorThemeId = 'custom-theme';

    const outline: OutlineNode[] = [{ text: 'New', level: 0 }];
    const result = applyOutlineToDiagram(diagram, outline);

    expect(result.quickStyleId).toBe('custom-style');
    expect(result.colorThemeId).toBe('custom-theme');
    expect(result.layoutId).toBe(diagram.layoutId);
  });
});

describe('diagramToOutline', () => {
  it('should convert single node to outline', () => {
    const diagram = createSingleNodeDiagram();
    const result = diagramToOutline(diagram);

    expect(result).toBe('\u2022 Root');
  });

  it('should convert hierarchical diagram to outline', () => {
    const diagram = createHierarchicalDiagram();
    const result = diagramToOutline(diagram);

    const lines = result.split('\n');
    expect(lines[0]).toBe('\u2022 Root 1');
    expect(lines[1]).toBe('\t\u2022 Child 1');
    expect(lines[2]).toBe('\t\t\u2022 Grandchild');
    expect(lines[3]).toBe('\t\u2022 Child 2');
    expect(lines[4]).toBe('\u2022 Root 2');
  });

  it('should return empty string for empty diagram', () => {
    const diagram = createEmptyDiagram();
    const result = diagramToOutline(diagram);

    expect(result).toBe('');
  });

  it('should use correct indentation for levels', () => {
    let diagram = createEmptyDiagram();

    const root = createNode({ text: 'Level 0' });
    diagram = addNodeToDiagram(diagram, root, 'after');

    const level1 = createNode({ text: 'Level 1' });
    diagram = addNodeToDiagram(diagram, level1, 'child', root.id);

    const level2 = createNode({ text: 'Level 2' });
    diagram = addNodeToDiagram(diagram, level2, 'child', level1.id);

    const level3 = createNode({ text: 'Level 3' });
    diagram = addNodeToDiagram(diagram, level3, 'child', level2.id);

    const result = diagramToOutline(diagram);
    const lines = result.split('\n');

    expect(lines[0]).toBe('\u2022 Level 0');
    expect(lines[1]).toBe('\t\u2022 Level 1');
    expect(lines[2]).toBe('\t\t\u2022 Level 2');
    expect(lines[3]).toBe('\t\t\t\u2022 Level 3');
  });
});

describe('roundtrip', () => {
  it('should preserve structure through parse and apply', () => {
    const originalText = `Root 1
\tChild 1
\t\tGrandchild
\tChild 2
Root 2`;

    const parsed = parseOutline(originalText);
    const diagram = applyOutlineToDiagram(createEmptyDiagram(), parsed);
    const resultText = diagramToOutline(diagram);

    // Parse both and compare structure
    const originalParsed = parseOutline(originalText);
    const resultParsed = parseOutline(resultText);

    expect(resultParsed.length).toBe(originalParsed.length);
    originalParsed.forEach((node, i) => {
      expect(resultParsed[i].text).toBe(node.text);
      expect(resultParsed[i].level).toBe(node.level);
    });
  });

  it('should preserve text content through roundtrip', () => {
    const texts = ['First Item', 'Second Item', 'Third Item'];
    const outline = texts.map((text) => ({ text, level: 0 }));

    const diagram = applyOutlineToDiagram(createEmptyDiagram(), outline);
    const resultText = diagramToOutline(diagram);
    const resultParsed = parseOutline(resultText);

    texts.forEach((text, i) => {
      expect(resultParsed[i].text).toBe(text);
    });
  });

  it('should preserve hierarchy through roundtrip', () => {
    const outline: OutlineNode[] = [
      { text: 'Parent', level: 0 },
      { text: 'Child', level: 1 },
      { text: 'Grandchild', level: 2 },
      { text: 'Sibling', level: 1 },
    ];

    const diagram = applyOutlineToDiagram(createEmptyDiagram(), outline);
    const resultText = diagramToOutline(diagram);
    const resultParsed = parseOutline(resultText);

    expect(resultParsed).toEqual(outline);
  });
});

describe('edge cases', () => {
  it('should handle text with special characters', () => {
    const outline: OutlineNode[] = [{ text: 'Text with & < > " \' chars', level: 0 }];

    const diagram = applyOutlineToDiagram(createEmptyDiagram(), outline);
    const node = diagram.nodes.get(diagram.rootNodeIds[0])!;

    expect(node.text).toBe('Text with & < > " \' chars');
  });

  it('should handle very deep nesting', () => {
    const outline: OutlineNode[] = [];
    for (let i = 0; i < 10; i++) {
      outline.push({ text: `Level ${i}`, level: i });
    }

    const diagram = applyOutlineToDiagram(createEmptyDiagram(), outline);

    // Verify structure
    let currentNode = diagram.nodes.get(diagram.rootNodeIds[0])!;
    for (let i = 0; i < 10; i++) {
      expect(currentNode.text).toBe(`Level ${i}`);
      expect(currentNode.level).toBe(i);
      if (i < 9) {
        currentNode = diagram.nodes.get(currentNode.childIds[0])!;
      }
    }
  });

  it('should handle jumping back multiple levels', () => {
    const outline: OutlineNode[] = [
      { text: 'Root', level: 0 },
      { text: 'Deep 1', level: 1 },
      { text: 'Deep 2', level: 2 },
      { text: 'Deep 3', level: 3 },
      { text: 'Back to Root', level: 0 },
    ];

    const diagram = applyOutlineToDiagram(createEmptyDiagram(), outline);

    expect(diagram.rootNodeIds.length).toBe(2);
    expect(diagram.nodes.get(diagram.rootNodeIds[1])?.text).toBe('Back to Root');
  });

  it('should handle single character text', () => {
    const outline: OutlineNode[] = [
      { text: 'A', level: 0 },
      { text: 'B', level: 1 },
    ];

    const diagram = applyOutlineToDiagram(createEmptyDiagram(), outline);
    const root = diagram.nodes.get(diagram.rootNodeIds[0])!;

    expect(root.text).toBe('A');
    expect(diagram.nodes.get(root.childIds[0])?.text).toBe('B');
  });

  it('should handle empty text nodes', () => {
    const outline: OutlineNode[] = [
      { text: '', level: 0 },
      { text: 'Has text', level: 0 },
    ];

    const diagram = applyOutlineToDiagram(createEmptyDiagram(), outline);

    expect(diagram.nodes.get(diagram.rootNodeIds[0])?.text).toBe('');
    expect(diagram.nodes.get(diagram.rootNodeIds[1])?.text).toBe('Has text');
  });
});
