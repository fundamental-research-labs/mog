/**
 * Diagram Bridge
 *
 * Bridges the standalone Diagram library (@mog/diagram-engine) to the engine.
 * This bridge handles:
 * - Computed layout caching (invalidated on structure/style changes)
 * - EventBus subscriptions for reactive updates
 * - Node operations (add, remove, update, move)
 * - Layout and style management
 *
 * Architecture Notes:
 * - ComputedLayout is a runtime cache, NOT persisted to storage
 * - The bridge listens to EventBus for automatic cache invalidation
 * - Provides ctx.diagram.* access pattern
 *
 * @see contracts/src/bridges/diagram-engine-bridge.ts - Interface definition
 * @see contracts/src/diagram-engine/types.ts - Core Diagram types
 */

import type {
  ComputedLayoutCache,
  IDiagramBridge,
  NodeMoveDirection,
  NodePosition,
} from '@mog-sdk/contracts/bridges';
import type { SheetId } from '@mog-sdk/contracts/core';
import type { DrawingObject } from '@mog-sdk/contracts/drawing';
import type {
  DiagramLayoutChangedEvent,
  DiagramNodeAddedEvent,
  DiagramNodeMovedEvent,
  DiagramNodeRemovedEvent,
  DiagramNodeUpdatedEvent,
  DiagramNodesBatchAddedEvent,
  DiagramNodesBatchRemovedEvent,
  DiagramStyleChangedEvent,
} from '@mog-sdk/contracts/events';
import type { FloatingObject, DiagramObject } from '@mog-sdk/contracts/floating-objects';
import type {
  ComputedConnector,
  ComputedLayout,
  ComputedShape,
  LayoutResult,
  NodeId,
  Diagram,
  DiagramNode,
} from '@mog-sdk/contracts/diagram';

import {
  addNodeToDiagram,
  changeLayout as changeLayoutModel,
  computeLayout as computeLayoutInternal,
  createNode,
  demoteNode,
  layoutRegistry,
  layoutToDrawingObjects,
  moveNodeDown,
  moveNodeUp,
  promoteNode,
  removeNodeFromDiagram,
} from '@mog/diagram-engine';

import type { DocumentContext } from '../../context/types';
import { BridgeError } from '../../errors/bridge';
import { toCellId } from '@mog-sdk/contracts/cell-identity';

function defaultDiagramPosition(width = 400, height = 300): DiagramObject['position'] {
  return {
    anchorType: 'oneCell' as const,
    from: { cellId: toCellId('cell-0-0'), xOffset: 0, yOffset: 0 },
    width,
    height,
    rotation: 0,
  };
}

// =============================================================================
// Re-export types from contracts for backward compatibility
// =============================================================================

export type {
  ComputedLayout,
  ComputedLayoutCache,
  IDiagramBridge,
  NodeMoveDirection,
  NodePosition,
  Diagram,
  DiagramNode,
};

// =============================================================================
// Diagram Bridge Class
// =============================================================================

/**
 * Diagram Bridge
 *
 * Connects the standalone Diagram library to the engine's reactive system.
 *
 * Key responsibilities:
 * 1. Cache computed layouts (invalidate on structure/style changes)
 * 2. Subscribe to Diagram change events
 * 3. Provide API for node operations
 * 4. Manage layout and style changes
 */
export class DiagramBridge implements IDiagramBridge {
  /** Cache of computed layouts per Diagram object ID */
  private layoutCache = new Map<string, ComputedLayoutCache>();

  /** Cleanup functions for event subscriptions */
  private cleanups: Array<() => void> = [];

  /** Whether the bridge has been started */
  private started = false;

  /** Version counter for cache invalidation tracking */
  private versionCounter = 0;

  constructor(private ctx: DocumentContext) {}

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  /**
   * Start the Diagram bridge - subscribe to events for reactive updates.
   *
   * @returns Cleanup function to stop the bridge
   */
  start(): () => void {
    if (this.started) {
      return () => this.stop();
    }
    this.started = true;

    this.setupSubscriptions();

    return () => this.stop();
  }

