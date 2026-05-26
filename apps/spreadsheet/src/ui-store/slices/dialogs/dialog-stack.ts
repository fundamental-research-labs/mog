/**
 * Dialog Stack Slice
 *
 * Manages parent-child relationships between dialogs to support nested dialog
 * minimization during range selection mode. When a child dialog enters range
 * selection mode, the entire stack (child → parent → grandparent) minimizes
 * to allow grid interaction.
 *
 * Architecture:
 * - Dialogs register on mount with optional parentDialogId
 * - minimizeStack() walks up the parent chain and minimizes all dialogs
 * - restoreStack() walks up the parent chain and restores all dialogs
 * - Source dialog shows MinimizedBar, parent dialogs render null (hidden)
 *
 */

import type { StateCreator } from 'zustand';

import { isDev } from '@mog/env';

// =============================================================================
// Types
// =============================================================================

/**
 * Entry for a registered dialog in the stack.
 */
export interface DialogEntry {
  /** Unique identifier for the dialog */
  dialogId: string;
  /** Parent dialog ID (null if top-level) */
  parentDialogId: string | null;
  /** Whether this dialog is currently minimized */
  isMinimized: boolean;
}

/**
 * Dialog stack state and actions.
 */
export interface DialogStackSlice {
  /**
   * Map of all registered dialogs.
   * Uses Record instead of Map for better Zustand devtools and shallow comparison.
   */
  dialogStack: Record<string, DialogEntry>;

  /**
   * Register a dialog when it mounts.
   * Call this in useEffect on mount.
   *
   * @param dialogId - Unique identifier for the dialog
   * @param parentDialogId - Optional parent dialog ID (for nested dialogs)
   */
  registerDialog: (dialogId: string, parentDialogId?: string) => void;

  /**
   * Unregister a dialog when it unmounts.
   * Call this in useEffect cleanup.
   *
   * @param dialogId - Unique identifier for the dialog
   */
  unregisterDialog: (dialogId: string) => void;

  /**
   * Minimize the entire dialog stack starting from the given dialog.
   * Walks up the parent chain and sets isMinimized = true for all.
   *
   * @param fromDialogId - The dialog that initiated range selection
   */
  minimizeStack: (fromDialogId: string) => void;

  /**
   * Restore the entire dialog stack starting from the given dialog.
   * Walks up the parent chain and sets isMinimized = false for all.
   *
   * @param fromDialogId - The dialog that initiated range selection
   */
  restoreStack: (fromDialogId: string) => void;

  /**
   * Check if a dialog is currently minimized.
   *
   * @param dialogId - The dialog to check
   * @returns true if the dialog is minimized
   */
  isDialogMinimized: (dialogId: string) => boolean;

  /**
   * Get the chain of dialog IDs from the given dialog up to the root.
   * Returns [dialogId, parentId, grandparentId, ...] up to root (no parent).
   *
   * @param dialogId - The starting dialog
   * @returns Array of dialog IDs from child to root
   */
  getDialogChain: (dialogId: string) => string[];
}

// =============================================================================
// Slice Creator
// =============================================================================

export const createDialogStackSlice: StateCreator<DialogStackSlice, [], [], DialogStackSlice> = (
  set,
  get,
) => ({
  dialogStack: {},

  registerDialog: (dialogId, parentDialogId) => {
    // Dev-mode warning for duplicate registration
    if (isDev()) {
      const existing = get().dialogStack[dialogId];
      if (existing) {
        console.warn(
          `[DialogStack] Dialog "${dialogId}" already registered. This may indicate a bug.`,
        );
      }
    }

    set((state) => ({
      dialogStack: {
        ...state.dialogStack,
        [dialogId]: {
          dialogId,
          parentDialogId: parentDialogId ?? null,
          isMinimized: false,
        },
      },
    }));

    // Dev-mode logging
    if (isDev()) {
      console.debug(
        `[DialogStack] registerDialog: ${dialogId}${parentDialogId ? ` (parent: ${parentDialogId})` : ''}`,
      );
    }
  },

  unregisterDialog: (dialogId) => {
    const state = get();

    // If this dialog is in range selection mode, cancel it
    // Access rangeSelectionMode via the store (cross-slice access)
    const rangeSelectionMode = (state as { rangeSelectionMode?: { sourceDialogId: string | null } })
      .rangeSelectionMode;
    if (rangeSelectionMode?.sourceDialogId === dialogId) {
      // The dialog is being unmounted while in range selection - cancel it
      const cancelRangeSelection = (state as { cancelRangeSelection?: () => void })
        .cancelRangeSelection;
      if (cancelRangeSelection) {
        cancelRangeSelection();
      }
    }

    set((state) => {
      const { [dialogId]: _, ...rest } = state.dialogStack;
      return { dialogStack: rest };
    });

    // Dev-mode logging
    if (isDev()) {
      console.debug(`[DialogStack] unregisterDialog: ${dialogId}`);
    }
  },

  minimizeStack: (fromDialogId) => {
    const chain = get().getDialogChain(fromDialogId);

    if (chain.length === 0) {
      if (isDev()) {
        console.warn(
          `[DialogStack] minimizeStack called with unregistered dialog: ${fromDialogId}`,
        );
      }
      return;
    }

    // Dev-mode logging
    if (isDev()) {
      console.debug(`[DialogStack] minimizeStack: ${fromDialogId}, chain: [${chain.join(' → ')}]`);
    }

    set((state) => {
      const newStack = { ...state.dialogStack };
      for (const id of chain) {
        if (newStack[id]) {
          newStack[id] = { ...newStack[id], isMinimized: true };
        }
      }
      return { dialogStack: newStack };
    });
  },

  restoreStack: (fromDialogId) => {
    const chain = get().getDialogChain(fromDialogId);

    if (chain.length === 0) {
      if (isDev()) {
        console.warn(`[DialogStack] restoreStack called with unregistered dialog: ${fromDialogId}`);
      }
      return;
    }

    // Dev-mode logging
    if (isDev()) {
      console.debug(`[DialogStack] restoreStack: ${fromDialogId}, chain: [${chain.join(' → ')}]`);
    }

    set((state) => {
      const newStack = { ...state.dialogStack };
      for (const id of chain) {
        if (newStack[id]) {
          newStack[id] = { ...newStack[id], isMinimized: false };
        }
      }
      return { dialogStack: newStack };
    });
  },

  isDialogMinimized: (dialogId) => {
    return get().dialogStack[dialogId]?.isMinimized ?? false;
  },

  getDialogChain: (dialogId) => {
    const stack = get().dialogStack;
    const chain: string[] = [];

    let currentId: string | null = dialogId;
    const visited = new Set<string>(); // Prevent infinite loops from circular refs

    while (currentId && !visited.has(currentId)) {
      const entry: DialogEntry | undefined = stack[currentId];
      if (!entry) break;

      visited.add(currentId);
      chain.push(currentId);
      currentId = entry.parentDialogId;
    }

    return chain;
  },
});
