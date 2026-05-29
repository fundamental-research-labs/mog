/**
 * Object Action Handlers
 *
 * Pure handler functions for floating object (charts, images, shapes) actions.
 * These handlers are called by the unified action dispatcher.
 *
 * ARCHITECTURE:
 * - Handlers are pure functions: (deps) => ActionResult
 * - Object actions send events to the ObjectInteractionActor
 * - The actor manages selection, movement, and deletion state
 * - DATA MUTATIONS go through the unified Worksheet API (ws.*)
 * - Undo descriptions are set via deps.workbook.setPendingUndoDescription() before ws calls
 * - DO NOT use onUIAction for data mutations
 *
 * This file handles:
 * - Object deletion
 * - Object deselection
 * - Nudge operations (arrow keys move objects by grid amount)
 * - Fine nudge operations (Ctrl+arrow keys move by small increments)
 * - Object duplication
 * - Shape operations (insert, fill, outline, text, shadow)
 * - Z-order operations (bring to front, send to back, etc.)
 * - Grouping operations (group, ungroup)
 * - Rotation/flip operations
 *
 */

import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';
import type { MutationReceipt } from '@mog-sdk/contracts/api';
import type { ObjectFill, ShapeOutline, ShapeText } from '@mog-sdk/contracts/floating-objects';

import {
  getUIStore,
  handled,
  isProtectionRejection,
  notHandled,
  showProtectionFeedback,
} from './handler-utils';

import type { ISheetViewGeometry, ISheetViewViewport } from '@mog-sdk/sheet-view';
import type { SheetId } from '@mog-sdk/contracts/core';
import {
  getSmartPosition,
  SHAPE_POSITION_PRESET,
  TEXTBOX_POSITION_PRESET,
} from '../../systems/objects/utils/smart-positioning';

const DEFAULT_PICTURE_WIDTH = 200;
const DEFAULT_PICTURE_HEIGHT = 150;
const DEFAULT_TEXTBOX_WIDTH = 150;
const DEFAULT_TEXTBOX_HEIGHT = 75;

// =============================================================================
// Type Helpers
// =============================================================================

/**
 * Check if an ID is a chart by querying the Worksheet API.
 *
 * Architecture Note:
 * Charts are stored in Rust compute-core, not in FloatingObjectManager.
 * To determine if an ID is a chart, we check if ws.charts.get() returns a value.
 */
async function isChart(
  deps: ActionDependencies,
  sheetId: SheetId,
  objectId: string,
): Promise<boolean> {
  const ws = deps.workbook.getSheetById(sheetId);
  const chart = await ws.charts.get(objectId);
  return chart !== null && chart !== undefined;
}

/**
 * Get the selected object ID from the object interaction actor.
 */
function getSelectedObjectId(deps: ActionDependencies): string | null {
  return deps.accessors.object.getFirstSelectedId();
}

/**
 * Get all selected object IDs from the object interaction actor.
 */
function getSelectedObjectIds(deps: ActionDependencies): string[] {
  return deps.accessors.object.getSelectedIds();
}

/**
 * Type guard: does the coordinator expose renderer capabilities?
 */
function hasRendererCapabilities(coordinator: unknown): coordinator is {
  renderer: {
    getGeometry: () => ISheetViewGeometry | null;
    getViewport: () => ISheetViewViewport | null;
  };
} {
  return (
    coordinator !== null &&
    coordinator !== undefined &&
    typeof coordinator === 'object' &&
    'renderer' in coordinator &&
    coordinator.renderer !== null &&
    typeof coordinator.renderer === 'object' &&
    'getGeometry' in coordinator.renderer! &&
    typeof (coordinator.renderer as any).getGeometry === 'function' &&
    'getViewport' in coordinator.renderer! &&
    typeof (coordinator.renderer as any).getViewport === 'function'
  );
}

/**
 * Compute smart position for a floating object using the active selection
 * and viewport visibility, following the same pattern as chart positioning.
 */
function getSmartObjectPosition(
  deps: ActionDependencies,
  sheetId: SheetId,
  preset: {
    offsetFromSource?: { rows: number; cols: number };
    fallbackOffset?: { rows: number; cols: number };
    positionRight?: boolean;
  },
): { anchorRow: number; anchorCol: number } {
  let geometry: ISheetViewGeometry | null = null;
  let viewport: ISheetViewViewport | null = null;
  if (hasRendererCapabilities(deps.coordinator)) {
    geometry = deps.coordinator.renderer.getGeometry();
    viewport = deps.coordinator.renderer.getViewport();
  }

  // Use the current selection as the source range anchor
  const ranges = deps.accessors.selection.getDataBoundedRanges(sheetId);
  const sourceRange = ranges.length > 0 ? ranges[0] : null;

  return getSmartPosition({
    sourceRange,
    geometry,
    viewport,
    defaultPosition: { anchorRow: 2, anchorCol: 2 },
    ...preset,
  });
}

/**
 * Form controls inserted from the ribbon are cell controls, not free-floating
 * shapes. Excel anchors them to the selected/active cell and links their value
 * to that same cell.
 */
function getSelectedCellPosition(deps: ActionDependencies): { row: number; col: number } {
  const activeCell = deps.accessors.selection.getActiveCell?.();
  if (activeCell) {
    return { row: activeCell.row, col: activeCell.col };
  }

  const range = deps.accessors.selection.getRanges?.()[0];
  if (range) {
    return { row: range.startRow, col: range.startCol };
  }

  return { row: 0, col: 0 };
}

// =============================================================================
// Object Deletion/Selection Actions
// These actions route to chart actor when a chart is selected.
// =============================================================================

