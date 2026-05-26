/**
 * Extension Store
 *
 * Zustand store for managing extension panel state.
 * Handles extension registration, lifecycle, and panel preferences.
 *
 * @module state/extension-store
 */

import { create } from 'zustand';
import { persist, subscribeWithSelector } from 'zustand/middleware';

import type {
  ExtensionInstance,
  ExtensionLifecycleState,
  ExtensionManifest,
} from '@mog-sdk/contracts/extensions';

// =============================================================================
// Inlined Extension Panel Constants
// (Moved from extensions/constants to break infra/ -> extensions/ DAG violation)
// =============================================================================

/** Default panel width (px) */
const DEFAULT_PANEL_WIDTH = 400;

/** Minimum panel width (px) */
const MIN_PANEL_WIDTH = 280;

/** Maximum panel width (px) */
const MAX_PANEL_WIDTH = 800;

/** Key for storing panel visibility preference */
const STORAGE_KEY_PANEL_VISIBLE = 'shortcut:extension-panel:visible';

/** Key for storing panel width preference */
const STORAGE_KEY_PANEL_WIDTH = 'shortcut:extension-panel:width';

/** Key for storing active extension ID */
const STORAGE_KEY_ACTIVE_EXTENSION = 'shortcut:extension-panel:active';

// =============================================================================
// Store State Interface
// =============================================================================

export interface ExtensionStoreState {
  // -----------------------------------------------------------------------------
  // Extension Registry
  // -----------------------------------------------------------------------------

  /**
   * Map of extension ID to extension instance.
   * Contains all registered extensions regardless of state.
   */
  extensions: Map<string, ExtensionInstance>;

  /**
   * Currently active (displayed) extension ID.
   * Null if no extension is active.
   */
  activeExtensionId: string | null;

  // -----------------------------------------------------------------------------
  // Panel State
  // -----------------------------------------------------------------------------

  /**
   * Whether the extension panel is visible
   */
  panelVisible: boolean;

  /**
   * Current panel width in pixels
   */
  panelWidth: number;

  /**
   * Whether the panel is currently being resized
   */
  isResizing: boolean;

  // -----------------------------------------------------------------------------
  // Actions
  // -----------------------------------------------------------------------------

  /**
   * Register a new extension from its manifest.
   * Creates an ExtensionInstance in 'idle' state.
   */
  registerExtension: (manifest: ExtensionManifest, baseUrl: string) => void;

  /**
   * Unregister an extension by ID.
   * If it was the active extension, clears activeExtensionId.
   */
  unregisterExtension: (extensionId: string) => void;

  /**
   * Set the active extension to display in the panel.
   * Pass null to deactivate all extensions.
   */
  setActiveExtension: (extensionId: string | null) => void;

  /**
   * Update an extension's lifecycle state.
   */
  setExtensionState: (
    extensionId: string,
    state: ExtensionLifecycleState,
    error?: string | null,
  ) => void;

  /**
   * Set the extension's session ID after successful handshake.
   */
  setExtensionSession: (extensionId: string, sessionId: string) => void;

  /**
   * Update the extension's last activity timestamp.
   */
  updateExtensionActivity: (extensionId: string) => void;

  /**
   * Add events to an extension's subscription list.
   */
  addEventSubscriptions: (extensionId: string, events: string[]) => void;

  /**
   * Remove events from an extension's subscription list.
   */
  removeEventSubscriptions: (extensionId: string, events: string[]) => void;

  /**
   * Show the extension panel.
   */
  showPanel: () => void;

  /**
   * Hide the extension panel.
   */
  hidePanel: () => void;

  /**
   * Toggle panel visibility.
   */
  togglePanel: () => void;

  /**
   * Set the panel width.
   * Clamps to min/max bounds.
   */
  setPanelWidth: (width: number) => void;

  /**
   * Set whether the panel is being resized.
   */
  setIsResizing: (isResizing: boolean) => void;

  /**
   * Get an extension instance by ID.
   */
  getExtension: (extensionId: string) => ExtensionInstance | undefined;

  /**
   * Get all registered extensions as an array.
   */
  getAllExtensions: () => ExtensionInstance[];

  /**
   * Get the currently active extension instance.
   */
  getActiveExtension: () => ExtensionInstance | undefined;