  /**
   * Stop the Diagram bridge and clean up subscriptions.
   */
  stop(): void {
    this.cleanups.forEach((fn) => fn());
    this.cleanups = [];
    this.layoutCache.clear();
    this.started = false;
  }

  /**
   * Destroy the bridge - alias for stop().
   */
  destroy(): void {
    this.stop();
  }

  // ===========================================================================
  // Event Subscriptions
  // ===========================================================================

  /**
   * Set up EventBus subscriptions for reactive Diagram updates.
   */
  private setupSubscriptions(): void {
    // Subscribe to node added events
    const unsubNodeAdded = this.ctx.eventBus.on('diagram:node-added', (event) => {
      const typedEvent = event as DiagramNodeAddedEvent;
      this.invalidateLayout(typedEvent.objectId);
    });
    this.cleanups.push(unsubNodeAdded);

    // Subscribe to node removed events
    const unsubNodeRemoved = this.ctx.eventBus.on('diagram:node-removed', (event) => {
      const typedEvent = event as DiagramNodeRemovedEvent;
      this.invalidateLayout(typedEvent.objectId);
    });
    this.cleanups.push(unsubNodeRemoved);

    // Subscribe to node updated events
    const unsubNodeUpdated = this.ctx.eventBus.on('diagram:node-updated', (event) => {
      const typedEvent = event as DiagramNodeUpdatedEvent;
      this.invalidateLayout(typedEvent.objectId);
    });
    this.cleanups.push(unsubNodeUpdated);

    // Subscribe to node moved events
    const unsubNodeMoved = this.ctx.eventBus.on('diagram:node-moved', (event) => {
      const typedEvent = event as DiagramNodeMovedEvent;
      this.invalidateLayout(typedEvent.objectId);
    });
    this.cleanups.push(unsubNodeMoved);

    // Subscribe to batch node added events
    const unsubBatchAdded = this.ctx.eventBus.on('diagram:nodes-batch-added', (event) => {
      const typedEvent = event as DiagramNodesBatchAddedEvent;
      this.invalidateLayout(typedEvent.objectId);
    });
    this.cleanups.push(unsubBatchAdded);

    // Subscribe to batch node removed events
    const unsubBatchRemoved = this.ctx.eventBus.on('diagram:nodes-batch-removed', (event) => {
      const typedEvent = event as DiagramNodesBatchRemovedEvent;
      this.invalidateLayout(typedEvent.objectId);
    });
    this.cleanups.push(unsubBatchRemoved);

    // Subscribe to layout changed events
    const unsubLayoutChanged = this.ctx.eventBus.on('diagram:layout-changed', (event) => {
      const typedEvent = event as DiagramLayoutChangedEvent;
      this.invalidateLayout(typedEvent.objectId);
    });
    this.cleanups.push(unsubLayoutChanged);

    // Subscribe to style changed events
    const unsubStyleChanged = this.ctx.eventBus.on('diagram:style-changed', (event) => {
      const typedEvent = event as DiagramStyleChangedEvent;
      this.invalidateLayout(typedEvent.objectId);
    });
    this.cleanups.push(unsubStyleChanged);
  }

  // ===========================================================================
  // Diagram Access
  // ===========================================================================

  /**
   * Get a Diagram diagram by object ID.
   *
   * @param objectId - Diagram floating object ID
   * @returns The diagram or undefined if not found
   */
  async getDiagram(objectId: string): Promise<Diagram | undefined> {
    // Find the Diagram object across all sheets
    const sheetIds = await this.getAllSheetIdsAsync();

    for (const sheetId of sheetIds) {
      const diagram = await this.getDiagramById(sheetId, objectId);
      if (diagram) {
        return diagram.diagram;
      }
    }

    return undefined;
  }

  /**
   * Get all Diagram diagrams on a sheet.
   *
   * @param sheetId - Sheet ID
   * @returns Array of Diagram diagrams on the sheet
   */
  async getDiagramsOnSheet(sheetId: SheetId): Promise<Diagram[]> {
    const diagrams = await this.getAllDiagramsOnSheet(sheetId);
    return diagrams.map((obj) => obj.diagram);
  }

