/**
 * Pane Focus State Machine
 *
 * Manages F6 pane navigation for cycling focus between major UI panes:
 * toolbar -> formulaBar -> grid -> statusBar (and back)
 *
 * Excel Parity Quickwin E1: F6 Pane Navigation
 *
 * Key design principles:
 * 1. Machine is PURE - no DOM access (coordinator handles focus)
 * 2. State is deterministic - pane order is fixed
 * 3. Serializable state - stores current pane type only
 *
 */

import type { ActorRefFrom, SnapshotFrom } from 'xstate';
import { assign, setup } from 'xstate';

import { paneFocusSelectors } from '../../../selectors';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Types of panes that can receive focus.
 * Order determines navigation cycle: toolbar -> formulaBar -> grid -> statusBar
 */
export type PaneType = 'toolbar' | 'formulaBar' | 'grid' | 'statusBar';

/**
 * Pane focus machine context.
 */
export interface PaneFocusContext {
  /** Currently focused pane */
  currentPane: PaneType;
  /** Previously focused pane (for restoration after overlays) */
  previousPane: PaneType | null;
}

// =============================================================================
// EVENTS
// =============================================================================

/**
 * Events for the pane focus machine.
 */
export type PaneFocusEvent =
  | { type: 'FOCUS_NEXT_PANE' }
  | { type: 'FOCUS_PREVIOUS_PANE' }
  | { type: 'FOCUS_PANE'; pane: PaneType }
  | { type: 'RESET_TO_GRID' };

// =============================================================================
// EVENT FACTORY
// =============================================================================

/**
 * Type-safe event factories for the pane focus machine.
 */
export const PaneFocusEvents = {
  focusNextPane: (): PaneFocusEvent => ({
    type: 'FOCUS_NEXT_PANE',
  }),

  focusPreviousPane: (): PaneFocusEvent => ({
    type: 'FOCUS_PREVIOUS_PANE',
  }),

  focusPane: (pane: PaneType): PaneFocusEvent => ({
    type: 'FOCUS_PANE',
    pane,
  }),

  resetToGrid: (): PaneFocusEvent => ({
    type: 'RESET_TO_GRID',
  }),
} as const;

// =============================================================================
// CONSTANTS
// =============================================================================

/** Ordered list of panes for F6 navigation */
export const PANE_ORDER: readonly PaneType[] = [
  'toolbar',
  'formulaBar',
  'grid',
  'statusBar',
] as const;

// =============================================================================
// INITIAL CONTEXT
// =============================================================================

