/**
 * Kanban State Machine
 *
 * Manages the interaction state for the Kanban view including:
 * - Card selection (single, multi-select with shift/ctrl)
 * - Drag and drop between columns
 * - Inline card editing
 * - Adding new cards
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

export interface KanbanContext {
  /** Set of selected card row IDs */
  selectedCards: Set<RowId>;

  /** Currently focused card (for keyboard navigation) */
  focusedCard: RowId | null;

  /** Card being dragged */
  draggedCard: RowId | null;

  /** Column value being dragged over */
  draggedOverColumn: string | null;

  /** Drop position within column */
  dropPosition: { column: string; index: number } | null;

  /** Card being edited */
  editingCard: RowId | null;

  /** Field being edited on the card */
  editingField: ColId | null;

  /** Column where new card is being added */
  addingInColumn: string | null;
}

const initialContext: KanbanContext = {
  selectedCards: new Set(),
  focusedCard: null,
  draggedCard: null,
  draggedOverColumn: null,
  dropPosition: null,
  editingCard: null,
  editingField: null,
  addingInColumn: null,
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

export type KanbanEvent =
  // Selection events
  | { type: 'CARD_CLICK'; cardId: RowId; modifiers: KeyModifiers }
  | { type: 'CARD_DOUBLE_CLICK'; cardId: RowId }
  | { type: 'CLEAR_SELECTION' }
  | { type: 'SELECT_ALL'; cardIds: RowId[] }

  // Drag events
  | { type: 'DRAG_START'; cardId: RowId }
  | { type: 'DRAG_OVER'; column: string; index: number }
  | { type: 'DRAG_END' }
  | { type: 'DROP' }
  | { type: 'CANCEL_DRAG' }

  // Edit events
  | { type: 'START_EDIT'; cardId: RowId; fieldId: ColId }
  | { type: 'COMMIT_EDIT' }
  | { type: 'CANCEL_EDIT' }

  // Add card events
  | { type: 'START_ADD_CARD'; column: string }
  | { type: 'COMMIT_ADD_CARD' }
  | { type: 'CANCEL_ADD_CARD' }

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

export const KanbanEvents = {
  cardClick: (cardId: RowId, modifiers: KeyModifiers): KanbanEvent => ({
    type: 'CARD_CLICK',
    cardId,
    modifiers,
  }),

  cardDoubleClick: (cardId: RowId): KanbanEvent => ({
    type: 'CARD_DOUBLE_CLICK',
    cardId,
  }),

  clearSelection: (): KanbanEvent => ({
    type: 'CLEAR_SELECTION',
  }),

  selectAll: (cardIds: RowId[]): KanbanEvent => ({
    type: 'SELECT_ALL',
    cardIds,
  }),

  dragStart: (cardId: RowId): KanbanEvent => ({
    type: 'DRAG_START',
    cardId,
  }),

  dragOver: (column: string, index: number): KanbanEvent => ({
    type: 'DRAG_OVER',
    column,
    index,
  }),

  dragEnd: (): KanbanEvent => ({
    type: 'DRAG_END',
  }),

  drop: (): KanbanEvent => ({
    type: 'DROP',
  }),

  cancelDrag: (): KanbanEvent => ({
    type: 'CANCEL_DRAG',
  }),

  startEdit: (cardId: RowId, fieldId: ColId): KanbanEvent => ({
    type: 'START_EDIT',
    cardId,
    fieldId,
  }),

  commitEdit: (): KanbanEvent => ({
    type: 'COMMIT_EDIT',
  }),

  cancelEdit: (): KanbanEvent => ({
    type: 'CANCEL_EDIT',
  }),

  startAddCard: (column: string): KanbanEvent => ({
    type: 'START_ADD_CARD',
    column,
  }),

  commitAddCard: (): KanbanEvent => ({
    type: 'COMMIT_ADD_CARD',
  }),

  cancelAddCard: (): KanbanEvent => ({
    type: 'CANCEL_ADD_CARD',
  }),

  keyboard: (key: string, modifiers: KeyModifiers): KanbanEvent => ({
    type: 'KEYBOARD',
    key,
    modifiers,
  }),

  focusCard: (cardId: RowId): KanbanEvent => ({
    type: 'FOCUS_CARD',
    cardId,
  }),

  blur: (): KanbanEvent => ({
    type: 'BLUR',
  }),

  remoteRecordChanged: (rowId: RowId): KanbanEvent => ({
    type: 'REMOTE_RECORD_CHANGED',
    rowId,
  }),

  remoteRecordDeleted: (rowId: RowId): KanbanEvent => ({
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

export const kanbanMachine = setup({
  types: {
    context: {} as KanbanContext,
    events: {} as KanbanEvent,
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

    // Drag actions
    startDrag: assign(({ event, context }) => {
      if (event.type !== 'DRAG_START') return {};
      // If dragging a non-selected card, select it
      const newSelection = context.selectedCards.has(event.cardId)
        ? context.selectedCards
        : new Set([event.cardId]);
      return {
        draggedCard: event.cardId,
        selectedCards: newSelection,
      };
    }),

    updateDragOver: assign(({ event }) => {
      if (event.type !== 'DRAG_OVER') return {};
      return {
        draggedOverColumn: event.column,
        dropPosition: { column: event.column, index: event.index },
      };
    }),

    clearDrag: assign(() => ({
      draggedCard: null,
      draggedOverColumn: null,
      dropPosition: null,
    })),

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

    // Add card actions
    startAdding: assign(({ event }) => {
      if (event.type !== 'START_ADD_CARD') return {};
      return {
        addingInColumn: event.column,
      };
    }),

    clearAdding: assign(() => ({
      addingInColumn: null,
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
        draggedCard: context.draggedCard === event.rowId ? null : context.draggedCard,
      };
    }),
  },
  guards: {
    hasSelection: ({ context }) => context.selectedCards.size > 0,
    hasFocusedCard: ({ context }) => context.focusedCard !== null,
    isEditing: ({ context }) => context.editingCard !== null,
    isDragging: ({ context }) => context.draggedCard !== null,
    isAdding: ({ context }) => context.addingInColumn !== null,
  },
}).createMachine({
  id: 'kanban',
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
        DRAG_START: {
          target: 'dragging',
          actions: 'startDrag',
        },
        START_ADD_CARD: {
          target: 'adding',
          actions: 'startAdding',
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
     * Can transition to dragging, editing, or back to idle.
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
        DRAG_START: {
          target: 'dragging',
          actions: 'startDrag',
        },
        START_EDIT: {
          target: 'editing',
          actions: 'startEditing',
        },
        START_ADD_CARD: {
          target: 'adding',
          actions: 'startAdding',
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
     * DRAGGING: A card is being dragged between columns.
     * On drop, the adapter will update the record's groupBy field.
     */
    dragging: {
      on: {
        DRAG_OVER: {
          actions: 'updateDragOver',
        },
        DROP: {
          target: 'selecting',
          actions: 'clearDrag',
          // Note: Actual data update is handled by adapter on DROP
        },
        DRAG_END: {
          target: 'selecting',
          actions: 'clearDrag',
        },
        CANCEL_DRAG: {
          target: 'selecting',
          actions: 'clearDrag',
        },
        KEYBOARD: [
          {
            // Escape cancels drag
            target: 'selecting',
            actions: 'clearDrag',
            guard: ({ event }) => event.type === 'KEYBOARD' && event.key === 'Escape',
          },
        ],
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

    /**
     * ADDING: Adding a new card to a column.
     * Shows an inline form for entering card details.
     */
    adding: {
      on: {
        COMMIT_ADD_CARD: {
          target: 'idle',
          actions: 'clearAdding',
          // Note: Actual record creation is handled by adapter before sending COMMIT_ADD_CARD
        },
        CANCEL_ADD_CARD: {
          target: 'idle',
          actions: 'clearAdding',
        },
        KEYBOARD: [
          {
            // Escape cancels adding
            target: 'idle',
            actions: 'clearAdding',
            guard: ({ event }) => event.type === 'KEYBOARD' && event.key === 'Escape',
          },
        ],
      },
    },
  },
});

// =============================================================================
// SNAPSHOT HELPERS
// =============================================================================

export interface KanbanSnapshot {
  /** Current state value */
  state: 'idle' | 'selecting' | 'dragging' | 'editing' | 'adding';
  /** Selected card IDs */
  selectedCards: RowId[];
  /** Focused card ID */
  focusedCard: RowId | null;
  /** Card being dragged */
  draggedCard: RowId | null;
  /** Column being dragged over */
  draggedOverColumn: string | null;
  /** Drop position */
  dropPosition: { column: string; index: number } | null;
  /** Card being edited */
  editingCard: RowId | null;
  /** Field being edited */
  editingField: ColId | null;
  /** Column where adding new card */
  addingInColumn: string | null;
}

/**
 * Extract a normalized snapshot from machine state.
 */
export function getKanbanSnapshot(state: SnapshotFrom<typeof kanbanMachine>): KanbanSnapshot {
  const context = state.context;
  const stateValue = (
    typeof state.value === 'string' ? state.value : Object.keys(state.value)[0]
  ) as KanbanSnapshot['state'];

  return {
    state: stateValue,
    selectedCards: Array.from(context.selectedCards),
    focusedCard: context.focusedCard,
    draggedCard: context.draggedCard,
    draggedOverColumn: context.draggedOverColumn,
    dropPosition: context.dropPosition,
    editingCard: context.editingCard,
    editingField: context.editingField,
    addingInColumn: context.addingInColumn,
  };
}

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type KanbanMachine = typeof kanbanMachine;
export type KanbanActor = ActorRefFrom<typeof kanbanMachine>;
export type KanbanState = SnapshotFrom<typeof kanbanMachine>;