/**
 * Delete - Delete the currently selected object(s).
 *
 * UNIFIED ARCHITECTURE (
 * All floating objects (shapes, images, charts) are selected via objectInteractionActor.
 * This handler:
 * 1. Gets selected IDs from objectInteractionActor (single source of truth)
 * 2. For each ID, determines if it's a chart or other object
 * 3. Deletes via appropriate layer (Worksheet API for charts, Mutations for others)
 * 4. Clears selection state via objectInteractionActor
 *
 */
export const DELETE_OBJECT: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  // Get selected object IDs from unified objectInteractionActor
  const selectedIds = getSelectedObjectIds(deps);
  if (selectedIds.length === 0) {
    return notHandled('wrong_context');
  }

  const sheetId = deps.getActiveSheetId();

  // Separate chart IDs from other object IDs
  const chartIds: string[] = [];
  const otherObjectIds: string[] = [];

  for (const id of selectedIds) {
    if (await isChart(deps, sheetId, id)) {
      chartIds.push(id);
    } else {
      otherObjectIds.push(id);
    }
  }

  // Delete charts via unified Worksheet API
  const ws = deps.workbook.getSheetById(sheetId);
  for (const chartId of chartIds) {
    try {
      await ws.charts.remove(chartId);
    } catch (err) {
      // Log error but continue with other deletions
      console.warn(`Failed to delete chart ${chartId}: ${(err as Error).message}`);
    }
  }

  // Delete other objects via WorksheetObjects API
  const receipts: MutationReceipt[] = [];
  if (otherObjectIds.length > 0) {
    deps.workbook.setPendingUndoDescription('Delete objects');
    for (const id of otherObjectIds) {
      try {
        const handle = await ws.objects.get(id);
        if (handle) {
          const receipt = await handle.delete();
          receipts.push(receipt);
        }
      } catch (err) {
        console.warn(`Failed to delete object ${id}: ${(err as Error).message}`);
      }
    }
  }

  // Clear selection state in the unified state machine
  deps.commands.object.keyDelete();

  // Also clear chart selection state for backward compatibility during transition
  // (Chart machine may still have stale selection state)
  deps.commands.chart.deselect();

  return handled(receipts.length > 0 ? { receipts } : undefined);
};

/**
 * Escape - Deselect the currently selected object, returning focus to grid.
 *
 * UNIFIED ARCHITECTURE (
 * All floating objects (shapes, images, charts) are selected via objectInteractionActor.
 * We deselect via objectInteractionActor and also clear chart selection for backward
 * compatibility during the transition period.
 */
export const DESELECT_OBJECT: ActionHandler = (deps): ActionResult => {
  // Deselect via unified objectInteractionActor
  deps.commands.object.keyEscape();

  // Also clear chart selection for backward compatibility during transition
  deps.commands.chart.deselect();

  return handled();
};

// =============================================================================
// Nudge Actions (Standard - Grid Snapping)
// UNIFIED ARCHITECTURE : All objects selected via objectInteractionActor
// =============================================================================

/**
 * Nudge amount constants.
 * Standard nudge is 1 cell, large nudge (Shift+Arrow) is 5 cells.
 */
const NUDGE_SMALL = 1;
const NUDGE_LARGE = 5;

/**
 * Helper function to nudge selected objects (charts and other objects).
 *
 * UNIFIED ARCHITECTURE (
 * Gets selected IDs from objectInteractionActor, then:
 * - For charts: uses Worksheet API updateChart with cell-based positioning
 * - For other objects: uses object keyArrow command
 *
 * @param deps - Action dependencies
 * @param dx - Horizontal movement (in cells)
 * @param dy - Vertical movement (in cells)
 * @param large - Whether this is a large nudge (Shift+Arrow)
 */
async function nudgeSelectedObjects(
  deps: ActionDependencies,
  dx: number,
  dy: number,
  large: boolean,
): Promise<ActionResult> {
  const selectedIds = getSelectedObjectIds(deps);
  if (selectedIds.length === 0) {
    return notHandled('wrong_context');
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  const amount = large ? NUDGE_LARGE : NUDGE_SMALL;

  // Track if we have non-chart objects that need keyArrow command
  let hasOtherObjects = false;

  for (const id of selectedIds) {
    if (await isChart(deps, sheetId, id)) {
      // Nudge chart via Worksheet API
      const chart = await ws.charts.get(id);
      if (chart) {
        const currentRow = chart.anchorRow ?? 0;
        const currentCol = chart.anchorCol ?? 0;
        const newRow = Math.max(0, currentRow + dy * amount);
        const newCol = Math.max(0, currentCol + dx * amount);

        await ws.charts.update(id, { anchorRow: newRow, anchorCol: newCol });
      }
    } else {
      hasOtherObjects = true;
    }
  }

  // If any non-chart objects, use object keyArrow command
  // (This handles the movement for shapes, images, etc. via object state machine)
  if (hasOtherObjects) {
    const direction = dy < 0 ? 'up' : dy > 0 ? 'down' : dx < 0 ? 'left' : dx > 0 ? 'right' : 'up';
    deps.commands.object.keyArrow(direction, large);
  }

  return handled();
}

/**
 * Up Arrow (when object selected) - Nudge object up by grid amount.
 *
 * UNIFIED ARCHITECTURE (
 * Works with any selected object type (charts, shapes, images).
 */
export const NUDGE_OBJECT_UP: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  return nudgeSelectedObjects(deps, 0, -1, false);
};

