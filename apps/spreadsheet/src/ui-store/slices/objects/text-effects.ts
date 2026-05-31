/**
 * TextEffect UI Slice
 *
 * Manages ephemeral UI state for TextEffect interactions.
 * This includes editing state, gallery/picker visibility, and selected presets.
 *
 * Architecture:
 * - This Zustand slice handles: editing state, gallery states, simple UI toggles
 * - Actual TextEffect data is stored in Yjs (handled by floating objects)
 * - Rendering is handled by the TextEffect bridge and rendering system
 *
 * Engine Integration - UIStore Slice
 * Canvas Integration - Selection & Interaction Handles
 */

import type { StateCreator } from 'zustand';

// =============================================================================
// State Interface
// =============================================================================

/**
 * TextEffect text editing state with cursor and selection tracking.
 *
 * This state is used when the user is actively editing the text content
 * of a TextEffect object (entered via double-click).
 *
 * Canvas Integration
 */
export interface TextEffectEditingState {
  /** The TextEffect object ID being edited */
  objectId: string;
  /** Current cursor position (character index in text) */
  cursorPosition: number;
  /** Start of text selection (null if no selection) */
  selectionStart: number | null;
  /** End of text selection (null if no selection) */
  selectionEnd: number | null;
}

/**
 * TextEffect UI state managed by this slice.
 */
export interface TextEffectUIState {
  /** ID of TextEffect currently being text-edited (null if not editing) */
  editingTextEffectId: string | null;

  /**
   * Detailed editing state with cursor/selection tracking.
   * null when not in editing mode.
   * Canvas Integration
   */
  textEffectsEditingState: TextEffectEditingState | null;

  /** Whether the TextEffect gallery is open */
  isTextEffectGalleryOpen: boolean;

  /** Selected warp preset in gallery (before insertion) */
  gallerySelectedPreset: string | null;
}

// =============================================================================
// Slice Interface
// =============================================================================

/**
 * TextEffect UI slice with state and actions.
 */
export interface TextEffectSlice extends TextEffectUIState {
  /**
   * Set the ID of the TextEffect being text-edited.
   * Pass null to exit editing mode.
   * @param id - The TextEffect object ID to edit, or null to stop editing
   * @deprecated Use startTextEffectEditing/stopTextEffectEditing for better state management
   */
  setEditingTextEffectId: (id: string | null) => void;

  /**
   * Start editing a TextEffect object's text.
   * Sets up both editingTextEffectId and the detailed editing state.
   * @param objectId - The TextEffect object ID to edit
   * @param initialCursorPosition - Initial cursor position (defaults to end of text)
   */
  startTextEffectEditing: (objectId: string, initialCursorPosition?: number) => void;

  /**
   * Stop editing the current TextEffect object.
   * Clears all editing state.
   */
  stopTextEffectEditing: () => void;

  /**
   * Update the cursor position in the TextEffect text.
   * Only valid when in editing mode.
   * @param position - New cursor position (character index)
   */
  updateTextEffectCursor: (position: number) => void;

  /**
   * Update the text selection in the TextEffect.
   * Only valid when in editing mode.
   * @param start - Selection start position
   * @param end - Selection end position
   */
  updateTextEffectSelection: (start: number, end: number) => void;

  /**
   * Clear the text selection (keep cursor at current position).
   * Only valid when in editing mode.
   */
  clearTextEffectSelection: () => void;

  /**
   * Open the TextEffect gallery/picker dialog.
   * Requires an explicit preset selection before insertion.
   */
  openTextEffectGallery: () => void;

  /**
   * Close the TextEffect gallery/picker dialog.
   * Clears the selected preset.
   */
  closeTextEffectGallery: () => void;

