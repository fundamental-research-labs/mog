/**
 * Ink Action Handlers
 *
 * Handlers for ink/drawing mode actions. All ink interactions go through
 * the Unified Action System via dispatch().
 *
 * Wave 5: Ink Actions & UI System
 * @see docs/ARCHITECTURE-CHECKLIST.md
 */

import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';
import type { StrokeTransformParams } from '@mog-sdk/contracts/api';
import type { DrawingObject, InkTool } from '@mog-sdk/contracts/ink';

import { getUIStore, handled, notHandled } from './handler-utils';

// =============================================================================
// Type Helpers
// =============================================================================

interface InkCoordinatorHost {
  readonly ink: {
    activate(drawingId: string): void;
    deactivate(): void;
  };
}

/**
 * Get coordinator from dependencies.
 */
function getCoordinator(deps: ActionDependencies): InkCoordinatorHost | undefined {
  return deps.coordinator as InkCoordinatorHost | undefined;
}

/**
 * Get drawing data by ID using the handle-based drawings API.
 * Uses ws.drawings.get() to obtain a handle, then getData() for the object.
 */
async function getDrawingById(
  deps: ActionDependencies,
  drawingId: string,
): Promise<DrawingObject | null> {
  try {
    const ws = deps.workbook.activeSheet;
    const handle = await ws.drawings.get(drawingId);
    if (!handle) return null;
    return await handle.getData();
  } catch {
    return null;
  }
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Ensure a drawing exists for ink mode.
 * Creates a new drawing if no drawingId is provided.
 *
 * @returns Drawing ID on success, null on failure
 */
async function ensureDrawingExists(deps: ActionDependencies): Promise<string | null> {
  try {
    const ws = deps.workbook.activeSheet;

    // Get viewport center (use default position if not available)
    const viewportCenter = { x: 200, y: 200 }; // Default fallback

    const handle = await ws.drawings.add({
      anchorType: 'oneCell',
      x: viewportCenter.x,
      y: viewportCenter.y,
      width: 400,
      height: 300,
    });
    return handle.id;
  } catch {
    return null;
  }
}

// =============================================================================
// Mode Activation Actions
// =============================================================================

/**
 * ACTIVATE_INK_MODE
 *
 * Activates ink mode for drawing. If a drawingId is provided, activates that
 * drawing. If not, creates a new drawing at the viewport center.
 *
 * @param payload - Optional { drawingId: string }
 */
export const ACTIVATE_INK_MODE: AsyncActionHandler = async (
  deps,
  payload?: { drawingId?: string },
): Promise<ActionResult> => {
  const uiStore = getUIStore(deps);
  const state = uiStore.getState();

  // If drawingId is provided, use it
  if (payload?.drawingId) {
    // Verify the drawing exists
    const drawing = await getDrawingById(deps, payload.drawingId);
    if (!drawing) {
      return notHandled('disabled');
    }
    state.activateInkMode(payload.drawingId);

    // Initialize ink coordination on the coordinator
    // Coordinator computes getDrawingOffset internally (Resource Ownership principle)
    const coordinator = getCoordinator(deps);
    coordinator?.ink.activate(payload.drawingId);

    return handled();
  }

  // Create a new drawing at viewport center using helper
  const drawingId = await ensureDrawingExists(deps);
  if (!drawingId) {
    return notHandled('disabled');
  }

  state.activateInkMode(drawingId);

  // Initialize ink coordination on the coordinator
  // Coordinator computes getDrawingOffset internally (Resource Ownership principle)
  const coordinator = getCoordinator(deps);
  coordinator?.ink.activate(drawingId);

  return handled();
};

/**
 * DEACTIVATE_INK_MODE
 *
 * Deactivates ink mode, clearing selection and returning to normal mode.
 */
export const DEACTIVATE_INK_MODE: ActionHandler = (deps): ActionResult => {
  const uiStore = getUIStore(deps);
  const coordinator = getCoordinator(deps);

  // Deactivate ink coordination first (cleans up input handler)
  coordinator?.ink.deactivate();

  // Then update UIStore
  uiStore.getState().deactivateInkMode();
  return handled();
};

/**
 * TOGGLE_INK_TOOL
 *
 * Toggle ink mode with specified tool.
 * - If not active: activate ink mode with the tool
 * - If active with a different tool: switch to the new tool
 * - If active with the same tool: deactivate ink mode (toggle off)
 *
 * @param payload - { tool: InkTool }
 */
export const TOGGLE_INK_TOOL: AsyncActionHandler = async (
  deps,
  payload?: { tool: InkTool },
): Promise<ActionResult> => {
  if (!payload?.tool) {
    return notHandled('disabled');
  }

  const uiStore = getUIStore(deps);
  const state = uiStore.getState();
  const { tool } = payload;

  if (!state.inkModeActive) {
    // Not active - activate ink mode and set tool
    const drawingId = await ensureDrawingExists(deps);
    if (!drawingId) {
      return notHandled('disabled');
    }

    state.activateInkMode(drawingId);
    state.setActiveTool(tool);

    // Initialize ink coordination on the coordinator
    const coordinator = getCoordinator(deps);
    coordinator?.ink.activate(drawingId);

    return handled();
  } else if (state.activeTool === tool) {
    // Same tool - toggle off (deactivate ink mode)
    const coordinator = getCoordinator(deps);
    coordinator?.ink.deactivate();
    state.deactivateInkMode();
    return handled();
  } else {
    // Different tool - just switch tools
    state.setActiveTool(tool);
    return handled();
  }
};

/**
 * TOGGLE_INK_MODE_DEFAULT
 *
 * Toggle ink mode with default 'pen' tool.
 * Used by keyboard shortcuts which cannot pass payloads.
 *
 * Delegates to TOGGLE_INK_TOOL with { tool: 'pen' }.
 */
export const TOGGLE_INK_MODE_DEFAULT: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  return TOGGLE_INK_TOOL(deps, { tool: 'pen' });
};

