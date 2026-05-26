/**
 * Extension Manager
 *
 * Singleton manager for all extension instances.
 * Handles extension loading, unloading, and lifecycle management.
 *
 * Responsibilities:
 * - Loading extensions from manifests
 * - Managing extension lifecycle state
 * - Tracking active connections
 * - Providing reload/retry functionality
 *
 * @module extensions/ExtensionManager
 */

import { useExtensionStore } from '../infra/state/extension-store';
import {
  DEV_EXTENSION_ORIGINS,
  DISCONNECT_THRESHOLD,
  EXTENSION_ORIGIN_PRODUCTION,
  HEARTBEAT_INTERVAL,
  isDev,
  MAX_RETRY_ATTEMPTS,
  RETRY_BASE_DELAY,
  RETRY_MAX_DELAY,
} from './constants';
import type { ExtensionInstance, ExtensionLifecycleState, ExtensionManifest } from './types';

// =============================================================================
// Types
// =============================================================================

export interface LoadExtensionOptions {
  /** Base URL for the extension (defaults to production or dev origin) */
  baseUrl?: string;
  /** Whether to auto-activate after loading */
  autoActivate?: boolean;
}

export interface ExtensionManagerState {
  /** Number of currently loaded extensions */
  loadedCount: number;
  /** Number of extensions in ready state */
  readyCount: number;
  /** Number of extensions in error state */
  errorCount: number;
}

// =============================================================================
// Extension Manager Class
// =============================================================================

class ExtensionManagerImpl {
  private retryAttempts: Map<string, number> = new Map();
  private retryTimeouts: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private heartbeatInterval: ReturnType<typeof setInterval> | null = null;

  // ---------------------------------------------------------------------------
  // Singleton Access
  // ---------------------------------------------------------------------------

  private static instance: ExtensionManagerImpl | null = null;

  static getInstance(): ExtensionManagerImpl {
    if (!ExtensionManagerImpl.instance) {
      ExtensionManagerImpl.instance = new ExtensionManagerImpl();
    }
    return ExtensionManagerImpl.instance;
  }

  /**
   * Reset the singleton instance (for testing)
   */
  static resetInstance(): void {
    if (ExtensionManagerImpl.instance) {
      ExtensionManagerImpl.instance.cleanup();
      ExtensionManagerImpl.instance = null;
    }
  }

  // ---------------------------------------------------------------------------
  // Initialization
  // ---------------------------------------------------------------------------

  constructor() {
    // Start heartbeat monitoring
    this.startHeartbeat();
  }

  /**
   * Clean up resources (timers, etc.)
   */
  cleanup(): void {
    // Clear all retry timeouts
    this.retryTimeouts.forEach((timeout) => clearTimeout(timeout));
    this.retryTimeouts.clear();
    this.retryAttempts.clear();

    // Stop heartbeat
    this.stopHeartbeat();
  }

  // ---------------------------------------------------------------------------
  // Extension Loading
  // ---------------------------------------------------------------------------

  /**
   * Load an extension from its manifest.
   *
   * @param manifest - Extension manifest
   * @param options - Load options
   * @returns The created extension instance
   */
  load(manifest: ExtensionManifest, options: LoadExtensionOptions = {}): ExtensionInstance {
    const { baseUrl, autoActivate = false } = options;

    // Determine base URL
    const extensionBaseUrl = baseUrl || this.getDefaultBaseUrl(manifest);

    // Register in store
    const store = useExtensionStore.getState();
    store.registerExtension(manifest, extensionBaseUrl);

    // Get the created instance
    const instance = store.getExtension(manifest.id);
    if (!instance) {
      throw new Error(`Failed to register extension: ${manifest.id}`);
    }

    // Auto-activate if requested
    if (autoActivate) {
      store.setActiveExtension(manifest.id);
      store.showPanel();
    }

    // Clear any previous retry state
    this.retryAttempts.delete(manifest.id);
    this.clearRetryTimeout(manifest.id);

    return instance;
  }

  /**
   * Unload an extension and clean up resources.
   *
   * @param extensionId - Extension ID to unload
   */
  unload(extensionId: string): void {
    const store = useExtensionStore.getState();

    // Clear retry state
    this.retryAttempts.delete(extensionId);
    this.clearRetryTimeout(extensionId);

    // Unregister from store
    store.unregisterExtension(extensionId);
  }

