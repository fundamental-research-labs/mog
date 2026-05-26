/**
 * Keyboard Settings Store
 *
 * Zustand store for user keyboard shortcut customization.
 * Manages profiles, custom bindings, and conflict detection.
 *
 * Features:
 * - Multiple named profiles
 * - Per-shortcut binding customization
 * - Enable/disable shortcuts
 * - Profile import/export
 * - Persisted to localStorage
 *
 * @see contracts/src/keyboard/customization.ts
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { PhysicalKeyBinding, Platform } from '@mog-sdk/kernel/keyboard';
import type {
  ConflictResult,
  CustomBinding,
  KeyboardShortcut,
  KeyboardProfile,
  SerializedProfile,
} from '../../keyboard';
import {
  KEYBOARD_SHORTCUTS,
  applyCustomizations,
  copyProfile,
  createProfile,
  importProfile as deserializeProfile,
  detectConflict,
  removeProfileBinding,
  exportProfile as serializeProfile,
  updateProfileBinding,
} from '../../keyboard';

// =============================================================================
// Types
// =============================================================================

/**
 * Serializable profile format for localStorage.
 */
interface StoredProfile {
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
 * Keyboard settings store state.
 */
export interface KeyboardSettingsState {
  // ---------------------------------------------------------------------------
  // State
  // ---------------------------------------------------------------------------

  /** Active profile ID */
  activeProfileId: string;

  /** User-created profiles (stored as serializable format) */
  profiles: Record<string, StoredProfile>;

  /**
   * Current keyboard layout map from the browser Keyboard API.
   *
   * Maps physical key codes (e.g., 'KeyQ') to the characters they produce
   * in the user's current layout (e.g., 'a' on AZERTY).
   *
   * null when the Keyboard API is unavailable (Safari/Firefox) or hasn't
   * been fetched yet. NOT persisted — runtime-only state, re-fetched each session.
   */
  layoutMap: ReadonlyMap<string, string> | null;

  // ---------------------------------------------------------------------------
  // Computed (derived from state)
  // ---------------------------------------------------------------------------

  /**
   * Get the active profile as a KeyboardProfile object.
   * Converts from stored format to Map-based format.
   */
  getActiveProfile: () => KeyboardProfile;

  /**
   * Get all shortcuts with active profile customizations applied.
   * This is what the keyboard system should use.
   */
  getActiveShortcuts: () => Map<string, KeyboardShortcut>;

  /**
   * Get shortcuts as an array (convenience for iteration).
   */
  getActiveShortcutsArray: () => KeyboardShortcut[];

  /**
   * Check if a new binding would conflict with existing shortcuts.
   */
  checkConflict: (
    newBinding: PhysicalKeyBinding,
    excludeShortcutId?: string,
    platform?: Platform,
  ) => ConflictResult;

  // ---------------------------------------------------------------------------
  // Profile Management Actions
  // ---------------------------------------------------------------------------

  /** Set the active profile */
  setActiveProfile: (profileId: string) => void;

  /** Create a new empty profile */
  createNewProfile: (name: string) => string;

  /** Delete a profile (cannot delete default) */
  deleteProfile: (profileId: string) => boolean;

  /** Duplicate an existing profile */
  duplicateProfile: (profileId: string, newName: string) => string;

  /** Rename a profile */
  renameProfile: (profileId: string, newName: string) => void;

  // ---------------------------------------------------------------------------
  // Binding Customization Actions
  // ---------------------------------------------------------------------------

  /**
   * Set a custom binding for a shortcut.
   * Pass platform to set a platform-specific binding.
   */
  setBinding: (shortcutId: string, binding: PhysicalKeyBinding, platform?: Platform) => void;

  /** Reset a shortcut to its default binding */
  resetBinding: (shortcutId: string) => void;

  /** Disable a shortcut (it won't trigger) */
  disableShortcut: (shortcutId: string) => void;

  /** Enable a previously disabled shortcut */
  enableShortcut: (shortcutId: string) => void;

