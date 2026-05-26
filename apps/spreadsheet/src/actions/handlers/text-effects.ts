/**
 * TextEffect Action Handlers
 *
 * Pure handler functions for TextEffect operations.
 * These handlers are called by the unified action dispatcher.
 *
 * ARCHITECTURE:
 * - Handlers are pure functions: (deps, payload?) => ActionResult
 * - TextEffect data mutations go through the unified Worksheet API (deps.workbook)
 * - UI state (editing, gallery) goes through the TextEffect UI slice
 * - Use deps.accessors for reading state where available
 *
 * This file handles:
 * - TextEffect lifecycle (insert, delete)
 * - Style operations (warp, fill, outline, effects)
 * - Text editing (edit, commit)
 * - Conversion (to/from TextEffect)
 *
 * Engine Integration - Action Handlers
 * @see docs/ARCHITECTURE-CHECKLIST.md (sections 1, 2, 17)
 */

import type {
  ActionDependencies,
  ActionHandler,
  ActionResult,
  AsyncActionHandler,
} from '@mog-sdk/contracts/actions';
import type { MutationReceipt, TextEffectTextFormatUpdate } from '@mog-sdk/contracts/api';
import type { ObjectPosition } from '@mog-sdk/contracts/floating-objects';
import type {
  AdjustmentValues,
  TextEffects,
  TextWarpPreset,
  TextEffectFill,
  TextEffectOutline,
} from '@mog-sdk/contracts/text-effects';

import { getUIStore, handled, notHandled } from './handler-utils';

// =============================================================================
// Payload Interfaces
// =============================================================================

/**
 * Payload for INSERT_TEXT_EFFECT action.
 */
interface InsertTextEffectPayload {
  text?: string;
  warpPreset?: TextWarpPreset;
  position?: Partial<ObjectPosition>;
}

/**
 * Payload for DELETE_TEXT_EFFECT action.
 */
interface DeleteTextEffectPayload {
  objectId?: string;
}

/**
 * Payload for UPDATE_TEXT_EFFECT_WARP action.
 */
interface UpdateTextEffectWarpPayload {
  objectId: string;
  warpPreset: TextWarpPreset;
  adjustments?: AdjustmentValues;
}

/**
 * Payload for UPDATE_TEXT_EFFECT_FILL action.
 */
interface UpdateTextEffectFillPayload {
  objectId: string;
  fill: TextEffectFill;
}

/**
 * Payload for UPDATE_TEXT_EFFECT_OUTLINE action.
 */
interface UpdateTextEffectOutlinePayload {
  objectId: string;
  outline?: TextEffectOutline;
}

/**
 * Payload for UPDATE_TEXT_EFFECT_EFFECTS action.
 */
interface UpdateTextEffectEffectsPayload {
  objectId: string;
  effects: TextEffects;
}

/**
 * Payload for EDIT_TEXT_EFFECT_TEXT action.
 */
interface EditTextEffectTextPayload {
  objectId: string | null;
  cursorPosition?: number;
}

/**
 * Payload for COMMIT_TEXT_EFFECT_TEXT action.
 */
interface CommitTextEffectTextPayload {
  objectId: string;
  text: string;
}

/**
 * Payload for CONVERT_TO_TEXT_EFFECT action.
 */
interface ConvertToTextEffectPayload {
  objectId: string;
  warpPreset?: TextWarpPreset;
}

/**
 * Payload for CONVERT_TO_TEXTBOX action.
 */
interface ConvertToTextBoxPayload {
  objectId: string;
}

// =============================================================================
// Type Helpers
// =============================================================================

/**
 * Get selected object IDs from the object interaction accessor.
 */
function getSelectedObjectIds(deps: ActionDependencies): string[] {
  return deps.accessors.object.getSelectedIds();
}

// =============================================================================
// TextEffect Lifecycle Actions
// =============================================================================

/**
 * INSERT_TEXT_EFFECT - Create a new TextEffect object on the current sheet.
 *
 * This handler:
 * 1. Gets active sheet ID via deps.getActiveSheetId()
 * 2. Determines position from payload or default
 * 3. Creates TextEffect via the Worksheet API
 * 4. Selects the newly created object
 *
 * Payload: {
 * text?: string (default: 'Your text here'),
 * warpPreset?: TextWarpPreset (default: 'textArchUp'),
 * position?: Partial<ObjectPosition>
 * }
 */
