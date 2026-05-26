/**
 * @file Keyboard Customization Types and Utilities
 *
 * Types and functions for user customization of keyboard shortcuts,
 * including custom bindings, profiles, and conflict detection.
 */

import {
  bindingsEqual,
  resolveBinding,
  type PhysicalKeyBinding,
  type Platform,
  type PlatformKeyBindings,
} from '@mog-sdk/kernel/keyboard';
import type { KeyboardShortcut, ShortcutContext } from './types';

// =============================================================================
// Custom Binding Types
// =============================================================================

/**
 * A user-defined custom binding for a shortcut.
 *
 * Custom bindings can override the default binding, add platform-specific
 * overrides, or disable the shortcut entirely.
 */
export interface CustomBinding {
  /**
   * The ID of the shortcut being customized.
   */
  readonly shortcutId: string;

  /**
   * The custom key bindings.
   *
   * Partial allows overriding just specific platforms.
   */
  readonly bindings: Partial<PlatformKeyBindings>;

  /**
   * Whether this shortcut is disabled.
   *
   * If true, the shortcut will not trigger regardless of bindings.
   */
  readonly disabled?: boolean;
}

// =============================================================================
// Keyboard Profile Types
// =============================================================================

/**
 * A keyboard profile containing user customizations.
 *
 * Profiles allow users to save and switch between different keyboard
 * configurations (e.g., Excel-style, Google Sheets-style, custom).
 */
export interface KeyboardProfile {
  /**
   * Unique identifier for this profile.
   */
  readonly id: string;

  /**
   * Human-readable name for display.
   */
  readonly name: string;

  /**
   * Custom bindings in this profile.
   *
   * Map from shortcut ID to custom binding.
   */
  readonly customBindings: ReadonlyMap<string, CustomBinding>;

  /**
   * When this profile was created.
   */
  readonly createdAt: Date;

  /**
   * When this profile was last modified.
   */
  readonly modifiedAt: Date;
}

/**
 * Built-in profile identifiers.
 */
export const BUILT_IN_PROFILES = {
  /** Default Excel-compatible shortcuts */
  excel: 'excel-default',
  /** Google Sheets-style shortcuts */
  googleSheets: 'google-sheets',
} as const;

/**
 * Type for built-in profile IDs.
 */
export type BuiltInProfileId = (typeof BUILT_IN_PROFILES)[keyof typeof BUILT_IN_PROFILES];

// =============================================================================
// Profile Application
// =============================================================================

/**
 * Apply custom bindings from a profile to default shortcuts.
 *
 * Returns a new map of shortcuts with customizations applied.
 * Does not mutate the input shortcuts.
 *
 * @param defaults - The default shortcut definitions
 * @param profile - The profile containing customizations
 * @returns New map with customizations applied
 *
 * @example
 * ```ts
 * const customized = applyCustomizations(defaultShortcuts, userProfile);
 * // customized contains shortcuts with user's custom bindings
 * ```
 */
export function applyCustomizations(
  defaults: ReadonlyMap<string, KeyboardShortcut>,
  profile: KeyboardProfile,
): Map<string, KeyboardShortcut> {
  const result = new Map<string, KeyboardShortcut>();

  for (const [id, shortcut] of defaults) {
    const custom = profile.customBindings.get(id);

    if (!custom) {
      // No customization, use default
      result.set(id, shortcut);
      continue;
    }

    // Apply customization
    const customized: KeyboardShortcut = {
      ...shortcut,
      bindings: mergeBindings(shortcut.bindings, custom.bindings),
      enabled: custom.disabled ? false : shortcut.enabled,
    };

    result.set(id, customized);
  }

  return result;
}

/**
 * Merge custom bindings with default bindings.
 *
 * Custom bindings override defaults for any platform they specify.
 *
 * @param defaults - The default bindings
 * @param custom - The custom binding overrides
 * @returns Merged bindings
 * @internal
 */
function mergeBindings(
  defaults: PlatformKeyBindings,
  custom: Partial<PlatformKeyBindings>,
): PlatformKeyBindings {
  return {
    default: custom.default ?? defaults.default,
    macos: custom.macos ?? defaults.macos,
    windows: custom.windows ?? defaults.windows,
    linux: custom.linux ?? defaults.linux,
  };
}

// =============================================================================
// Profile Serialization
// =============================================================================

/**
 * Serialized format for a keyboard profile.
 *
 * Used for storing profiles in localStorage or exporting/importing.
 */
export interface SerializedProfile {
  id: string;
  name: string;
  customBindings: Array<{
    shortcutId: string;
    bindings: {
      default?: { code: string; modifiers: string[] };
      macos?: { code: string; modifiers: string[] };
      windows?: { code: string; modifiers: string[] };
      linux?: { code: string; modifiers: string[] };
    };
    disabled?: boolean;
  }>;
  createdAt: string;
  modifiedAt: string;
}

/**
 * Export a profile to a serializable format.
 *
 * @param profile - The profile to export
 * @returns Serialized profile data
 */