// =============================================================================
// Tool Settings Actions
// =============================================================================

/**
 * SET_INK_TOOL
 *
 * Sets the active ink tool (pen, pencil, highlighter, eraser).
 *
 * @param payload - { tool: InkTool }
 */
export const SET_INK_TOOL: ActionHandler = (deps, payload?: { tool: InkTool }): ActionResult => {
  if (!payload?.tool) {
    return notHandled('disabled');
  }

  const uiStore = getUIStore(deps);
  uiStore.getState().setActiveTool(payload.tool);
  return handled();
};

/**
 * SET_INK_COLOR
 *
 * Sets the stroke color for drawing.
 *
 * @param payload - { color: string } CSS color value
 */
export const SET_INK_COLOR: ActionHandler = (deps, payload?: { color: string }): ActionResult => {
  if (!payload?.color) {
    return notHandled('disabled');
  }

  const uiStore = getUIStore(deps);
  uiStore.getState().setStrokeColor(payload.color);
  return handled();
};

/**
 * SET_INK_WIDTH
 *
 * Sets the stroke width for drawing.
 *
 * @param payload - { width: number } Width in pixels
 */
export const SET_INK_WIDTH: ActionHandler = (deps, payload?: { width: number }): ActionResult => {
  if (typeof payload?.width !== 'number') {
    return notHandled('disabled');
  }

  const uiStore = getUIStore(deps);
  uiStore.getState().setStrokeWidth(payload.width);
  return handled();
};

/**
 * SET_INK_OPACITY
 *
 * Sets the stroke opacity for drawing.
 *
 * @param payload - { opacity: number } Opacity 0-1
 */
export const SET_INK_OPACITY: ActionHandler = (
  deps,
  payload?: { opacity: number },
): ActionResult => {
  if (typeof payload?.opacity !== 'number') {
    return notHandled('disabled');
  }

  const uiStore = getUIStore(deps);
  uiStore.getState().setStrokeOpacity(payload.opacity);
  return handled();
};

// =============================================================================
// Drawing Operations
// =============================================================================

/**
 * CLEAR_DRAWING
 *
 * Clears all strokes from the active drawing.
 */
export const CLEAR_DRAWING: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const uiStore = getUIStore(deps);
  const state = uiStore.getState();

  if (!state.inkModeActive || !state.activeDrawingId) {
    return notHandled('disabled');
  }

  const ws = deps.workbook.activeSheet;
  const drawing = await ws.drawings.get(state.activeDrawingId);
  if (!drawing) return notHandled('disabled');
  await drawing.clearStrokes();

  // Clear selection after clearing strokes
  state.clearStrokeSelection();

  return handled();
};

/**
 * DELETE_SELECTED_STROKES
 *
 * Deletes the currently selected strokes from the drawing.
 */
export const DELETE_SELECTED_STROKES: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const uiStore = getUIStore(deps);
  const state = uiStore.getState();

  if (!state.inkModeActive || !state.activeDrawingId) {
    return notHandled('disabled');
  }

  if (state.selectedStrokeIds.size === 0) {
    return notHandled('disabled');
  }

  const ws = deps.workbook.activeSheet;
  const drawing = await ws.drawings.get(state.activeDrawingId);
  if (!drawing) return notHandled('disabled');
  const strokeIds = Array.from(state.selectedStrokeIds);

  await drawing.eraseStrokes(strokeIds);

  // Clear selection after deleting
  state.clearStrokeSelection();

  return handled();
};

