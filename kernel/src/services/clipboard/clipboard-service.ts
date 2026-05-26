/**
 * Clipboard Service
 *
 * Cross-app clipboard service that survives app switches.
 * Uses XState for state management.
 *
 * States:
 * - empty: No clipboard data
 * - hasCopy: Copied data available (can paste multiple times)
 * - hasCut: Cut data available (single-use, clears after paste)
 * - pasting: Paste operation in progress
 *
 */

import { assign, createActor, setup, type ActorRefFrom, type SnapshotFrom } from 'xstate';

import type {
  ClipboardContext,
  ClipboardEvent,
  ClipboardPayload,
  ClipboardSnapshot,
  IClipboardService,
} from './types';
import { Subscribable } from '../primitives';

// =============================================================================
// Initial Context
// =============================================================================

const initialContext: ClipboardContext = {
  payload: null,
  operation: null,
  isStale: false,
  timestamp: null,
  error: null,
};

// =============================================================================
// State Machine Definition
// =============================================================================

export const clipboardServiceMachine = setup({
  types: {
    context: {} as ClipboardContext,
    events: {} as ClipboardEvent,
  },
  actions: {
    storeCopyData: assign(({ event }) => {
      if (event.type !== 'COPY') return {};
      return {
        payload: event.payload,
        operation: 'copy' as const,
        isStale: false,
        timestamp: Date.now(),
        error: null,
      };
    }),

    storeCutData: assign(({ event }) => {
      if (event.type !== 'CUT') return {};
      return {
        payload: event.payload,
        operation: 'cut' as const,
        isStale: false,
        timestamp: Date.now(),
        error: null,
      };
    }),

    clearAfterCut: assign(() => ({
      payload: null,
      operation: null,
      isStale: false,
      timestamp: null,
      error: null,
    })),

    clearAll: assign(() => ({
      payload: null,
      operation: null,
      isStale: false,
      timestamp: null,
      error: null,
    })),

    storeError: assign(({ event }) => {
      if (event.type !== 'PASTE_ERROR') return {};
      return {
        error: event.message,
      };
    }),

    clearError: assign(() => ({
      error: null,
    })),

    markStale: assign(() => ({
      isStale: true,
    })),

    markFresh: assign(() => ({
      isStale: false,
    })),
  },
  guards: {
    isCutOperation: ({ context }) => context.operation === 'cut',
  },
}).createMachine({
  id: 'clipboardService',
  initial: 'empty',
  context: initialContext,

  states: {
    // =========================================================================
    // EMPTY - No clipboard data
    // =========================================================================
    empty: {
      on: {
        COPY: {
          target: 'hasCopy',
          actions: 'storeCopyData',
        },
        CUT: {
          target: 'hasCut',
          actions: 'storeCutData',
        },
      },
    },

    // =========================================================================
    // HAS_COPY - Copied data available (can paste multiple times)
    // =========================================================================
    hasCopy: {
      on: {
        COPY: {
          target: 'hasCopy',
          actions: 'storeCopyData',
          reenter: true,
        },
        CUT: {
          target: 'hasCut',
          actions: 'storeCutData',
        },
        PASTE_START: {
          target: 'pasting',
        },
        CLEAR: {
          target: 'empty',
          actions: 'clearAll',
        },
        FOCUS_LOST: {
          actions: 'markStale',
        },
        FOCUS_GAINED: {
          actions: 'markFresh',
        },
      },
    },

    // =========================================================================
    // HAS_CUT - Cut data available (single-use)
    // =========================================================================
    hasCut: {
      on: {
        COPY: {
          target: 'hasCopy',
          actions: 'storeCopyData',
        },
        CUT: {
          target: 'hasCut',
          actions: 'storeCutData',
          reenter: true,
        },
        PASTE_START: {
          target: 'pasting',
        },
        CLEAR: {
          target: 'empty',
          actions: 'clearAll',
        },
        FOCUS_LOST: {
          actions: 'markStale',
        },
        FOCUS_GAINED: {
          actions: 'markFresh',
        },
      },
    },

    // =========================================================================
    // PASTING - Paste operation in progress
    // =========================================================================
    pasting: {
      on: {
        PASTE_COMPLETE: [
          {
            // Cut is single-use, clear after paste
            target: 'empty',
            guard: 'isCutOperation',
            actions: ['clearAfterCut', 'clearError'],
          },
          {
            // Copy can be pasted multiple times
            target: 'hasCopy',
            actions: 'clearError',
          },
        ],
        PASTE_ERROR: [
          {
            target: 'hasCut',
            guard: 'isCutOperation',
            actions: 'storeError',
          },
          {
            target: 'hasCopy',
            actions: 'storeError',
          },
        ],
      },
    },
  },
});