/**
 * Down Arrow (when object selected) - Nudge object down by grid amount.
 *
 * UNIFIED ARCHITECTURE (
 * Works with any selected object type (charts, shapes, images).
 */
export const NUDGE_OBJECT_DOWN: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  return nudgeSelectedObjects(deps, 0, 1, false);
};

/**
 * Left Arrow (when object selected) - Nudge object left by grid amount.
 *
 * UNIFIED ARCHITECTURE (
 * Works with any selected object type (charts, shapes, images).
 */
export const NUDGE_OBJECT_LEFT: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  return nudgeSelectedObjects(deps, -1, 0, false);
};

/**
 * Right Arrow (when object selected) - Nudge object right by grid amount.
 *
 * UNIFIED ARCHITECTURE (
 * Works with any selected object type (charts, shapes, images).
 */
export const NUDGE_OBJECT_RIGHT: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  return nudgeSelectedObjects(deps, 1, 0, false);
};

// =============================================================================
// Fine Nudge Actions (Large Increments - Shift+Arrow)
// UNIFIED ARCHITECTURE : All objects selected via objectInteractionActor
// =============================================================================

/**
 * Shift+Up Arrow (when object selected) - Nudge object up by large amount.
 *
 * UNIFIED ARCHITECTURE (
 * Works with any selected object type (charts, shapes, images).
 */
export const NUDGE_OBJECT_UP_FINE: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  return nudgeSelectedObjects(deps, 0, -1, true);
};

/**
 * Shift+Down Arrow (when object selected) - Nudge object down by large amount.
 *
 * UNIFIED ARCHITECTURE (
 * Works with any selected object type (charts, shapes, images).
 */
export const NUDGE_OBJECT_DOWN_FINE: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  return nudgeSelectedObjects(deps, 0, 1, true);
};

/**
 * Shift+Left Arrow (when object selected) - Nudge object left by large amount.
 *
 * UNIFIED ARCHITECTURE (
 * Works with any selected object type (charts, shapes, images).
 */
export const NUDGE_OBJECT_LEFT_FINE: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  return nudgeSelectedObjects(deps, -1, 0, true);
};

/**
 * Shift+Right Arrow (when object selected) - Nudge object right by large amount.
 *
 * UNIFIED ARCHITECTURE (
 * Works with any selected object type (charts, shapes, images).
 */
export const NUDGE_OBJECT_RIGHT_FINE: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  return nudgeSelectedObjects(deps, 1, 0, true);
};

// =============================================================================
// Duplication Actions
// =============================================================================

/**
 * Ctrl+D (when object selected) - Duplicate the selected object.
 */
export const DUPLICATE_OBJECT: ActionHandler = (deps): ActionResult => {
  deps.commands.object.keyDuplicate();
  return handled();
};

// =============================================================================
// Picture Dialog Actions (Excel Parity Quickwin B2)
// =============================================================================

/**
 * Open Format Picture Dialog - opens the dialog for the target picture.
 * Payload: { objectId: string }
 */
export const OPEN_FORMAT_PICTURE_DIALOG: ActionHandler = (deps, payload): ActionResult => {
  const objectId = payload?.objectId;
  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }
  getUIStore(deps).getState().openFormatPictureDialog(objectId);
  return handled();
};

/**
 * Close Format Picture Dialog.
 */
export const CLOSE_FORMAT_PICTURE_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeFormatPictureDialog();
  return handled();
};

/**
 * Open Edit Alt Text Dialog - opens the dialog for the target picture.
 * Payload: { objectId: string }
 */
export const OPEN_EDIT_ALT_TEXT_DIALOG: ActionHandler = (deps, payload): ActionResult => {
  const objectId = payload?.objectId;
  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }
  getUIStore(deps).getState().openEditAltTextDialog(objectId);
  return handled();
};

/**
 * Close Edit Alt Text Dialog.
 */
export const CLOSE_EDIT_ALT_TEXT_DIALOG: ActionHandler = (deps): ActionResult => {
  getUIStore(deps).getState().closeEditAltTextDialog();
  return handled();
};

/**
 * Decode the bytes and inferred extension from a picture's `src`. Pictures
 * may be stored as `data:` URLs (most common path), `blob:` URLs (paste from
 * clipboard before persistence), or remote `http(s)` URLs (rare). All three
 * are reachable via `fetch` in the browser; we read the response as a
 * `Uint8Array` and derive an extension from the response MIME type when the
 * `data:` URL doesn't carry one.
 */
async function readPictureBytes(
  src: string,
): Promise<{ bytes: Uint8Array; extension: string } | null> {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const buffer = await res.arrayBuffer();
    const mime = res.headers.get('content-type') ?? 'application/octet-stream';
    const extension = mimeToExtension(mime);
    return { bytes: new Uint8Array(buffer), extension };
  } catch {
    return null;
  }
}

function mimeToExtension(mime: string): string {
  const lower = mime.toLowerCase();
  if (lower.includes('png')) return 'png';
  if (lower.includes('jpeg') || lower.includes('jpg')) return 'jpg';
  if (lower.includes('gif')) return 'gif';
  if (lower.includes('webp')) return 'webp';
  if (lower.includes('bmp')) return 'bmp';
  if (lower.includes('svg')) return 'svg';
  return 'png';
}

/**
 * Save Picture As File - exports the picture as a downloadable file.
 *
 * routes through `deps.platform.dialogs.showSaveDialog` →
 * `PlatformFileHandle.write`. On web with FSA the user picks a destination;
 * on web without FSA the handle's `write` performs an anchor download.
 *
 * Payload: { objectId: string }
 */