export const INSERT_TEXT_EFFECT: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  if (!sheetId) {
    return notHandled('disabled');
  }

  // Type the payload at the top
  const typedPayload = payload as InsertTextEffectPayload | undefined;
  const text = typedPayload?.text ?? 'Your text here';
  const warpPreset: TextWarpPreset = typedPayload?.warpPreset ?? 'textArchUp';

  // Get position from payload or use default absolute position
  const position: Partial<ObjectPosition> = typedPayload?.position ?? {
    anchorType: 'absolute',
    x: 100,
    y: 100,
    width: 300,
    height: 80,
  };

  deps.workbook.setPendingUndoDescription('Insert text effects');

  const ws = deps.workbook.getSheetById(sheetId);
  try {
    const handle = await ws.textEffects.add({
      text,
      warpPreset,
      x: position?.x,
      y: position?.y,
      width: position?.width,
      height: position?.height,
    });

    // Select the newly created TextEffect
    deps.commands.object.selectObject(handle.id, false, false);
  } catch (err) {
    console.error('Failed to create TextEffect:', (err as Error).message);
    return { handled: false, error: (err as Error).message };
  }

  return handled();
};

/**
 * DELETE_TEXT_EFFECT - Delete TextEffect object(s).
 *
 * If objectId is provided in payload, deletes that specific object.
 * Otherwise, deletes all selected TextEffect objects.
 *
 * Payload: { objectId?: string }
 */
export const DELETE_TEXT_EFFECT: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const sheetId = deps.getActiveSheetId();
  if (!sheetId) {
    return notHandled('disabled');
  }

  // Type the payload at the top
  const typedPayload = payload as DeleteTextEffectPayload | undefined;
  const objectId = typedPayload?.objectId;
  const objectIds = objectId ? [objectId] : getSelectedObjectIds(deps);

  if (objectIds.length === 0) {
    return notHandled('wrong_context');
  }

  deps.workbook.setPendingUndoDescription('Delete text effects');

  const ws = deps.workbook.getSheetById(sheetId);
  let deletedAny = false;
  const receipts: MutationReceipt[] = [];

  for (const id of objectIds) {
    try {
      const handle = await ws.objects.get(id);
      if (handle) {
        const receipt = await handle.delete();
        receipts.push(receipt);
        deletedAny = true;
      }
    } catch (err) {
      console.error('Failed to delete TextEffect:', (err as Error).message);
    }
  }

  if (!deletedAny) {
    return notHandled('wrong_context');
  }

  // Clear selection after deletion
  deps.commands.object.deselectAll();

  return handled(receipts.length > 0 ? { receipts } : undefined);
};

// =============================================================================
// TextEffect Style Operations
// =============================================================================

/**
 * UPDATE_TEXT_EFFECT_WARP - Update the warp preset of a TextEffect object.
 *
 * Payload: {
 * objectId: string,
 * warpPreset: TextWarpPreset,
 * adjustments?: AdjustmentValues
 * }
 */
export const UPDATE_TEXT_EFFECT_WARP: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  // Type the payload at the top
  const typedPayload = payload as UpdateTextEffectWarpPayload | undefined;
  const objectId = typedPayload?.objectId;
  const warpPreset = typedPayload?.warpPreset;

  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }
  if (!warpPreset) {
    return { handled: false, error: 'Missing warpPreset in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  if (!sheetId) {
    return notHandled('disabled');
  }

  const adjustments = typedPayload?.adjustments;

  deps.workbook.setPendingUndoDescription(`Change text effects style to ${warpPreset}`);

  const ws = deps.workbook.getSheetById(sheetId);
  try {
    const handle = await ws.textEffects.get(objectId);
    if (!handle) throw new Error(`TextEffect ${objectId} not found`);
    await handle.update({
      warp: warpPreset,
      warpAdjustments: adjustments,
    });
  } catch (err) {
    console.error('Failed to update TextEffect warp:', (err as Error).message);
    return { handled: false, error: (err as Error).message };
  }

  return handled();
};

/**
 * UPDATE_TEXT_EFFECT_FILL - Update the fill of a TextEffect object.
 *
 * Payload: {
 * objectId: string,
 * fill: TextEffectFill
 * }
 */