  // ===========================================================================
  // Node Operations
  // ===========================================================================

  /**
   * Add a node to a diagram.
   *
   * @param objectId - Diagram object ID
   * @param text - Initial text content for the node
   * @param position - Position relative to reference node
   * @param referenceNodeId - Reference node ID (null for root)
   * @returns The ID of the newly created node
   */
  async addNode(
    objectId: string,
    text: string,
    position: NodePosition,
    referenceNodeId: NodeId | null,
  ): Promise<NodeId> {
    const diagram = await this.getDiagram(objectId);
    if (!diagram) {
      throw new BridgeError(
        'OBJ_DIAGRAM_NOT_FOUND',
        'diagram',
        `Diagram diagram not found: ${objectId}`,
      );
    }

    // Create the new node
    const newNode = createNode({ text, level: 0 });

    // Add to diagram
    const updatedDiagram = addNodeToDiagram(
      diagram,
      newNode,
      position,
      referenceNodeId ?? undefined,
    );

    // Update the diagram via ComputeBridge
    await this.updateDiagramAsync(objectId, updatedDiagram);

    // Emit event for cache invalidation (handled by event subscription)
    const event: DiagramNodeAddedEvent = {
      type: 'diagram:node-added',
      timestamp: Date.now(),
      objectId,
      nodeId: newNode.id,
      parentId: newNode.parentId,
      position,
      source: 'user',
    };
    this.ctx.eventBus.emit(event);

    return newNode.id;
  }

  /**
   * Remove a node from a diagram.
   *
   * @param objectId - Diagram object ID
   * @param nodeId - Node ID to remove
   */
  async removeNode(objectId: string, nodeId: NodeId): Promise<void> {
    const diagram = await this.getDiagram(objectId);
    if (!diagram) {
      throw new BridgeError(
        'OBJ_DIAGRAM_NOT_FOUND',
        'diagram',
        `Diagram diagram not found: ${objectId}`,
      );
    }

    // Remove the node (children are promoted to parent by default)
    const updatedDiagram = removeNodeFromDiagram(diagram, nodeId, {
      removeChildren: false,
    });

    // Update the diagram
    await this.updateDiagramAsync(objectId, updatedDiagram);

    // Emit event
    const event: DiagramNodeRemovedEvent = {
      type: 'diagram:node-removed',
      timestamp: Date.now(),
      objectId,
      nodeId,
      source: 'user',
    };
    this.ctx.eventBus.emit(event);
  }

  /**
   * Update node properties.
   *
   * @param objectId - Diagram object ID
   * @param nodeId - Node ID to update
   * @param updates - Partial node properties to update
   */
  async updateNode(objectId: string, nodeId: NodeId, updates: Partial<DiagramNode>): Promise<void> {
    const diagram = await this.getDiagram(objectId);
    if (!diagram) {
      throw new BridgeError(
        'OBJ_DIAGRAM_NOT_FOUND',
        'diagram',
        `Diagram diagram not found: ${objectId}`,
      );
    }

    const node = diagram.nodes.get(nodeId);
    if (!node) {
      throw new BridgeError('OBJ_NOT_FOUND', 'diagram', `Diagram node not found: ${nodeId}`);
    }

    // Create updated node
    const updatedNode: DiagramNode = {
      ...node,
      ...updates,
      // Preserve immutable fields
      id: node.id,
      childIds: node.childIds,
      parentId: node.parentId,
    };

    // Update the diagram
    const newNodes = new Map(diagram.nodes);
    newNodes.set(nodeId, updatedNode);

    const updatedDiagram: Diagram = {
      ...diagram,
      nodes: newNodes,
    };

    await this.updateDiagramAsync(objectId, updatedDiagram);

    // Emit event
    const event: DiagramNodeUpdatedEvent = {
      type: 'diagram:node-updated',
      timestamp: Date.now(),
      objectId,
      nodeId,
      changes: {
        text: updates.text,
        fillColor: updates.fillColor,
        imageUrl: updates.imageUrl,
      },
      source: 'user',
    };
    this.ctx.eventBus.emit(event);
  }