export const SAVE_PICTURE_AS_FILE: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const objectId = payload?.objectId;
  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  const pictureHandle = await ws.pictures.get(objectId);
  if (!pictureHandle) {
    return { handled: false, error: `Picture ${objectId} not found` };
  }
  const pictureData = await pictureHandle.getData();

  const decoded = await readPictureBytes(pictureData.src);
  if (!decoded) {
    return { handled: false, error: 'Failed to read picture bytes' };
  }

  const baseName = (pictureData.displayName ?? `picture-${objectId}`).replace(/\.[^.]+$/, '');
  const filter = { name: 'Image', extensions: [decoded.extension] };
  const fileHandle = await deps.platform.dialogs.showSaveDialog({
    title: 'Save Picture As',
    defaultPath: `${baseName}.${decoded.extension}`,
    filters: [filter],
  });
  if (!fileHandle) return notHandled('disabled');

  await fileHandle.write(decoded.bytes);
  return handled();
};

/**
 * Insert Picture - opens a platform file picker and inserts the selected image
 * as a floating picture anchored near the active selection.
 */
export const INSERT_PICTURE: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  const handle = await deps.platform.dialogs.showOpenDialog({
    title: 'Insert Picture',
    filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }],
  });
  if (!handle) return notHandled('disabled');

  try {
    const bytes = await handle.read();
    const dataUrl = bytesToDataUrl(bytes, handle.name);
    const sheetId = deps.getActiveSheetId();
    const ws = deps.workbook.getSheetById(sheetId);
    const { anchorRow, anchorCol } = getSmartObjectPosition(deps, sheetId, SHAPE_POSITION_PRESET);

    deps.workbook.setPendingUndoDescription('Insert picture');
    const picture = await ws.pictures.add({
      src: dataUrl,
      anchorCell: { row: anchorRow, col: anchorCol },
      width: DEFAULT_PICTURE_WIDTH,
      height: DEFAULT_PICTURE_HEIGHT,
      name: handle.name,
    });
    deps.commands.object.selectObject(picture.id, false, false);
    return handled();
  } catch (err) {
    return { handled: false, error: (err as Error).message };
  }
};

/**
 * Update Picture - updates picture properties (size, crop, adjustments, etc.).
 * Uses Mutations layer for data writes.
 * Payload: { objectId: string, updates: Partial<PictureObject> }
 */
export const UPDATE_PICTURE: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const objectId = payload?.objectId;
  const updates = payload?.updates;
  if (!objectId || !updates) {
    return { handled: false, error: 'Missing objectId or updates in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    deps.workbook.setPendingUndoDescription('Update picture');
    const picture = await ws.pictures.get(objectId);
    if (!picture) {
      return { handled: false, error: `Picture ${objectId} not found` };
    }
    await picture.update(updates);
  } catch (err) {
    return { handled: false, error: (err as Error).message };
  }
  return handled();
};

/**
 * Change Picture - opens file picker to replace image source.
 *
 * routes through `deps.platform.dialogs.showOpenDialog` →
 * `PlatformFileHandle.read`. The new bytes are encoded as a `data:` URL
 * (matching how pasted/inserted images are stored today) and pushed through
 * the worksheet API.
 *
 * Payload: { objectId: string }
 */
export const CHANGE_PICTURE: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const objectId = payload?.objectId;
  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }

  const handle = await deps.platform.dialogs.showOpenDialog({
    title: 'Change Picture',
    filters: [{ name: 'Image', extensions: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'] }],
  });
  if (!handle) return notHandled('disabled');

  const bytes = await handle.read();
  const dataUrl = bytesToDataUrl(bytes, handle.name);

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  const picture = await ws.pictures.get(objectId);
  if (!picture) {
    return { handled: false, error: `Picture ${objectId} not found` };
  }

  deps.workbook.setPendingUndoDescription('Change picture');
  await picture.update({ src: dataUrl });
  return handled();
};

function bytesToDataUrl(bytes: Uint8Array, name: string): string {
  const lower = name.toLowerCase();
  let mime = 'image/png';
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) mime = 'image/jpeg';
  else if (lower.endsWith('.gif')) mime = 'image/gif';
  else if (lower.endsWith('.webp')) mime = 'image/webp';
  else if (lower.endsWith('.bmp')) mime = 'image/bmp';
  else if (lower.endsWith('.svg')) mime = 'image/svg+xml';

  // Encode in chunks to avoid blowing the call stack on large images.
  let binary = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  const base64 = btoa(binary);
  return `data:${mime};base64,${base64}`;
}

/**
 * Reset Picture - restores original size and removes cropping.
 * Uses Mutations layer for data writes.
 * Payload: { objectId: string }
 */
export const RESET_PICTURE: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const objectId = payload?.objectId;
  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  // Read current picture state via WorksheetObjects API (read-only)
  const info = await ws.objects.get(objectId);
  if (!info || info.type !== 'picture') {
    return { handled: false, error: `Picture ${objectId} not found` };
  }

  try {
    deps.workbook.setPendingUndoDescription('Reset picture');
    const pictureHandle = await ws.pictures.get(objectId);
    if (!pictureHandle) {
      return { handled: false, error: `Picture ${objectId} not found` };
    }
    const pictureData = await pictureHandle.getData();
    await pictureHandle.update({
      width: pictureData.originalWidth,
      height: pictureData.originalHeight,
    });
  } catch (err) {
    return { handled: false, error: (err as Error).message };
  }
  return handled();
};

// =============================================================================
// Shape Actions
// Fixed to use Mutations layer instead of onUIAction
// =============================================================================