export const UPDATE_TEXT_EFFECT_FILL: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  // Type the payload at the top
  const typedPayload = payload as UpdateTextEffectFillPayload | undefined;
  const objectId = typedPayload?.objectId;
  const fill = typedPayload?.fill;

  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }
  if (!fill) {
    return { handled: false, error: 'Missing fill in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  if (!sheetId) {
    return notHandled('disabled');
  }

  deps.workbook.setPendingUndoDescription('Change text effects fill');

  const ws = deps.workbook.getSheetById(sheetId);
  try {
    const handle = await ws.textEffects.get(objectId);
    if (!handle) throw new Error(`TextEffect ${objectId} not found`);
    await handle.update({ fill: { ...fill } });
  } catch (err) {
    console.error('Failed to update TextEffect fill:', (err as Error).message);
    return { handled: false, error: (err as Error).message };
  }

  return handled();
};

/**
 * UPDATE_TEXT_EFFECT_OUTLINE - Update the outline of a TextEffect object.
 *
 * Payload: {
 * objectId: string,
 * outline?: TextEffectOutline (undefined to remove outline)
 * }
 */
export const UPDATE_TEXT_EFFECT_OUTLINE: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  // Type the payload at the top
  const typedPayload = payload as UpdateTextEffectOutlinePayload | undefined;
  const objectId = typedPayload?.objectId;

  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  if (!sheetId) {
    return notHandled('disabled');
  }

  const outline = typedPayload?.outline;

  deps.workbook.setPendingUndoDescription(
    outline ? 'Change text effects outline' : 'Remove text effects outline',
  );

  const ws = deps.workbook.getSheetById(sheetId);
  try {
    const handle = await ws.textEffects.get(objectId);
    if (!handle) throw new Error(`TextEffect ${objectId} not found`);
    await handle.update({ outline });
  } catch (err) {
    console.error('Failed to update TextEffect outline:', (err as Error).message);
    return { handled: false, error: (err as Error).message };
  }

  return handled();
};

/**
 * UPDATE_TEXT_EFFECT_EFFECTS - Update the effects of a TextEffect object.
 *
 * Payload: {
 * objectId: string,
 * effects: TextEffects
 * }
 */
export const UPDATE_TEXT_EFFECT_EFFECTS: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  // Type the payload at the top
  const typedPayload = payload as UpdateTextEffectEffectsPayload | undefined;
  const objectId = typedPayload?.objectId;
  const effects = typedPayload?.effects;

  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }
  if (!effects) {
    return { handled: false, error: 'Missing effects in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  if (!sheetId) {
    return notHandled('disabled');
  }

  deps.workbook.setPendingUndoDescription('Change text effects');

  const ws = deps.workbook.getSheetById(sheetId);
  try {
    const handle = await ws.textEffects.get(objectId);
    if (!handle) throw new Error(`TextEffect ${objectId} not found`);
    await handle.update({ effects });
  } catch (err) {
    console.error('Failed to update TextEffect effects:', (err as Error).message);
    return { handled: false, error: (err as Error).message };
  }

  return handled();
};

// =============================================================================
// TextEffect Text Editing
// =============================================================================

/**
 * EDIT_TEXT_EFFECT_TEXT - Start or stop text editing mode for a TextEffect object.
 *
 * This handler sets the editing state in the UIStore slice.
 * Pass objectId to start editing, or null to exit editing.
 *
 * Payload: { objectId: string | null, cursorPosition?: number }
 */
export const EDIT_TEXT_EFFECT_TEXT: ActionHandler = (deps, payload): ActionResult => {
  const uiStore = getUIStore(deps);
  if (!uiStore) {
    return notHandled('disabled');
  }

  // Type the payload at the top
  const typedPayload = payload as EditTextEffectTextPayload | undefined;
  const objectId = typedPayload?.objectId ?? null;

  // Set editing state in UI store using proper methods
  if (objectId) {
    const initialCursorPosition = typedPayload?.cursorPosition ?? 0;
    uiStore.getState().startTextEffectEditing(objectId, initialCursorPosition);
  } else {
    uiStore.getState().stopTextEffectEditing();
  }

  return handled();
};