  /**
   * Move a node in the hierarchy.
   *
   * @param objectId - Diagram object ID
   * @param nodeId - Node ID to move
   * @param direction - Direction to move the node
   */
  async moveNode(objectId: string, nodeId: NodeId, direction: NodeMoveDirection): Promise<void> {
    const diagram = await this.getDiagram(objectId);
    if (!diagram) {
      throw new BridgeError(
        'OBJ_DIAGRAM_NOT_FOUND',
        'diagram',
        `Diagram diagram not found: ${objectId}`,
      );
    }

    let updatedDiagram: Diagram;

    switch (direction) {
      case 'promote':
        updatedDiagram = promoteNode(diagram, nodeId);
        break;
      case 'demote':
        updatedDiagram = demoteNode(diagram, nodeId);
        break;
      case 'move-up':
        updatedDiagram = moveNodeUp(diagram, nodeId);
        break;
      case 'move-down':
        updatedDiagram = moveNodeDown(diagram, nodeId);
        break;
      default:
        return;
    }

    // Update the diagram
    await this.updateDiagramAsync(objectId, updatedDiagram);

    // Emit event
    const event: DiagramNodeMovedEvent = {
      type: 'diagram:node-moved',
      timestamp: Date.now(),
      objectId,
      nodeId,
      direction,
      source: 'user',
    };
    this.ctx.eventBus.emit(event);
  }

  /**
   * Get a node by ID.
   *
   * @param objectId - Diagram object ID
   * @param nodeId - Node ID to retrieve
   * @returns The node or undefined if not found
   */
  async getNode(objectId: string, nodeId: NodeId): Promise<DiagramNode | undefined> {
    const diagram = await this.getDiagram(objectId);
    if (!diagram) return undefined;

    return diagram.nodes.get(nodeId);
  }

  // ===========================================================================
  // Layout and Style
  // ===========================================================================

  /**
   * Change the diagram layout.
   *
   * @param objectId - Diagram object ID
   * @param newLayoutId - New layout ID
   */
  async changeLayout(objectId: string, newLayoutId: string): Promise<void> {
    const diagram = await this.getDiagram(objectId);
    if (!diagram) {
      throw new BridgeError(
        'OBJ_DIAGRAM_NOT_FOUND',
        'diagram',
        `Diagram diagram not found: ${objectId}`,
      );
    }

    const newLayoutDef = layoutRegistry.getById(newLayoutId);
    if (!newLayoutDef) {
      throw new BridgeError('OBJ_INVALID_CONFIG', 'diagram', `Layout not found: ${newLayoutId}`);
    }

    const previousLayoutId = diagram.layoutId;

    // Change layout using the model function
    const updatedDiagram = changeLayoutModel(diagram, newLayoutDef);

    // Update the diagram
    await this.updateDiagramAsync(objectId, updatedDiagram);

    // Emit event
    const event: DiagramLayoutChangedEvent = {
      type: 'diagram:layout-changed',
      timestamp: Date.now(),
      objectId,
      previousLayoutId,
      newLayoutId,
      source: 'user',
    };
    this.ctx.eventBus.emit(event);
  }

  /**
   * Change the quick style.
   *
   * @param objectId - Diagram object ID
   * @param quickStyleId - Quick style ID
   */
  async changeQuickStyle(objectId: string, quickStyleId: string): Promise<void> {
    const diagram = await this.getDiagram(objectId);
    if (!diagram) {
      throw new BridgeError(
        'OBJ_DIAGRAM_NOT_FOUND',
        'diagram',
        `Diagram diagram not found: ${objectId}`,
      );
    }

    const previousValue = diagram.quickStyleId;

    const updatedDiagram: Diagram = {
      ...diagram,
      quickStyleId,
    };

    // Update the diagram
    await this.updateDiagramAsync(objectId, updatedDiagram);

    // Emit event
    const event: DiagramStyleChangedEvent = {
      type: 'diagram:style-changed',
      timestamp: Date.now(),
      objectId,
      changeType: 'quick-style',
      previousValue,
      newValue: quickStyleId,
      source: 'user',
    };
    this.ctx.eventBus.emit(event);
  }

