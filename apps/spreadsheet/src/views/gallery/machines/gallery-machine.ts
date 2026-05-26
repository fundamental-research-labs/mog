/**
 * Gallery State Machine
 *
 * Manages the interaction state for the Gallery view including:
 * - Card selection (single, multi-select with shift/ctrl)
 * - Keyboard navigation
 * - Card editing
 *
 * Key design principles:
 * 1. Machine is PURE - no DOM access, no data mutations
 * 2. Selection is tracked by RowId (card identity)
 * 3. Side effects (data updates) are handled by the adapter/coordinator
 */

import type { ColId, RowId } from '@mog-sdk/contracts/cell-identity';
import { assign, setup, type ActorRefFrom, type SnapshotFrom } from 'xstate';

// =============================================================================
// CONTEXT
// =============================================================================

export interface GalleryContext {
  /** Set of selected card row IDs */
  selectedCards: Set<RowId>;

  /** Currently focused card (for keyboard navigation) */
  focusedCard: RowId | null;

  /** Card being edited */
  editingCard: RowId | null;

  /** Field being edited on the card */
  editingField: ColId | null;
}

const initialContext: GalleryContext = {
  selectedCards: new Set(),
  focusedCard: null,
  editingCard: null,
  editingField: null,
};

// =============================================================================
// EVENTS
// =============================================================================

export type KeyModifiers = {
  shiftKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey: boolean;
};

export type GalleryEvent =
  // Selection events
  | { type: 'CARD_CLICK'; cardId: RowId; modifiers: KeyModifiers }
  | { type: 'CARD_DOUBLE_CLICK'; cardId: RowId }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SELECT_ALL'; cardIds: RowId[] }

  // Edit events
  | { type: 'START_EDIT'; cardId: RowId; fieldId: ColId }
  | { type: 'COMMIT_EDIT' }
  | { type: 'CANCEL_EDIT' }

  // Keyboard events
  | { type: 'KEYBOARD'; key: string; modifiers: KeyModifiers }

  // Focus events
  | { type: 'FOCUS_CARD'; cardId: RowId }
  | { type: 'BLUR' }

  // Remote events (from other users)
  | { type: 'REMOTE_RECORD_CHANGED'; rowId: RowId }
  | { type: 'REMOTE_RECORD_DELETED'; rowId: RowId };

// =============================================================================
// EVENT FACTORY
// =============================================================================

export const GalleryEvents = {
  cardClick: (cardId: RowId, modifiers: KeyModifiers): GalleryEvent => ({
    type: 'CARD_CLICK',
    cardId,
    modifiers,
  }),

  cardDoubleClick: (cardId: RowId): GalleryEvent => ({
    type: 'CARD_DOUBLE_CLICK',
    cardId,
  }),

  clearSelection: (): GalleryEvent => ({
    type: 'CLEAR_SELECTION',
  }),

  selectAll: (cardIds: RowId[]): GalleryEvent => ({
    type: 'SELECT_ALL',
    cardIds,
  }),

  startEdit: (cardId: RowId, fieldId: ColId): GalleryEvent => ({
    type: 'START_EDIT',
    cardId,
    fieldId,
  }),

  commitEdit: (): GalleryEvent => ({
    type: 'COMMIT_EDIT',
  }),

  cancelEdit: (): GalleryEvent => ({
    type: 'CANCEL_EDIT',
  }),

  keyboard: (key: string, modifiers: KeyModifiers): GalleryEvent => ({
    type: 'KEYBOARD',
    key,
    modifiers,
  }),

  focusCard: (cardId: RowId): GalleryEvent => ({
    type: 'FOCUS_CARD',
    cardId,
  }),

  blur: (): GalleryEvent => ({
    type: 'BLUR',
  }),

  remoteRecordChanged: (rowId: RowId): GalleryEvent => ({
    type: 'REMOTE_RECORD_CHANGED',
    rowId,
  }),

  remoteRecordDeleted: (rowId: RowId): GalleryEvent => ({
    type: 'REMOTE_RECORD_DELETED',
    rowId,
  }),
} as const;

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Handle card selection with modifiers (shift/ctrl/cmd).
 */
function handleCardSelection(
  currentSelection: Set<RowId>,
  cardId: RowId,
  modifiers: KeyModifiers,
): Set<RowId> {
  const newSelection = new Set(currentSelection);
  const hasModifier = modifiers.ctrlKey || modifiers.metaKey;

  if (modifiers.shiftKey) {
    // Shift+click: add to selection (range selection could be added later)
    newSelection.add(cardId);
  } else if (hasModifier) {
    // Ctrl/Cmd+click: toggle selection
    if (newSelection.has(cardId)) {
      newSelection.delete(cardId);
    } else {
      newSelection.add(cardId);
    }
  } else {
    // Plain click: select only this card
    newSelection.clear();
    newSelection.add(cardId);
  }

  return newSelection;
}

// =============================================================================
// MACHINE
// =============================================================================