/**
 * Insert Shape - creates a new shape near the active cell/viewport.
 * Uses smart positioning to ensure the shape is always visible.
 * Payload: { shapeType: ShapeType, fill?, outline? }
 */
export const INSERT_SHAPE: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const { shapeType, fill, outline } = payload || {};
  if (!shapeType) {
    return { handled: false, error: 'Missing shapeType' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  const hasDragPosition = payload?.position?.x != null && payload?.position?.y != null;
  const width = payload?.position?.width ?? 200;
  const height = payload?.position?.height ?? 200;

  try {
    deps.workbook.setPendingUndoDescription('Insert shape');
    if (hasDragPosition) {
      // Drag-to-draw: pass pixel coords, let Rust resolve to cell anchor + offset
      await ws.shapes.add({
        type: shapeType,
        anchorRow: 0,
        anchorCol: 0,
        pixelX: payload.position.x,
        pixelY: payload.position.y,
        width,
        height,
        fill,
        outline,
      });
    } else {
      // Click-to-insert: use smart positioning near active cell
      const { anchorRow, anchorCol } = getSmartObjectPosition(deps, sheetId, SHAPE_POSITION_PRESET);
      await ws.shapes.add({
        type: shapeType,
        anchorRow,
        anchorCol,
        xOffset: 0,
        yOffset: 0,
        width,
        height,
        fill,
        outline,
      });
    }
    // Note: ws.shapes.add() returns a ShapeHandle, not a MutationReceipt.
    // The shape creation is complete; rendering is triggered through the normal event path.
    return handled();
  } catch (err) {
    return { handled: false, error: (err as Error).message };
  }
};

/**
 * Start Shape Insert — creates the default visible shape and keeps insertion mode armed
 * so a follow-up worksheet drag can define an explicitly sized shape.
 * Payload: { shapeType: ShapeType }
 */
export const START_SHAPE_INSERT: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const { shapeType } = payload || {};
  if (!shapeType) {
    return { handled: false, error: 'Missing shapeType' };
  }
  const result = await INSERT_SHAPE(deps, payload);
  if (!result.handled) {
    return result;
  }
  deps.commands.object.startInsert(shapeType);
  return handled();
};

/**
 * Insert Text Box - creates a new text box near the active cell/viewport.
 * Uses smart positioning to ensure the text box is always visible.
 * Payload: { content?: string, options?: CreateTextBoxOptions }
 */
export const INSERT_TEXTBOX: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const content = payload?.content ?? '';

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  // Use smart positioning: near active cell, visible in viewport
  const { anchorRow, anchorCol } = getSmartObjectPosition(deps, sheetId, TEXTBOX_POSITION_PRESET);
  const width = payload?.position?.width ?? DEFAULT_TEXTBOX_WIDTH;
  const height = payload?.position?.height ?? DEFAULT_TEXTBOX_HEIGHT;
  const text: ShapeText = {
    content,
    verticalAlign: 'top',
    horizontalAlign: 'left',
    margins: { left: 8, right: 8, top: 4, bottom: 4 },
  };

  try {
    deps.workbook.setPendingUndoDescription('Insert text box');
    const textBox = await ws.textBoxes.add({
      text,
      anchorCell: { row: anchorRow, col: anchorCol },
      x: 0,
      y: 0,
      width,
      height,
      name: payload?.name ?? 'Text Box',
    });
    deps.commands.object.selectObject(textBox.id, false, false);
    return handled();
  } catch (err) {
    return { handled: false, error: (err as Error).message };
  }
};

/**
 * Insert Checkbox Form Control - creates a linked checkbox near the active
 * selection through the worksheet form-controls API.
 */
export const INSERT_FORM_CONTROL_CHECKBOX: AsyncActionHandler = async (
  deps,
): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  const position = getSelectedCellPosition(deps);

  try {
    if (!(await ws.protection.canDoStructureOp('editObject'))) {
      showProtectionFeedback(deps);
      return notHandled('disabled');
    }
    deps.workbook.setPendingUndoDescription('Insert checkbox');
    await ws.formControls.addCheckbox({
      anchor: position,
      linkedCell: position,
    });
    return handled();
  } catch (err) {
    if (isProtectionRejection(err)) {
      showProtectionFeedback(deps, (err as Error).message);
      return notHandled('disabled');
    }
    return { handled: false, error: (err as Error).message };
  }
};

/**
 * Insert Combo Box Form Control - creates a linked dropdown near the active
 * selection through the worksheet form-controls API.
 */
export const INSERT_FORM_CONTROL_COMBOBOX: AsyncActionHandler = async (
  deps,
): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);
  const position = getSelectedCellPosition(deps);

  try {
    if (!(await ws.protection.canDoStructureOp('editObject'))) {
      showProtectionFeedback(deps);
      return notHandled('disabled');
    }
    deps.workbook.setPendingUndoDescription('Insert combo box');
    await ws.formControls.addComboBox({
      anchor: position,
      linkedCell: position,
      items: ['Option 1', 'Option 2', 'Option 3'],
      placeholder: 'Select',
    });
    return handled();
  } catch (err) {
    if (isProtectionRejection(err)) {
      showProtectionFeedback(deps, (err as Error).message);
      return notHandled('disabled');
    }
    return { handled: false, error: (err as Error).message };
  }
};

/**
 * Flip Shape Horizontal - flips the shape horizontally.
 * Uses Mutations layer for data writes.
 * Payload: { objectId: string }
 */