export function exportProfile(profile: KeyboardProfile): SerializedProfile {
  const customBindings: SerializedProfile['customBindings'] = [];

  for (const [_id, custom] of profile.customBindings) {
    const serializedBindings: SerializedProfile['customBindings'][0]['bindings'] = {};

    if (custom.bindings.default) {
      serializedBindings.default = {
        code: custom.bindings.default.code,
        modifiers: [...custom.bindings.default.modifiers],
      };
    }
    if (custom.bindings.macos) {
      serializedBindings.macos = {
        code: custom.bindings.macos.code,
        modifiers: [...custom.bindings.macos.modifiers],
      };
    }
    if (custom.bindings.windows) {
      serializedBindings.windows = {
        code: custom.bindings.windows.code,
        modifiers: [...custom.bindings.windows.modifiers],
      };
    }
    if (custom.bindings.linux) {
      serializedBindings.linux = {
        code: custom.bindings.linux.code,
        modifiers: [...custom.bindings.linux.modifiers],
      };
    }

    customBindings.push({
      shortcutId: custom.shortcutId,
      bindings: serializedBindings,
      disabled: custom.disabled,
    });
  }

  return {
    id: profile.id,
    name: profile.name,
    customBindings,
    createdAt: profile.createdAt.toISOString(),
    modifiedAt: profile.modifiedAt.toISOString(),
  };
}

/**
 * Import a profile from serialized data.
 *
 * @param json - The serialized profile data
 * @returns The imported profile, or null if invalid
 */
export function importProfile(json: SerializedProfile): KeyboardProfile | null {
  try {
    const customBindings = new Map<string, CustomBinding>();

    for (const entry of json.customBindings) {
      // Build bindings object - we construct it completely then assign
      const defaultBinding = entry.bindings.default
        ? {
            code: entry.bindings.default.code as PhysicalKeyBinding['code'],
            modifiers: Object.freeze(
              entry.bindings.default.modifiers as PhysicalKeyBinding['modifiers'],
            ),
          }
        : undefined;

      const macBinding = entry.bindings.macos
        ? {
            code: entry.bindings.macos.code as PhysicalKeyBinding['code'],
            modifiers: Object.freeze(
              entry.bindings.macos.modifiers as PhysicalKeyBinding['modifiers'],
            ),
          }
        : undefined;

      const windowsBinding = entry.bindings.windows
        ? {
            code: entry.bindings.windows.code as PhysicalKeyBinding['code'],
            modifiers: Object.freeze(
              entry.bindings.windows.modifiers as PhysicalKeyBinding['modifiers'],
            ),
          }
        : undefined;

      const linuxBinding = entry.bindings.linux
        ? {
            code: entry.bindings.linux.code as PhysicalKeyBinding['code'],
            modifiers: Object.freeze(
              entry.bindings.linux.modifiers as PhysicalKeyBinding['modifiers'],
            ),
          }
        : undefined;

      // Construct the bindings object
      const bindings: Partial<PlatformKeyBindings> = {
        ...(defaultBinding && { default: defaultBinding }),
        ...(macBinding && { macos: macBinding }),
        ...(windowsBinding && { windows: windowsBinding }),
        ...(linuxBinding && { linux: linuxBinding }),
      };

      customBindings.set(entry.shortcutId, {
        shortcutId: entry.shortcutId,
        bindings,
        disabled: entry.disabled,
      });
    }

    return {
      id: json.id,
      name: json.name,
      customBindings,
      createdAt: new Date(json.createdAt),
      modifiedAt: new Date(json.modifiedAt),
    };
  } catch {
    return null;
  }
}

// =============================================================================
// Conflict Detection
// =============================================================================

/**
 * Result of a conflict detection check.
 */
export interface ConflictResult {
  /**
   * Whether a conflict was detected.
   */
  readonly hasConflict: boolean;

  /**
   * The shortcut that conflicts, if any.
   */
  readonly conflictingShortcut?: KeyboardShortcut;

  /**
   * The platform(s) where the conflict occurs.
   */
  readonly platforms?: readonly Platform[];

  /**
   * The context(s) where the conflict occurs.
   */
  readonly contexts?: readonly ShortcutContext[];
}

/**
 * No conflict result constant.
 */
const NO_CONFLICT: ConflictResult = { hasConflict: false };

/**
 * Detect if a new binding conflicts with existing shortcuts.
 *
 * Two shortcuts conflict if they have the same binding on any platform
 * AND share at least one context (both could be active at the same time).
 *
 * @param shortcuts - The existing shortcuts to check against
 * @param newBinding - The new binding to check
 * @param excludeId - Shortcut ID to exclude (for editing existing shortcuts)
 * @param context - Optional context to limit conflict checking
 * @returns Conflict result
 *
 * @example
 * ```ts
 * const conflict = detectConflict(
 * shortcuts,
 * { code: 'KeyS', modifiers: ['ctrl'] },
 * 'file.save', // Exclude the shortcut we're editing
 * 'global'
 * );
 *
 * if (conflict.hasConflict) {
 * console.log(`Conflicts with ${conflict.conflictingShortcut.description}`);
 * }
 * ```
 */
