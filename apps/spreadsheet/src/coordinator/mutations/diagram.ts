/**
 * Diagram Mutations Module
 *
 * Orchestrates Diagram write operations following the Mutations Layer pattern.
 * All Diagram writes go through this module to ensure:
 * - Proper undo description via workbook.setPendingUndoDescription()
 * - Consistent API for action handlers
 * - EventBus integration for UI updates
 *
 * Architecture: "Reads Direct, Writes Orchestrated"
 * - Reads: Use Diagram bridge functions directly
 * - Writes: Come through this mutations layer
 *
 */

import type { NodeMoveDirection, NodePosition, WorksheetDiagrams } from '@mog-sdk/contracts/api';
import type {
  DiagramCreatedEvent,
  DiagramDeletedEvent,
  DiagramLayoutChangedEvent,
  DiagramNodeAddedEvent,
  DiagramNodeMovedEvent,
  DiagramNodeRemovedEvent,
  DiagramNodeUpdatedEvent,
  DiagramStyleChangedEvent,
} from '@mog-sdk/contracts/events';
import type { NodeId, DiagramNode } from '@mog-sdk/contracts/diagram';

import type { WorkbookInternal } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';

// =============================================================================
// Diagram Error Types
// =============================================================================

/**
 * Diagram operation error codes.
 */
export type DiagramErrorCode =
  | 'DIAGRAM_NOT_FOUND'
  | 'BRIDGE_NOT_AVAILABLE'
  | 'NODE_NOT_FOUND'
  | 'CANNOT_REMOVE_LAST_NODE';

/**
 * Diagram operation error structure.
 */
export interface DiagramError {
  code: DiagramErrorCode;
  message: string;
  objectId?: string;
  nodeId?: string;
}

/**
 * Result type for Diagram operations.
 */
export type DiagramResult<T> =
  | { success: true; value: T }
  | { success: false; error: DiagramError };

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Create error result for missing bridge.
 */
function bridgeNotAvailable(): DiagramResult<never> {
  return {
    success: false,
    error: {
      code: 'BRIDGE_NOT_AVAILABLE',
      message: 'Diagram bridge not available',
    },
  };
}

/**
 * Create error result for Diagram not found.
 */
function diagramNotFound(objectId: string): DiagramResult<never> {
  return {
    success: false,
    error: {
      code: 'DIAGRAM_NOT_FOUND',
      message: `Diagram ${objectId} not found`,
      objectId,
    },
  };
}

/**
 * Create error result for node not found.
 */
function nodeNotFound(nodeId: string): DiagramResult<never> {
  return {
    success: false,
    error: {
      code: 'NODE_NOT_FOUND',
      message: `Node ${nodeId} not found`,
      nodeId,
    },
  };
}

// =============================================================================
// Create Diagram
// =============================================================================

/**
 * Create a new Diagram diagram.
 *
 * @param workbook - Workbook instance
 * @param sheetId - Sheet to create Diagram on
 * @param position - Position configuration
 * @param layoutId - Layout identifier
 * @returns Result with object ID or error
 */
export async function createDiagram(
  workbook: WorkbookInternal,
  sheetId: SheetId,
  position: Record<string, unknown>,
  layoutId: string,
): Promise<DiagramResult<string>> {
  const ws = workbook.getSheetById(sheetId);

  workbook.setPendingUndoDescription('Insert Diagram');

  const diagram = await ws.diagrams.add({
    layoutId,
    x: position?.x as number | undefined,
    y: position?.y as number | undefined,
    width: position?.width as number | undefined,
    height: position?.height as number | undefined,
  });

  return { success: true, value: diagram.id };
}

// =============================================================================
// Delete Diagram
// =============================================================================

/**
 * Delete a Diagram diagram.
 *
 * @param workbook - Workbook instance
 * @param sheetId - Sheet containing the Diagram
 * @param objectId - Diagram object ID
 * @returns Result indicating success or error
 */
