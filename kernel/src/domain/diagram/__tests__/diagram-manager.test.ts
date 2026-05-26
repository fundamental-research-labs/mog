import { describe, expect, it } from '@jest/globals';

import type { DiagramObject, FloatingObject } from '@mog-sdk/contracts/floating-objects';

import { deserializeDiagram } from '../diagram-manager';

describe('deserializeDiagram', () => {
  function storedDiagramWith(rawDiagram: unknown, definition?: unknown): FloatingObject {
    return {
      id: 'diagram-1',
      type: 'diagram',
      sheetId: 'sheet-1',
      containerId: 'sheet-1',
      position: {
        anchorType: 'oneCell',
        from: { cellId: 'cell-0-0', xOffset: 100, yOffset: 100 },
        width: 400,
        height: 300,
        rotation: 0,
      },
      anchor: {
        anchorType: 'oneCell',
        from: { cellId: 'cell-0-0', xOffset: 100, yOffset: 100 },
        width: 400,
        height: 300,
        rotation: 0,
      },
      zIndex: 1,
      locked: false,
      printable: true,
      name: 'Diagram 1',
      definition,
      diagram: rawDiagram,
    } as unknown as FloatingObject;
  }

  const diagramData = {
    layoutId: 'list/basic-block-list',
    category: 'list',
    nodes: {
      node1: {
        id: 'node1',
        text: 'Text',
        level: 0,
        parentId: null,
        childIds: [],
        siblingOrder: 0,
      },
    },
    rootNodeIds: ['node1'],
    quickStyleId: 'subtle-effect',
    colorThemeId: 'colorful-1',
    layoutOptions: {},
  };

  it('hydrates persisted definition.dataXml diagrams into runtime Diagram objects', () => {
    const stored = storedDiagramWith(undefined, {
      dataXml: JSON.stringify(diagramData),
    });

    const diagram = deserializeDiagram(stored);

    expect(diagram).toBeDefined();
    expect(diagram?.diagram.layoutId).toBe('list/basic-block-list');
    expect(diagram?.diagram.category).toBe('list');
    expect(diagram?.diagram.nodes).toBeInstanceOf(Map);
    expect(
      diagram?.diagram.nodes.get('node1' as DiagramObject['diagram']['rootNodeIds'][number])?.text,
    ).toBe('Text');
  });

  it('hydrates mapped wire diagrams whose diagram property is SmartArtDefinition', () => {
    const stored = storedDiagramWith({
      dataXml: JSON.stringify(diagramData),
    });

    const diagram = deserializeDiagram(stored);

    expect(diagram).toBeDefined();
    expect(diagram?.diagram.layoutId).toBe('list/basic-block-list');
    expect(diagram?.diagram.category).toBe('list');
    expect(diagram?.diagram.nodes).toBeInstanceOf(Map);
    expect(
      diagram?.diagram.nodes.get('node1' as DiagramObject['diagram']['rootNodeIds'][number])?.text,
    ).toBe('Text');
  });
});