const initialContext: PaneFocusContext = {
  currentPane: 'grid',
  previousPane: null,
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get the next pane in the cycle.
 * toolbar -> formulaBar -> grid -> statusBar -> toolbar
 */
function getNextPane(current: PaneType): PaneType {
  const currentIndex = PANE_ORDER.indexOf(current);
  const nextIndex = (currentIndex + 1) % PANE_ORDER.length;
  return PANE_ORDER[nextIndex];
}

/**
 * Get the previous pane in the cycle.
 * statusBar -> grid -> formulaBar -> toolbar -> statusBar
 */
function getPreviousPane(current: PaneType): PaneType {
  const currentIndex = PANE_ORDER.indexOf(current);
  const prevIndex = (currentIndex - 1 + PANE_ORDER.length) % PANE_ORDER.length;
  return PANE_ORDER[prevIndex];
}

// =============================================================================
// PANE FOCUS MACHINE
// =============================================================================

export const paneFocusMachine = setup({
  types: {
    context: {} as PaneFocusContext,
    events: {} as PaneFocusEvent,
  },
  actions: {
    /** Move to the next pane in the cycle */
    focusNextPane: assign({
      previousPane: ({ context }) => context.currentPane,
      currentPane: ({ context }) => getNextPane(context.currentPane),
    }),

    /** Move to the previous pane in the cycle */
    focusPreviousPane: assign({
      previousPane: ({ context }) => context.currentPane,
      currentPane: ({ context }) => getPreviousPane(context.currentPane),
    }),

    /** Focus a specific pane */
    focusPane: assign({
      previousPane: ({ context }) => context.currentPane,
      currentPane: ({ event }) => (event.type === 'FOCUS_PANE' ? event.pane : 'grid'),
    }),

    /** Reset to grid pane */
    resetToGrid: assign({
      previousPane: ({ context }) => context.currentPane,
      currentPane: () => 'grid' as PaneType,
    }),
  },
}).createMachine({
  id: 'paneFocus',
  initial: 'grid',
  context: initialContext,

  states: {
    /**
     * TOOLBAR: Quick Access Toolbar / Ribbon has focus.
     */
    toolbar: {
      entry: assign({ currentPane: () => 'toolbar' as PaneType }),
      on: {
        FOCUS_NEXT_PANE: {
          target: 'formulaBar',
          actions: 'focusNextPane',
        },
        FOCUS_PREVIOUS_PANE: {
          target: 'statusBar',
          actions: 'focusPreviousPane',
        },
        FOCUS_PANE: [
          { target: 'formulaBar', guard: ({ event }) => event.pane === 'formulaBar' },
          { target: 'grid', guard: ({ event }) => event.pane === 'grid' },
          { target: 'statusBar', guard: ({ event }) => event.pane === 'statusBar' },
        ],
        RESET_TO_GRID: {
          target: 'grid',
          actions: 'resetToGrid',
        },
      },
    },

    /**
     * FORMULA_BAR: Formula bar input has focus.
     */
    formulaBar: {
      entry: assign({ currentPane: () => 'formulaBar' as PaneType }),
      on: {
        FOCUS_NEXT_PANE: {
          target: 'grid',
          actions: 'focusNextPane',
        },
        FOCUS_PREVIOUS_PANE: {
          target: 'toolbar',
          actions: 'focusPreviousPane',
        },
        FOCUS_PANE: [
          { target: 'toolbar', guard: ({ event }) => event.pane === 'toolbar' },
          { target: 'grid', guard: ({ event }) => event.pane === 'grid' },
          { target: 'statusBar', guard: ({ event }) => event.pane === 'statusBar' },
        ],
        RESET_TO_GRID: {
          target: 'grid',
          actions: 'resetToGrid',
        },
      },
    },

    /**
     * GRID: Spreadsheet grid has focus (default state).
     */
    grid: {
      entry: assign({ currentPane: () => 'grid' as PaneType }),
      on: {
        FOCUS_NEXT_PANE: {
          target: 'statusBar',
          actions: 'focusNextPane',
        },
        FOCUS_PREVIOUS_PANE: {
          target: 'formulaBar',
          actions: 'focusPreviousPane',
        },
        FOCUS_PANE: [
          { target: 'toolbar', guard: ({ event }) => event.pane === 'toolbar' },
          { target: 'formulaBar', guard: ({ event }) => event.pane === 'formulaBar' },
          { target: 'statusBar', guard: ({ event }) => event.pane === 'statusBar' },
        ],
        RESET_TO_GRID: {
          actions: 'resetToGrid',
        },
      },
    },

    /**
     * STATUS_BAR: Status bar has focus.
     */
    statusBar: {
      entry: assign({ currentPane: () => 'statusBar' as PaneType }),
      on: {
        FOCUS_NEXT_PANE: {
          target: 'toolbar',
          actions: 'focusNextPane',
        },
        FOCUS_PREVIOUS_PANE: {
          target: 'grid',
          actions: 'focusPreviousPane',
        },
        FOCUS_PANE: [
          { target: 'toolbar', guard: ({ event }) => event.pane === 'toolbar' },
          { target: 'formulaBar', guard: ({ event }) => event.pane === 'formulaBar' },
          { target: 'grid', guard: ({ event }) => event.pane === 'grid' },
        ],
        RESET_TO_GRID: {
          target: 'grid',
          actions: 'resetToGrid',
        },
      },
    },
  },
});

// =============================================================================
// SNAPSHOT HELPERS
// =============================================================================

/**
 * What the pane focus machine exposes to consumers.
 */
export interface PaneFocusSnapshot {
  /** Current focused pane */
  currentPane: PaneType;
  /** Previously focused pane */
  previousPane: PaneType | null;
  /** Whether the grid has focus */
  isGridFocused: boolean;
}

/**
 * Get a normalized snapshot from the pane focus machine state.
 *
 * ARCHITECTURE: This function composes selectors - the single source of truth.
 * All extraction logic is delegated to paneFocusSelectors.
 * @see contracts/src/actors/pane-focus.ts
 */
export function getPaneFocusSnapshot(
  snapshot: SnapshotFrom<typeof paneFocusMachine>,
): PaneFocusSnapshot {
  // Cast state to selector-compatible type
  const s = snapshot as Parameters<(typeof paneFocusSelectors)['currentPane']>[0];

  return {
    // Value selectors
    currentPane: paneFocusSelectors.currentPane(s),
    previousPane: paneFocusSelectors.previousPane(s),

    // Derived selector
    isGridFocused: paneFocusSelectors.isGrid(s),
  };
}

// =============================================================================
// TYPE EXPORTS
// =============================================================================

export type PaneFocusMachine = typeof paneFocusMachine;
export type PaneFocusActor = ActorRefFrom<typeof paneFocusMachine>;
export type PaneFocusState = SnapshotFrom<typeof paneFocusMachine>;
