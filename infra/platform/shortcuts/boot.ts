/**
 * Global Shortcuts Boot Wiring
 *
 * Registers shortcuts marked `global: true` as OS-level hotkeys at app boot.
 * Desktop only — returns a no-op disposable on web.
 *
 * Usage at app boot:
 * ```ts
 * const globalShortcuts = await bootGlobalShortcuts(shortcuts, onAction);
 * // ... on app close:
 * globalShortcuts.dispose();
 * ```
 *
 */

import type { IDisposable } from '@mog-sdk/contracts/core';
import type {
  KeyboardShortcut,
  ModifierKey,
  PhysicalKeyBinding,
  PlatformKeyBindings,
  Platform,
} from '@mog-sdk/contracts/keyboard';
import { DisposableNone } from '@mog/spreadsheet-utils/disposable';
import { createGlobalShortcutService } from './global-shortcuts';

/**
 * Register all `global: true` shortcuts as OS-level hotkeys.
 *
 * @param shortcuts - All keyboard shortcuts (will be filtered to global ones)
 * @param onAction - Callback invoked with the shortcut's action string when triggered
 * @param platform - Current platform for resolving platform-specific bindings
 * @returns IDisposable that unregisters all global shortcuts on dispose
 */
export async function bootGlobalShortcuts(
  shortcuts: readonly KeyboardShortcut[],
  onAction: (action: string, shortcut: KeyboardShortcut) => void,
  platform: Platform,
): Promise<IDisposable> {
  const service = createGlobalShortcutService();
  if (!service) {
    // Web — global shortcuts not available
    return DisposableNone;
  }

  const globalShortcuts = shortcuts.filter((s) => s.global && s.enabled);

  for (const shortcut of globalShortcuts) {
    const binding: PhysicalKeyBinding = resolveBinding(shortcut.bindings, platform);
    await service.register(binding, () => {
      onAction(shortcut.action, shortcut);
    });
  }

  return service;
}

function resolveBinding(bindings: PlatformKeyBindings, platform: Platform): PhysicalKeyBinding {
  switch (platform) {
    case 'macos':
      return bindings.macos ?? convertCtrlToMeta(bindings.default);
    case 'windows':
      return bindings.windows ?? bindings.default;
    case 'linux':
      return bindings.linux ?? bindings.default;
  }
}

function convertCtrlToMeta(binding: PhysicalKeyBinding): PhysicalKeyBinding {
  if (!binding.modifiers.includes('ctrl')) return binding;
  return {
    code: binding.code,
    modifiers: Object.freeze(
      binding.modifiers.map((modifier) => (modifier === 'ctrl' ? 'meta' : modifier)),
    ) as readonly ModifierKey[],
  };
}
