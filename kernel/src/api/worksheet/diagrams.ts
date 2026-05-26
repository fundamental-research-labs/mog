/**
 * WorksheetDiagramsImpl — Implementation of the WorksheetDiagrams sub-API.
 *
 * CRUD operations inline the manager + event-bus logic directly (no operations layer).
 * Node/layout/cache ops delegate to IDiagramBridge (ctx.diagram internal bridge).
 */
import type { DiagramConfig, SheetId, WorksheetDiagrams } from '@mog-sdk/contracts/api';
import type { NodeMoveDirection, NodePosition } from '@mog-sdk/contracts/api';
import type { DiagramCreatedEvent, DiagramDeletedEvent } from '@mog-sdk/contracts/events';
import type { DiagramObject } from '@mog-sdk/contracts/floating-objects';
import type { ComputedLayout, NodeId, Diagram, DiagramNode } from '@mog-sdk/contracts/diagram';
import { toCellId } from '@mog-sdk/contracts/cell-identity';

import type { DocumentContext } from '../../context';
import { deserializeDiagram } from '../../domain/diagram/diagram-manager';
import { KernelError } from '../../errors';
import { diagramNotFound } from '../../errors/api';
import type { SpreadsheetObjectManager } from '../../floating-objects';

function defaultDiagramPosition(width = 400, height = 300): DiagramObject['position'] {
  return {
    anchorType: 'oneCell' as const,
    from: { cellId: toCellId('cell-0-0'), xOffset: 0, yOffset: 0 },
    width,
    height,
    rotation: 0,
  };
}

function parseStoredDiagram(object: DiagramObject): DiagramObject {
  const diagram = deserializeDiagram(object);
  if (!diagram) {
    throw new KernelError('OBJ_INVALID_CONFIG', `Invalid diagram object: ${object.id}`);
  }

  return diagram;
}

function serializeDiagramObject(object: DiagramObject): unknown {
  return {
    ...object,
    type: 'diagram',
    definition: {
      dataXml: JSON.stringify({
        ...object.diagram,
        nodes: Object.fromEntries(object.diagram.nodes),
      }),
    },
    category: object.diagram.category,
    diagram: undefined,
  };
}