export const galleryMachine = setup({
  types: {
    context: {} as GalleryContext,
    events: {} as GalleryEvent,
  },
  actions: {
    // Selection actions
    selectCard: assign(({ context, event }) => {
      if (event.type !== 'CARD_CLICK') return {};
      return {
        selectedCards: handleCardSelection(context.selectedCards, event.cardId, event.modifiers),
        focusedCard: event.cardId,
      };
    }),

    selectAllCards: assign(({ event }) => {
      if (event.type !== 'SELECT_ALL') return {};
      return {
        selectedCards: new Set(event.cardIds),
      };
    }),

    clearSelection: assign(() => ({
      selectedCards: new Set<RowId>(),
      focusedCard: null,
    })),

    focusCard: assign(({ event }) => {
      if (event.type !== 'FOCUS_CARD' && event.type !== 'CARD_CLICK') return {};
      const cardId = event.type === 'FOCUS_CARD' ? event.cardId : event.cardId;
      return {
        focusedCard: cardId,
      };
    }),

    // Edit actions
    startEditing: assign(({ event }) => {
      if (event.type !== 'START_EDIT' && event.type !== 'CARD_DOUBLE_CLICK') return {};
      if (event.type === 'CARD_DOUBLE_CLICK') {
        return {
          editingCard: event.cardId,
          editingField: null, // Will edit title by default
          selectedCards: new Set([event.cardId]),
          focusedCard: event.cardId,
        };
      }
      return {
        editingCard: event.cardId,
        editingField: event.fieldId,
        selectedCards: new Set([event.cardId]),
        focusedCard: event.cardId,
      };
    }),

    clearEditing: assign(() => ({
      editingCard: null,
      editingField: null,
    })),

    // Remote change handling
    handleRemoteDelete: assign(({ context, event }) => {
      if (event.type !== 'REMOTE_RECORD_DELETED') return {};
      const newSelection = new Set(context.selectedCards);
      newSelection.delete(event.rowId);
      return {
        selectedCards: newSelection,
        focusedCard: context.focusedCard === event.rowId ? null : context.focusedCard,
        editingCard: context.editingCard === event.rowId ? null : context.editingCard,
      };
    }),
  },
  guards: {
    hasSelection: ({ context }) => context.selectedCards.size > 0,
    hasFocusedCard: ({ context }) => context.focusedCard !== null,
    isEditing: ({ context }) => context.editingCard !== null,
  },
}).createMachine({
  id: 'gallery',
  initial: 'idle',
  context: initialContext,

  states: {
    /**
     * IDLE: Default state - waiting for user interaction.
     */
    idle: {
      on: {
        CARD_CLICK: {
          target: 'selecting',
          actions: 'selectCard',
        },
        CARD_DOUBLE_CLICK: {
          target: 'editing',
          actions: 'startEditing',
        },
        FOCUS_CARD: {
          actions: 'focusCard',
        },
        SELECT_ALL: {
          target: 'selecting',
          actions: 'selectAllCards',
        },
        REMOTE_RECORD_DELETED: {
          actions: 'handleRemoteDelete',
        },
      },
    },

    /**
     * SELECTING: One or more cards are selected.
     * Can transition to editing or back to idle.
     */
    selecting: {
      on: {
        CARD_CLICK: {
          actions: 'selectCard',
        },
        CARD_DOUBLE_CLICK: {
          target: 'editing',
          actions: 'startEditing',
        },
        CLEAR_SELECTION: {
          target: 'idle',
          actions: 'clearSelection',
        },
        START_EDIT: {
          target: 'editing',
          actions: 'startEditing',
        },
        SELECT_ALL: {
          actions: 'selectAllCards',
        },
        KEYBOARD: {
          // Keyboard handling is done by the adapter
          // This just keeps us in selecting state
        },
        FOCUS_CARD: {
          actions: 'focusCard',
        },
        BLUR: {
          // Stay in selecting but can optionally clear
        },
        REMOTE_RECORD_DELETED: {
          actions: 'handleRemoteDelete',
        },
      },
    },

    /**
     * EDITING: Inline editing a card field.
     * Typically editing the title, but can be any field.
     */
    editing: {
      on: {
        COMMIT_EDIT: {
          target: 'selecting',
          actions: 'clearEditing',
          // Note: Actual data update is handled by adapter before sending COMMIT_EDIT
        },
        CANCEL_EDIT: {
          target: 'selecting',
          actions: 'clearEditing',
        },
        KEYBOARD: [
          {
            // Escape cancels edit
            target: 'selecting',
            actions: 'clearEditing',
            guard: ({ event }) => event.type === 'KEYBOARD' && event.key === 'Escape',
          },
          {
            // Enter commits edit
            target: 'selecting',
            actions: 'clearEditing',
            guard: ({ event }) => event.type === 'KEYBOARD' && event.key === 'Enter',
          },
        ],
        REMOTE_RECORD_DELETED: {
          target: 'idle',
          actions: ['handleRemoteDelete', 'clearEditing'],
        },
      },
    },
  },
});

// =============================================================================
// SNAPSHOT HELPERS
// =============================================================================

export interface GallerySnapshot {
  /** Current state value */
  state: 'idle' | 'selecting' | 'editing';
  /** Selected card IDs */
  selectedCards: RowId[];
  /** Focused card ID */
  focusedCard: RowId | null;
  /** Card being edited */
  editingCard: RowId | null;
  /** Field being edited */
  editingField: ColId | null;
}

/**
 * Extract a normalized snapshot from machine state.
 */
export function getGallerySnapshot(state: SnapshotFrom<typeof galleryMachine>): GallerySnapshot {
  const context = state.context;
  const stateValue = (
    typeof state.value === 'string' ? state.value : Object.keys(state.value)[0]
  ) as GallerySnapshot['state'];

  return {
    state: stateValue,
    selectedCards: Array.from(context.selectedCards),
    focusedCard: context.focusedCard,
    editingCard: context.editingCard,
    editingField: context.editingField,
  };
}

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type GalleryMachine = typeof galleryMachine;
export type GalleryActor = ActorRefFrom<typeof galleryMachine>;
export type GalleryState = SnapshotFrom<typeof galleryMachine>;