// =============================================================================
// Type Exports
// =============================================================================

export type ClipboardServiceMachine = typeof clipboardServiceMachine;
export type ClipboardServiceActor = ActorRefFrom<ClipboardServiceMachine>;
export type ClipboardServiceState = SnapshotFrom<ClipboardServiceMachine>;

// =============================================================================
// Snapshot Helper
// =============================================================================

/**
 * Extract ClipboardSnapshot from machine state.
 */
export function getClipboardServiceSnapshot(state: ClipboardServiceState): ClipboardSnapshot {
  // Map machine state to ClipboardState
  let clipboardState: import('./types').ClipboardState = 'empty';
  if (state.matches('hasCopy')) clipboardState = 'hasCopy';
  else if (state.matches('hasCut')) clipboardState = 'hasCut';
  else if (state.matches('pasting')) clipboardState = 'pasting';

  return {
    state: clipboardState,
    operation: state.context.operation,
    hasData: state.context.payload !== null,
    isStale: state.context.isStale,
    error: state.context.error,
  };
}

// =============================================================================
// Service Implementation
// =============================================================================

/**
 * Clipboard service implementation.
 *
 * Extends Subscribable<ClipboardSnapshot> — subscribe() returns IDisposable,
 * listeners are automatically cleaned up on dispose.
 *
 * Keeps XState actor for clipboard state transitions; only the subscription
 * layer is unified via Subscribable.
 */
class ClipboardService extends Subscribable<ClipboardSnapshot> implements IClipboardService {
  private actor: ClipboardServiceActor;

  constructor() {
    super();
    this.actor = createActor(clipboardServiceMachine, {
      inspect: (evt) => {
        if (typeof window !== 'undefined') {
          window.__OS_DEVTOOLS__?.reportActor?.('clipboardService', evt);
        }
      },
    });
    this.actor.subscribe(() => {
      this.emitChange();
    });
    this.actor.start();
  }

  // ===========================================================================
  // Subscribable<ClipboardSnapshot>
  // ===========================================================================

  getSnapshot(): ClipboardSnapshot {
    return getClipboardServiceSnapshot(this.actor.getSnapshot());
  }

  // ===========================================================================
  // State
  // ===========================================================================

  getPayload(): ClipboardPayload | null {
    return this.actor.getSnapshot().context.payload;
  }

  // ===========================================================================
  // Commands
  // ===========================================================================

  copy(payload: ClipboardPayload): void {
    this.actor.send({ type: 'COPY', payload });
  }

  cut(payload: ClipboardPayload): void {
    this.actor.send({ type: 'CUT', payload });
  }

  startPaste(): void {
    this.actor.send({ type: 'PASTE_START' });
  }

  completePaste(): void {
    this.actor.send({ type: 'PASTE_COMPLETE' });
  }

  errorPaste(message: string): void {
    this.actor.send({ type: 'PASTE_ERROR', message });
  }

  clear(): void {
    this.actor.send({ type: 'CLEAR' });
  }

  markStale(): void {
    this.actor.send({ type: 'FOCUS_LOST' });
  }

  markFresh(): void {
    this.actor.send({ type: 'FOCUS_GAINED' });
  }

  // ===========================================================================
  // Lifecycle
  // ===========================================================================

  protected _dispose(): void {
    this.actor.stop();
    super._dispose();
  }
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a new clipboard service instance.
 */
export function createClipboardService(): IClipboardService {
  return new ClipboardService();
}
