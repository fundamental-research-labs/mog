/**
 * Draw Border State Machine
 *
 * Manages draw border tool interactions including:
 * - Draw Border mode: click/drag to apply borders to cells
 * - Draw Border Grid mode: click/drag to apply grid borders to cells
 * - Erase Border mode: click/drag to remove borders from cells
 *
 * This file contains only the state machine definition itself.
 * The machine is PURE - no side effects. All border application
 * logic is handled by the coordinator.
 *
 * @see docs/ARCHITECTURE-CHECKLIST.md - Section 4: State Machine / Coordinator Pattern
 */

import { setup, type ActorRefFrom } from 'xstate';

import { drawBorderSelectors } from '../../../selectors';
import type { DrawBorderState as DrawBorderSelectorState } from '@mog-sdk/contracts/actors/draw-border';
import type { CellCoord } from '../../shared/types';

// =============================================================================
// TYPES
// =============================================================================

/**
 * Border style configuration for drawing.
 * Used to specify the style of borders being drawn.
 */
export interface DrawBorderStyle {
  /** Border color (hex, rgb, or theme color) */
  color: string;
  /** Border line style */
  style: 'thin' | 'medium' | 'thick' | 'dashed' | 'dotted' | 'double' | 'hair';
}

/**
 * Context for the draw border machine.
 * Tracks the current drawing operation state.
 */
export interface DrawBorderContext {
  /** Current border style to apply (null when erasing) */
  borderStyle: DrawBorderStyle | null;

  /** Starting cell of the current drag operation */
  startCell: CellCoord | null;

  /** Current cell during drag (end of range) */
  currentCell: CellCoord | null;

  /** Cells that have been drawn on during the current drag operation */
  drawnCells: CellCoord[];

  /** Sheet ID where drawing is occurring */
  sheetId: string | null;
}

/**
 * Initial context for the draw border machine.
 */
export const initialDrawBorderContext: DrawBorderContext = {
  borderStyle: null,
  startCell: null,
  currentCell: null,
  drawnCells: [],
  sheetId: null,
};

// =============================================================================
// EVENTS
// =============================================================================

/**
 * Events that the draw border machine can receive.
 */
export type DrawBorderEvent =
  // Activation events - enter a drawing mode
  | {
      type: 'ACTIVATE_DRAW_BORDER';
      borderStyle: DrawBorderStyle;
      sheetId: string;
    }
  | {
      type: 'ACTIVATE_DRAW_BORDER_GRID';
      borderStyle: DrawBorderStyle;
      sheetId: string;
    }
  | {
      type: 'ACTIVATE_ERASE_BORDER';
      sheetId: string;
    }
  // Mouse events during drawing
  | {
      type: 'MOUSE_DOWN';
      cell: CellCoord;
    }
  | {
      type: 'MOUSE_MOVE';
      cell: CellCoord;
    }
  | {
      type: 'MOUSE_UP';
    }
  // Deactivation events
  | { type: 'CANCEL' }
  | { type: 'DEACTIVATE' };

// =============================================================================
// GUARDS
// =============================================================================

/**
 * Guards for draw border state machine transitions.
 */
const drawBorderGuards = {
  /** Check if a cell is different from the current cell */
  isCellChanged: ({
    context,
    event,
  }: {
    context: DrawBorderContext;
    event: DrawBorderEvent;
  }): boolean => {
    if (event.type !== 'MOUSE_MOVE') return false;
    const { currentCell } = context;
    const { cell } = event;
    if (!currentCell) return true;
    return currentCell.row !== cell.row || currentCell.col !== cell.col;
  },
};

// =============================================================================
// ACTIONS
// =============================================================================

/**
 * Actions for draw border state machine.
 * These are PURE - they only update context, no side effects.
 */