/**
 * SELECT_ALL_STROKES
 *
 * Selects all strokes in the active drawing.
 */
export const SELECT_ALL_STROKES: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const uiStore = getUIStore(deps);
  const state = uiStore.getState();

  if (!state.inkModeActive || !state.activeDrawingId) {
    return notHandled('disabled');
  }

  // Get the drawing to access all stroke IDs
  const drawing = await getDrawingById(deps, state.activeDrawingId);
  if (!drawing) {
    return notHandled('disabled');
  }

  // Get all stroke IDs from the drawing's strokes Map
  const allStrokeIds = Array.from(drawing.strokes.keys());
  state.selectStrokes(allStrokeIds);

  return handled();
};

/**
 * INSERT_DRAWING
 *
 * Inserts a new drawing object at the viewport center.
 */
export const INSERT_DRAWING: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const ws = deps.workbook.activeSheet;

  // Get viewport center (use default position if not available)
  const viewportCenter = { x: 200, y: 200 }; // Default fallback

  const handle = await ws.drawings.add({
    anchorType: 'oneCell',
    x: viewportCenter.x,
    y: viewportCenter.y,
    width: 400,
    height: 300,
  });

  // Optionally activate ink mode for the new drawing
  const uiStore = getUIStore(deps);
  uiStore.getState().activateInkMode(handle.id);

  return handled();
};

// =============================================================================
// Selection Actions
// =============================================================================

/**
 * TOGGLE_LASSO_SELECTION
 *
 * Toggles lasso selection mode for selecting strokes.
 */
export const TOGGLE_LASSO_SELECTION: ActionHandler = (deps): ActionResult => {
  const uiStore = getUIStore(deps);
  const state = uiStore.getState();

  if (!state.inkModeActive) {
    return notHandled('disabled');
  }

  state.toggleSelectionMode();
  return handled();
};

// =============================================================================
// Transform Actions
// =============================================================================

/**
 * MOVE_SELECTED_STROKES
 *
 * Moves selected strokes by a delta offset.
 *
 * @param payload - { deltaX: number, deltaY: number }
 */
export const MOVE_SELECTED_STROKES: AsyncActionHandler = async (
  deps,
  payload?: { deltaX: number; deltaY: number },
): Promise<ActionResult> => {
  if (typeof payload?.deltaX !== 'number' || typeof payload?.deltaY !== 'number') {
    return notHandled('disabled');
  }

  const uiStore = getUIStore(deps);
  const state = uiStore.getState();

  if (!state.inkModeActive || !state.activeDrawingId) {
    return notHandled('disabled');
  }

  if (state.selectedStrokeIds.size === 0) {
    return notHandled('disabled');
  }

  const ws = deps.workbook.activeSheet;
  const drawing = await ws.drawings.get(state.activeDrawingId);
  if (!drawing) return notHandled('disabled');
  const strokeIds = Array.from(state.selectedStrokeIds);

  await drawing.moveStrokes(strokeIds, payload.deltaX, payload.deltaY);

  return handled();
};

/**
 * TRANSFORM_SELECTED_STROKES
 *
 * Transforms selected strokes (rotate, scale, flip).
 *
 * @param payload - StrokeTransformParams
 */
export const TRANSFORM_SELECTED_STROKES: AsyncActionHandler = async (
  deps,
  payload?: StrokeTransformParams,
): Promise<ActionResult> => {
  if (!payload?.type) {
    return notHandled('disabled');
  }

  const uiStore = getUIStore(deps);
  const state = uiStore.getState();

  if (!state.inkModeActive || !state.activeDrawingId) {
    return notHandled('disabled');
  }

  if (state.selectedStrokeIds.size === 0) {
    return notHandled('disabled');
  }

  const ws = deps.workbook.activeSheet;
  const drawing = await ws.drawings.get(state.activeDrawingId);
  if (!drawing) return notHandled('disabled');
  const strokeIds = Array.from(state.selectedStrokeIds);

  await drawing.transformStrokes(strokeIds, payload);

  return handled();
};

// =============================================================================
// Recognition Actions (Wave 6: Ink Recognition)
// =============================================================================

/**
 * RECOGNIZE_INK_AS_SHAPE
 *
 * Recognizes selected strokes (or all strokes if none selected) as a
 * geometric shape and converts them to a shape object.
 *
 * Uses the InkRecognitionBridge to analyze stroke geometry and determine
 * the best matching shape. If recognition succeeds, the original strokes
 * are deleted and a new shape object is created in their place.
 */
