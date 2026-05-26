/**
 * Diagram Manager (Spreadsheet-Specific)
 *
 * Standalone functions for Diagram-specific floating object operations.
 *
 * This is spreadsheet-specific because:
 * - Diagram objects are positioned on the cell grid
 *
 * Key change from managers/diagram-engine-manager.ts:
 * - sheetId -> containerId in public API
 * - Event emission is handled by the caller (SpreadsheetObjectManager)
 *
 * @see contracts/src/floating-objects.ts - DiagramObject interface
 * @see contracts/src/diagram-engine/types.ts - Diagram diagram types
 */

import type {
  CreateDiagramOptions,
  FloatingObject,
  ObjectPosition,
  DiagramObject,
} from '@mog-sdk/contracts/floating-objects';
import { toCellId } from '@mog-sdk/contracts/cell-identity';
import type { NodeId, DiagramCategory, Diagram, DiagramNode } from '@mog-sdk/contracts/diagram';

import { createNodeId } from '@mog/diagram-engine/types';

import type { IObjectStore } from '@mog-sdk/contracts/objects/canvas-object';
import { type SheetId, sheetId as toSheetId } from '@mog-sdk/contracts/core';
import type { ComputeBridge } from '../../bridges/compute/compute-bridge';

// =============================================================================
// CONSTANTS
// =============================================================================

