/**
 * Shell Event Dispatcher Types
 *
 * Pure type definitions describing the event-dispatcher contract.
 * Kept separate from `event-dispatcher.ts` (the implementation) and
 * `types.ts` (other pure bootstrap types) so that neither `types.ts`
 * nor `event-dispatcher.ts` has to import the other.
 *
 * @see ./event-dispatcher.ts for the concrete implementation.
 */

import type { StoreApi } from 'zustand';
import type { IPlatform } from '@mog-sdk/contracts/platform';
import type { ProjectService } from '../services/project';
import type { ShellUIState } from '../ui-store/shell-store';

// =============================================================================
// Event Dispatcher Dependencies
// =============================================================================

/**
 * Dependencies for the event dispatcher.
 */
export interface EventDispatcherDeps {
  platform: IPlatform | null;
  store: StoreApi<ShellUIState>;
  projectService: ProjectService | null;
}

// =============================================================================
// Event Dispatcher Interface
// =============================================================================

/**
 * Event dispatcher interface.
 */
export interface EventDispatcher {
  /**
   * Start listening for system events.
   * Call after all dependencies are ready.
   */
  start: () => Promise<void>;

  /**
   * Stop listening and cleanup.
   * Call when shutting down.
   */
  stop: () => void;

  /**
   * Update handlers from React.
   * Call when React callbacks change (e.g., after mount).
   */
  setHandlers: (handlers: ShellEventHandlers) => void;
}

// =============================================================================
// Handlers for React Integration
// =============================================================================

/**
 * Handlers that React components can provide to the event dispatcher.
 *
 * These are for actions that require React state/context (e.g., opening dialogs).
 * The event dispatcher calls these when system events occur.
 */
export interface ShellEventHandlers {
  /**
   * Called when user wants to open settings dialog.
   * Settings dialog is a React component, so this is handled via callback.
   */
  onOpenSettings?: () => void;

  /**
   * Called when user wants to show about dialog.
   */
  onOpenAbout?: () => void;

  /**
   * Called when user triggers undo via Edit > Undo menu.
   * Routes to the active document proxy's undo().
   */
  onUndo?: () => void;

  /**
   * Called when user triggers redo via Edit > Redo menu.
   * Routes to the active document proxy's redo().
   */
  onRedo?: () => void;
}