export const RECOGNIZE_INK_AS_SHAPE: AsyncActionHandler = async (deps) => {
  const uiStore = getUIStore(deps);
  const state = uiStore.getState();

  if (!state.inkModeActive || !state.activeDrawingId) {
    return notHandled('disabled');
  }

  // Get the drawing
  const drawing = await getDrawingById(deps, state.activeDrawingId);
  if (!drawing || drawing.strokes.size === 0) {
    return notHandled('disabled');
  }

  // Get strokes to recognize (selected or all)
  const strokeIds =
    state.selectedStrokeIds.size > 0
      ? Array.from(state.selectedStrokeIds)
      : Array.from(drawing.strokes.keys());

  const strokes = strokeIds
    .map((id) => drawing.strokes.get(id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined);

  if (strokes.length === 0) {
    return notHandled('disabled');
  }

  // Use the recognition bridge from workbook
  const ink = deps.workbook.ink;
  if (!ink) return notHandled('disabled');
  const result = await ink.recognizeShape(strokes);

  if (!result) {
    // No shape recognized with sufficient confidence
    return { handled: true };
  }

  // Recognition succeeded - create shape and delete original strokes
  deps.workbook.setPendingUndoDescription(`Convert ink to ${result.type}`);

  // Delete the strokes that were converted
  const ws = deps.workbook.activeSheet;
  const drawingHandle = await ws.drawings.get(state.activeDrawingId!);
  if (!drawingHandle) return notHandled('disabled');
  await drawingHandle.eraseStrokes(strokeIds as import('@mog-sdk/contracts/ink').StrokeId[]);

  // Create a shape object at the recognized bounds
  // Note: Shape creation would go through floatingObjectManager.createShape
  // For now, emit an event with the recognition result
  deps.workbook.emit({
    type: 'INK_SHAPE_RECOGNIZED',
    timestamp: Date.now(),
    drawingId: state.activeDrawingId!,
    shapeType: result.type,
    confidence: result.confidence,
    bounds: result.bounds,
    params: result.params,
  });

  // Clear selection after converting
  state.clearStrokeSelection();

  return handled();
};

/**
 * RECOGNIZE_INK_AS_TEXT
 *
 * Recognizes selected strokes (or all strokes if none selected) as
 * handwritten text using the browser's Handwriting Recognition API.
 *
 * If recognition succeeds, the original strokes are deleted and the
 * recognized text is inserted into the cell under the drawing's anchor.
 */
export const RECOGNIZE_INK_AS_TEXT: AsyncActionHandler = async (deps) => {
  const uiStore = getUIStore(deps);
  const state = uiStore.getState();

  if (!state.inkModeActive || !state.activeDrawingId) {
    return notHandled('disabled');
  }

  // Check if text recognition is available
  const ink = deps.workbook.ink;
  if (!ink || !ink.isTextRecognitionAvailable()) {
    // Emit an event to show a toast/notification
    deps.workbook.emit({
      type: 'INK_TEXT_RECOGNITION_UNAVAILABLE',
      timestamp: Date.now(),
    });
    return { handled: true };
  }

  // Get the drawing
  const drawing = await getDrawingById(deps, state.activeDrawingId);
  if (!drawing || drawing.strokes.size === 0) {
    return notHandled('disabled');
  }

  // Get strokes to recognize (selected or all)
  const strokeIds =
    state.selectedStrokeIds.size > 0
      ? Array.from(state.selectedStrokeIds)
      : Array.from(drawing.strokes.keys());

  const strokes = strokeIds
    .map((id) => drawing.strokes.get(id))
    .filter((s): s is NonNullable<typeof s> => s !== undefined);

  if (strokes.length === 0) {
    return notHandled('disabled');
  }

  // Use the recognition bridge
  const result = await ink.recognizeText(strokes);

  if (!result) {
    // No text recognized with sufficient confidence
    return { handled: true };
  }

  // Recognition succeeded
  deps.workbook.setPendingUndoDescription('Convert ink to text');

  // Delete the strokes that were converted
  const ws = deps.workbook.activeSheet;
  const drawingHandle = await ws.drawings.get(state.activeDrawingId!);
  if (!drawingHandle) return notHandled('disabled');
  await drawingHandle.eraseStrokes(strokeIds as import('@mog-sdk/contracts/ink').StrokeId[]);

  // Emit an event with the recognized text
  // The coordinator can handle setting the cell value
  deps.workbook.emit({
    type: 'INK_TEXT_RECOGNIZED',
    timestamp: Date.now(),
    drawingId: state.activeDrawingId!,
    text: result.text,
    confidence: result.confidence,
    bounds: result.bounds,
  });

  // Clear selection after converting
  state.clearStrokeSelection();

  return handled();
};

// =============================================================================
// Aliases for Backwards Compatibility
// =============================================================================

/**
 * SET_INK_THICKNESS - Alias for SET_INK_WIDTH.
 * Maintains backwards compatibility with code expecting SET_INK_THICKNESS.
 */
export const SET_INK_THICKNESS = SET_INK_WIDTH;

/**
 * CLEAR_ALL_INK - Alias for CLEAR_DRAWING.
 * Clears all ink strokes from the active drawing.
 */
export const CLEAR_ALL_INK = CLEAR_DRAWING;

/**
 * ADD_INK_STROKE
 *
 * Adds a new ink stroke to the active drawing.
 * This is typically handled by the ink coordination layer during mouse/touch events.
 *
 * @param payload - { stroke: InkStroke } The stroke to add
 */
export const ADD_INK_STROKE: AsyncActionHandler = async (
  deps,
  payload?: { stroke: import('@mog-sdk/contracts/ink').InkStroke },
): Promise<ActionResult> => {
  if (!payload?.stroke) {
    return notHandled('disabled');
  }

  const uiStore = getUIStore(deps);
  const state = uiStore.getState();

  if (!state.inkModeActive || !state.activeDrawingId) {
    return notHandled('disabled');
  }

  // Get the drawing handle and add the stroke
  const ws = deps.workbook.activeSheet;
  const drawing = await ws.drawings.get(state.activeDrawingId);
  if (!drawing) {
    return notHandled('disabled');
  }

  await drawing.addStroke(payload.stroke);

  return handled();
};

/**
 * UNDO_INK_STROKE
 *
 * Removes the most recently added ink stroke from the active drawing.
 */
export const UNDO_INK_STROKE: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const uiStore = getUIStore(deps);
  const state = uiStore.getState();

  if (!state.inkModeActive || !state.activeDrawingId) {
    return notHandled('disabled');
  }

  const ws = deps.workbook.activeSheet;
  const drawingHandle = await ws.drawings.get(state.activeDrawingId);
  if (!drawingHandle) return notHandled('disabled');

  const drawingData = await drawingHandle.getData();
  if (!drawingData || drawingData.strokes.size === 0) {
    return notHandled('disabled');
  }

  // Get the last stroke ID (strokes are stored in a Map, get last key)
  const strokeIds = Array.from(drawingData.strokes.keys());
  if (strokeIds.length === 0) {
    return notHandled('disabled');
  }

  const lastStrokeId = strokeIds[strokeIds.length - 1];

  await drawingHandle.eraseStrokes([lastStrokeId]);

  return handled();
};