  // ---------------------------------------------------------------------------
  // Import/Export Actions
  // ---------------------------------------------------------------------------

  /** Export a profile to JSON string */
  exportProfileAsJson: (profileId: string) => string | null;

  /** Import a profile from JSON string */
  importProfileFromJson: (json: string) => { success: boolean; profileId?: string; error?: string };

  // ---------------------------------------------------------------------------
  // Layout Map
  // ---------------------------------------------------------------------------

  /**
   * Set the keyboard layout map (from browser Keyboard API).
   * Called at startup and when the user switches keyboard layout.
   */
  setLayoutMap: (map: ReadonlyMap<string, string> | null) => void;

  // ---------------------------------------------------------------------------
  // Reset
  // ---------------------------------------------------------------------------

  /** Reset everything to defaults */
  resetToDefaults: () => void;
}

// =============================================================================
// Default Profile
// =============================================================================

const DEFAULT_PROFILE_ID = 'default';

function createDefaultStoredProfile(): StoredProfile {
  return {
    id: DEFAULT_PROFILE_ID,
    name: 'Default',
    customBindings: [],
    createdAt: new Date().toISOString(),
    modifiedAt: new Date().toISOString(),
  };
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Convert stored profile format to KeyboardProfile.
 */
function storedToProfile(stored: StoredProfile): KeyboardProfile {
  const customBindings = new Map<string, CustomBinding>();

  for (const entry of stored.customBindings) {
    // Build bindings object using spread to avoid readonly assignment issues
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

    // Construct the bindings object in one step
    const bindings: CustomBinding['bindings'] = {
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
    id: stored.id,
    name: stored.name,
    customBindings,
    createdAt: new Date(stored.createdAt),
    modifiedAt: new Date(stored.modifiedAt),
  };
}

/**
 * Convert KeyboardProfile to stored format.
 */
function profileToStored(profile: KeyboardProfile): StoredProfile {
  const serialized = serializeProfile(profile);
  return serialized;
}

/**
 * Build the default shortcuts map.
 */
function buildDefaultShortcutsMap(): Map<string, KeyboardShortcut> {
  const map = new Map<string, KeyboardShortcut>();
  for (const shortcut of KEYBOARD_SHORTCUTS) {
    map.set(shortcut.id, shortcut);
  }
  return map;
}

/**
 * Generate a unique profile ID.
 */
function generateProfileId(): string {
  return `profile-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

// =============================================================================
// Store
// =============================================================================

export const useKeyboardSettingsStore = create<KeyboardSettingsState>()(
  persist(
    (set, get) => ({
      // -------------------------------------------------------------------------
      // Initial State
      // -------------------------------------------------------------------------

      activeProfileId: DEFAULT_PROFILE_ID,
      profiles: {
        [DEFAULT_PROFILE_ID]: createDefaultStoredProfile(),
      },
      layoutMap: null,

      // -------------------------------------------------------------------------
      // Computed Getters
      // -------------------------------------------------------------------------

      getActiveProfile: () => {
        const state = get();
        const stored = state.profiles[state.activeProfileId];
        if (!stored) {
          // Fallback to default if active profile not found
          return storedToProfile(createDefaultStoredProfile());
        }
        return storedToProfile(stored);
      },

      getActiveShortcuts: () => {
        const profile = get().getActiveProfile();
        const defaults = buildDefaultShortcutsMap();
        return applyCustomizations(defaults, profile);
      },

      getActiveShortcutsArray: () => {
        return Array.from(get().getActiveShortcuts().values());
      },

      checkConflict: (newBinding, excludeShortcutId, _platform) => {
        const shortcuts = get().getActiveShortcuts();
        return detectConflict(shortcuts, newBinding, excludeShortcutId);
      },

      // -------------------------------------------------------------------------
      // Profile Management
      // -------------------------------------------------------------------------

      setActiveProfile: (profileId) => {
        const state = get();
        if (state.profiles[profileId]) {
          set({ activeProfileId: profileId });
        }
      },

      createNewProfile: (name) => {
        const id = generateProfileId();
        const newProfile = createProfile(id, name);
        const stored = profileToStored(newProfile);

        set((state) => ({
          profiles: {
            ...state.profiles,
            [id]: stored,
          },
          activeProfileId: id,
        }));

        return id;
      },

      deleteProfile: (profileId) => {
        // Cannot delete default profile
        if (profileId === DEFAULT_PROFILE_ID) {
          return false;
        }

        const state = get();
        if (!state.profiles[profileId]) {
          return false;
        }

        const newProfiles = { ...state.profiles };
        delete newProfiles[profileId];

        // Switch to default if deleting active profile
        const newActiveId =
          state.activeProfileId === profileId ? DEFAULT_PROFILE_ID : state.activeProfileId;

        set({
          profiles: newProfiles,
          activeProfileId: newActiveId,
        });

        return true;
      },

      duplicateProfile: (profileId, newName) => {
        const state = get();
        const sourceStored = state.profiles[profileId];
        if (!sourceStored) {
          return '';
        }

        const sourceProfile = storedToProfile(sourceStored);
        const newId = generateProfileId();
        const duplicated = copyProfile(sourceProfile, newId, newName);
        const stored = profileToStored(duplicated);

        set((s) => ({
          profiles: {
            ...s.profiles,
            [newId]: stored,
          },
          activeProfileId: newId,
        }));

        return newId;
      },

      renameProfile: (profileId, newName) => {
        set((state) => {
          const existing = state.profiles[profileId];
          if (!existing) return state;

          return {
            profiles: {
              ...state.profiles,
              [profileId]: {
                ...existing,
                name: newName,
                modifiedAt: new Date().toISOString(),
              },
            },
          };
        });
      },

      // -------------------------------------------------------------------------
      // Binding Customization
      // -------------------------------------------------------------------------

      setBinding: (shortcutId, binding, platform) => {
        set((state) => {
          const stored = state.profiles[state.activeProfileId];
          if (!stored) return state;

          const profile = storedToProfile(stored);

          // Get existing custom binding or create new one
          const existingCustom = profile.customBindings.get(shortcutId);
          const newBindings = existingCustom ? { ...existingCustom.bindings } : {};

          // Set the binding for the specified platform (or default)
          const platformKey = platform ?? 'default';
          (newBindings as Record<string, PhysicalKeyBinding>)[platformKey] = binding;

          const custom: CustomBinding = {
            shortcutId,
            bindings: newBindings,
            disabled: existingCustom?.disabled,
          };

          const updatedProfile = updateProfileBinding(profile, custom);
          const updatedStored = profileToStored(updatedProfile);

          return {
            profiles: {
              ...state.profiles,
              [state.activeProfileId]: updatedStored,
            },
          };
        });
      },

      resetBinding: (shortcutId) => {
        set((state) => {
          const stored = state.profiles[state.activeProfileId];
          if (!stored) return state;

          const profile = storedToProfile(stored);
          const updatedProfile = removeProfileBinding(profile, shortcutId);
          const updatedStored = profileToStored(updatedProfile);

          return {
            profiles: {
              ...state.profiles,
              [state.activeProfileId]: updatedStored,
            },
          };
        });
      },

      disableShortcut: (shortcutId) => {
        set((state) => {
          const stored = state.profiles[state.activeProfileId];
          if (!stored) return state;

          const profile = storedToProfile(stored);
          const existingCustom = profile.customBindings.get(shortcutId);

          const custom: CustomBinding = {
            shortcutId,
            bindings: existingCustom?.bindings ?? {},
            disabled: true,
          };

          const updatedProfile = updateProfileBinding(profile, custom);
          const updatedStored = profileToStored(updatedProfile);

          return {
            profiles: {
              ...state.profiles,
              [state.activeProfileId]: updatedStored,
            },
          };
        });
      },

      enableShortcut: (shortcutId) => {
        set((state) => {
          const stored = state.profiles[state.activeProfileId];
          if (!stored) return state;

          const profile = storedToProfile(stored);
          const existingCustom = profile.customBindings.get(shortcutId);

          if (!existingCustom) return state;

          // If there are no binding customizations, just remove the entry
          const hasBindings =
            existingCustom.bindings.default ||
            existingCustom.bindings.macos ||
            existingCustom.bindings.windows ||
            existingCustom.bindings.linux;

          if (!hasBindings) {
            const updatedProfile = removeProfileBinding(profile, shortcutId);
            const updatedStored = profileToStored(updatedProfile);

            return {
              profiles: {
                ...state.profiles,
                [state.activeProfileId]: updatedStored,
              },
            };
          }

          // Otherwise, just clear the disabled flag
          const custom: CustomBinding = {
            shortcutId,
            bindings: existingCustom.bindings,
            disabled: false,
          };

          const updatedProfile = updateProfileBinding(profile, custom);
          const updatedStored = profileToStored(updatedProfile);

          return {
            profiles: {
              ...state.profiles,
              [state.activeProfileId]: updatedStored,
            },
          };
        });
      },

      // -------------------------------------------------------------------------
      // Import/Export
      // -------------------------------------------------------------------------

      exportProfileAsJson: (profileId) => {
        const state = get();
        const stored = state.profiles[profileId];
        if (!stored) return null;

        const profile = storedToProfile(stored);
        const serialized = serializeProfile(profile);
        return JSON.stringify(serialized, null, 2);
      },

      importProfileFromJson: (json) => {
        try {
          const parsed = JSON.parse(json) as SerializedProfile;
          const profile = deserializeProfile(parsed);

          if (!profile) {
            return { success: false, error: 'Invalid profile format' };
          }

          // Generate new ID to avoid collisions
          const newId = generateProfileId();
          const renamedProfile: KeyboardProfile = {
            ...profile,
            id: newId,
            name: `${profile.name} (Imported)`,
          };

          const stored = profileToStored(renamedProfile);

          set((state) => ({
            profiles: {
              ...state.profiles,
              [newId]: stored,
            },
            activeProfileId: newId,
          }));

          return { success: true, profileId: newId };
        } catch (e) {
          return { success: false, error: e instanceof Error ? e.message : 'Parse error' };
        }
      },

      // -------------------------------------------------------------------------
      // Layout Map
      // -------------------------------------------------------------------------

      setLayoutMap: (map) => {
        set({ layoutMap: map });
      },

      // -------------------------------------------------------------------------
      // Reset
      // -------------------------------------------------------------------------

      resetToDefaults: () => {
        set({
          activeProfileId: DEFAULT_PROFILE_ID,
          profiles: {
            [DEFAULT_PROFILE_ID]: createDefaultStoredProfile(),
          },
        });
      },
    }),
    {
      name: 'keyboard-settings',
      version: 1,
      partialize: (state) => ({
        activeProfileId: state.activeProfileId,
        profiles: state.profiles,
      }),
    },
  ),
);

// =============================================================================
// Selectors
// =============================================================================

/**
 * Select the active profile ID.
 */
export const selectActiveProfileId = (state: KeyboardSettingsState) => state.activeProfileId;

/**
 * Select all profile IDs.
 */
export const selectProfileIds = (state: KeyboardSettingsState) => Object.keys(state.profiles);

/**
 * Select a profile by ID.
 */
export const selectProfileById = (profileId: string) => (state: KeyboardSettingsState) =>
  state.profiles[profileId];

/**
 * Select all profiles.
 */
export const selectAllProfiles = (state: KeyboardSettingsState) => Object.values(state.profiles);

/**
 * Select the keyboard layout map (null when Keyboard API unavailable).
 */
export const selectLayoutMap = (state: KeyboardSettingsState) => state.layoutMap;
