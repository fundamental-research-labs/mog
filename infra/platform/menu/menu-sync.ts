/**
 * Menu Shortcut Sync — Keeps Tauri native menu accelerators in sync with the JS shortcut registry.
 *
 * On desktop (Tauri): converts shortcut bindings to Tauri accelerator strings,
 * then calls the `set_menu_items` IPC command to rebuild the native menu.
 *
 * On web: not instantiated (no native menu).
 *
 */

import { invoke } from '@tauri-apps/api/core';

import type { PlatformIdentity } from '@mog-sdk/contracts/platform';
import type {
  KeyboardShortcut,
  ModifierKey,
  PhysicalKeyBinding,
  ShortcutRegistry,
} from '@mog-sdk/contracts/keyboard';
import { DisposableBase } from '@mog/spreadsheet-utils/disposable';

// =============================================================================
// Types
// =============================================================================

/**
 * A menu item sent to the Rust backend via IPC.
 *
 * Matches the `MenuItemInput` struct in menu.rs.
 */
export interface MenuItemInput {
  /** Unique ID for the menu item (used in menu-action events) */
  readonly id: string;
  /** Display label in the menu */
  readonly label: string;
  /** Tauri accelerator string (e.g., 'CmdOrCtrl+S') or null for no accelerator */
  readonly accelerator: string | null;
  /** Whether the menu item is enabled/clickable */
  readonly enabled: boolean;
  /** Which submenu this item belongs to */
  readonly submenu: 'file' | 'edit' | 'view';
}

/**
 * Maps a shortcut action to its menu representation.
 *
 * Only shortcuts that have corresponding menu items are included here.
 * OS-standard items (About, Quit, Hide, etc.) are NOT included because
 * they are always hardcoded in Rust.
 *
 * Edit actions (undo/redo/clipboard) are NOT included here because they use
 * custom MenuItem entries with no accelerators — keyboard shortcuts for these
 * are handled entirely by the webview's shortcut registry.
 */
interface MenuShortcutMapping {
  /** The shortcut ID in the registry */
  shortcutId: string;
  /** The menu item ID (matches menu.rs event IDs) */
  menuId: string;
  /** Display label in the menu */
  label: string;
  /** Which submenu this belongs to */
  submenu: 'file' | 'edit' | 'view';
}

// =============================================================================
// Shortcut-to-Menu Mapping
// =============================================================================

/**
 * Maps keyboard shortcut IDs to their menu item representations.
 *
 * Only app-specific menu items that come from the shortcut registry.
 * OS-standard items (About, Quit, Preferences, Hide, Minimize) are
 * hardcoded in Rust. Edit actions (undo/redo/clipboard) use custom
 * MenuItem entries without accelerators.
 */
const MENU_SHORTCUT_MAPPINGS: MenuShortcutMapping[] = [
  // File menu
  { shortcutId: 'new-workbook', menuId: 'new', label: 'New', submenu: 'file' },
  { shortcutId: 'open', menuId: 'open', label: 'Open...', submenu: 'file' },
  { shortcutId: 'save', menuId: 'save', label: 'Save', submenu: 'file' },
  { shortcutId: 'save-as', menuId: 'save_as', label: 'Save As...', submenu: 'file' },
  { shortcutId: 'close-tab', menuId: 'close_tab', label: 'Close File', submenu: 'file' },

  // Edit menu (undo/redo/clipboard not included — no accelerators by design)
  { shortcutId: 'find', menuId: 'find', label: 'Find...', submenu: 'edit' },
  {
    shortcutId: 'find-replace',
    menuId: 'find_replace',
    label: 'Find and Replace...',
    submenu: 'edit',
  },
  { shortcutId: 'go-to-cell', menuId: 'go_to_cell', label: 'Go to Cell...', submenu: 'edit' },
  { shortcutId: 'toggle-filter', menuId: 'toggle_filter', label: 'Toggle Filter', submenu: 'edit' },
  {
    shortcutId: 'insert-date',
    menuId: 'insert_date',
    label: 'Insert Current Date',
    submenu: 'edit',
  },
  {
    shortcutId: 'insert-time',
    menuId: 'insert_time',
    label: 'Insert Current Time',
    submenu: 'edit',
  },

  // View menu
  { shortcutId: 'zoom-in', menuId: 'zoom_in', label: 'Zoom In', submenu: 'view' },
  { shortcutId: 'zoom-out', menuId: 'zoom_out', label: 'Zoom Out', submenu: 'view' },
  { shortcutId: 'zoom-reset', menuId: 'zoom_reset', label: 'Reset Zoom', submenu: 'view' },
  {
    shortcutId: 'show-formulas',
    menuId: 'toggle_formulas',
    label: 'Show Formulas',
    submenu: 'view',
  },
  { shortcutId: 'focus-chat', menuId: 'focus_chat', label: 'Focus AI Chat', submenu: 'view' },
  { shortcutId: 'next-sheet', menuId: 'next_sheet', label: 'Next Sheet', submenu: 'view' },
  { shortcutId: 'prev-sheet', menuId: 'prev_sheet', label: 'Previous Sheet', submenu: 'view' },
];