/**
 * ERASE_INK_AT_POINT
 *
 * Erases ink strokes that intersect with a given point.
 * Used by the eraser tool during mouse/touch events.
 *
 * @param payload - { x: number, y: number, radius?: number } The point and optional eraser radius
 */
export const ERASE_INK_AT_POINT: AsyncActionHandler = async (
  deps,
  payload?: { x: number; y: number; radius?: number },
): Promise<ActionResult> => {
  if (typeof payload?.x !== 'number' || typeof payload?.y !== 'number') {
    return notHandled('disabled');
  }

  const uiStore = getUIStore(deps);
  const state = uiStore.getState();

  if (!state.inkModeActive || !state.activeDrawingId) {
    return notHandled('disabled');
  }

  const ws = deps.workbook.activeSheet;
  const drawingHandle = await ws.drawings.get(state.activeDrawingId);
  if (!drawingHandle) return notHandled('disabled');

  const drawingData = await drawingHandle.getData();
  if (!drawingData) {
    return notHandled('disabled');
  }

  const radius = payload.radius ?? 5;
  const x = payload.x;
  const y = payload.y;

  // Find strokes that intersect with the point
  const strokesToErase: string[] = [];
  drawingData.strokes.forEach((stroke, strokeId) => {
    // Check if any point in the stroke is within radius of the target point
    for (const point of stroke.points) {
      const distance = Math.sqrt(Math.pow(point.x - x, 2) + Math.pow(point.y - y, 2));
      if (distance <= radius) {
        strokesToErase.push(strokeId);
        break;
      }
    }
  });

  if (strokesToErase.length === 0) {
    return handled(); // No strokes to erase
  }

  await drawingHandle.eraseStrokes(strokesToErase as import('@mog-sdk/contracts/ink').StrokeId[]);

  return handled();
};