  /**
   * Change the color theme.
   *
   * @param objectId - Diagram object ID
   * @param colorThemeId - Color theme ID
   */
  async changeColorTheme(objectId: string, colorThemeId: string): Promise<void> {
    const diagram = await this.getDiagram(objectId);
    if (!diagram) {
      throw new BridgeError(
        'OBJ_DIAGRAM_NOT_FOUND',
        'diagram',
        `Diagram diagram not found: ${objectId}`,
      );
    }

    const previousValue = diagram.colorThemeId;

    const updatedDiagram: Diagram = {
      ...diagram,
      colorThemeId,
    };

    // Update the diagram
    await this.updateDiagramAsync(objectId, updatedDiagram);

    // Emit event
    const event: DiagramStyleChangedEvent = {
      type: 'diagram:style-changed',
      timestamp: Date.now(),
      objectId,
      changeType: 'color-theme',
      previousValue,
      newValue: colorThemeId,
      source: 'user',
    };
    this.ctx.eventBus.emit(event);
  }

  // ===========================================================================
  // Layout Computation (Cache Management)
  // ===========================================================================

  /**
   * Get the computed layout for a diagram.
   * Returns cached result if valid, otherwise recomputes.
   *
   * @param objectId - Diagram object ID
   * @returns Computed layout or undefined if diagram not found
   */
  async getComputedLayout(objectId: string): Promise<ComputedLayout | undefined> {
    // Check cache first
    const cached = this.layoutCache.get(objectId);
    if (cached) {
      return cached.layout;
    }

    // Get the full Diagram object (we need both diagram and position)
    const found = await this.findDiagramObject(objectId);
    if (!found) {
      // DEBUG: Log why findDiagramObject failed
      const sheetIds = await this.getAllSheetIdsAsync();
      console.warn(
        `[DiagramBridge] getComputedLayout failed: object ${objectId} not found. ` +
          `Sheet count: ${sheetIds.length}, sheetIds: ${JSON.stringify(sheetIds)}`,
      );
      return undefined;
    }

    const { object: diagramObject } = found;
    const diagram = diagramObject.diagram;

    // Get bounds from the object's position
    const bounds = {
      width: diagramObject.position.width ?? 400,
      height: diagramObject.position.height ?? 300,
    };

    // Compute layout using the diagram package
    const layout = this.computeLayoutForDiagramWithBounds(diagram, bounds);
    if (!layout) {
      // DEBUG: Log why layout computation failed
      console.warn(
        `[DiagramBridge] computeLayoutForDiagramWithBounds failed for object ${objectId}. ` +
          `layoutId: ${diagram.layoutId}, nodeCount: ${diagram.nodes?.size ?? 'nodes is not a Map'}, ` +
          `rootNodeIds: ${JSON.stringify(diagram.rootNodeIds)}`,
      );
      return undefined;
    }

    // Cache the result
    this.versionCounter++;
    const cacheEntry: ComputedLayoutCache = {
      objectId,
      layout,
      lastComputed: Date.now(),
      version: this.versionCounter,
    };
    this.layoutCache.set(objectId, cacheEntry);

    return layout;
  }

  /**
   * Invalidate the cached layout for a diagram.
   *
   * @param objectId - Diagram object ID
   */
  invalidateLayout(objectId: string): void {
    this.layoutCache.delete(objectId);
  }

  /**
   * Invalidate all cached layouts.
   */
  invalidateAllLayouts(): void {
    this.layoutCache.clear();
  }

  /**
   * Get DrawingObject[] for a Diagram diagram, ready for rendering.
   *
   * This combines layout computation with the DrawingObject conversion,
   * providing the unified rendering format used by drawing-engine.
   *
   * @param objectId - Diagram object ID
   * @returns Array of DrawingObjects, or undefined if diagram not found or layout fails
   */
  async getDrawingObjects(objectId: string): Promise<DrawingObject[] | undefined> {
    const layout = await this.getComputedLayout(objectId);
    if (!layout) return undefined;

    return layoutToDrawingObjects(layout);
  }