function createDiagramObjectId(): string {
  return `obj-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function cloneDiagram(diagram: Diagram): Diagram {
  const idMap = new Map<NodeId, NodeId>();
  for (const nodeId of diagram.nodes.keys()) {
    idMap.set(nodeId, createDiagramObjectId() as NodeId);
  }

  const nodes = new Map<NodeId, DiagramNode>();
  for (const [oldId, node] of diagram.nodes.entries()) {
    const newId = idMap.get(oldId)!;
    nodes.set(newId, {
      ...node,
      id: newId,
      parentId: node.parentId ? (idMap.get(node.parentId) ?? null) : null,
      childIds: node.childIds.map((id) => idMap.get(id)!).filter(Boolean),
    });
  }

  return {
    ...diagram,
    nodes,
    rootNodeIds: diagram.rootNodeIds.map((id) => idMap.get(id)!).filter(Boolean),
  };
}

function offsetPosition(position: DiagramObject['position']): DiagramObject['position'] {
  const base = position.from ? position : defaultDiagramPosition(position.width, position.height);
  return {
    ...base,
    from: {
      ...base.from,
      xOffset: (base.from.xOffset ?? 0) + 20,
      yOffset: (base.from.yOffset ?? 0) + 20,
    },
    to: base.to
      ? {
          ...base.to,
          xOffset: (base.to.xOffset ?? 0) + 20,
          yOffset: (base.to.yOffset ?? 0) + 20,
        }
      : undefined,
  };
}

export class WorksheetDiagramsImpl implements WorksheetDiagrams {
  constructor(
    private readonly ctx: DocumentContext,
    private readonly sheetId: SheetId,
    private readonly manager: SpreadsheetObjectManager | null = null,
  ) {}

  /** Get the manager, throwing if not available. */
  private get mgr(): SpreadsheetObjectManager {
    if (!this.manager) {
      throw new KernelError('OPERATION_FAILED', 'FloatingObjectManager not available');
    }
    return this.manager;
  }

  /** Internal Diagram bridge accessor. */
  private get bridge() {
    return this.ctx.diagram;
  }

  private async getDiagramObject(objectId: string): Promise<DiagramObject | null> {
    const object = await this.ctx.computeBridge.getFloatingObject(this.sheetId, objectId);
    const type = (object as { type?: string } | null)?.type;
    if (!object || type !== 'diagram') {
      return null;
    }
    return parseStoredDiagram(object as DiagramObject);
  }

  private async getDiagramObjectsOnSheet(): Promise<DiagramObject[]> {
    const entries = await this.ctx.computeBridge.getFloatingObjectsInSheet(this.sheetId);
    const diagrams: DiagramObject[] = [];
    for (const [, object] of entries) {
      const type = (object as { type?: string } | null)?.type;
      if (type === 'diagram') {
        diagrams.push(parseStoredDiagram(object as DiagramObject));
      }
    }
    return diagrams;
  }

  // ===========================================================================
  // Core CRUD
  // ===========================================================================

  async add(config: DiagramConfig): Promise<DiagramObject> {
    const diagram = await this.mgr.createDiagram(
      this.sheetId,
      {
        from: {
          cellId: toCellId('cell-0-0'),
          xOffset: config.x ?? 0,
          yOffset: config.y ?? 0,
        },
        width: config.width,
        height: config.height,
      },
      config.layoutId,
      {
        initialNodes: config.nodes?.map((n) => ({ text: n.text, level: n.level ?? 0 })),
        name: config.name,
      },
    );

    const event: DiagramCreatedEvent = {
      type: 'diagram:created',
      timestamp: Date.now(),
      objectId: diagram.id,
      sheetId: this.sheetId,
      layoutId: config.layoutId,
      source: 'user',
    };
    this.ctx.eventBus.emit(event);

    return diagram;
  }

  async get(objectId: string): Promise<Diagram | null> {
    return (await this.getDiagramObject(objectId))?.diagram ?? null;
  }

  async has(objectId: string): Promise<boolean> {
    return (await this.get(objectId)) !== null;
  }

  async getCount(): Promise<number> {
    return (await this.list()).length;
  }

  async remove(objectId: string): Promise<void> {
    const existing = await this.getDiagramObject(objectId);
    if (!existing) {
      throw diagramNotFound(objectId);
    }

    await this.ctx.computeBridge.deleteFloatingObject(this.sheetId, objectId);

    const event: DiagramDeletedEvent = {
      type: 'diagram:deleted',
      timestamp: Date.now(),
      objectId,
      sheetId: this.sheetId,
      source: 'user',
    };
    this.ctx.eventBus.emit(event);
  }

  async list(): Promise<Diagram[]> {
    return (await this.getDiagramObjectsOnSheet()).map((object) => object.diagram);
  }

  async clear(): Promise<void> {
    for (const diagram of await this.getDiagramObjectsOnSheet()) {
      await this.remove(diagram.id);
    }
  }

  async duplicate(objectId: string): Promise<string> {
    const existing = await this.getDiagramObject(objectId);
    if (!existing) {
      throw diagramNotFound(objectId);
    }

    const newObjectId = createDiagramObjectId();
    const position = offsetPosition(existing.position);
    const duplicate: DiagramObject = {
      ...existing,
      id: newObjectId,
      name: existing.name ? `${existing.name} Copy` : undefined,
      zIndex: existing.zIndex + 1,
      position,
      anchor: position,
      diagram: cloneDiagram(existing.diagram),
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    await this.ctx.computeBridge.setFloatingObject(
      this.sheetId,
      newObjectId,
      serializeDiagramObject(duplicate),
    );

    const event: DiagramCreatedEvent = {
      type: 'diagram:created',
      timestamp: Date.now(),
      objectId: newObjectId,
      sheetId: this.sheetId,
      layoutId: duplicate.diagram.layoutId,
      source: 'user',
    };
    this.ctx.eventBus.emit(event);

    return newObjectId;
  }

  // ===========================================================================
  // Node Operations
  // ===========================================================================

  async addNode(
    objectId: string,
    text: string,
    position: NodePosition,
    referenceNodeId: NodeId | null,
  ): Promise<NodeId> {
    return this.bridge.addNode(objectId, text, position, referenceNodeId);
  }

  async removeNode(objectId: string, nodeId: NodeId): Promise<void> {
    return this.bridge.removeNode(objectId, nodeId);
  }

  async updateNode(objectId: string, nodeId: NodeId, updates: Partial<DiagramNode>): Promise<void> {
    return this.bridge.updateNode(objectId, nodeId, updates);
  }

  async moveNode(objectId: string, nodeId: NodeId, direction: NodeMoveDirection): Promise<void> {
    return this.bridge.moveNode(objectId, nodeId, direction);
  }

  async getNode(objectId: string, nodeId: NodeId): Promise<DiagramNode | undefined> {
    return this.bridge.getNode(objectId, nodeId);
  }

  // ===========================================================================
  // Diagram Reads (deprecated — use get/list instead)
  // ===========================================================================

  /** @deprecated Use `get(objectId)` instead. */
  async getDiagram(objectId: string): Promise<Diagram | null> {
    return this.get(objectId);
  }

  /** @deprecated Use `list()` instead. */
  async getDiagramsOnSheet(): Promise<Diagram[]> {
    return this.list();
  }

  // ===========================================================================
  // Layout and Style
  // ===========================================================================

  async changeLayout(objectId: string, newLayoutId: string): Promise<void> {
    return this.bridge.changeLayout(objectId, newLayoutId);
  }

  async changeQuickStyle(objectId: string, quickStyleId: string): Promise<void> {
    return this.bridge.changeQuickStyle(objectId, quickStyleId);
  }

  async changeColorTheme(objectId: string, colorThemeId: string): Promise<void> {
    return this.bridge.changeColorTheme(objectId, colorThemeId);
  }

  // ===========================================================================
  // Layout Computation (Cache Management)
  // ===========================================================================

  async getComputedLayout(objectId: string): Promise<ComputedLayout | undefined> {
    return this.bridge.getComputedLayout(objectId);
  }

  invalidateLayout(objectId: string): void {
    this.bridge.invalidateLayout(objectId);
  }

  invalidateAllLayouts(): void {
    this.bridge.invalidateAllLayouts();
  }
}