const DEFAULT_DIAGRAM_WIDTH = 400;
const DEFAULT_DIAGRAM_HEIGHT = 300;
const DEFAULT_QUICK_STYLE_ID = 'subtle-effect';
const DEFAULT_COLOR_THEME_ID = 'accent-1';

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function generateObjectId(): string {
  return `obj-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

async function getNextZIndex(
  store: IObjectStore<FloatingObject>,
  containerId: SheetId,
): Promise<number> {
  const objects = await store.readInDocument(containerId);
  let maxZ = 0;
  for (const obj of objects) {
    if (obj.zIndex > maxZ) {
      maxZ = obj.zIndex;
    }
  }
  return maxZ + 1;
}

function normalizePosition(
  partial: Partial<ObjectPosition>,
  defaultWidth: number,
  defaultHeight: number,
): ObjectPosition {
  const anchorType = partial.anchorType ?? 'oneCell';
  const defaultAnchor = { cellId: toCellId('cell-0-0'), xOffset: 10, yOffset: 10 };

  return {
    anchorType,
    from: partial.from ?? defaultAnchor,
    to: partial.to,
    x: partial.x,
    y: partial.y,
    width: partial.width ?? defaultWidth,
    height: partial.height ?? defaultHeight,
    rotation: partial.rotation ?? 0,
    flipH: partial.flipH,
    flipV: partial.flipV,
  };
}

function getCategoryFromLayoutId(layoutId: string): DiagramCategory {
  const [category] = layoutId.split('/');
  const validCategories: DiagramCategory[] = [
    'list',
    'process',
    'cycle',
    'hierarchy',
    'relationship',
    'matrix',
    'pyramid',
    'picture',
  ];

  if (validCategories.includes(category as DiagramCategory)) {
    return category as DiagramCategory;
  }

  return 'hierarchy';
}

function createDefaultDiagram(layoutId: string, options?: CreateDiagramOptions): Diagram {
  const category = getCategoryFromLayoutId(layoutId);
  const nodes = new Map<NodeId, DiagramNode>();
  const rootNodeIds: NodeId[] = [];

  if (options?.initialNodes && options.initialNodes.length > 0) {
    const levelStacks: NodeId[][] = [];

    for (const nodeData of options.initialNodes) {
      const nodeId = createNodeId();
      const level = nodeData.level;

      while (levelStacks.length <= level) {
        levelStacks.push([]);
      }

      let parentId: NodeId | null = null;
      for (let l = level - 1; l >= 0; l--) {
        if (levelStacks[l] && levelStacks[l].length > 0) {
          parentId = levelStacks[l][levelStacks[l].length - 1];
          break;
        }
      }

      const node: DiagramNode = {
        id: nodeId,
        text: nodeData.text,
        level,
        parentId,
        childIds: [],
        siblingOrder: levelStacks[level].length,
      };

      nodes.set(nodeId, node);
      levelStacks[level].push(nodeId);

      if (level === 0) {
        rootNodeIds.push(nodeId);
      }

      if (parentId) {
        const parent = nodes.get(parentId);
        if (parent) {
          parent.childIds.push(nodeId);
        }
      }
    }
  } else {
    const rootId = createNodeId();
    const rootNode: DiagramNode = {
      id: rootId,
      text: 'Text',
      level: 0,
      parentId: null,
      childIds: [],
      siblingOrder: 0,
    };
    nodes.set(rootId, rootNode);
    rootNodeIds.push(rootId);
  }

  return {
    layoutId,
    category,
    nodes,
    rootNodeIds,
    quickStyleId: options?.quickStyleId ?? DEFAULT_QUICK_STYLE_ID,
    colorThemeId: options?.colorThemeId ?? DEFAULT_COLOR_THEME_ID,
    layoutOptions: {},
  };
}

function serializeDiagramForStorage(diagram: Diagram): unknown {
  return {
    ...diagram,
    nodes: Object.fromEntries(diagram.nodes),
  };
}

function toDiagramStorageObject(diagramObject: DiagramObject): unknown {
  return {
    ...diagramObject,
    type: 'diagram',
    definition: {
      dataXml: JSON.stringify(serializeDiagramForStorage(diagramObject.diagram)),
    },
    category: diagramObject.diagram.category,
    diagram: undefined,
  };
}

// =============================================================================
// DIAGRAM OPERATIONS
// =============================================================================

/**
 * Create a Diagram object.
 */
export async function createDiagram(
  store: IObjectStore<FloatingObject>,
  computeBridge: ComputeBridge,
  containerId: SheetId,
  layoutId: string,
  position: Partial<ObjectPosition>,
  options?: CreateDiagramOptions,
  nameGenerator?: () => string,
): Promise<DiagramObject> {
  const id = generateObjectId();
  const now = Date.now();

  const normalizedPosition = normalizePosition(
    position,
    DEFAULT_DIAGRAM_WIDTH,
    DEFAULT_DIAGRAM_HEIGHT,
  );

  const diagram = createDefaultDiagram(layoutId, options);
  const zIndex = await getNextZIndex(store, containerId);

  const diagramObj: DiagramObject = {
    id,
    type: 'diagram',
    sheetId: containerId,
    containerId,
    position: normalizedPosition,
    anchor: normalizedPosition,
    zIndex,
    locked: options?.locked ?? false,
    printable: options?.printable ?? true,
    name: options?.name ?? nameGenerator?.() ?? `Diagram ${id.slice(-4)}`,
    altText: options?.altText,
    diagram,
    createdAt: now,
    updatedAt: now,
  };

  await computeBridge.setFloatingObject(
    containerId,
    diagramObj.id,
    toDiagramStorageObject(diagramObj),
  );

  return diagramObj;
}

/**
 * Deep copy a Diagram diagram with new node IDs.
 */
function deepCopyDiagram(diagram: Diagram): Diagram {
  const idMapping = new Map<NodeId, NodeId>();
  Array.from(diagram.nodes.keys()).forEach((oldId) => {
    idMapping.set(oldId, createNodeId());
  });

  const newNodes = new Map<NodeId, DiagramNode>();
  Array.from(diagram.nodes.entries()).forEach(([oldId, oldNode]) => {
    const newId = idMapping.get(oldId)!;
    const newNode: DiagramNode = {
      ...oldNode,
      id: newId,
      parentId: oldNode.parentId ? (idMapping.get(oldNode.parentId) ?? null) : null,
      childIds: oldNode.childIds.map((childId) => idMapping.get(childId)!).filter(Boolean),
    };
    newNodes.set(newId, newNode);
  });

  const newRootNodeIds = diagram.rootNodeIds.map((id) => idMapping.get(id)!).filter(Boolean);

  return {
    ...diagram,
    nodes: newNodes,
    rootNodeIds: newRootNodeIds,
  };
}

/**
 * Duplicate a Diagram object with optional position offset.
 */
export async function duplicateDiagram(
  store: IObjectStore<FloatingObject>,
  computeBridge: ComputeBridge,
  originalDiagram: DiagramObject,
  offset?: { dx: number; dy: number },
  nameGenerator?: () => string,
): Promise<DiagramObject> {
  const DEFAULT_DUPLICATE_OFFSET = 20;
  const dx = offset?.dx ?? DEFAULT_DUPLICATE_OFFSET;
  const dy = offset?.dy ?? DEFAULT_DUPLICATE_OFFSET;

  const newPosition: ObjectPosition = {
    ...originalDiagram.position,
    from: {
      ...originalDiagram.position.from,
      xOffset: originalDiagram.position.from.xOffset + dx,
      yOffset: originalDiagram.position.from.yOffset + dy,
    },
  };

  if (originalDiagram.position.to) {
    newPosition.to = {
      ...originalDiagram.position.to,
      xOffset: originalDiagram.position.to.xOffset + dx,
      yOffset: originalDiagram.position.to.yOffset + dy,
    };
  }

  const duplicatedDiagram = deepCopyDiagram(originalDiagram.diagram);

  const id = generateObjectId();
  const now = Date.now();
  const normalizedPosition = normalizePosition(
    newPosition,
    DEFAULT_DIAGRAM_WIDTH,
    DEFAULT_DIAGRAM_HEIGHT,
  );

  const zIndex = await getNextZIndex(store, originalDiagram.sheetId);

  const diagramObj: DiagramObject = {
    id,
    type: 'diagram',
    sheetId: originalDiagram.sheetId,
    containerId: originalDiagram.sheetId,
    position: normalizedPosition,
    anchor: normalizedPosition,
    zIndex,
    locked: false,
    printable: originalDiagram.printable,
    name: nameGenerator?.() ?? `${originalDiagram.name} Copy`,
    altText: originalDiagram.altText,
    diagram: duplicatedDiagram,
    createdAt: now,
    updatedAt: now,
  };

  await computeBridge.setFloatingObject(
    originalDiagram.sheetId,
    diagramObj.id,
    toDiagramStorageObject(diagramObj),
  );

  return diagramObj;
}

/**
 * Update a Diagram diagram using an updater function.
 */
export async function updateDiagram(
  store: IObjectStore<FloatingObject>,
  computeBridge: ComputeBridge,
  objectId: string,
  updater: (diagram: Diagram) => Diagram,
): Promise<DiagramObject | null> {
  const found = await store.read(objectId);
  if (!found.object || !found.containerId || found.object.type !== 'diagram') {
    console.warn(`[diagram-manager] Diagram object not found: ${objectId}`);
    return null;
  }

  const foundObject = deserializeDiagram(found.object);
  if (!foundObject) {
    console.warn(`[diagram-manager] Failed to deserialize Diagram: ${objectId}`);
    return null;
  }

  const updatedDiagram = updater(foundObject.diagram);
  const now = Date.now();

  const updated: DiagramObject = {
    ...foundObject,
    diagram: updatedDiagram,
    updatedAt: now,
  };

  await computeBridge.setFloatingObject(
    toSheetId(found.containerId),
    objectId,
    toDiagramStorageObject(updated),
  );

  return updated;
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

export function isDiagram(obj: FloatingObject): obj is DiagramObject {
  return obj.type === 'diagram';
}

export function asDiagramObject(obj: FloatingObject | undefined): DiagramObject | undefined {
  if (obj && isDiagram(obj)) return obj;
  return undefined;
}

/**
 * Deserialize a Diagram diagram from storage format.
 */
export function deserializeDiagram(obj: FloatingObject): DiagramObject | undefined {
  if (obj.type !== 'diagram') return undefined;

  const diagramRaw = obj as DiagramObject;
  const rawDiagram = diagramRaw.diagram as unknown;
  const diagram = isRuntimeDiagram(rawDiagram)
    ? rawDiagram
    : parseStoredDiagramDefinition(
        readDataXml(rawDiagram) ??
          (diagramRaw as DiagramObject & { definition?: { dataXml?: unknown } }).definition
            ?.dataXml,
      );

  if (!diagram) {
    console.warn('[diagram-manager] Unexpected diagram structure:', obj.id);
    return undefined;
  }

  let nodesMap: Map<NodeId, DiagramNode>;
  if (diagram.nodes instanceof Map) {
    nodesMap = diagram.nodes;
  } else {
    nodesMap = new Map(Object.entries(diagram.nodes as Record<string, DiagramNode>)) as Map<
      NodeId,
      DiagramNode
    >;
  }

  return {
    ...diagramRaw,
    diagram: {
      ...diagram,
      nodes: nodesMap,
    },
  };
}

function parseStoredDiagramDefinition(dataXml: unknown): Diagram | undefined {
  if (!dataXml) return undefined;
  if (typeof dataXml === 'object') return dataXml as Diagram;
  if (typeof dataXml !== 'string') return undefined;

  try {
    const parsed = JSON.parse(dataXml);
    return parsed && typeof parsed === 'object' ? (parsed as Diagram) : undefined;
  } catch {
    return undefined;
  }
}

function isRuntimeDiagram(value: unknown): value is Diagram {
  return (
    !!value &&
    typeof value === 'object' &&
    'nodes' in value &&
    (value as { nodes?: unknown }).nodes != null
  );
}

function readDataXml(value: unknown): unknown {
  return value && typeof value === 'object' ? (value as { dataXml?: unknown }).dataXml : undefined;
}