  /**
   * Reload an extension by unloading and reloading it.
   *
   * @param extensionId - Extension ID to reload
   */
  reload(extensionId: string): void {
    const store = useExtensionStore.getState();
    const extension = store.getExtension(extensionId);

    if (!extension) {
      console.warn(`[ExtensionManager] Cannot reload unknown extension: ${extensionId}`);
      return;
    }

    // Reset retry counter
    this.retryAttempts.set(extensionId, 0);
    this.clearRetryTimeout(extensionId);

    // Reset to loading state (ExtensionHost will handle actual reload)
    store.setExtensionState(extensionId, 'loading');
  }

  // ---------------------------------------------------------------------------
  // State Management
  // ---------------------------------------------------------------------------

  /**
   * Update an extension's lifecycle state.
   *
   * @param extensionId - Extension ID
   * @param state - New state
   * @param error - Optional error message
   */
  setState(extensionId: string, state: ExtensionLifecycleState, error?: string | null): void {
    const store = useExtensionStore.getState();
    store.setExtensionState(extensionId, state, error);

    // Handle state-specific logic
    if (state === 'error' || state === 'disconnected') {
      this.handleErrorState(extensionId, state);
    }
  }

  /**
   * Mark extension as ready and set session.
   */
  setReady(extensionId: string, sessionId: string): void {
    const store = useExtensionStore.getState();
    store.setExtensionState(extensionId, 'ready');
    store.setExtensionSession(extensionId, sessionId);

    // Clear retry counter on successful connection
    this.retryAttempts.delete(extensionId);
    this.clearRetryTimeout(extensionId);
  }

  /**
   * Update activity timestamp for an extension.
   */
  updateActivity(extensionId: string): void {
    const store = useExtensionStore.getState();
    store.updateExtensionActivity(extensionId);
  }

  // ---------------------------------------------------------------------------
  // Retry Logic
  // ---------------------------------------------------------------------------

  /**
   * Handle error/disconnected state with retry logic.
   */
  private handleErrorState(extensionId: string, state: ExtensionLifecycleState): void {
    const currentAttempts = this.retryAttempts.get(extensionId) || 0;

    // Check if we should auto-retry
    if (currentAttempts < MAX_RETRY_ATTEMPTS && state === 'disconnected') {
      const delay = this.getRetryDelay(currentAttempts);
      this.retryAttempts.set(extensionId, currentAttempts + 1);

      console.log(
        `[ExtensionManager] Scheduling retry for ${extensionId} in ${delay}ms (attempt ${currentAttempts + 1}/${MAX_RETRY_ATTEMPTS})`,
      );

      const timeout = setTimeout(() => {
        this.reload(extensionId);
      }, delay);

      this.retryTimeouts.set(extensionId, timeout);
    }
  }

  /**
   * Clear a retry timeout for an extension.
   */
  private clearRetryTimeout(extensionId: string): void {
    const timeout = this.retryTimeouts.get(extensionId);
    if (timeout) {
      clearTimeout(timeout);
      this.retryTimeouts.delete(extensionId);
    }
  }

  /**
   * Calculate retry delay with exponential backoff.
   */
  private getRetryDelay(attempt: number): number {
    const delay = RETRY_BASE_DELAY * Math.pow(2, attempt);
    return Math.min(delay, RETRY_MAX_DELAY);
  }

  // ---------------------------------------------------------------------------
  // Heartbeat Monitoring
  // ---------------------------------------------------------------------------

  /**
   * Start heartbeat monitoring for extension health.
   */
  private startHeartbeat(): void {
    if (this.heartbeatInterval) return;

    this.heartbeatInterval = setInterval(() => {
      this.checkExtensionHealth();
    }, HEARTBEAT_INTERVAL);
  }