export function detectConflict(
  shortcuts: ReadonlyMap<string, KeyboardShortcut>,
  newBinding: PhysicalKeyBinding,
  excludeId?: string,
  context?: ShortcutContext,
): ConflictResult {
  const conflictPlatforms: Platform[] = [];
  const conflictContexts: ShortcutContext[] = [];
  let conflictingShortcut: KeyboardShortcut | undefined;

  for (const [id, shortcut] of shortcuts) {
    // Skip the shortcut we're editing
    if (id === excludeId) continue;

    // Skip disabled shortcuts
    if (!shortcut.enabled) continue;

    // Check if contexts overlap
    if (context && !shortcut.contexts.includes(context) && !shortcut.contexts.includes('any')) {
      continue;
    }

    // Check each platform for binding match
    const platforms: Platform[] = ['macos', 'windows', 'linux'];
    for (const platform of platforms) {
      const existingBinding = resolveBinding(shortcut.bindings, platform);
      if (bindingsEqual(existingBinding, newBinding)) {
        conflictPlatforms.push(platform);
        conflictingShortcut = shortcut;

        // Record overlapping contexts
        for (const ctx of shortcut.contexts) {
          if (!conflictContexts.includes(ctx)) {
            if (context === undefined || ctx === context || ctx === 'any') {
              conflictContexts.push(ctx);
            }
          }
        }
      }
    }
  }

  if (conflictingShortcut) {
    return {
      hasConflict: true,
      conflictingShortcut,
      platforms: Object.freeze(conflictPlatforms),
      contexts: Object.freeze(conflictContexts),
    };
  }

  return NO_CONFLICT;
}

/**
 * Find all shortcuts that use a specific binding.
 *
 * Useful for showing what a key combination currently does.
 *
 * @param shortcuts - The shortcuts to search
 * @param binding - The binding to find
 * @param platform - Optional platform to check (checks all if not specified)
 * @returns Array of shortcuts using this binding
 */
export function findShortcutsByBinding(
  shortcuts: ReadonlyMap<string, KeyboardShortcut>,
  binding: PhysicalKeyBinding,
  platform?: Platform,
): KeyboardShortcut[] {
  const results: KeyboardShortcut[] = [];
  const platforms: Platform[] = platform ? [platform] : ['macos', 'windows', 'linux'];

  for (const shortcut of shortcuts.values()) {
    if (!shortcut.enabled) continue;

    for (const p of platforms) {
      const shortcutBinding = resolveBinding(shortcut.bindings, p);
      if (bindingsEqual(shortcutBinding, binding)) {
        results.push(shortcut);
        break; // Don't add same shortcut multiple times
      }
    }
  }

  return results;
}

// =============================================================================
// Profile Creation Utilities
// =============================================================================

/**
 * Create a new empty keyboard profile.
 *
 * @param id - Unique identifier
 * @param name - Display name
 * @returns New empty profile
 */
export function createProfile(id: string, name: string): KeyboardProfile {
  const now = new Date();
  return {
    id,
    name,
    customBindings: new Map(),
    createdAt: now,
    modifiedAt: now,
  };
}

/**
 * Create a copy of a profile with a new ID.
 *
 * @param source - The profile to copy
 * @param newId - The new profile ID
 * @param newName - Optional new name (defaults to "Copy of {name}")
 * @returns The copied profile
 */
export function copyProfile(
  source: KeyboardProfile,
  newId: string,
  newName?: string,
): KeyboardProfile {
  const now = new Date();
  return {
    id: newId,
    name: newName ?? `Copy of ${source.name}`,
    customBindings: new Map(source.customBindings),
    createdAt: now,
    modifiedAt: now,
  };
}

/**
 * Update a profile with a new custom binding.
 *
 * Returns a new profile object (immutable update).
 *
 * @param profile - The profile to update
 * @param custom - The custom binding to add/update
 * @returns New profile with the binding updated
 */
export function updateProfileBinding(
  profile: KeyboardProfile,
  custom: CustomBinding,
): KeyboardProfile {
  const newBindings = new Map(profile.customBindings);
  newBindings.set(custom.shortcutId, custom);

  return {
    ...profile,
    customBindings: newBindings,
    modifiedAt: new Date(),
  };
}

/**
 * Remove a custom binding from a profile.
 *
 * Returns a new profile object (immutable update).
 *
 * @param profile - The profile to update
 * @param shortcutId - The shortcut ID to remove customization for
 * @returns New profile with the binding removed
 */
export function removeProfileBinding(
  profile: KeyboardProfile,
  shortcutId: string,
): KeyboardProfile {
  const newBindings = new Map(profile.customBindings);
  newBindings.delete(shortcutId);

  return {
    ...profile,
    customBindings: newBindings,
    modifiedAt: new Date(),
  };
}