export const FLIP_SHAPE_HORIZONTAL: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const objectId = payload?.objectId;
  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    deps.workbook.setPendingUndoDescription('Flip object horizontal');
    const info = await ws.objects.get(objectId);
    if (!info) {
      return { handled: false, error: `Object ${objectId} not found` };
    }
    await info.flip('horizontal');
  } catch (err) {
    return { handled: false, error: (err as Error).message };
  }
  return handled();
};

/**
 * Flip Shape Vertical - flips the shape vertically.
 * Uses Mutations layer for data writes.
 * Payload: { objectId: string }
 */
export const FLIP_SHAPE_VERTICAL: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const objectId = payload?.objectId;
  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    deps.workbook.setPendingUndoDescription('Flip object vertical');
    const info = await ws.objects.get(objectId);
    if (!info) {
      return { handled: false, error: `Object ${objectId} not found` };
    }
    await info.flip('vertical');
  } catch (err) {
    return { handled: false, error: (err as Error).message };
  }
  return handled();
};

/**
 * Set Shape Fill - updates the fill color/pattern of a shape.
 * Uses Mutations layer for data writes.
 * Payload: { objectId: string, fill: ObjectFill }
 */
export const SET_SHAPE_FILL: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const objectId = payload?.objectId;
  const fill = payload?.fill as ObjectFill | undefined;
  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    deps.workbook.setPendingUndoDescription('Change shape fill');
    const shape = await ws.shapes.get(objectId);
    if (!shape) {
      return { handled: false, error: `Shape ${objectId} not found` };
    }
    await shape.update({ fill });
    return handled();
  } catch (err) {
    return { handled: false, error: (err as Error).message };
  }
};

/**
 * Set Shape Outline - updates the outline/border of a shape.
 * Uses Mutations layer for data writes.
 * Payload: { objectId: string, outline: ShapeOutline }
 */
export const SET_SHAPE_OUTLINE: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const objectId = payload?.objectId;
  const outline = payload?.outline as ShapeOutline | undefined;
  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    deps.workbook.setPendingUndoDescription('Change shape outline');
    const shape = await ws.shapes.get(objectId);
    if (!shape) {
      return { handled: false, error: `Shape ${objectId} not found` };
    }
    await shape.update({ outline });
    return handled();
  } catch (err) {
    return { handled: false, error: (err as Error).message };
  }
};

/**
 * Set Shape Text - updates the text content of a shape.
 * Uses Mutations layer for data writes.
 * Payload: { objectId: string, text: ShapeText }
 */
export const SET_SHAPE_TEXT: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const objectId = payload?.objectId;
  const text = payload?.text as ShapeText | undefined;
  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    deps.workbook.setPendingUndoDescription('Change shape text');
    const shape = await ws.shapes.get(objectId);
    if (!shape) {
      return { handled: false, error: `Shape ${objectId} not found` };
    }
    await shape.update({ text });
    return handled();
  } catch (err) {
    return { handled: false, error: (err as Error).message };
  }
};

/**
 * Set Shape Shadow - updates the shadow effect of a shape.
 * Payload: { objectId: string, shadow: OuterShadowEffect }
 */
export const SET_SHAPE_SHADOW: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const objectId = payload?.objectId;
  const shadow = payload?.shadow;
  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    deps.workbook.setPendingUndoDescription('Update object');
    const shape = await ws.shapes.get(objectId);
    if (!shape) {
      return { handled: false, error: `Shape ${objectId} not found` };
    }
    await shape.update({ shadow });
    return handled();
  } catch (err) {
    return { handled: false, error: (err as Error).message };
  }
};

/**
 * Copy Shape - copies the selected shape to the clipboard.
 * Reads shape data and stores in UIStore (no Yjs write).
 * Payload: { objectId: string }
 */
export const COPY_SHAPE: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const objectId = payload?.objectId;
  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  const info = await ws.objects.getInfo(objectId);
  if (!info) {
    return { handled: false, error: 'Object not found' };
  }

  // TODO: object clipboard not yet in UIState
  const uiStore = getUIStore(deps);
  uiStore.getState().setObjectClipboard({
    object: info,
    isCut: false,
    sourceSheetId: sheetId,
  });
  return handled();
};

/**
 * Cut Shape - cuts the selected shape to the clipboard.
 * Reads shape data and stores in UIStore with isCut flag (no Yjs write until paste).
 * Payload: { objectId: string }
 */
export const CUT_SHAPE: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const objectId = payload?.objectId;
  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  const info = await ws.objects.getInfo(objectId);
  if (!info) {
    return { handled: false, error: 'Object not found' };
  }

  // TODO: object clipboard not yet in UIState
  const uiStore = getUIStore(deps);
  uiStore.getState().setObjectClipboard({
    object: info,
    isCut: true,
    sourceSheetId: sheetId,
  });
  return handled();
};

/**
 * Paste Shape - pastes a shape from the clipboard.
 * Uses Mutations layer for data writes.
 * No payload required - pastes from clipboard state.
 */
export const PASTE_SHAPE: AsyncActionHandler = async (deps): Promise<ActionResult> => {
  // TODO: object clipboard not yet in UIState
  const uiStore = getUIStore(deps);
  const clipboard = uiStore.getState().objectClipboard;
  if (!clipboard?.object) {
    return notHandled('disabled');
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    // Duplicate the object via WorksheetObjects API
    const info = await ws.objects.get(clipboard.object.id);
    if (!info) {
      return { handled: false, error: `Object ${clipboard.object.id} not found` };
    }

    deps.workbook.setPendingUndoDescription('Duplicate object');
    const duplicateHandle = await info.duplicate();

    // If cut, delete original
    if (clipboard.isCut) {
      deps.workbook.setPendingUndoDescription('Delete object');
      await info.delete();
      // TODO: object clipboard not yet in UIState
      uiStore.getState().clearObjectClipboard();
    }

    return handled();
  } catch (err) {
    return { handled: false, error: (err as Error).message };
  }
};

