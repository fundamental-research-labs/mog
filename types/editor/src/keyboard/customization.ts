/**
 * @file Keyboard Customization Types and Utilities
 *
 * Types for user customization of keyboard shortcuts.
 */

import type { KeyboardShortcut, PlatformKeyBindings, ShortcutContext } from './shortcuts/types';
import type { Platform } from './physical-keys';

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
 * Type for built-in profile IDs.
 */
export type BuiltInProfileId = 'excel-default' | 'google-sheets';

// =============================================================================
// Profile Serialization Types
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

// =============================================================================
// Conflict Detection Types
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