  // ===========================================================================
  // Private Helpers
  // ===========================================================================

  /**
   * Get all sheet IDs in the workbook (async via ComputeBridge).
   */
  private async getAllSheetIdsAsync(): Promise<SheetId[]> {
    return await this.ctx.computeBridge.getAllSheetIds();
  }

  /**
   * Get a Diagram object by ID from a specific sheet.
   *
   * IMPORTANT: This method deserializes the Diagram object from storage format.
   * Storage may return Maps as plain objects, so we convert diagram.nodes back to a Map.
   */
  private async getDiagramById(
    sheetId: SheetId,
    objectId: string,
  ): Promise<DiagramObject | undefined> {
    const json = await this.ctx.computeBridge.getFloatingObject(sheetId, objectId);
    if (!json) return undefined;

    const floatingObj = json as FloatingObject;
    if (floatingObj.type === 'diagram') {
      return this.deserializeDiagram(floatingObj as DiagramObject);
    }

    return undefined;
  }

  /**
   * Deserialize a Diagram object from storage format.
   *
   * Storage may return Maps as plain JavaScript objects, so this method converts
   * the diagram.nodes object back to a proper Map for runtime use.
   *
   * @param diagram - The raw Diagram object from storage
   * @returns The Diagram object with diagram.nodes as a proper Map
   */
  private deserializeDiagram(diagramObject: DiagramObject): DiagramObject {
    const diagram = diagramObject.diagram;

    // Check if nodes is already a Map (runtime) or a plain object (from storage)
    let nodesMap: Map<NodeId, DiagramNode>;
    if (diagram.nodes instanceof Map) {
      nodesMap = diagram.nodes;
    } else {
      // Convert plain object to Map
      nodesMap = new Map(Object.entries(diagram.nodes as Record<string, DiagramNode>)) as Map<
        NodeId,
        DiagramNode
      >;
    }

    return {
      ...diagramObject,
      type: 'diagram',
      position: diagramObject.position?.from
        ? diagramObject.position
        : diagramObject.anchor?.from
          ? diagramObject.anchor
          : defaultDiagramPosition(diagramObject.position?.width, diagramObject.position?.height),
      anchor: diagramObject.anchor?.from
        ? diagramObject.anchor
        : diagramObject.position?.from
          ? diagramObject.position
          : defaultDiagramPosition(diagramObject.position?.width, diagramObject.position?.height),
      diagram: {
        ...diagram,
        nodes: nodesMap,
      },
    };
  }

  /**
   * Get all Diagram objects on a sheet.
   *
   * IMPORTANT: This method deserializes all Diagram objects from storage format.
   */
  private async getAllDiagramsOnSheet(sheetId: SheetId): Promise<DiagramObject[]> {
    const entries = await this.ctx.computeBridge.getFloatingObjectsInSheet(sheetId);

    const diagrams: DiagramObject[] = [];
    for (const [, json] of entries) {
      const floatingObj = json as FloatingObject;
      if (floatingObj && floatingObj.type === 'diagram') {
        diagrams.push(this.deserializeDiagram(floatingObj as DiagramObject));
      }
    }

    return diagrams;
  }

  /**
   * Find the Diagram object across all sheets and return it with its sheet ID.
   */
  private async findDiagramObject(
    objectId: string,
  ): Promise<{ sheetId: SheetId; object: DiagramObject } | null> {
    const sheetIds = await this.getAllSheetIdsAsync();

    // DEBUG: Log sheet lookup details
    if (sheetIds.length === 0) {
      console.warn(`[DiagramBridge] findDiagramObject: No sheets found.`);
    }

    for (const sheetId of sheetIds) {
      const diagram = await this.getDiagramById(sheetId, objectId);
      if (diagram) {
        return { sheetId, object: diagram };
      }
    }

    return null;
  }

