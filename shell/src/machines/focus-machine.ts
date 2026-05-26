/**
 * Focus State Machine
 *
 * Manages keyboard focus hierarchy for the spreadsheet application.
 * Tracks which component should receive keyboard events using a stack-based model.
 *
 * Key design principles:
 * 1. Machine is PURE - no DOM access (coordinator handles all DOM operations)
 * 2. Stack is single source of truth - state is derived from stack top
 * 3. Serializable state - stores CSS selectors, not DOM elements
 */

import { focusSelectors } from '../selectors';
import type { FocusState as FocusSelectorState } from '@mog-sdk/contracts/actors/focus';
import type { FocusLayer, FocusLayerType, FocusSnapshot } from '@mog-sdk/contracts/machines';
import type { ActorRefFrom, SnapshotFrom } from 'xstate';
import { assign, setup } from 'xstate';

// Re-export types from contracts for backward compatibility
export type { FocusLayer, FocusLayerType, FocusSnapshot } from '@mog-sdk/contracts/machines';

/**
 * Focus machine context.
 */
export interface FocusContext {
  /** Stack of focus layers. Base grid layer is always at index 0. */
  stack: FocusLayer[];
  /** Last known active grid cell (for restoration after overlays) */
  previousGridCell: { row: number; col: number } | null;
}

// =============================================================================
// EVENTS
// =============================================================================

/**
 * Events for the focus machine.
 * Uses generic PUSH_LAYER/POP_LAYER for all overlay types.
 */
export type FocusEvent =
  | { type: 'FOCUS_GRID' }
  | { type: 'FOCUS_EDITOR'; cellId: string; returnFocusTarget: string | null }
  | {
      type: 'PUSH_LAYER';
      layerType: FocusLayerType;
      id: string;
      returnFocusTarget: string | null;
    }
  | { type: 'POP_LAYER' }
  | { type: 'RESET_TO_GRID' }; // Emergency escape - clears entire stack

// =============================================================================
// EVENT FACTORY
// =============================================================================

/**
 * Type-safe event factories for the focus machine.
 * Use these instead of inline object literals to prevent magic string drift.
 */
export const FocusEvents = {
  focusGrid: (): FocusEvent => ({
    type: 'FOCUS_GRID',
  }),

  focusEditor: (cellId: string, returnFocusTarget: string | null): FocusEvent => ({
    type: 'FOCUS_EDITOR',
    cellId,
    returnFocusTarget,
  }),

  pushLayer: (
    layerType: FocusLayerType,
    id: string,
    returnFocusTarget: string | null,
  ): FocusEvent => ({
    type: 'PUSH_LAYER',
    layerType,
    id,
    returnFocusTarget,
  }),

  popLayer: (): FocusEvent => ({
    type: 'POP_LAYER',
  }),

  resetToGrid: (): FocusEvent => ({
    type: 'RESET_TO_GRID',
  }),
} as const;

// =============================================================================
// CONSTANTS
// =============================================================================

/** Maximum stack depth to prevent infinite nesting bugs */
export const MAX_STACK_DEPTH = 10;

/** Base grid layer - always present at stack[0] */
const BASE_GRID_LAYER: FocusLayer = {
  type: 'grid',
  id: 'grid',
  returnFocusTarget: null,
};

// =============================================================================
// INITIAL CONTEXT
// =============================================================================