// =============================================================================
// Arrange Group Actions
// Fixed to use Mutations layer instead of onUIAction
// =============================================================================

/**
 * Bring Object to Front - moves object to top of z-order.
 * Uses Mutations layer for data writes.
 * Payload: { objectId?: string } - If not provided, uses selected object.
 */
export const BRING_OBJECT_TO_FRONT: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const objectId = payload?.objectId || getSelectedObjectId(deps);
  if (!objectId) {
    return notHandled('wrong_context');
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    deps.workbook.setPendingUndoDescription('Bring to front');
    const info = await ws.objects.get(objectId);
    if (!info) {
      return { handled: false, error: `Object ${objectId} not found` };
    }
    await ws.objects.bringToFront(objectId);
  } catch (err) {
    return { handled: false, error: (err as Error).message };
  }
  return handled();
};

/**
 * Bring Object Forward - moves object up one level in z-order.
 * Uses Mutations layer for data writes.
 * Payload: { objectId?: string } - If not provided, uses selected object.
 */
export const BRING_OBJECT_FORWARD: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const objectId = payload?.objectId || getSelectedObjectId(deps);
  if (!objectId) {
    return notHandled('wrong_context');
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    deps.workbook.setPendingUndoDescription('Bring forward');
    const info = await ws.objects.get(objectId);
    if (!info) {
      return { handled: false, error: `Object ${objectId} not found` };
    }
    await ws.objects.bringForward(objectId);
  } catch (err) {
    return { handled: false, error: (err as Error).message };
  }
  return handled();
};

/**
 * Send Object to Back - moves object to bottom of z-order.
 * Uses Mutations layer for data writes.
 * Payload: { objectId?: string } - If not provided, uses selected object.
 */
export const SEND_OBJECT_TO_BACK: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const objectId = payload?.objectId || getSelectedObjectId(deps);
  if (!objectId) {
    return notHandled('wrong_context');
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    deps.workbook.setPendingUndoDescription('Send to back');
    const info = await ws.objects.get(objectId);
    if (!info) {
      return { handled: false, error: `Object ${objectId} not found` };
    }
    await ws.objects.sendToBack(objectId);
  } catch (err) {
    return { handled: false, error: (err as Error).message };
  }
  return handled();
};

/**
 * Send Object Backward - moves object down one level in z-order.
 * Uses Mutations layer for data writes.
 * Payload: { objectId?: string } - If not provided, uses selected object.
 */
export const SEND_OBJECT_BACKWARD: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const objectId = payload?.objectId || getSelectedObjectId(deps);
  if (!objectId) {
    return notHandled('wrong_context');
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    deps.workbook.setPendingUndoDescription('Send backward');
    const info = await ws.objects.get(objectId);
    if (!info) {
      return { handled: false, error: `Object ${objectId} not found` };
    }
    await ws.objects.sendBackward(objectId);
  } catch (err) {
    return { handled: false, error: (err as Error).message };
  }
  return handled();
};

/**
 * Align Objects Left - aligns multiple objects to leftmost edge.
 * Note: Alignment operations require computing bounds of multiple objects.
 * Currently not implemented in FloatingObjectManager - would need to be added.
 * Payload: { objectIds?: string[] } - If not provided, uses selected objects.
 */
export const ALIGN_OBJECTS_LEFT: ActionHandler = (_deps, _payload): ActionResult => {
  // TODO: Implement alignment in FloatingObjectManager
  // For now, return not implemented
  return notHandled('not_implemented');
};

/**
 * Align Objects Center - aligns multiple objects to horizontal center.
 * Note: Alignment operations require computing bounds of multiple objects.
 * Currently not implemented in FloatingObjectManager - would need to be added.
 * Payload: { objectIds?: string[] } - If not provided, uses selected objects.
 */
export const ALIGN_OBJECTS_CENTER: ActionHandler = (_deps, _payload): ActionResult => {
  // TODO: Implement alignment in FloatingObjectManager
  return notHandled('not_implemented');
};

/**
 * Align Objects Right - aligns multiple objects to rightmost edge.
 * Note: Alignment operations require computing bounds of multiple objects.
 * Currently not implemented in FloatingObjectManager - would need to be added.
 * Payload: { objectIds?: string[] } - If not provided, uses selected objects.
 */
export const ALIGN_OBJECTS_RIGHT: ActionHandler = (_deps, _payload): ActionResult => {
  // TODO: Implement alignment in FloatingObjectManager
  return notHandled('not_implemented');
};

/**
 * Align Objects Top - aligns multiple objects to topmost edge.
 * Note: Alignment operations require computing bounds of multiple objects.
 * Currently not implemented in FloatingObjectManager - would need to be added.
 * Payload: { objectIds?: string[] } - If not provided, uses selected objects.
 */
export const ALIGN_OBJECTS_TOP: ActionHandler = (_deps, _payload): ActionResult => {
  // TODO: Implement alignment in FloatingObjectManager
  return notHandled('not_implemented');
};

/**
 * Align Objects Middle - aligns multiple objects to vertical center.
 * Note: Alignment operations require computing bounds of multiple objects.
 * Currently not implemented in FloatingObjectManager - would need to be added.
 * Payload: { objectIds?: string[] } - If not provided, uses selected objects.
 */