const drawBorderActions = {
  /** Set border style when activating draw or draw grid mode */
  setBorderStyle: ({
    event,
  }: {
    context: DrawBorderContext;
    event: DrawBorderEvent;
  }): Partial<DrawBorderContext> => {
    if (event.type !== 'ACTIVATE_DRAW_BORDER' && event.type !== 'ACTIVATE_DRAW_BORDER_GRID') {
      return {};
    }
    return {
      borderStyle: event.borderStyle,
      sheetId: event.sheetId,
    };
  },

  /** Clear border style when activating erase mode */
  clearBorderStyle: ({
    event,
  }: {
    context: DrawBorderContext;
    event: DrawBorderEvent;
  }): Partial<DrawBorderContext> => {
    if (event.type !== 'ACTIVATE_ERASE_BORDER') return {};
    return {
      borderStyle: null,
      sheetId: event.sheetId,
    };
  },

  /** Start a new draw operation on mouse down */
  startDraw: ({
    event,
  }: {
    context: DrawBorderContext;
    event: DrawBorderEvent;
  }): Partial<DrawBorderContext> => {
    if (event.type !== 'MOUSE_DOWN') return {};
    return {
      startCell: event.cell,
      currentCell: event.cell,
      drawnCells: [event.cell],
    };
  },

  /** Update current cell on mouse move */
  updateDraw: ({
    context,
    event,
  }: {
    context: DrawBorderContext;
    event: DrawBorderEvent;
  }): Partial<DrawBorderContext> => {
    if (event.type !== 'MOUSE_MOVE') return {};
    const { cell } = event;
    const { drawnCells } = context;

    // Check if cell is already in drawn cells
    const alreadyDrawn = drawnCells.some((c) => c.row === cell.row && c.col === cell.col);

    return {
      currentCell: cell,
      drawnCells: alreadyDrawn ? drawnCells : [...drawnCells, cell],
    };
  },

  /** Clear draw state on mouse up or cancel */
  clearDraw: (): Partial<DrawBorderContext> => {
    return {
      startCell: null,
      currentCell: null,
      drawnCells: [],
    };
  },

  /** Reset to initial context */
  reset: (): DrawBorderContext => {
    return initialDrawBorderContext;
  },
};

// =============================================================================
// STATE MACHINE
// =============================================================================

/**
 * Draw Border State Machine
 *
 * States:
 * - inactive: No drawing mode active, waiting for activation
 * - drawingBorder: Draw Border mode - applies single-edge borders on drag
 * - drawingBorderGrid: Draw Border Grid mode - applies grid borders on drag
 * - erasingBorder: Erase Border mode - removes borders on drag
 *
 * Each active state has sub-states:
 * - idle: Waiting for mouse down to start drawing
 * - active: Currently drawing/erasing (mouse is down)
 */
