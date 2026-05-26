/**
 * Global Shortcuts Service — OS-level hotkeys via Tauri plugin.
 *
 * Desktop: wraps @tauri-apps/plugin-global-shortcut to register
 * hotkeys that work even when the app is not focused.
 *
 * Web: factory returns null (global shortcuts are a desktop-only capability).
 *
 * Registration can fail if another application already owns the key combination.
 * Failures are logged as warnings and skipped — the in-app shortcut still works,
 * only the OS-level registration is lost.
 *
 */

import type { IDisposable } from '@mog-sdk/contracts/core';
import type { ModifierKey, PhysicalKeyBinding } from '@mog-sdk/contracts/keyboard';
import { isTauri } from '../tauri/detection';

// =============================================================================
// Accelerator String Conversion
// =============================================================================

/**
 * Map modifier keys to Tauri accelerator modifier names.
 *
 * Uses 'CmdOrCtrl' for ctrl — Tauri maps this to Cmd on macOS and Ctrl elsewhere.
 * This matches the cross-platform shortcut pattern used throughout the app.
 */
const MODIFIER_TO_ACCELERATOR: Record<ModifierKey, string> = {
  ctrl: 'CmdOrCtrl',
  shift: 'Shift',
  alt: 'Alt',
  meta: 'Super',
};

/**
 * Map physical key codes to Tauri accelerator key names.
 *
 * Only maps keys that differ from the simple stripping logic.
 * For letter keys (KeyA-KeyZ), we strip the "Key" prefix.
 * For digit keys (Digit0-Digit9), we strip the "Digit" prefix.
 * For F-keys, numpad, and special keys, we map explicitly.
 */
const KEY_CODE_TO_ACCELERATOR: Partial<Record<string, string>> = {
  // Navigation
  ArrowUp: 'Up',
  ArrowDown: 'Down',
  ArrowLeft: 'Left',
  ArrowRight: 'Right',
  // Editing
  Backspace: 'Backspace',
  Delete: 'Delete',
  Enter: 'Return',
  Tab: 'Tab',
  Escape: 'Escape',
  Space: 'Space',
  // Punctuation
  Minus: '-',
  Equal: '=',
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Semicolon: ';',
  Quote: "'",
  Comma: ',',
  Period: '.',
  Slash: '/',
  Backquote: '`',
};

/**
 * Convert a PhysicalKeyBinding to a Tauri accelerator string.
 *
 * @example
 * toAcceleratorString({ code: 'KeyS', modifiers: ['ctrl'] })
 * // => 'CmdOrCtrl+S'
 *
 * toAcceleratorString({ code: 'KeyZ', modifiers: ['ctrl', 'shift'] })
 * // => 'CmdOrCtrl+Shift+Z'
 */
export function toAcceleratorString(binding: PhysicalKeyBinding): string {
  const parts: string[] = [];

  // Add modifiers in consistent order
  const modifierOrder: ModifierKey[] = ['ctrl', 'alt', 'shift', 'meta'];
  for (const mod of modifierOrder) {
    if (binding.modifiers.includes(mod)) {
      parts.push(MODIFIER_TO_ACCELERATOR[mod]);
    }
  }

  // Convert key code to accelerator key name
  const code = binding.code as string;
  let keyName: string;

  if (code in KEY_CODE_TO_ACCELERATOR) {
    keyName = KEY_CODE_TO_ACCELERATOR[code]!;
  } else if (code.startsWith('Key') && code.length === 4) {
    // KeyA -> A, KeyZ -> Z
    keyName = code.slice(3);
  } else if (code.startsWith('Digit') && code.length === 6) {
    // Digit0 -> 0, Digit9 -> 9
    keyName = code.slice(5);
  } else if (code.startsWith('F') && /^F\d{1,2}$/.test(code)) {
    // F1 -> F1, F12 -> F12
    keyName = code;
  } else if (code.startsWith('Numpad')) {
    // Numpad0 -> num0, NumpadAdd -> numadd, etc.
    keyName = 'num' + code.slice(6).toLowerCase();
  } else {
    // Fallback: use the code as-is
    keyName = code;
  }

  parts.push(keyName);
  return parts.join('+');
}

// =============================================================================
// GlobalShortcutService
// =============================================================================

/**
 * Service for registering OS-level global shortcuts via Tauri.
 *
 * Implements IDisposable for cleanup on app close / HMR.
 */
export class GlobalShortcutService implements IDisposable {
  private readonly unsubscribers: Array<() => void> = [];
  private disposed = false;

  /**
   * Reference to the Tauri global shortcut plugin module.
   * Lazy-loaded on first register() call.
   */
  private pluginModule: TauriGlobalShortcutPlugin | null = null;

  /**
   * Register a global (OS-level) shortcut.
   *
   * If registration fails (e.g., another app owns the combo), logs a warning
   * and returns a no-op unsubscribe function. The in-app shortcut still works.
   *
   * @param binding - The physical key binding to register
   * @param callback - Function to call when the shortcut is triggered
   * @returns Unsubscribe function to remove this registration
   */
  async register(binding: PhysicalKeyBinding, callback: () => void): Promise<() => void> {
    if (this.disposed) {
      console.warn('[GlobalShortcutService] Cannot register — service is disposed');
      return () => {};
    }

    const accelerator = toAcceleratorString(binding);

    try {
      const plugin = await this.getPlugin();
      if (!plugin) {
        return () => {};
      }

      await plugin.register(accelerator, callback);

      const unsubscribe = () => {
        plugin.unregister(accelerator).catch((err: unknown) => {
          console.warn(`[GlobalShortcutService] Failed to unregister '${accelerator}':`, err);
        });
        const idx = this.unsubscribers.indexOf(unsubscribe);
        if (idx >= 0) this.unsubscribers.splice(idx, 1);
      };

      this.unsubscribers.push(unsubscribe);
      return unsubscribe;
    } catch (err) {
      console.warn(`[GlobalShortcutService] Failed to register '${accelerator}':`, err);
      return () => {};
    }
  }

  /**
   * Dispose the service and unregister all global shortcuts.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Use unregisterAll for bulk cleanup
    if (this.pluginModule) {
      this.pluginModule.unregisterAll().catch((err: unknown) => {
        console.warn('[GlobalShortcutService] Failed to unregisterAll:', err);
      });
    }

    this.unsubscribers.length = 0;
  }

  [Symbol.dispose](): void {
    this.dispose();
  }

  /**
   * Lazy-load the Tauri global shortcut plugin.
   */
  private async getPlugin(): Promise<TauriGlobalShortcutPlugin | null> {
    if (this.pluginModule) return this.pluginModule;
    try {
      const mod = await import('@tauri-apps/plugin-global-shortcut');
      this.pluginModule = mod;
      return mod;
    } catch {
      console.warn('[GlobalShortcutService] @tauri-apps/plugin-global-shortcut not available');
      return null;
    }
  }
}

// =============================================================================
// Plugin Type (minimal shape for dynamic import)
// =============================================================================

interface TauriGlobalShortcutPlugin {
  register(shortcut: string, handler: () => void): Promise<void>;
  unregister(shortcut: string): Promise<void>;
  unregisterAll(): Promise<void>;
}

// =============================================================================
// Factory
// =============================================================================

/**
 * Create a GlobalShortcutService if running on desktop, or null on web.
 *
 * @returns GlobalShortcutService on desktop, null on web
 */
export function createGlobalShortcutService(): GlobalShortcutService | null {
  if (!isTauri()) {
    return null;
  }
  return new GlobalShortcutService();
}
