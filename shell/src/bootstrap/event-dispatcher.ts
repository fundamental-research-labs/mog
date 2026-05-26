/**
 * Shell Event Dispatcher
 *
 * Wires system events (menu, keyboard, IPC) to service methods.
 * Lives OUTSIDE React - no hooks, no context, no render cycle dependency.
 *
 * This is the core of the shell layer architecture:
 * - Initialized BEFORE React mounts
 * - Listens for Tauri events directly
 * - Calls service methods when events occur
 * - React observes state changes through store subscriptions
 *
 */

import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { EventDispatcher, EventDispatcherDeps, ShellEventHandlers } from './dispatcher-types';

// =============================================================================
// Menu Action Types (mirrors Rust menu.rs)
// =============================================================================

/**
 * Menu actions emitted from Rust backend.
 * Keep in sync with src-tauri/src/menu.rs MenuAction enum.
 */
type MenuAction =
  // File actions
  | 'new'
  | 'open'
  | 'save'
  | 'save_as'
  | 'close'
  | 'quit'
  // Project actions
  | 'open_folder'
  | 'close_project'
  // Tab actions
  | 'close_tab'
  | 'close_other_tabs'
  | 'close_all_tabs'
  | 'next_tab'
  | 'prev_tab'
  // Edit actions (undo/redo/clipboard — custom menu items, no native interception)
  | 'undo'
  | 'redo'
  | 'cut'
  | 'copy'
  | 'paste'
  | 'select_all'
  // Edit actions (app-specific)
  | 'find'
  | 'find_replace'
  | 'go_to_cell'
  | 'toggle_filter'
  | 'insert_date'
  | 'insert_time'
  // View actions
  | 'zoom_in'
  | 'zoom_out'
  | 'zoom_reset'
  | 'toggle_formulas'
  | 'toggle_fullscreen'
  | 'next_sheet'
  | 'prev_sheet'
  // App actions
  | 'focus_chat'
  | 'settings'
  // Help actions
  | 'about'
  | 'check_updates';

// =============================================================================
// Event Dispatcher Factory
// =============================================================================

/**
 * Create an event dispatcher that wires system events to services.
 *
 * The dispatcher:
 * 1. Listens for Tauri 'menu-action' events
 * 2. Routes events to the appropriate service method or handler
 * 3. Updates store state as needed
 *
 * This runs OUTSIDE React - no hooks, no context dependencies.
 */
export function createEventDispatcher(deps: EventDispatcherDeps): EventDispatcher {
  const { platform, projectService } = deps;

  // Track listeners for cleanup
  let unlistenMenu: UnlistenFn | null = null;

  // React-provided handlers (updated via setHandlers)
  let handlers: ShellEventHandlers = {};

  // -------------------------------------------------------------------------
  // Menu Action Handler
  // -------------------------------------------------------------------------

  async function handleMenuAction(action: MenuAction): Promise<void> {
    switch (action) {
      // ---------------------------------------------------------------------
      // Project Actions (handled by projectService)
      // ---------------------------------------------------------------------
      case 'open_folder':
        if (platform && projectService) {
          const folder = await platform.dialogs.showOpenFolderDialog();
          if (folder) {
            await projectService.openProject(folder);
          }
        } else {
          console.warn(
            '[EventDispatcher] Cannot open folder: platform or projectService unavailable',
          );
        }
        break;

      case 'close_project':
        await projectService?.closeProject();
        break;

      // ---------------------------------------------------------------------
      // File Actions
      // ---------------------------------------------------------------------
      case 'new':
        await projectService?.newFile();
        break;

      case 'close':
      case 'close_tab':
        if (projectService) {
          const activeFile = projectService.getActiveFile();
          if (activeFile) {
            await projectService.closeFile(activeFile.id);
          }
        }
        break;

      // ---------------------------------------------------------------------
      // Tab Navigation
      // ---------------------------------------------------------------------
      case 'next_tab':
        projectService?.switchToNextTab();
        break;

      case 'prev_tab':
        projectService?.switchToPrevTab();
        break;

      // ---------------------------------------------------------------------
      // App Actions (handled via React handlers)
      // ---------------------------------------------------------------------
      case 'settings':
        handlers.onOpenSettings?.();
        break;

      case 'about':
        handlers.onOpenAbout?.();
        break;

      // ---------------------------------------------------------------------
      // Actions not yet implemented
      // ---------------------------------------------------------------------
      case 'undo':
        handlers.onUndo?.();
        break;

      case 'redo':
        handlers.onRedo?.();
        break;

      case 'cut':
      case 'copy':
      case 'paste':
      case 'select_all':
      case 'open':
      case 'save':
      case 'save_as':
      case 'quit':
      case 'close_other_tabs':
      case 'close_all_tabs':
      case 'find':
      case 'find_replace':
      case 'go_to_cell':
      case 'toggle_filter':
      case 'insert_date':
      case 'insert_time':
      case 'zoom_in':
      case 'zoom_out':
      case 'zoom_reset':
      case 'toggle_formulas':
      case 'toggle_fullscreen':
      case 'next_sheet':
      case 'prev_sheet':
      case 'focus_chat':
      case 'check_updates':
        // Not yet implemented
        break;

      default:
        console.warn(`[EventDispatcher] Unknown menu action: ${action}`);
    }
  }

  // -------------------------------------------------------------------------
  // Public Interface
  // -------------------------------------------------------------------------

  return {
    async start() {
      // Only setup Tauri listeners if running in Tauri
      if (typeof window === 'undefined') {
        return;
      }

      // Check for Tauri v2 (uses __TAURI_INTERNALS__) or v1 (uses __TAURI__)
      const hasTauri = '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
      if (!hasTauri) {
        return;
      }

      try {
        unlistenMenu = await listen<MenuAction>('menu-action', (event) => {
          void handleMenuAction(event.payload);
        });
      } catch (error) {
        console.warn('[EventDispatcher] Failed to setup menu listener:', error);
      }
    },

    stop() {
      unlistenMenu?.();
      unlistenMenu = null;
    },

    setHandlers(newHandlers) {
      handlers = newHandlers;
    },
  };
}
