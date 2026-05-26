/**
 * CleanupManager
 *
 * Centralized cleanup tracking for the coordinator.
 * Replaces the mixed cleanup patterns in SheetCoordinator:
 * - cleanups Map (already used)
 * - individual properties (sparklineManager, etc.)
 * - module result cleanup functions
 *
 * Features:
 * - Keyed cleanup registration (enables replacement without leaks)
 * - LIFO cleanup order (last registered = first cleaned up)
 * - Error isolation (one failed cleanup doesn't block others)
 * - Disposal state tracking (prevents leaks from late registrations)
 *
 */

/**
 * Manages cleanup functions for coordinator resources.
 *
 * Usage:
 * ```typescript
 * const cleanups = new CleanupManager();
 *
 * // Register cleanups
 * cleanups.register('subscription', () => unsubscribe());
 * cleanups.register('renderer', () => renderer.dispose());
 *
 * // Replace a cleanup (old one is called first)
 * cleanups.register('renderer', () => newRenderer.dispose());
 *
 * // Clean up everything
 * cleanups.dispose();
 * ```
 */
export class CleanupManager {
  private cleanups = new Map<string, () => void>();
  private disposed = false;

  /**
   * Register a cleanup function with a unique key.
   *
   * If a cleanup with the same key exists, the old cleanup is called first
   * (replacement pattern - prevents resource leaks).
   *
   * If the manager is already disposed, the cleanup is called immediately
   * and a warning is logged.
   *
   * @param key - Unique identifier for this cleanup (e.g., 'renderContext', 'editorYjs')
   * @param cleanup - Function to call on dispose or replacement
   */
  register(key: string, cleanup: () => void): void {
    if (this.disposed) {
      console.warn(
        `CleanupManager: Attempted to register '${key}' after disposal. Cleaning up immediately.`,
      );
      try {
        cleanup();
      } catch (error) {
        console.error(`CleanupManager: Error in immediate cleanup '${key}':`, error);
      }
      return;
    }

    // If replacing existing, clean up old one first
    const existing = this.cleanups.get(key);
    if (existing) {
      try {
        existing();
      } catch (error) {
        console.error(`CleanupManager: Error replacing cleanup '${key}':`, error);
      }
    }

    this.cleanups.set(key, cleanup);
  }

  /**
   * Unregister and call a specific cleanup.
   * Use this for early cleanup when a resource is no longer needed.
   *
   * @param key - Key of the cleanup to unregister
   * @returns true if cleanup was found and called, false otherwise
   */
  unregister(key: string): boolean {
    const cleanup = this.cleanups.get(key);
    if (!cleanup) return false;

    this.cleanups.delete(key);
    try {
      cleanup();
    } catch (error) {
      console.error(`CleanupManager: Error unregistering '${key}':`, error);
    }
    return true;
  }

  /**
   * Check if a cleanup is registered.
   *
   * @param key - Key to check
   */
  has(key: string): boolean {
    return this.cleanups.has(key);
  }

  /**
   * Run all cleanups in reverse registration order (LIFO) and clear.
   * Idempotent - calling multiple times has no effect after first call.
   *
   * Cleanup errors are logged but don't prevent other cleanups from running.
   */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    // Clean up in reverse order (LIFO) - last registered, first cleaned
    const keys = Array.from(this.cleanups.keys()).reverse();
    for (const key of keys) {
      const cleanup = this.cleanups.get(key);
      if (cleanup) {
        try {
          cleanup();
        } catch (error) {
          console.error(`CleanupManager: Error disposing '${key}':`, error);
        }
      }
    }
    this.cleanups.clear();
  }

  /**
   * Get the number of registered cleanups.
   */
  get size(): number {
    return this.cleanups.size;
  }

  /**
   * Check if the manager has been disposed.
   */
  isDisposed(): boolean {
    return this.disposed;
  }

  /**
   * Get all registered cleanup keys.
   * Useful for debugging and testing.
   */
  getKeys(): string[] {
    return Array.from(this.cleanups.keys());
  }
}
