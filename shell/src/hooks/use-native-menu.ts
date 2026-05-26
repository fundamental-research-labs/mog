/**
 * useNativeMenu - Hook for handling native menu events
 *
 * Listens for 'menu-action' events emitted from Rust (menu.rs)
 * and executes the corresponding callback.
 *
 * Usage:
 * ```tsx
 * useNativeMenu({
 *   onNew: () => createNewWorkbook(),
 *   onOpen: () => showOpenDialog(),
 *   onSave: () => saveCurrentFile(),
 * });
 * ```
 */

import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { useEffect, useRef } from 'react';
// TODO: Import from shared types once contracts are migrated
// import type { MenuAction } from '../types/contracts';

// Temporary inline type until contracts are migrated
export type MenuAction =
  | 'new'
  | 'open'
  | 'save'
  | 'save_as'
  | 'close'
  | 'quit'
  | 'find'
  | 'find_replace'
  | 'go_to_cell'
  | 'toggle_filter'
  | 'insert_date'
  | 'insert_time'
  | 'zoom_in'
  | 'zoom_out'
  | 'zoom_reset'
  | 'toggle_formulas'
  | 'toggle_fullscreen'
  | 'next_sheet'
  | 'prev_sheet'
  | 'focus_chat'
  | 'settings'
  | 'about'
  | 'check_updates'
  | 'open_folder'
  | 'close_project'
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
  | 'select_all';

export interface MenuHandlers {
  // File actions
  onNew?: () => void;
  onOpen?: () => void;
  onSave?: () => void;
  onSaveAs?: () => void;
  onClose?: () => void;
  onQuit?: () => void;
  // Edit actions
  onFind?: () => void;
  onFindReplace?: () => void;
  onGoToCell?: () => void;
  onToggleFilter?: () => void;
  onInsertDate?: () => void;
  onInsertTime?: () => void;
  // View actions
  onZoomIn?: () => void;
  onZoomOut?: () => void;
  onZoomReset?: () => void;
  onToggleFormulas?: () => void;
  onToggleFullscreen?: () => void;
  onNextSheet?: () => void;
  onPrevSheet?: () => void;
  // App actions
  onFocusChat?: () => void;
  onSettings?: () => void;
  // Help actions
  onAbout?: () => void;
  onCheckUpdates?: () => void;
  // Project-based multi-file actions (WS-PJ5)
  onOpenFolder?: () => void;
  onCloseProject?: () => void;
  onCloseTab?: () => void;
  onCloseOtherTabs?: () => void;
  onCloseAllTabs?: () => void;
  onNextTab?: () => void;
  onPrevTab?: () => void;
  // Edit actions (undo/redo/clipboard) — menu clicks emit events,
  // keyboard shortcuts handled by webview's shortcut registry
  onUndo?: () => void;
  onRedo?: () => void;
  onCut?: () => void;
  onCopy?: () => void;
  onPaste?: () => void;
  onSelectAll?: () => void;
}

/**
 * Hook to listen for native menu events from Tauri
 *
 * The menu.rs backend emits 'menu-action' events with MenuAction payloads.
 * This hook routes those events to the appropriate callbacks.
 */
export function useNativeMenu(handlers: MenuHandlers) {
  // Use ref to avoid re-subscribing when handlers change
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;

    const setupListener = async () => {
      try {
        unlisten = await listen<MenuAction>('menu-action', (event) => {
          const action = event.payload;
          const h = handlersRef.current;

          console.log(
            '[useNativeMenu] Received menu action:',
            action,
            'handlers:',
            Object.keys(h).filter((k) => h[k as keyof MenuHandlers] != null),
          );

          switch (action) {
            // File actions
            case 'new':
              h.onNew?.();
              break;
            case 'open':
              h.onOpen?.();
              break;
            case 'save':
              h.onSave?.();
              break;
            case 'save_as':
              h.onSaveAs?.();
              break;
            case 'close':
              h.onClose?.();
              break;
            case 'quit':
              h.onQuit?.();
              break;
            // Edit actions
            case 'find':
              h.onFind?.();
              break;
            case 'find_replace':
              h.onFindReplace?.();
              break;
            case 'go_to_cell':
              h.onGoToCell?.();
              break;
            case 'toggle_filter':
              h.onToggleFilter?.();
              break;
            case 'insert_date':
              h.onInsertDate?.();
              break;
            case 'insert_time':
              h.onInsertTime?.();
              break;
            // View actions
            case 'zoom_in':
              h.onZoomIn?.();
              break;
            case 'zoom_out':
              h.onZoomOut?.();
              break;
            case 'zoom_reset':
              h.onZoomReset?.();
              break;
            case 'toggle_formulas':
              h.onToggleFormulas?.();
              break;
            case 'toggle_fullscreen':
              h.onToggleFullscreen?.();
              break;
            case 'next_sheet':
              h.onNextSheet?.();
              break;
            case 'prev_sheet':
              h.onPrevSheet?.();
              break;
            // App actions
            case 'focus_chat':
              h.onFocusChat?.();
              break;
            case 'settings':
              h.onSettings?.();
              break;
            // Help actions
            case 'about':
              h.onAbout?.();
              break;
            case 'check_updates':
              h.onCheckUpdates?.();
              break;
            // Project-based multi-file actions (WS-PJ5)
            case 'open_folder':
              h.onOpenFolder?.();
              break;
            case 'close_project':
              h.onCloseProject?.();
              break;
            case 'close_tab':
              h.onCloseTab?.();
              break;
            case 'close_other_tabs':
              h.onCloseOtherTabs?.();
              break;
            case 'close_all_tabs':
              h.onCloseAllTabs?.();
              break;
            case 'next_tab':
              h.onNextTab?.();
              break;
            case 'prev_tab':
              h.onPrevTab?.();
              break;
            // Edit actions (undo/redo/clipboard)
            case 'undo':
              h.onUndo?.();
              break;
            case 'redo':
              h.onRedo?.();
              break;
            case 'cut':
              h.onCut?.();
              break;
            case 'copy':
              h.onCopy?.();
              break;
            case 'paste':
              h.onPaste?.();
              break;
            case 'select_all':
              h.onSelectAll?.();
              break;

            default:
              console.warn(`[useNativeMenu] Unknown menu action: ${action}`);
          }
        });
      } catch (error) {
        // Tauri APIs may not be available in browser dev mode
        console.warn('[useNativeMenu] Failed to setup menu listener:', error);
      }
    };

    setupListener();

    return () => {
      unlisten?.();
    };
  }, []);
}
