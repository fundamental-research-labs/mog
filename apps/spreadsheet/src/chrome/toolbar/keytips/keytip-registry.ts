/**
 * KeyTip Registry
 *
 * Central registry mapping keys to ribbon elements and actions.
 * This is the foundation for Alt-key navigation.
 *
 */

import type { KeyTipEntry } from './types';

/**
 * KeyTip Registry - Maps keys to ribbon elements.
 *
 * This is a singleton registry that gets populated as the ribbon is rendered.
 * Components register their keytips by calling registerKeyTip().
 *
 * Architecture:
 * - Tab-level keytips have no tabId (e.g., H=Home, N=Insert)
 * - Command-level keytips have a tabId (e.g., B=Bold on Home tab)
 * - Multi-level keytips use children (e.g., Alt+H+F+P for Font Color dropdown)
 */
class KeyTipRegistry {
  /** All registered keytip entries */
  private entries: KeyTipEntry[] = [];

  /**
   * Register a keytip entry.
   * Called by ribbon components during render.
   */
  register(entry: KeyTipEntry): void {
    // Remove existing entry with same key and tabId (if updating)
    this.entries = this.entries.filter((e) => !(e.key === entry.key && e.tabId === entry.tabId));

    // Add the new entry
    this.entries.push(entry);
  }

  /**
   * Unregister a keytip entry.
   * Called when a component unmounts.
   */
  unregister(key: string, tabId?: string): void {
    this.entries = this.entries.filter((e) => !(e.key === key && e.tabId === tabId));
  }

  /**
   * Get all tab-level keytips (no tabId).
   */
  getTabKeys(): KeyTipEntry[] {
    return this.entries.filter((e) => e.tabId === undefined);
  }

  /**
   * Get all command-level keytips for a specific tab.
   */
  getCommandKeys(tabId: string): KeyTipEntry[] {
    return this.entries.filter((e) => e.tabId === tabId);
  }

  /**
   * Find a keytip entry by key and optional tabId.
   */
  find(key: string, tabId?: string): KeyTipEntry | undefined {
    return this.entries.find((e) => e.key === key && (tabId === undefined || e.tabId === tabId));
  }

  /**
   * Clear all registered keytips.
   * Used for testing or cleanup.
   */
  clear(): void {
    this.entries = [];
  }

  /**
   * Get all registered entries (for debugging).
   */
  getAll(): KeyTipEntry[] {
    return [...this.entries];
  }
}

// Export singleton instance
export const keyTipRegistry = new KeyTipRegistry();

/**
 * Hook-friendly helper to register a keytip on mount and unregister on unmount.
 * Returns the registration function for use in useEffect.
 */
export function useKeyTipRegistration(entry: KeyTipEntry): () => void {
  return () => {
    keyTipRegistry.register(entry);
    return () => keyTipRegistry.unregister(entry.key, entry.tabId);
  };
}