/**
 * COMMIT_TEXT_EFFECT_TEXT - Commit text changes to a TextEffect object.
 *
 * This handler:
 * 1. Updates the TextEffect text via the Worksheet API
 * 2. Exits editing mode
 *
 * Payload: {
 * objectId: string,
 * text: string
 * }
 */
export const COMMIT_TEXT_EFFECT_TEXT: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  // Type the payload at the top
  const typedPayload = payload as CommitTextEffectTextPayload | undefined;
  const objectId = typedPayload?.objectId;
  const text = typedPayload?.text;

  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }
  if (text === undefined) {
    return { handled: false, error: 'Missing text in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  if (!sheetId) {
    return notHandled('disabled');
  }

  deps.workbook.setPendingUndoDescription('Edit text effects text');

  const ws = deps.workbook.getSheetById(sheetId);
  try {
    const handle = await ws.textEffects.get(objectId);
    if (!handle) throw new Error(`TextEffect ${objectId} not found`);
    await handle.update({ text });
  } catch (err) {
    console.error('Failed to update TextEffect text:', (err as Error).message);
    return { handled: false, error: (err as Error).message };
  }

  // Exit editing mode using proper method (guard for undefined uiStore in tests)
  const uiStore = getUIStore(deps);
  if (uiStore) {
    uiStore.getState().stopTextEffectEditing();
  }

  return handled();
};

/**
 * CANCEL_TEXT_EFFECT_EDIT - Cancel text editing mode without committing changes.
 *
 * This handler:
 * 1. Clears the editing state in UIStore
 * 2. Does NOT update the TextEffect text (changes are discarded)
 *
 * Text Editor Component
 */
export const CANCEL_TEXT_EFFECT_EDIT: ActionHandler = (deps): ActionResult => {
  const uiStore = getUIStore(deps);
  if (!uiStore) {
    return notHandled('disabled');
  }

  // Exit editing mode without saving using proper method
  uiStore.getState().stopTextEffectEditing();

  return handled();
};

// =============================================================================
// TextEffect Conversion
// =============================================================================

/**
 * CONVERT_TO_TEXT_EFFECT - Convert a regular text box to TextEffect.
 *
 * Payload: {
 * objectId: string,
 * warpPreset?: TextWarpPreset (default: 'textPlain')
 * }
 */
export const CONVERT_TO_TEXT_EFFECT: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  // Type the payload at the top
  const typedPayload = payload as ConvertToTextEffectPayload | undefined;
  const objectId = typedPayload?.objectId;

  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  if (!sheetId) {
    return notHandled('disabled');
  }

  const warpPreset: TextWarpPreset = typedPayload?.warpPreset ?? 'textPlain';

  const ws = deps.workbook.getSheetById(sheetId);
  try {
    await ws.objects.convertToTextEffect(objectId, warpPreset);
  } catch (err) {
    console.error('Failed to convert to TextEffect:', (err as Error).message);
    return { handled: false, error: (err as Error).message };
  }

  return handled();
};

/**
 * CONVERT_TO_TEXTBOX - Convert TextEffect back to a regular text box.
 *
 * Payload: { objectId: string }
 */
export const CONVERT_TO_TEXTBOX: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  // Type the payload at the top
  const typedPayload = payload as ConvertToTextBoxPayload | undefined;
  const objectId = typedPayload?.objectId;

  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  if (!sheetId) {
    return notHandled('disabled');
  }

  const ws = deps.workbook.getSheetById(sheetId);
  try {
    await ws.objects.convertToTextBox(objectId);
  } catch (err) {
    console.error('Failed to convert to text box:', (err as Error).message);
    return { handled: false, error: (err as Error).message };
  }

  return handled();
};

// =============================================================================
// TextEffect Gallery Actions
// =============================================================================

/**
 * OPEN_TEXT_EFFECT_GALLERY - Open the TextEffect gallery/picker dialog.
 *
 * Opens the gallery for selecting a warp preset and entering text.
 * Called from the Insert ribbon TextEffect dropdown button.
 *
 */
export const OPEN_TEXT_EFFECT_GALLERY: ActionHandler = (deps): ActionResult => {
  const uiStore = getUIStore(deps);
  if (!uiStore) {
    return notHandled('disabled');
  }

  uiStore.getState().openTextEffectGallery();
  return handled();
};

/**
 * CLOSE_TEXT_EFFECT_GALLERY - Close the TextEffect gallery/picker dialog.
 *
 * Closes the gallery without inserting TextEffect.
 */