// =============================================================================
// Accelerator String Generation
// =============================================================================

/**
 * Physical key code to Tauri accelerator key name mapping.
 *
 * Tauri uses a specific set of key names for accelerators.
 * @see https://docs.rs/tauri/latest/tauri/menu/struct.MenuItem.html
 */
const CODE_TO_ACCELERATOR: Record<string, string> = {
  // Letters
  KeyA: 'A',
  KeyB: 'B',
  KeyC: 'C',
  KeyD: 'D',
  KeyE: 'E',
  KeyF: 'F',
  KeyG: 'G',
  KeyH: 'H',
  KeyI: 'I',
  KeyJ: 'J',
  KeyK: 'K',
  KeyL: 'L',
  KeyM: 'M',
  KeyN: 'N',
  KeyO: 'O',
  KeyP: 'P',
  KeyQ: 'Q',
  KeyR: 'R',
  KeyS: 'S',
  KeyT: 'T',
  KeyU: 'U',
  KeyV: 'V',
  KeyW: 'W',
  KeyX: 'X',
  KeyY: 'Y',
  KeyZ: 'Z',
  // Digits
  Digit0: '0',
  Digit1: '1',
  Digit2: '2',
  Digit3: '3',
  Digit4: '4',
  Digit5: '5',
  Digit6: '6',
  Digit7: '7',
  Digit8: '8',
  Digit9: '9',
  // F-keys
  F1: 'F1',
  F2: 'F2',
  F3: 'F3',
  F4: 'F4',
  F5: 'F5',
  F6: 'F6',
  F7: 'F7',
  F8: 'F8',
  F9: 'F9',
  F10: 'F10',
  F11: 'F11',
  F12: 'F12',
  // Special keys
  Enter: 'Enter',
  Escape: 'Escape',
  Space: 'Space',
  Tab: 'Tab',
  Backspace: 'Backspace',
  Delete: 'Delete',
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  Home: 'Home',
  End: 'End',
  PageUp: 'PageUp',
  PageDown: 'PageDown',
  // Punctuation
  Semicolon: ';',
  Equal: '=',
  Minus: '-',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Quote: "'",
};

/**
 * Convert a modifier key to its Tauri accelerator string.
 *
 * Uses 'CmdOrCtrl' for 'ctrl' and 'meta' to get cross-platform behavior
 * (Cmd on macOS, Ctrl on Windows/Linux).
 */
function modifierToAccelerator(modifier: ModifierKey, os: PlatformIdentity['os']): string {
  switch (modifier) {
    case 'ctrl':
      return os === 'macos' ? 'Ctrl' : 'CmdOrCtrl';
    case 'meta':
      return os === 'macos' ? 'CmdOrCtrl' : 'Super';
    case 'shift':
      return 'Shift';
    case 'alt':
      return os === 'macos' ? 'Option' : 'Alt';
    default:
      return modifier;
  }
}

/**
 * Resolve a shortcut's binding for the given platform.
 */
function resolveBinding(
  shortcut: KeyboardShortcut,
  os: PlatformIdentity['os'],
): PhysicalKeyBinding | null {
  const bindings = shortcut.bindings;
  switch (os) {
    case 'macos':
      return bindings.macos ?? bindings.default;
    case 'windows':
      return bindings.windows ?? bindings.default;
    case 'linux':
      return bindings.linux ?? bindings.default;
  }
}

