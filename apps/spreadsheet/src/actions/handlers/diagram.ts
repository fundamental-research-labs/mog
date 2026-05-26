/**
 * Diagram Action Handlers
 *
 * Pure handler functions for Diagram diagram operations.
 * These handlers are called by the unified action dispatcher.
 *
 * ARCHITECTURE:
 * - Handlers are pure functions: (deps, payload?) => ActionResult
 * - Diagram data mutations go through the unified Worksheet API (ws.diagrams.*)
 * - UI state (dialogs, selection) goes through the Diagram UI slice
 *
 * This file handles:
 * - Diagram lifecycle (insert, delete)
 * - Node operations (add, remove, update)
 * - Style operations (update style, update layout)
 * - UI actions (dialog open/close, node selection, text pane toggle)
 *
 * @see contracts/src/diagram/types.ts for Diagram data types
 */

import type { ActionHandler, ActionResult, AsyncActionHandler } from '@mog-sdk/contracts/actions';
import type { NodeMoveDirection, NodePosition } from '@mog-sdk/contracts/api';
import type { NodeId } from '@mog-sdk/contracts/diagram';

import { getUIStore, handled, notHandled } from './handler-utils';

// =============================================================================
// Diagram Lifecycle Actions
// =============================================================================

/**
 * DIAGRAM_INSERT - Create a new Diagram diagram on the current sheet.
 * Payload: {
 * position?: { x?: number, y?: number, width?: number, height?: number },
 * layoutId: string,
 * options?: { nodes?: DiagramNodeConfig[] }
 * }
 *
 * This is triggered from the Insert Diagram dialog or ribbon.
 * Uses the unified Worksheet API for Diagram creation.
 */
export const DIAGRAM_INSERT: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const layoutId = payload?.layoutId;
  if (!layoutId) {
    return { handled: false, error: 'Missing layoutId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  // Default position if not provided
  const position = payload?.position || {
    x: 100,
    y: 100,
    width: 400,
    height: 300,
  };

  deps.workbook.setPendingUndoDescription('Insert Diagram');

  const diagram = await ws.diagrams.add({
    layoutId,
    x: position?.x,
    y: position?.y,
    width: position?.width,
    height: position?.height,
    nodes: payload?.options?.nodes,
  });

  // Select the newly created Diagram
  const uiStore = getUIStore(deps);
  if (uiStore) {
    uiStore.getState().selectDiagram(diagram.id);
  }

  // Close the dialog if it was open
  uiStore?.getState().closeDiagramDialog();

  return handled();
};

/**
 * DIAGRAM_DELETE - Delete a Diagram diagram.
 * Payload: { objectId: string }
 *
 * This is triggered from the Delete key when Diagram is selected or from context menu.
 * Uses the unified Worksheet API for Diagram deletion.
 */
export const DIAGRAM_DELETE: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const objectId = payload?.objectId;
  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  deps.workbook.setPendingUndoDescription('Delete Diagram');

  const handle = await ws.objects.get(objectId);
  if (!handle) {
    return { handled: false, error: `Object ${objectId} not found` };
  }
  const receipt = await handle.delete();

  // Deselect Diagram after deletion
  const uiStore = getUIStore(deps);
  if (uiStore) {
    uiStore.getState().deselectDiagram();
  }

  return handled({ receipts: [receipt] });
};

// =============================================================================
// Diagram Node Operations
// =============================================================================

/**
 * DIAGRAM_ADD_NODE - Add a node to a Diagram diagram.
 * Payload: {
 * objectId: string,
 * text: string,
 * position: NodePosition,
 * referenceNodeId: string | null
 * }
 *
 * The new node is positioned relative to the reference node.
 * Uses the unified Worksheet API via ws.diagrams sub-API.
 */
export const DIAGRAM_ADD_NODE: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const objectId = payload?.objectId;
  const text = payload?.text ?? '';
  const position = payload?.position ?? 'after';
  const referenceNodeId = payload?.referenceNodeId ?? undefined;

  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  const diagram = await ws.diagrams.get(objectId);
  if (!diagram) {
    return { handled: false, error: `Diagram ${objectId} not found` };
  }

  deps.workbook.setPendingUndoDescription('Add diagram item');

  const nodeId = await ws.diagrams.addNode(
    objectId,
    text,
    position as NodePosition,
    (referenceNodeId ?? null) as NodeId | null,
  );

  // Select the newly created node
  const uiStore = getUIStore(deps);
  if (uiStore) {
    uiStore.getState().selectNode(nodeId);
  }

  return handled();
};

/**
 * DIAGRAM_REMOVE_NODE - Remove a node from a Diagram diagram.
 * Payload: { objectId: string, nodeId: string }
 *
 * Children are promoted to the removed node's parent.
 * Uses the unified Worksheet API via ws.diagrams sub-API.
 */