  /**
   * Set the selected warp preset in the gallery.
   * @param preset - The warp preset name to select, or null to clear
   */
  setGallerySelectedPreset: (preset: string | null) => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialTextEffectUIState: TextEffectUIState = {
  editingTextEffectId: null,
  textEffectsEditingState: null,
  isTextEffectGalleryOpen: false,
  gallerySelectedPreset: null,
};

// =============================================================================
// Slice Creator
// =============================================================================

/**
 * Create the TextEffect UI slice.
 */
export const createTextEffectSlice: StateCreator<TextEffectSlice, [], [], TextEffectSlice> = (
  set,
  get,
) => ({
  // Initial state
  ...initialTextEffectUIState,

  // Actions
  setEditingTextEffectId: (id: string | null) => {
    // Deprecated but kept for backward compatibility
    // Updates both editingTextEffectId and clears detailed editing state
    set({
      editingTextEffectId: id,
      textEffectsEditingState: id
        ? {
            objectId: id,
            cursorPosition: 0,
            selectionStart: null,
            selectionEnd: null,
          }
        : null,
    });
  },

  startTextEffectEditing: (objectId: string, initialCursorPosition: number = 0) => {
    set({
      editingTextEffectId: objectId,
      textEffectsEditingState: {
        objectId,
        cursorPosition: initialCursorPosition,
        selectionStart: null,
        selectionEnd: null,
      },
    });
  },

  stopTextEffectEditing: () => {
    set({
      editingTextEffectId: null,
      textEffectsEditingState: null,
    });
  },

  updateTextEffectCursor: (position: number) => {
    const state = get();
    if (!state.textEffectsEditingState) return;

    set({
      textEffectsEditingState: {
        ...state.textEffectsEditingState,
        cursorPosition: position,
        selectionStart: null,
        selectionEnd: null,
      },
    });
  },

  updateTextEffectSelection: (start: number, end: number) => {
    const state = get();
    if (!state.textEffectsEditingState) return;

    set({
      textEffectsEditingState: {
        ...state.textEffectsEditingState,
        selectionStart: start,
        selectionEnd: end,
        cursorPosition: end, // Cursor follows selection end
      },
    });
  },

  clearTextEffectSelection: () => {
    const state = get();
    if (!state.textEffectsEditingState) return;

    set({
      textEffectsEditingState: {
        ...state.textEffectsEditingState,
        selectionStart: null,
        selectionEnd: null,
      },
    });
  },

  openTextEffectGallery: () => {
    set({
      isTextEffectGalleryOpen: true,
      gallerySelectedPreset: null,
    });
  },

  closeTextEffectGallery: () => {
    set({
      isTextEffectGalleryOpen: false,
      gallerySelectedPreset: null,
    });
  },

  setGallerySelectedPreset: (preset: string | null) => {
    set({ gallerySelectedPreset: preset });
  },
});

// =============================================================================
// Selectors
// =============================================================================

/**
 * Select whether the TextEffect gallery is open.
 */
export function selectIsTextEffectGalleryOpen(state: TextEffectSlice): boolean {
  return state.isTextEffectGalleryOpen;
}

/**
 * Select whether a TextEffect is currently being edited.
 */
export function selectIsEditingTextEffect(state: TextEffectSlice): boolean {
  return state.editingTextEffectId !== null;
}

/**
 * Select the ID of the TextEffect being edited.
 */
export function selectEditingTextEffectId(state: TextEffectSlice): string | null {
  return state.editingTextEffectId;
}

/**
 * Select the currently selected preset in the gallery.
 */
export function selectGallerySelectedPreset(state: TextEffectSlice): string | null {
  return state.gallerySelectedPreset;
}

/**
 * Select the detailed TextEffect editing state.
 * Returns null if not in editing mode.
 */
export function selectTextEffectEditingState(
  state: TextEffectSlice,
): TextEffectEditingState | null {
  return state.textEffectsEditingState;
}

/**
 * Select whether there is a text selection in the TextEffect being edited.
 */
export function selectHasTextEffectSelection(state: TextEffectSlice): boolean {
  const editingState = state.textEffectsEditingState;
  return editingState?.selectionStart !== null && editingState?.selectionEnd !== null;
}

/**
 * Select the cursor position in the TextEffect being edited.
 * Returns null if not in editing mode.
 */
export function selectTextEffectCursorPosition(state: TextEffectSlice): number | null {
  return state.textEffectsEditingState?.cursorPosition ?? null;
}