export async function deleteDiagram(
  workbook: WorkbookInternal,
  sheetId: SheetId,
  objectId: string,
): Promise<DiagramResult<void>> {
  const ws = workbook.getSheetById(sheetId);

  const existing = await ws.objects.get(objectId);
  if (!existing) return diagramNotFound(objectId);

  workbook.setPendingUndoDescription('Delete Diagram');

  await ws.objects.remove(objectId);

  const event: DiagramDeletedEvent = {
    type: 'diagram:deleted',
    objectId,
    sheetId,
    source: 'user',
    timestamp: Date.now(),
  };
  workbook.emit(event);

  return { success: true, value: undefined };
}

// =============================================================================
// Add Node
// =============================================================================

/**
 * Add a node to a Diagram diagram.
 *
 * @param workbook - Workbook instance
 * @param sheetId - Sheet containing the Diagram
 * @param bridge - Diagram bridge
 * @param objectId - Diagram object ID
 * @param text - Node text content
 * @param position - Where to add the node relative to reference
 * @param referenceNodeId - Reference node ID (null for root)
 * @returns Result with new node ID or error
 */
export async function addNode(
  workbook: WorkbookInternal,
  sheetId: SheetId,
  bridge: WorksheetDiagrams | undefined,
  objectId: string,
  text: string,
  position: NodePosition,
  referenceNodeId: NodeId | null,
): Promise<DiagramResult<string>> {
  if (!bridge) return bridgeNotAvailable();

  const ws = workbook.getSheetById(sheetId);
  const handle = await ws.objects.get(objectId);
  if (!handle) return diagramNotFound(objectId);

  workbook.setPendingUndoDescription('Add Diagram node');

  const newNodeId = await bridge.addNode(objectId, text, position, referenceNodeId);

  const event: DiagramNodeAddedEvent = {
    type: 'diagram:node-added',
    objectId,
    nodeId: newNodeId,
    position,
    parentId: referenceNodeId,
    source: 'user',
    timestamp: Date.now(),
  };
  workbook.emit(event);

  return { success: true, value: newNodeId as string };
}

// =============================================================================
// Remove Node
// =============================================================================

/**
 * Remove a node from a Diagram diagram.
 *
 * @param workbook - Workbook instance
 * @param sheetId - Sheet containing the Diagram
 * @param bridge - Diagram bridge
 * @param objectId - Diagram object ID
 * @param nodeId - Node ID to remove
 * @returns Result indicating success or error
 */
export async function removeNode(
  workbook: WorkbookInternal,
  sheetId: SheetId,
  bridge: WorksheetDiagrams | undefined,
  objectId: string,
  nodeId: NodeId,
): Promise<DiagramResult<void>> {
  if (!bridge) return bridgeNotAvailable();

  const ws = workbook.getSheetById(sheetId);
  const handle = await ws.objects.get(objectId);
  if (!handle) return diagramNotFound(objectId);

  // Check if node exists
  const node = await bridge.getNode(objectId, nodeId);
  if (!node) return nodeNotFound(nodeId as string);

  // Check if this is the last node
  const diagram = await bridge.getDiagram(objectId);
  if (diagram && diagram.nodes.size <= 1) {
    return {
      success: false,
      error: {
        code: 'CANNOT_REMOVE_LAST_NODE',
        message: 'Cannot remove the last node from a Diagram diagram',
        objectId,
        nodeId: nodeId as string,
      },
    };
  }

  workbook.setPendingUndoDescription('Remove Diagram node');

  await bridge.removeNode(objectId, nodeId);

  const event: DiagramNodeRemovedEvent = {
    type: 'diagram:node-removed',
    objectId,
    nodeId,
    source: 'user',
    timestamp: Date.now(),
  };
  workbook.emit(event);

  return { success: true, value: undefined };
}

// =============================================================================
// Update Node
// =============================================================================

/**
 * Update a node's properties.
 *
 * @param workbook - Workbook instance
 * @param sheetId - Sheet containing the Diagram
 * @param bridge - Diagram bridge
 * @param objectId - Diagram object ID
 * @param nodeId - Node ID to update
 * @param updates - Properties to update
 * @returns Result indicating success or error
 */