export const DIAGRAM_REMOVE_NODE: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const objectId = payload?.objectId;
  const nodeId = payload?.nodeId;

  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }
  if (!nodeId) {
    return { handled: false, error: 'Missing nodeId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  const diagram = await ws.diagrams.get(objectId);
  if (!diagram) {
    return { handled: false, error: `Diagram ${objectId} not found` };
  }

  deps.workbook.setPendingUndoDescription('Remove diagram item');

  await ws.diagrams.removeNode(objectId, nodeId as NodeId);

  // Clear node selection after removal
  const uiStore = getUIStore(deps);
  if (uiStore) {
    uiStore.getState().deselectNodes();
  }

  return handled();
};

/**
 * DIAGRAM_UPDATE_NODE - Update a node's properties.
 * Payload: {
 * objectId: string,
 * nodeId: string,
 * updates: Partial<DiagramNodeConfig>
 * }
 *
 * Updates node properties like text, fill color, image, etc.
 * Uses the unified Worksheet API via ws.diagrams sub-API.
 */
export const DIAGRAM_UPDATE_NODE: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const objectId = payload?.objectId;
  const nodeId = payload?.nodeId;
  const updates = payload?.updates;

  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }
  if (!nodeId) {
    return { handled: false, error: 'Missing nodeId in payload' };
  }
  if (!updates) {
    return { handled: false, error: 'Missing updates in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  const diagram = await ws.diagrams.get(objectId);
  if (!diagram) {
    return { handled: false, error: `Diagram ${objectId} not found` };
  }

  deps.workbook.setPendingUndoDescription('Update Diagram node');

  await ws.diagrams.updateNode(objectId, nodeId as NodeId, updates);

  return handled();
};

// =============================================================================
// Diagram Style Operations
// =============================================================================

/**
 * DIAGRAM_UPDATE_STYLE - Update the Diagram style.
 * Payload: {
 * objectId: string,
 * quickStyleId?: string,
 * colorThemeId?: string
 * }
 *
 * Updates the quick style and/or color theme.
 * Uses the unified Worksheet API via ws.diagrams sub-API.
 */
export const DIAGRAM_UPDATE_STYLE: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const objectId = payload?.objectId;
  const quickStyleId = payload?.quickStyleId;
  const colorThemeId = payload?.colorThemeId;

  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }
  if (!quickStyleId && !colorThemeId) {
    return { handled: false, error: 'Must provide quickStyleId or colorThemeId' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  const diagram = await ws.diagrams.get(objectId);
  if (!diagram) {
    return { handled: false, error: `Diagram ${objectId} not found` };
  }

  // Apply quick style if provided
  if (quickStyleId) {
    deps.workbook.setPendingUndoDescription('Change diagram style');
    await ws.diagrams.changeQuickStyle(objectId, quickStyleId);
  }

  // Apply color theme if provided
  if (colorThemeId) {
    deps.workbook.setPendingUndoDescription('Change diagram colors');
    await ws.diagrams.changeColorTheme(objectId, colorThemeId);
  }

  return handled();
};

/**
 * DIAGRAM_UPDATE_LAYOUT - Change the Diagram diagram layout.
 * Payload: { objectId: string, layoutId: string }
 *
 * Changes the layout type (e.g., hierarchy, process, cycle).
 * Uses the unified Worksheet API via ws.diagrams sub-API.
 */
export const DIAGRAM_UPDATE_LAYOUT: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const objectId = payload?.objectId;
  const layoutId = payload?.layoutId;

  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }
  if (!layoutId) {
    return { handled: false, error: 'Missing layoutId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  const diagram = await ws.diagrams.get(objectId);
  if (!diagram) {
    return { handled: false, error: `Diagram ${objectId} not found` };
  }

  deps.workbook.setPendingUndoDescription('Change diagram layout');

  await ws.diagrams.changeLayout(objectId, layoutId);

  return handled();
};

// =============================================================================
// Diagram UI Actions (Dialog and Selection)
// =============================================================================

/**
 * OPEN_DIAGRAM_DIALOG - Open the Insert Diagram dialog.
 *
 * This is triggered from the Insert ribbon.
 */
export const OPEN_DIAGRAM_DIALOG: ActionHandler = (deps): ActionResult => {
  const uiStore = getUIStore(deps);
  if (!uiStore) {
    return notHandled('disabled');
  }
  uiStore.getState().openDiagramDialog();
  return handled();
};

/**
 * CLOSE_DIAGRAM_DIALOG - Close the Insert Diagram dialog.
 */
export const CLOSE_DIAGRAM_DIALOG: ActionHandler = (deps): ActionResult => {
  const uiStore = getUIStore(deps);
  if (!uiStore) {
    return notHandled('disabled');
  }
  uiStore.getState().closeDiagramDialog();
  return handled();
};

/**
 * DIAGRAM_SELECT_NODE - Select a node within a Diagram diagram.
 * Payload: { nodeId: string }
 */
export const DIAGRAM_SELECT_NODE: ActionHandler = (deps, payload): ActionResult => {
  const nodeId = payload?.nodeId;
  if (!nodeId) {
    return { handled: false, error: 'Missing nodeId in payload' };
  }

  const uiStore = getUIStore(deps);
  if (!uiStore) {
    return notHandled('disabled');
  }
  uiStore.getState().selectNode(nodeId);
  return handled();
};

/**
 * DIAGRAM_DESELECT_NODE - Deselect all nodes within a Diagram diagram.
 */
export const DIAGRAM_DESELECT_NODE: ActionHandler = (deps): ActionResult => {
  const uiStore = getUIStore(deps);
  if (!uiStore) {
    return notHandled('disabled');
  }
  uiStore.getState().deselectNodes();
  return handled();
};

/**
 * TOGGLE_DIAGRAM_TEXT_PANE - Toggle the Diagram Text Pane visibility.
 */
export const TOGGLE_DIAGRAM_TEXT_PANE: ActionHandler = (deps): ActionResult => {
  const uiStore = getUIStore(deps);
  if (!uiStore) {
    return notHandled('disabled');
  }
  uiStore.getState().toggleTextPane();
  return handled();
};

/**
 * DIAGRAM_STOP_EDITING - Stop editing the current Diagram node.
 *
 * This is triggered when the user commits or cancels text editing on a node.
 */
export const DIAGRAM_STOP_EDITING: ActionHandler = (deps): ActionResult => {
  const uiStore = getUIStore(deps);
  if (!uiStore) {
    return notHandled('disabled');
  }
  uiStore.getState().stopEditingNode();
  return handled();
};

// =============================================================================
// Diagram Node Hierarchy Operations (Promote/Demote/Move)
// =============================================================================

/**
 * DIAGRAM_PROMOTE_NODE - Promote a node (move up one level in hierarchy).
 * Payload: { objectId: string, nodeId: string }
 *
 * The node becomes a sibling of its current parent.
 * Uses the unified Worksheet API via ws.diagrams sub-API.
 */
export const DIAGRAM_PROMOTE_NODE: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const objectId = payload?.objectId;
  const nodeId = payload?.nodeId;

  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }
  if (!nodeId) {
    return { handled: false, error: 'Missing nodeId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  const diagram = await ws.diagrams.get(objectId);
  if (!diagram) {
    return { handled: false, error: `Diagram ${objectId} not found` };
  }

  deps.workbook.setPendingUndoDescription('Promote diagram item');

  await ws.diagrams.moveNode(objectId, nodeId as NodeId, 'promote' as NodeMoveDirection);

  return handled();
};

/**
 * DIAGRAM_DEMOTE_NODE - Demote a node (move down one level by becoming child of previous sibling).
 * Payload: { objectId: string, nodeId: string }
 *
 * The node becomes a child of its previous sibling.
 * Uses the unified Worksheet API via ws.diagrams sub-API.
 */
export const DIAGRAM_DEMOTE_NODE: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const objectId = payload?.objectId;
  const nodeId = payload?.nodeId;

  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }
  if (!nodeId) {
    return { handled: false, error: 'Missing nodeId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  const diagram = await ws.diagrams.get(objectId);
  if (!diagram) {
    return { handled: false, error: `Diagram ${objectId} not found` };
  }

  deps.workbook.setPendingUndoDescription('Demote diagram item');

  await ws.diagrams.moveNode(objectId, nodeId as NodeId, 'demote' as NodeMoveDirection);

  return handled();
};

/**
 * DIAGRAM_MOVE_NODE_UP - Move a node up among its siblings.
 * Payload: { objectId: string, nodeId: string }
 *
 * Swaps the node with its previous sibling.
 * Uses the unified Worksheet API via ws.diagrams sub-API.
 */
export const DIAGRAM_MOVE_NODE_UP: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const objectId = payload?.objectId;
  const nodeId = payload?.nodeId;

  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }
  if (!nodeId) {
    return { handled: false, error: 'Missing nodeId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  const diagram = await ws.diagrams.get(objectId);
  if (!diagram) {
    return { handled: false, error: `Diagram ${objectId} not found` };
  }

  deps.workbook.setPendingUndoDescription('Move diagram item up');

  await ws.diagrams.moveNode(objectId, nodeId as NodeId, 'move-up' as NodeMoveDirection);

  return handled();
};

/**
 * DIAGRAM_MOVE_NODE_DOWN - Move a node down among its siblings.
 * Payload: { objectId: string, nodeId: string }
 *
 * Swaps the node with its next sibling.
 * Uses the unified Worksheet API via ws.diagrams sub-API.
 */
export const DIAGRAM_MOVE_NODE_DOWN: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const objectId = payload?.objectId;
  const nodeId = payload?.nodeId;

  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }
  if (!nodeId) {
    return { handled: false, error: 'Missing nodeId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  const diagram = await ws.diagrams.get(objectId);
  if (!diagram) {
    return { handled: false, error: `Diagram ${objectId} not found` };
  }

  deps.workbook.setPendingUndoDescription('Move diagram item down');

  await ws.diagrams.moveNode(objectId, nodeId as NodeId, 'move-down' as NodeMoveDirection);

  return handled();
};