export const CLOSE_TEXT_EFFECT_GALLERY: ActionHandler = (deps): ActionResult => {
  const uiStore = getUIStore(deps);
  if (!uiStore) {
    return notHandled('disabled');
  }

  uiStore.getState().closeTextEffectGallery();
  return handled();
};

/**
 * Payload for SET_TEXT_EFFECT_GALLERY_PRESET action.
 */
interface SetTextEffectGalleryPresetPayload {
  presetId: string;
}

/**
 * SET_TEXT_EFFECT_GALLERY_PRESET - Set the selected preset in the TextEffect gallery.
 *
 * Updates the gallery's selected preset state. This action is used by the
 * TextEffect gallery component when a user clicks on a preset thumbnail.
 *
 * Payload: { presetId: string }
 */
export const SET_TEXT_EFFECT_GALLERY_PRESET: ActionHandler = (deps, payload): ActionResult => {
  const uiStore = getUIStore(deps);
  if (!uiStore) {
    return notHandled('disabled');
  }

  const typedPayload = payload as SetTextEffectGalleryPresetPayload | undefined;
  if (!typedPayload?.presetId) {
    return { handled: false, error: 'Missing presetId in payload' };
  }

  uiStore.getState().setGallerySelectedPreset(typedPayload.presetId);
  return handled();
};

// =============================================================================
// TextEffect Text Format Actions
// =============================================================================

/**
 * Payload for UPDATE_TEXT_EFFECT_FORMAT action.
 */
interface UpdateTextEffectFormatPayload {
  objectId: string;
  bold?: boolean;
  italic?: boolean;
  fontSize?: number;
  fontFamily?: string;
  fontColor?: string;
}

/**
 * UPDATE_TEXT_EFFECT_FORMAT - Update text formatting for a TextEffect object.
 *
 * Updates the text.format property of the TextEffect textbox, which controls
 * font weight, style, size, family, and color.
 *
 * Format Tab Button Actions
 *
 * Payload: {
 * objectId: string,
 * bold?: boolean,
 * italic?: boolean,
 * fontSize?: number,
 * fontFamily?: string,
 * fontColor?: string
 * }
 */
export const UPDATE_TEXT_EFFECT_FORMAT: AsyncActionHandler = async (
  deps,
  payload,
): Promise<ActionResult> => {
  const typedPayload = payload as UpdateTextEffectFormatPayload | undefined;
  const objectId = typedPayload?.objectId;

  if (!objectId) {
    return { handled: false, error: 'Missing objectId in payload' };
  }

  const sheetId = deps.getActiveSheetId();
  if (!sheetId) {
    return notHandled('disabled');
  }

  // Build format updates from payload
  const formatUpdates: TextEffectTextFormatUpdate = {};

  if (typedPayload.bold !== undefined) formatUpdates.bold = typedPayload.bold;
  if (typedPayload.italic !== undefined) formatUpdates.italic = typedPayload.italic;
  if (typedPayload.fontSize !== undefined) formatUpdates.fontSize = typedPayload.fontSize;
  if (typedPayload.fontFamily !== undefined) formatUpdates.fontFamily = typedPayload.fontFamily;
  if (typedPayload.fontColor !== undefined) formatUpdates.fontColor = typedPayload.fontColor;

  // Build undo description based on what's being changed
  let description = 'Format text effects text';
  if (typedPayload.bold !== undefined) {
    description = typedPayload.bold ? 'Make text effects bold' : 'Remove text effects bold';
  } else if (typedPayload.italic !== undefined) {
    description = typedPayload.italic ? 'Make text effects italic' : 'Remove text effects italic';
  } else if (typedPayload.fontSize !== undefined) {
    description = `Set text effects font size to ${typedPayload.fontSize}`;
  }

  deps.workbook.setPendingUndoDescription(description);

  const ws = deps.workbook.getSheetById(sheetId);
  try {
    const handle = await ws.textEffects.get(objectId);
    if (!handle) throw new Error(`TextEffect ${objectId} not found`);
    await handle.update({ textFormat: formatUpdates });
  } catch (err) {
    console.error('Failed to update TextEffect format:', (err as Error).message);
    return { handled: false, error: (err as Error).message };
  }

  return handled();
};