const initialContext: FocusContext = {
  stack: [BASE_GRID_LAYER],
  previousGridCell: null,
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the state that we'll return to after popping the current layer.
 * Looks at the second-to-last item in stack.
 */
function getReturnState(stack: FocusLayer[]): FocusLayerType {
  if (stack.length <= 1) return 'grid';
  return stack[stack.length - 2].type;
}

// =============================================================================
// FOCUS MACHINE
// =============================================================================

export const focusMachine = setup({
  types: {
    context: {} as FocusContext,
    events: {} as FocusEvent,
  },
  guards: {
    /** Check if we can push another layer (not at max depth) */
    canPush: ({ context }) => context.stack.length < MAX_STACK_DEPTH,

    // Layer type guards for PUSH_LAYER
    isCommandPalette: ({ event }) =>
      event.type === 'PUSH_LAYER' && event.layerType === 'commandPalette',
    isContextMenu: ({ event }) => event.type === 'PUSH_LAYER' && event.layerType === 'contextMenu',
    isSheetTabs: ({ event }) => event.type === 'PUSH_LAYER' && event.layerType === 'sheetTabs',
    isFormulaPicker: ({ event }) =>
      event.type === 'PUSH_LAYER' && event.layerType === 'formulaPicker',
    isFormulaBar: ({ event }) => event.type === 'PUSH_LAYER' && event.layerType === 'formulaBar',
    isDialog: ({ event }) => event.type === 'PUSH_LAYER' && event.layerType === 'dialog',

    // Return state guards for POP_LAYER
    returnsToDialog: ({ context }) => getReturnState(context.stack) === 'dialog',
    returnsToFormulaPicker: ({ context }) => getReturnState(context.stack) === 'formulaPicker',
    returnsToCommandPalette: ({ context }) => getReturnState(context.stack) === 'commandPalette',
    returnsToEditor: ({ context }) => getReturnState(context.stack) === 'editor',
    returnsToFormulaBar: ({ context }) => getReturnState(context.stack) === 'formulaBar',
  },
  actions: {
    /** Push a new layer onto the stack */
    pushLayer: assign({
      stack: ({ context, event }) => {
        if (event.type !== 'PUSH_LAYER') return context.stack;
        if (context.stack.length >= MAX_STACK_DEPTH) {
          console.warn('[focus-machine] Max stack depth reached, ignoring push');
          return context.stack;
        }
        return [
          ...context.stack,
          {
            type: event.layerType,
            id: event.id,
            returnFocusTarget: event.returnFocusTarget,
          },
        ];
      },
    }),

    /** Push editor layer onto the stack */
    pushEditorLayer: assign({
      stack: ({ context, event }) => {
        if (event.type !== 'FOCUS_EDITOR') return context.stack;
        return [
          ...context.stack,
          {
            type: 'editor' as const,
            id: event.cellId,
            returnFocusTarget: event.returnFocusTarget,
          },
        ];
      },
    }),

    /** Pop the top layer from the stack (never pops base grid layer) */
    popLayer: assign({
      stack: ({ context }) => {
        if (context.stack.length <= 1) {
          // Never pop the base grid layer
          return context.stack;
        }
        return context.stack.slice(0, -1);
      },
    }),

    /** Reset stack to only the base grid layer */
    popToGrid: assign({
      stack: () => [BASE_GRID_LAYER],
    }),

    /** Store previous grid cell for restoration */
    storePreviousCell: assign({
      previousGridCell: ({ event }) => {
        if (event.type !== 'FOCUS_EDITOR') return null;
        // Parse cellId which is in format "row-col"
        const parts = event.cellId.split('-');
        if (parts.length === 2) {
          const row = parseInt(parts[0], 10);
          const col = parseInt(parts[1], 10);
          if (!isNaN(row) && !isNaN(col)) {
            return { row, col };
          }
        }
        return null;
      },
    }),
  },
}).createMachine({
  id: 'focus',
  initial: 'grid',
  context: initialContext,

  states: {
    /**
     * GRID: Base state - grid component handles keyboard events.
     * This is the default state when no overlays are open.
     */
    grid: {
      on: {
        FOCUS_EDITOR: {
          target: 'editor',
          actions: ['storePreviousCell', 'pushEditorLayer'],
        },
        PUSH_LAYER: [
          {
            target: 'formulaBar',
            guard: 'isFormulaBar',
            actions: 'pushLayer',
          },
          {
            target: 'commandPalette',
            guard: 'isCommandPalette',
            actions: 'pushLayer',
          },
          {
            target: 'contextMenu',
            guard: 'isContextMenu',
            actions: 'pushLayer',
          },
          {
            target: 'sheetTabs',
            guard: 'isSheetTabs',
            actions: 'pushLayer',
          },
          {
            target: 'dialog',
            guard: 'canPush',
            actions: 'pushLayer',
          },
        ],
      },
    },

    /**
     * EDITOR: Cell editor is active (inline cell editor).
     * Editor handles its own keyboard events.
     */
    editor: {
      on: {
        FOCUS_GRID: {
          target: 'grid',
          actions: 'popToGrid',
        },
        RESET_TO_GRID: {
          target: 'grid',
          actions: 'popToGrid',
        },
        PUSH_LAYER: [
          {
            target: 'formulaPicker',
            guard: 'isFormulaPicker',
            actions: 'pushLayer',
          },
          {
            target: 'dialog',
            guard: 'canPush',
            actions: 'pushLayer',
          },
        ],
      },
    },

    /**
     * FORMULA_BAR: Formula bar has focus.
     * Similar to editor but for formula bar input.
     * Can open dialogs (like function picker) from here.
     */
    formulaBar: {
      on: {
        POP_LAYER: {
          target: 'grid',
          actions: 'popLayer',
        },
        FOCUS_GRID: {
          target: 'grid',
          actions: 'popToGrid',
        },
        RESET_TO_GRID: {
          target: 'grid',
          actions: 'popToGrid',
        },
        PUSH_LAYER: [
          {
            target: 'formulaPicker',
            guard: 'isFormulaPicker',
            actions: 'pushLayer',
          },
          {
            target: 'dialog',
            guard: 'canPush',
            actions: 'pushLayer',
          },
        ],
      },
    },

    /**
     * DIALOG: Modal dialog is open.
     * Handles nested dialogs via stack.
     */
    dialog: {
      on: {
        POP_LAYER: [
          // Stay in dialog if there are nested dialogs
          {
            target: 'dialog',
            guard: 'returnsToDialog',
            actions: 'popLayer',
          },
          // Return to formula picker
          {
            target: 'formulaPicker',
            guard: 'returnsToFormulaPicker',
            actions: 'popLayer',
          },
          // Return to command palette
          {
            target: 'commandPalette',
            guard: 'returnsToCommandPalette',
            actions: 'popLayer',
          },
          // Return to editor
          {
            target: 'editor',
            guard: 'returnsToEditor',
            actions: 'popLayer',
          },
          // Return to formula bar
          {
            target: 'formulaBar',
            guard: 'returnsToFormulaBar',
            actions: 'popLayer',
          },
          // Default: return to grid
          {
            target: 'grid',
            actions: 'popLayer',
          },
        ],
        PUSH_LAYER: {
          target: 'dialog',
          guard: 'canPush',
          actions: 'pushLayer',
        },
        RESET_TO_GRID: {
          target: 'grid',
          actions: 'popToGrid',
        },
      },
    },

    /**
     * COMMAND_PALETTE: Command palette is open.
     * Has its own keyboard handling (fuzzy search, navigation).
     */
    commandPalette: {
      on: {
        POP_LAYER: [
          {
            target: 'editor',
            guard: 'returnsToEditor',
            actions: 'popLayer',
          },
          {
            target: 'grid',
            actions: 'popLayer',
          },
        ],
        PUSH_LAYER: {
          target: 'dialog',
          guard: 'canPush',
          actions: 'pushLayer',
        },
        RESET_TO_GRID: {
          target: 'grid',
          actions: 'popToGrid',
        },
      },
    },

    /**
     * CONTEXT_MENU: Context menu is open.
     * Handles arrow navigation within menu.
     */
    contextMenu: {
      on: {
        POP_LAYER: [
          {
            target: 'editor',
            guard: 'returnsToEditor',
            actions: 'popLayer',
          },
          {
            target: 'grid',
            actions: 'popLayer',
          },
        ],
        RESET_TO_GRID: {
          target: 'grid',
          actions: 'popToGrid',
        },
      },
    },

    /**
     * FORMULA_PICKER: Formula picker during formula editing.
     * Returns to editor or formulaBar when closed.
     */
    formulaPicker: {
      on: {
        POP_LAYER: [
          {
            target: 'formulaBar',
            guard: 'returnsToFormulaBar',
            actions: 'popLayer',
          },
          {
            target: 'editor',
            actions: 'popLayer',
          },
        ],
        PUSH_LAYER: {
          target: 'dialog',
          guard: 'canPush',
          actions: 'pushLayer',
        },
        RESET_TO_GRID: {
          target: 'grid',
          actions: 'popToGrid',
        },
      },
    },

    /**
     * SHEET_TABS: Sheet tabs have focus.
     * Tab navigation between sheets.
     */
    sheetTabs: {
      on: {
        POP_LAYER: {
          target: 'grid',
          actions: 'popLayer',
        },
        FOCUS_GRID: {
          target: 'grid',
          actions: 'popToGrid',
        },
        RESET_TO_GRID: {
          target: 'grid',
          actions: 'popToGrid',
        },
      },
    },
  },
});

// =============================================================================
// SNAPSHOT HELPERS
// =============================================================================

/**
 * Get a normalized snapshot from the focus machine state.
 *
 * ARCHITECTURE: This function composes selectors (the single primitive).
 * All extraction logic is defined once in focusSelectors.
 */
export function getFocusSnapshot(snapshot: SnapshotFrom<typeof focusMachine>): FocusSnapshot {
  // Cast state to compatible type for selectors
  const s = snapshot as unknown as FocusSelectorState;

  return {
    state: focusSelectors.state(s),
    currentLayer: focusSelectors.currentLayer(s),
    stack: focusSelectors.stack(s),
    shouldGridHandle: focusSelectors.shouldGridHandle(s),
    isInOverlay: focusSelectors.isInOverlay(s),
  };
}

/**
 * Get the current focus layer type from context.
 * Useful for components that need focus state without full snapshot.
 */
export function getCurrentLayerType(context: FocusContext): FocusLayerType {
  if (context.stack.length === 0) return 'grid';
  return context.stack[context.stack.length - 1].type;
}

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type FocusMachine = typeof focusMachine;
export type FocusActor = ActorRefFrom<typeof focusMachine>;
export type FocusState = SnapshotFrom<typeof focusMachine>;