  /**
   * Check if an extension is ready for API calls.
   */
  isExtensionReady: (extensionId: string) => boolean;

  /**
   * Reset the store to initial state.
   * Used for testing and cleanup.
   */
  reset: () => void;
}

// =============================================================================
// Initial State
// =============================================================================

const initialState = {
  extensions: new Map<string, ExtensionInstance>(),
  activeExtensionId: null,
  panelVisible: false,
  panelWidth: DEFAULT_PANEL_WIDTH,
  isResizing: false,
};

// =============================================================================
// Store Factory
// =============================================================================

/**
 * Create the extension store.
 *
 * Uses persist middleware to save panel preferences to localStorage.
 * Uses subscribeWithSelector for efficient subscriptions.
 */
export const useExtensionStore = create<ExtensionStoreState>()(
  subscribeWithSelector(
    persist(
      (set, get) => ({
        // Initial state
        ...initialState,

        // -------------------------------------------------------------------------
        // Extension Registry Actions
        // -------------------------------------------------------------------------

        registerExtension: (manifest, baseUrl) => {
          set((state) => {
            const newExtensions = new Map(state.extensions);
            const instance: ExtensionInstance = {
              manifest,
              state: 'idle',
              baseUrl,
              sessionId: null,
              error: null,
              lastActivity: Date.now(),
              subscribedEvents: new Set(),
            };
            newExtensions.set(manifest.id, instance);
            return { extensions: newExtensions };
          });
        },

        unregisterExtension: (extensionId) => {
          set((state) => {
            const newExtensions = new Map(state.extensions);
            newExtensions.delete(extensionId);

            // Clear active if it was the unregistered extension
            const activeExtensionId =
              state.activeExtensionId === extensionId ? null : state.activeExtensionId;

            return { extensions: newExtensions, activeExtensionId };
          });
        },

        setActiveExtension: (extensionId) => {
          const state = get();
          // Only set if extension exists or we're clearing
          if (extensionId === null || state.extensions.has(extensionId)) {
            set({ activeExtensionId: extensionId });
          }
        },

        setExtensionState: (extensionId, lifecycleState, error = null) => {
          set((state) => {
            const extension = state.extensions.get(extensionId);
            if (!extension) return state;

            const newExtensions = new Map(state.extensions);
            newExtensions.set(extensionId, {
              ...extension,
              state: lifecycleState,
              error,
              lastActivity: Date.now(),
            });
            return { extensions: newExtensions };
          });
        },

        setExtensionSession: (extensionId, sessionId) => {
          set((state) => {
            const extension = state.extensions.get(extensionId);
            if (!extension) return state;

            const newExtensions = new Map(state.extensions);
            newExtensions.set(extensionId, {
              ...extension,
              sessionId,
              lastActivity: Date.now(),
            });
            return { extensions: newExtensions };
          });
        },

        updateExtensionActivity: (extensionId) => {
          set((state) => {
            const extension = state.extensions.get(extensionId);
            if (!extension) return state;

            const newExtensions = new Map(state.extensions);
            newExtensions.set(extensionId, {
              ...extension,
              lastActivity: Date.now(),
            });
            return { extensions: newExtensions };
          });
        },

        addEventSubscriptions: (extensionId, events) => {
          set((state) => {
            const extension = state.extensions.get(extensionId);
            if (!extension) return state;

            const newExtensions = new Map(state.extensions);
            const newSubscribedEvents = new Set(extension.subscribedEvents);
            for (const event of events) {
              newSubscribedEvents.add(event);
            }
            newExtensions.set(extensionId, {
              ...extension,
              subscribedEvents: newSubscribedEvents,
            });
            return { extensions: newExtensions };
          });
        },

        removeEventSubscriptions: (extensionId, events) => {
          set((state) => {
            const extension = state.extensions.get(extensionId);
            if (!extension) return state;

            const newExtensions = new Map(state.extensions);
            const newSubscribedEvents = new Set(extension.subscribedEvents);
            for (const event of events) {
              newSubscribedEvents.delete(event);
            }
            newExtensions.set(extensionId, {
              ...extension,
              subscribedEvents: newSubscribedEvents,
            });
            return { extensions: newExtensions };
          });
        },

        // -------------------------------------------------------------------------
        // Panel Actions
        // -------------------------------------------------------------------------

        showPanel: () => set({ panelVisible: true }),

        hidePanel: () => set({ panelVisible: false }),

        togglePanel: () => set((state) => ({ panelVisible: !state.panelVisible })),

        setPanelWidth: (width) => {
          const clampedWidth = Math.max(MIN_PANEL_WIDTH, Math.min(MAX_PANEL_WIDTH, width));
          set({ panelWidth: clampedWidth });
        },

        setIsResizing: (isResizing) => set({ isResizing }),

        // -------------------------------------------------------------------------
        // Getters
        // -------------------------------------------------------------------------

        getExtension: (extensionId) => {
          return get().extensions.get(extensionId);
        },

        getAllExtensions: () => {
          return Array.from(get().extensions.values());
        },

        getActiveExtension: () => {
          const state = get();
          if (!state.activeExtensionId) return undefined;
          return state.extensions.get(state.activeExtensionId);
        },

        isExtensionReady: (extensionId) => {
          const extension = get().extensions.get(extensionId);
          return extension?.state === 'ready';
        },

        // -------------------------------------------------------------------------
        // Reset
        // -------------------------------------------------------------------------

        reset: () => {
          set(initialState);
        },
      }),
      {
        name: 'extension-store',
        // Only persist panel preferences, not extension registry
        partialize: (state: ExtensionStoreState) => ({
          panelVisible: state.panelVisible,
          panelWidth: state.panelWidth,
          activeExtensionId: state.activeExtensionId,
        }),
        // Custom storage for separate localStorage keys
        storage: {
          getItem: (_name: string) => {
            const visible = localStorage.getItem(STORAGE_KEY_PANEL_VISIBLE);
            const width = localStorage.getItem(STORAGE_KEY_PANEL_WIDTH);
            const active = localStorage.getItem(STORAGE_KEY_ACTIVE_EXTENSION);

            return {
              state: {
                panelVisible: visible ? JSON.parse(visible) : false,
                panelWidth: width ? parseInt(width, 10) : DEFAULT_PANEL_WIDTH,
                activeExtensionId: active || null,
              },
              version: 0,
            };
          },
          setItem: (_name: string, value: { state: Partial<ExtensionStoreState> }) => {
            const { state } = value;
            if (state.panelVisible !== undefined) {
              localStorage.setItem(STORAGE_KEY_PANEL_VISIBLE, JSON.stringify(state.panelVisible));
            }
            if (state.panelWidth !== undefined) {
              localStorage.setItem(STORAGE_KEY_PANEL_WIDTH, String(state.panelWidth));
            }
            if (state.activeExtensionId !== undefined) {
              if (state.activeExtensionId) {
                localStorage.setItem(STORAGE_KEY_ACTIVE_EXTENSION, state.activeExtensionId);
              } else {
                localStorage.removeItem(STORAGE_KEY_ACTIVE_EXTENSION);
              }
            }
          },
          removeItem: (_name: string) => {
            localStorage.removeItem(STORAGE_KEY_PANEL_VISIBLE);
            localStorage.removeItem(STORAGE_KEY_PANEL_WIDTH);
            localStorage.removeItem(STORAGE_KEY_ACTIVE_EXTENSION);
          },
        },
      },
    ),
  ),
);

// =============================================================================
// Selectors
// =============================================================================

/**
 * Select the active extension ID
 */
export const selectActiveExtensionId = (state: ExtensionStoreState) => state.activeExtensionId;

/**
 * Select panel visibility
 */
export const selectPanelVisible = (state: ExtensionStoreState) => state.panelVisible;

/**
 * Select panel width
 */
export const selectPanelWidth = (state: ExtensionStoreState) => state.panelWidth;

/**
 * Select whether panel is resizing
 */
export const selectIsResizing = (state: ExtensionStoreState) => state.isResizing;

/**
 * Select extension count
 */
export const selectExtensionCount = (state: ExtensionStoreState) => state.extensions.size;

/**
 * Create a selector for a specific extension's state
 */
export const selectExtensionState = (extensionId: string) => (state: ExtensionStoreState) =>
  state.extensions.get(extensionId)?.state ?? 'idle';

/**
 * Create a selector for checking if an extension is ready
 */
export const selectIsExtensionReady = (extensionId: string) => (state: ExtensionStoreState) =>
  state.extensions.get(extensionId)?.state === 'ready';