export async function updateNode(
  workbook: WorkbookInternal,
  sheetId: SheetId,
  bridge: WorksheetDiagrams | undefined,
  objectId: string,
  nodeId: NodeId,
  updates: Partial<DiagramNode> & Record<string, unknown>,
): Promise<DiagramResult<void>> {
  if (!bridge) return bridgeNotAvailable();

  const ws = workbook.getSheetById(sheetId);
  const handle = await ws.objects.get(objectId);
  if (!handle) return diagramNotFound(objectId);

  // Check if node exists
  const nodeResult = await bridge.getNode(objectId, nodeId);
  if (!nodeResult) {
    return nodeNotFound(nodeId as string);
  }

  workbook.setPendingUndoDescription('Update Diagram node');

  void bridge.updateNode(objectId, nodeId, updates as Partial<DiagramNode>);

  const event: DiagramNodeUpdatedEvent = {
    type: 'diagram:node-updated',
    objectId,
    nodeId,
    changes: updates as Partial<{ text: string; fillColor: string; imageUrl: string }>,
    source: 'user',
    timestamp: Date.now(),
  };
  workbook.emit(event);

  return { success: true, value: undefined };
}

// =============================================================================
// Move Node
// =============================================================================

/**
 * Move a node (promote, demote, move-up, move-down).
 *
 * @param workbook - Workbook instance
 * @param sheetId - Sheet containing the Diagram
 * @param bridge - Diagram bridge
 * @param objectId - Diagram object ID
 * @param nodeId - Node ID to move
 * @param direction - Movement direction
 * @returns Result indicating success or error
 */
export async function moveNode(
  workbook: WorkbookInternal,
  sheetId: SheetId,
  bridge: WorksheetDiagrams | undefined,
  objectId: string,
  nodeId: NodeId,
  direction: NodeMoveDirection,
): Promise<DiagramResult<void>> {
  if (!bridge) return bridgeNotAvailable();

  const ws = workbook.getSheetById(sheetId);
  const handle = await ws.objects.get(objectId);
  if (!handle) return diagramNotFound(objectId);

  // Check if node exists
  const nodeResult = await bridge.getNode(objectId, nodeId);
  if (!nodeResult) {
    return nodeNotFound(nodeId as string);
  }

  // Map direction to undo description
  const directionLabels: Record<NodeMoveDirection, string> = {
    promote: 'Promote Diagram node',
    demote: 'Demote Diagram node',
    'move-up': 'Move Diagram node up',
    'move-down': 'Move Diagram node down',
  };

  workbook.setPendingUndoDescription(directionLabels[direction]);

  void bridge.moveNode(objectId, nodeId, direction);

  const event: DiagramNodeMovedEvent = {
    type: 'diagram:node-moved',
    objectId,
    nodeId,
    direction,
    source: 'user',
    timestamp: Date.now(),
  };
  workbook.emit(event);

  return { success: true, value: undefined };
}

// =============================================================================
// Change Layout
// =============================================================================

/**
 * Change the layout of a Diagram diagram.
 *
 * @param workbook - Workbook instance
 * @param sheetId - Sheet containing the Diagram
 * @param bridge - Diagram bridge
 * @param objectId - Diagram object ID
 * @param newLayoutId - New layout identifier
 * @returns Result indicating success or error
 */
export async function changeLayout(
  workbook: WorkbookInternal,
  sheetId: SheetId,
  bridge: WorksheetDiagrams | undefined,
  objectId: string,
  newLayoutId: string,
): Promise<DiagramResult<void>> {
  if (!bridge) return bridgeNotAvailable();

  const ws = workbook.getSheetById(sheetId);
  const handle = await ws.objects.get(objectId);
  if (!handle) return diagramNotFound(objectId);

  const diagram = await bridge.getDiagram(objectId);
  const previousLayoutId = diagram?.layoutId ?? '';

  workbook.setPendingUndoDescription('Change Diagram layout');

  await bridge.changeLayout(objectId, newLayoutId);

  const event: DiagramLayoutChangedEvent = {
    type: 'diagram:layout-changed',
    objectId,
    previousLayoutId,
    newLayoutId,
    source: 'user',
    timestamp: Date.now(),
  };
  workbook.emit(event);

  return { success: true, value: undefined };
}