export const drawBorderMachine = setup({
  types: {
    context: {} as DrawBorderContext,
    events: {} as DrawBorderEvent,
  },
  guards: drawBorderGuards,
  actions: {
    // Actions use assign internally - these are wrappers
    setBorderStyle: ({ context, event }) => {
      const update = drawBorderActions.setBorderStyle({ context, event });
      Object.assign(context, update);
    },
    clearBorderStyle: ({ context, event }) => {
      const update = drawBorderActions.clearBorderStyle({ context, event });
      Object.assign(context, update);
    },
    startDraw: ({ context, event }) => {
      const update = drawBorderActions.startDraw({ context, event });
      Object.assign(context, update);
    },
    updateDraw: ({ context, event }) => {
      const update = drawBorderActions.updateDraw({ context, event });
      Object.assign(context, update);
    },
    clearDraw: ({ context }) => {
      const update = drawBorderActions.clearDraw();
      Object.assign(context, update);
    },
    reset: ({ context }) => {
      const update = drawBorderActions.reset();
      Object.assign(context, update);
    },
  },
}).createMachine({
  id: 'drawBorder',
  initial: 'inactive',
  context: initialDrawBorderContext,

  states: {
    // =========================================================================
    // INACTIVE - No drawing mode active
    // =========================================================================
    inactive: {
      on: {
        ACTIVATE_DRAW_BORDER: {
          target: 'drawingBorder',
          actions: 'setBorderStyle',
        },
        ACTIVATE_DRAW_BORDER_GRID: {
          target: 'drawingBorderGrid',
          actions: 'setBorderStyle',
        },
        ACTIVATE_ERASE_BORDER: {
          target: 'erasingBorder',
          actions: 'clearBorderStyle',
        },
      },
    },

    // =========================================================================
    // DRAWING BORDER - Apply borders on drag
    // =========================================================================
    drawingBorder: {
      initial: 'idle',
      on: {
        // Allow switching modes without going to inactive first
        ACTIVATE_DRAW_BORDER: {
          target: 'drawingBorder',
          actions: 'setBorderStyle',
        },
        ACTIVATE_DRAW_BORDER_GRID: {
          target: 'drawingBorderGrid',
          actions: 'setBorderStyle',
        },
        ACTIVATE_ERASE_BORDER: {
          target: 'erasingBorder',
          actions: 'clearBorderStyle',
        },
        DEACTIVATE: {
          target: 'inactive',
          actions: 'reset',
        },
        CANCEL: {
          target: 'inactive',
          actions: 'reset',
        },
      },
      states: {
        idle: {
          on: {
            MOUSE_DOWN: {
              target: 'active',
              actions: 'startDraw',
            },
          },
        },
        active: {
          on: {
            MOUSE_MOVE: {
              guard: 'isCellChanged',
              actions: 'updateDraw',
            },
            MOUSE_UP: {
              target: 'idle',
              actions: 'clearDraw',
            },
          },
        },
      },
    },

    // =========================================================================
    // DRAWING BORDER GRID - Apply grid borders on drag
    // =========================================================================
    drawingBorderGrid: {
      initial: 'idle',
      on: {
        ACTIVATE_DRAW_BORDER: {
          target: 'drawingBorder',
          actions: 'setBorderStyle',
        },
        ACTIVATE_DRAW_BORDER_GRID: {
          target: 'drawingBorderGrid',
          actions: 'setBorderStyle',
        },
        ACTIVATE_ERASE_BORDER: {
          target: 'erasingBorder',
          actions: 'clearBorderStyle',
        },
        DEACTIVATE: {
          target: 'inactive',
          actions: 'reset',
        },
        CANCEL: {
          target: 'inactive',
          actions: 'reset',
        },
      },
      states: {
        idle: {
          on: {
            MOUSE_DOWN: {
              target: 'active',
              actions: 'startDraw',
            },
          },
        },
        active: {
          on: {
            MOUSE_MOVE: {
              guard: 'isCellChanged',
              actions: 'updateDraw',
            },
            MOUSE_UP: {
              target: 'idle',
              actions: 'clearDraw',
            },
          },
        },
      },
    },

    // =========================================================================
    // ERASING BORDER - Remove borders on drag
    // =========================================================================
    erasingBorder: {
      initial: 'idle',
      on: {
        ACTIVATE_DRAW_BORDER: {
          target: 'drawingBorder',
          actions: 'setBorderStyle',
        },
        ACTIVATE_DRAW_BORDER_GRID: {
          target: 'drawingBorderGrid',
          actions: 'setBorderStyle',
        },
        ACTIVATE_ERASE_BORDER: {
          target: 'erasingBorder',
          actions: 'clearBorderStyle',
        },
        DEACTIVATE: {
          target: 'inactive',
          actions: 'reset',
        },
        CANCEL: {
          target: 'inactive',
          actions: 'reset',
        },
      },
      states: {
        idle: {
          on: {
            MOUSE_DOWN: {
              target: 'active',
              actions: 'startDraw',
            },
          },
        },
        active: {
          on: {
            MOUSE_MOVE: {
              guard: 'isCellChanged',
              actions: 'updateDraw',
            },
            MOUSE_UP: {
              target: 'idle',
              actions: 'clearDraw',
            },
          },
        },
      },
    },
  },
});

// =============================================================================
// TYPE EXPORTS & UTILITIES
// =============================================================================

export type DrawBorderMachine = typeof drawBorderMachine;
export type DrawBorderActor = ActorRefFrom<DrawBorderMachine>;
export type DrawBorderState = ReturnType<DrawBorderActor['getSnapshot']>;

/**
 * Snapshot type for consumers of the draw border machine.
 */
export interface DrawBorderSnapshot {
  /** Whether any drawing mode is active */
  isActive: boolean;
  /** Current mode (null if inactive) */
  mode: 'draw' | 'drawGrid' | 'erase' | null;
  /** Whether currently drawing (mouse down) */
  isDrawing: boolean;
  /** Current border style (null when erasing or inactive) */
  borderStyle: DrawBorderStyle | null;
  /** Cells drawn during current drag operation */
  drawnCells: CellCoord[];
  /** Sheet ID where drawing is occurring */
  sheetId: string | null;
}

/**
 * Get snapshot from draw border actor state.
 *
 * ARCHITECTURE: This function composes selectors (the single primitive).
 * All extraction logic is defined once in drawBorderSelectors.
 */
export function getDrawBorderSnapshot(state: DrawBorderState): DrawBorderSnapshot {
  // Cast state to compatible type for selectors
  const s = state as DrawBorderSelectorState;

  return {
    isActive: drawBorderSelectors.isActive(s),
    mode: drawBorderSelectors.mode(s),
    isDrawing: drawBorderSelectors.isDrawing(s),
    borderStyle: drawBorderSelectors.borderStyle(s),
    drawnCells: drawBorderSelectors.drawnCells(s),
    sheetId: drawBorderSelectors.sheetId(s),
  };
}