export const ALIGN_OBJECTS_MIDDLE: ActionHandler = (_deps, _payload): ActionResult => {
  // TODO: Implement alignment in FloatingObjectManager
  return notHandled('not_implemented');
};

/**
 * Align Objects Bottom - aligns multiple objects to bottommost edge.
 * Note: Alignment operations require computing bounds of multiple objects.
 * Currently not implemented in FloatingObjectManager - would need to be added.
 * Payload: { objectIds?: string[] } - If not provided, uses selected objects.
 */
export const ALIGN_OBJECTS_BOTTOM: ActionHandler = (_deps, _payload): ActionResult => {
  // TODO: Implement alignment in FloatingObjectManager
  return notHandled('not_implemented');
};

/**
 * Group Objects - groups selected objects into a single group.
 * Uses Mutations layer for data writes.
 * Payload: { objectIds?: string[] } - If not provided, uses selected objects.
 */
export const GROUP_OBJECTS: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const objectIds = payload?.objectIds || getSelectedObjectIds(deps);
  if (!objectIds || objectIds.length < 2) {
    return { handled: false, error: 'At least 2 objects required for grouping' };
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    deps.workbook.setPendingUndoDescription('Group objects');
    await ws.objects.group(objectIds);
  } catch (err) {
    return { handled: false, error: (err as Error).message };
  }
  return handled();
};

/**
 * Ungroup Objects - ungroups the selected group(s).
 * Uses Mutations layer for data writes.
 * Payload: { groupId?: string } - If not provided, uses selected object if it's a group.
 */
export const UNGROUP_OBJECTS: AsyncActionHandler = async (deps, payload): Promise<ActionResult> => {
  const groupId = payload?.groupId || getSelectedObjectId(deps);
  if (!groupId) {
    return notHandled('wrong_context');
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    deps.workbook.setPendingUndoDescription('Ungroup objects');
    await ws.objects.ungroup(groupId);
  } catch (err) {
    return { handled: false, error: (err as Error).message };
  }
  return handled();
};

/**
 * Rotate Object Right 90 - rotates object clockwise 90 degrees.
 * Uses Mutations layer for data writes.
 * Payload: { objectId?: string } - If not provided, uses selected object.
 */
export const ROTATE_OBJECT_RIGHT_90: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const objectId = payload?.objectId || getSelectedObjectId(deps);
  if (!objectId) {
    return notHandled('wrong_context');
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  // Read current rotation via WorksheetObjects API (read-only)
  const existing = await ws.objects.getInfo(objectId);
  if (!existing) {
    return { handled: false, error: `Object ${objectId} not found` };
  }
  const currentRotation = existing.rotation ?? 0;
  const newRotation = (currentRotation + 90) % 360;

  try {
    deps.workbook.setPendingUndoDescription('Rotate object right 90\u00B0');
    const handle = await ws.objects.get(objectId);
    if (handle) await handle.rotate(newRotation);
  } catch (err) {
    return { handled: false, error: (err as Error).message };
  }
  return handled();
};

/**
 * Rotate Object Left 90 - rotates object counter-clockwise 90 degrees.
 * Uses Mutations layer for data writes.
 * Payload: { objectId?: string } - If not provided, uses selected object.
 */
export const ROTATE_OBJECT_LEFT_90: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const objectId = payload?.objectId || getSelectedObjectId(deps);
  if (!objectId) {
    return notHandled('wrong_context');
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  // Read current rotation via WorksheetObjects API (read-only)
  const existing = await ws.objects.getInfo(objectId);
  if (!existing) {
    return { handled: false, error: `Object ${objectId} not found` };
  }
  const currentRotation = existing.rotation ?? 0;
  const newRotation = (currentRotation - 90 + 360) % 360;

  try {
    deps.workbook.setPendingUndoDescription('Rotate object left 90\u00B0');
    const handle = await ws.objects.get(objectId);
    if (handle) await handle.rotate(newRotation);
  } catch (err) {
    return { handled: false, error: (err as Error).message };
  }
  return handled();
};

/**
 * Flip Object Vertical - flips object vertically (top to bottom).
 * Uses Mutations layer for data writes.
 * Payload: { objectId?: string } - If not provided, uses selected object.
 */
export const FLIP_OBJECT_VERTICAL: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const objectId = payload?.objectId || getSelectedObjectId(deps);
  if (!objectId) {
    return notHandled('wrong_context');
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    deps.workbook.setPendingUndoDescription('Flip object vertical');
    const info = await ws.objects.get(objectId);
    if (!info) {
      return { handled: false, error: `Object ${objectId} not found` };
    }
    await info.flip('vertical');
  } catch (err) {
    return { handled: false, error: (err as Error).message };
  }
  return handled();
};

/**
 * Flip Object Horizontal - flips object horizontally (left to right).
 * Uses Mutations layer for data writes.
 * Payload: { objectId?: string } - If not provided, uses selected object.
 */
export const FLIP_OBJECT_HORIZONTAL: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const objectId = payload?.objectId || getSelectedObjectId(deps);
  if (!objectId) {
    return notHandled('wrong_context');
  }

  const sheetId = deps.getActiveSheetId();
  const ws = deps.workbook.getSheetById(sheetId);

  try {
    deps.workbook.setPendingUndoDescription('Flip object horizontal');
    const info = await ws.objects.get(objectId);
    if (!info) {
      return { handled: false, error: `Object ${objectId} not found` };
    }
    await info.flip('horizontal');
  } catch (err) {
    return { handled: false, error: (err as Error).message };
  }
  return handled();
};