// =============================================================================
// Change Quick Style
// =============================================================================

/**
 * Change the quick style of a Diagram diagram.
 *
 * @param workbook - Workbook instance
 * @param sheetId - Sheet containing the Diagram
 * @param bridge - Diagram bridge
 * @param objectId - Diagram object ID
 * @param quickStyleId - New quick style identifier
 * @returns Result indicating success or error
 */
export async function changeQuickStyle(
  workbook: WorkbookInternal,
  sheetId: SheetId,
  bridge: WorksheetDiagrams | undefined,
  objectId: string,
  quickStyleId: string,
): Promise<DiagramResult<void>> {
  if (!bridge) return bridgeNotAvailable();

  const ws = workbook.getSheetById(sheetId);
  const handle = await ws.objects.get(objectId);
  if (!handle) return diagramNotFound(objectId);

  const diagram = await bridge.getDiagram(objectId);
  const previousValue = diagram?.quickStyleId ?? '';

  workbook.setPendingUndoDescription('Change Diagram style');

  await bridge.changeQuickStyle(objectId, quickStyleId);

  const event: DiagramStyleChangedEvent = {
    type: 'diagram:style-changed',
    objectId,
    changeType: 'quick-style',
    previousValue,
    newValue: quickStyleId,
    source: 'user',
    timestamp: Date.now(),
  };
  workbook.emit(event);

  return { success: true, value: undefined };
}

// =============================================================================
// Change Color Theme
// =============================================================================

/**
 * Change the color theme of a Diagram diagram.
 *
 * @param workbook - Workbook instance
 * @param sheetId - Sheet containing the Diagram
 * @param bridge - Diagram bridge
 * @param objectId - Diagram object ID
 * @param colorThemeId - New color theme identifier
 * @returns Result indicating success or error
 */
export async function changeColorTheme(
  workbook: WorkbookInternal,
  sheetId: SheetId,
  bridge: WorksheetDiagrams | undefined,
  objectId: string,
  colorThemeId: string,
): Promise<DiagramResult<void>> {
  if (!bridge) return bridgeNotAvailable();

  const ws = workbook.getSheetById(sheetId);
  const handle = await ws.objects.get(objectId);
  if (!handle) return diagramNotFound(objectId);

  const diagram = await bridge.getDiagram(objectId);
  const previousValue = diagram?.colorThemeId ?? '';

  workbook.setPendingUndoDescription('Change Diagram colors');

  await bridge.changeColorTheme(objectId, colorThemeId);

  const event: DiagramStyleChangedEvent = {
    type: 'diagram:style-changed',
    objectId,
    changeType: 'color-theme',
    previousValue,
    newValue: colorThemeId,
    source: 'user',
    timestamp: Date.now(),
  };
  workbook.emit(event);

  return { success: true, value: undefined };
}

// =============================================================================
// Duplicate Diagram
// =============================================================================

/**
 * Duplicate a Diagram diagram.
 *
 * @param workbook - Workbook instance
 * @param sheetId - Sheet containing the Diagram
 * @param objectId - Diagram object ID to duplicate
 * @param offset - Optional position offset
 * @returns Result with new object ID or error
 */
export async function duplicateDiagram(
  workbook: WorkbookInternal,
  sheetId: SheetId,
  objectId: string,
  offset?: { dx: number; dy: number },
): Promise<DiagramResult<string>> {
  const ws = workbook.getSheetById(sheetId);

  const existing = await ws.objects.get(objectId);
  if (!existing) return diagramNotFound(objectId);

  workbook.setPendingUndoDescription('Duplicate Diagram');

  const duplicateHandle = await existing.duplicate();

  const event: DiagramCreatedEvent = {
    type: 'diagram:created',
    objectId: duplicateHandle.id,
    sheetId,
    layoutId: '',
    source: 'user',
    timestamp: Date.now(),
  };
  workbook.emit(event);

  return { success: true, value: duplicateHandle.id };
}