/**
 * Convert a PhysicalKeyBinding to a Tauri accelerator string.
 *
 * Examples:
 * - { code: 'KeyS', modifiers: ['ctrl'] } on macOS  => 'CmdOrCtrl+S'
 * - { code: 'KeyS', modifiers: ['meta'] } on macOS  => 'CmdOrCtrl+S'
 * - { code: 'KeyS', modifiers: ['ctrl'] } on win    => 'CmdOrCtrl+S'
 * - { code: 'KeyZ', modifiers: ['ctrl', 'shift'] }  => 'CmdOrCtrl+Shift+Z'
 * - { code: 'F11', modifiers: [] }                   => 'F11'
 *
 * Returns null if the key code is not recognized.
 */
export function bindingToAccelerator(
  binding: PhysicalKeyBinding,
  os: PlatformIdentity['os'],
): string | null {
  const keyName = CODE_TO_ACCELERATOR[binding.code];
  if (!keyName) return null;

  const parts: string[] = [];

  // Add modifiers in standard order: CmdOrCtrl, Shift, Alt/Option
  // Tauri expects a specific order for best display
  const modOrder: ModifierKey[] = ['ctrl', 'meta', 'shift', 'alt'];
  for (const mod of modOrder) {
    if (binding.modifiers.includes(mod)) {
      parts.push(modifierToAccelerator(mod, os));
    }
  }

  parts.push(keyName);
  return parts.join('+');
}

/**
 * Convert a keyboard shortcut to a Tauri accelerator string.
 *
 * Resolves the platform-specific binding first, then converts.
 * Returns null if no binding can be resolved or key is unknown.
 */
export function shortcutToAccelerator(
  shortcut: KeyboardShortcut,
  os: PlatformIdentity['os'],
): string | null {
  const binding = resolveBinding(shortcut, os);
  if (!binding) return null;
  return bindingToAccelerator(binding, os);
}

// =============================================================================
// MenuShortcutSync Service
// =============================================================================

/**
 * Synchronizes keyboard shortcuts with Tauri's native menu.
 *
 * On each sync(), it:
 * 1. Reads the current shortcut registry
 * 2. Converts matching shortcuts to Tauri accelerator strings
 * 3. Sends the menu items to Rust via IPC to rebuild the native menu
 *
 * OS-standard items (About, Quit, Hide, Minimize) are always hardcoded in
 * Rust. Edit actions (undo/redo/clipboard) use custom MenuItem entries
 * without accelerators and are not synced.
 */
export class MenuShortcutSync extends DisposableBase {
  private _getShortcuts: () => ShortcutRegistry;
  private _os: PlatformIdentity['os'];

  constructor(getShortcuts: () => ShortcutRegistry, os: PlatformIdentity['os']) {
    super();
    this._getShortcuts = getShortcuts;
    this._os = os;
  }

  /**
   * Push current shortcuts to Tauri menu.
   *
   * Call after registry is built and whenever shortcuts change
   * (e.g., user customization).
   */
  async sync(): Promise<void> {
    this.throwIfDisposed();

    const shortcuts = this._getShortcuts();
    const menuItems = this._buildMenuItems(shortcuts);

    try {
      await invoke('set_menu_items', { items: menuItems });
    } catch (err) {
      // Log but don't throw — menu sync failure should not crash the app
      console.warn('[MenuShortcutSync] Failed to sync menu:', err);
    }
  }

  /**
   * Build the menu item list from shortcuts.
   */
  private _buildMenuItems(shortcuts: ShortcutRegistry): MenuItemInput[] {
    const items: MenuItemInput[] = [];

    for (const mapping of MENU_SHORTCUT_MAPPINGS) {
      const shortcut = shortcuts.get(mapping.shortcutId);
      const accelerator = shortcut ? shortcutToAccelerator(shortcut, this._os) : null;

      items.push({
        id: mapping.menuId,
        label: mapping.label,
        accelerator,
        enabled: shortcut?.enabled ?? true,
        submenu: mapping.submenu,
      });
    }

    return items;
  }

  protected _dispose(): void {
    // No active subscriptions to clean up.
    // The caller is responsible for unsubscribing from store changes.
  }
}

/**
 * Create a MenuShortcutSync if running on desktop, or null on web.
 *
 * This factory prevents the service from being instantiated on web
 * where there is no native menu.
 */
export function createMenuShortcutSync(
  identity: PlatformIdentity,
  getShortcuts: () => ShortcutRegistry,
): MenuShortcutSync | null {
  if (identity.runtime !== 'desktop') return null;
  return new MenuShortcutSync(getShortcuts, identity.os);
}