  /**
   * Update a Diagram diagram in storage via ComputeBridge.
   */
  private async updateDiagramAsync(objectId: string, diagram: Diagram): Promise<void> {
    const found = await this.findDiagramObject(objectId);
    if (!found) {
      throw new BridgeError(
        'OBJ_DIAGRAM_NOT_FOUND',
        'diagram',
        `Diagram object not found: ${objectId}`,
      );
    }

    // Update the Diagram object with the new diagram
    const updatedObject: DiagramObject = {
      ...found.object,
      diagram,
      updatedAt: Date.now(),
    };

    // Store via ComputeBridge (atomic in Rust/Yrs). Diagram nodes are a Map in
    // the runtime model, but storage is JSON.
    await this.ctx.computeBridge.setFloatingObject(found.sheetId, objectId, {
      ...updatedObject,
      type: 'diagram',
      definition: {
        dataXml: JSON.stringify({
          ...updatedObject.diagram,
          nodes: Object.fromEntries(updatedObject.diagram.nodes),
        }),
      },
      category: updatedObject.diagram.category,
      diagram: undefined,
    });
  }

  /**
   * Compute layout for a diagram using pre-provided bounds.
   * This avoids redundant lookups by accepting bounds directly.
   * Converts from LayoutResult to ComputedLayout format.
   */
  private computeLayoutForDiagramWithBounds(
    diagram: Diagram,
    bounds: { width: number; height: number },
  ): ComputedLayout | null {
    // Convert nodes map to the format expected by computeLayout
    const nodeHierarchy = new Map<
      string,
      {
        level: number;
        parentId: string | null;
        childIds: string[];
        siblingOrder: number;
      }
    >();

    diagram.nodes.forEach((node, id) => {
      nodeHierarchy.set(id, {
        level: node.level,
        parentId: node.parentId,
        childIds: [...node.childIds],
        siblingOrder: node.siblingOrder,
      });
    });

    // Compute layout using the diagram package
    const layoutResult: LayoutResult | null = computeLayoutInternal(
      diagram.layoutId,
      nodeHierarchy,
      [...diagram.rootNodeIds],
      bounds,
      diagram.layoutOptions,
    );

    if (!layoutResult) {
      return null;
    }

    // Convert LayoutResult to ComputedLayout format
    const shapes: ComputedShape[] = [];
    layoutResult.positions.forEach((pos, nodeId) => {
      const node = diagram.nodes.get(nodeId);
      shapes.push({
        nodeId,
        shapeType: 'rect', // Default shape type; can be enhanced based on layout
        x: pos.x,
        y: pos.y,
        width: pos.width,
        height: pos.height,
        rotation: pos.rotation,
        fill: '#4472C4', // Default fill; can be enhanced based on style
        stroke: '#2F528F', // Default stroke
        strokeWidth: 1,
        text: node?.text ?? '',
        textStyle: {
          fontFamily: 'Calibri',
          fontSize: 12,
          fontWeight: 'normal',
          fontStyle: 'normal',
          color: '#FFFFFF',
          align: 'center',
          verticalAlign: 'middle',
        },
        effects: {},
      });
    });

    // Convert connectors
    const connectors: ComputedConnector[] = layoutResult.connectors.map((conn) => ({
      fromNodeId: conn.fromId,
      toNodeId: conn.toId,
      connectorType: conn.path.type === 'bezier' ? 'curved' : 'straight',
      path: {
        type: conn.path.type,
        points: conn.path.points,
      },
      stroke: '#4472C4', // Default connector stroke
      strokeWidth: 1,
    }));

    const computedLayout: ComputedLayout = {
      shapes,
      connectors,
      bounds: layoutResult.bounds,
      version: this.versionCounter + 1,
    };

    return computedLayout;
  }
}

// =============================================================================
// Factory Function
// =============================================================================

/**
 * Create a new DiagramBridge instance.
 *
 * @param ctx - Store context
 * @returns DiagramBridge instance (not started)
 */
export function createDiagramBridge(ctx: DocumentContext): DiagramBridge {
  return new DiagramBridge(ctx);
}