  /**
   * Stop heartbeat monitoring.
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Check health of all extensions based on last activity.
   */
  private checkExtensionHealth(): void {
    const store = useExtensionStore.getState();
    const extensions = store.getAllExtensions();
    const now = Date.now();

    for (const extension of extensions) {
      // Only check ready extensions
      if (extension.state !== 'ready') continue;

      // Check if extension has gone silent
      const timeSinceActivity = now - extension.lastActivity;
      if (timeSinceActivity > DISCONNECT_THRESHOLD) {
        console.warn(
          `[ExtensionManager] Extension ${extension.manifest.id} appears disconnected (${timeSinceActivity}ms since last activity)`,
        );
        store.setExtensionState(extension.manifest.id, 'disconnected', 'No activity detected');
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  /**
   * Get an extension by ID.
   */
  getExtension(extensionId: string): ExtensionInstance | undefined {
    return useExtensionStore.getState().getExtension(extensionId);
  }

  /**
   * Get all extensions.
   */
  getAllExtensions(): ExtensionInstance[] {
    return useExtensionStore.getState().getAllExtensions();
  }

  /**
   * Get extensions in a specific state.
   */
  getExtensionsByState(state: ExtensionLifecycleState): ExtensionInstance[] {
    return this.getAllExtensions().filter((ext) => ext.state === state);
  }

  /**
   * Get manager state summary.
   */
  getState(): ExtensionManagerState {
    const extensions = this.getAllExtensions();
    return {
      loadedCount: extensions.length,
      readyCount: extensions.filter((e) => e.state === 'ready').length,
      errorCount: extensions.filter((e) => e.state === 'error').length,
    };
  }

  /**
   * Check if an extension is loaded.
   */
  isLoaded(extensionId: string): boolean {
    return useExtensionStore.getState().extensions.has(extensionId);
  }

  /**
   * Check if an extension is ready.
   */
  isReady(extensionId: string): boolean {
    return useExtensionStore.getState().isExtensionReady(extensionId);
  }

  // ---------------------------------------------------------------------------
  // URL Helpers
  // ---------------------------------------------------------------------------

  /**
   * Get the default base URL for an extension.
   */
  private getDefaultBaseUrl(manifest: ExtensionManifest): string {
    if (isDev()) {
      // In dev mode, use first dev origin with extension path
      return `${DEV_EXTENSION_ORIGINS[0]}/${manifest.id}/${manifest.version}/`;
    }
    // Production: use extension hosting service
    return `${EXTENSION_ORIGIN_PRODUCTION}/${manifest.id}/${manifest.version}/`;
  }

  /**
   * Validate a manifest's base URL.
   */
  validateBaseUrl(baseUrl: string): boolean {
    try {
      const url = new URL(baseUrl);
      const origin = url.origin;

      // Check if origin is trusted
      if (origin === EXTENSION_ORIGIN_PRODUCTION) {
        return true;
      }

      if (isDev()) {
        return DEV_EXTENSION_ORIGINS.some((devOrigin) => origin === devOrigin);
      }

      return false;
    } catch {
      return false;
    }
  }

  // ---------------------------------------------------------------------------
  // Dev/Sideload Helpers
  // ---------------------------------------------------------------------------

  /**
   * Load an extension directly from a URL (sideloading).
   * Creates a minimal manifest and loads the extension.
   *
   * Useful for:
   * - Development testing
   * - Sideloading local extensions
   * - Loading extensions without a manifest file
   *
   * @param url - Base URL of the extension (e.g., "https://localhost:4000")
   * @param name - Display name for the extension
   * @returns The loaded extension instance
   *
   * @example
   * // From browser console:
   * ExtensionManager.getInstance().loadFromUrl('https://localhost:4000', 'Shortcut AI')
   */
  loadFromUrl(url: string, name = 'Sideloaded Extension'): ExtensionInstance {
    const manifest: ExtensionManifest = {
      id: `sideload-${Date.now()}`,
      name,
      version: '0.0.0',
      description: `Sideloaded from ${url}`,
      author: { name: 'Developer' },
      icon: '',
      entryPoint: '', // Will use baseUrl directly
      permissions: [
        'spreadsheet:read',
        'spreadsheet:write',
        'spreadsheet:format',
        'spreadsheet:structure',
        'selection:read',
        'selection:write',
        'charts:read',
        'charts:write',
      ],
    };

    console.log(`[ExtensionManager] Sideloading extension "${name}" from ${url}`);

    return this.load(manifest, {
      baseUrl: url,
      autoActivate: true,
    });
  }
}

// =============================================================================
// Singleton Export
// =============================================================================

/**
 * Get the ExtensionManager singleton instance.
 */
export function getExtensionManager(): ExtensionManagerImpl {
  return ExtensionManagerImpl.getInstance();
}

/**
 * Reset the ExtensionManager (for testing).
 */
export function resetExtensionManager(): void {
  ExtensionManagerImpl.resetInstance();
}

/**
 * Default export for convenient import.
 */
export const ExtensionManager = {
  getInstance: () => ExtensionManagerImpl.getInstance(),
  reset: () => ExtensionManagerImpl.resetInstance(),
};

// =============================================================================
// Dev Mode: Expose on Window
// =============================================================================

// Expose ExtensionManager on window in dev mode for console access
if (isDev() && typeof window !== 'undefined') {
  Object.assign(window, { ExtensionManager });
  console.log(
    '[ExtensionManager] Dev mode: Available on window.ExtensionManager\n' +
      'Usage: ExtensionManager.getInstance().loadFromUrl("https://localhost:4000", "Shortcut AI")',
  );
}
