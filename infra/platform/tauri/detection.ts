/**
 * Platform detection utilities for Spreadsheet OS.
 *
 * Provides runtime detection of the execution environment (Tauri desktop vs web browser).
 */

/**
 * Check if running in Tauri desktop environment.
 *
 * Tauri v2 uses __TAURI_INTERNALS__ (not __TAURI__ which was v1).
 * This function checks for both for compatibility.
 *
 * @returns true if running in Tauri, false if running in a web browser
 *
 * @example
 * ```ts
 * if (isTauri()) {
 *   // Use native file system
 *   const fs = new TauriFileSystem();
 * } else {
 *   // Use the browser/web filesystem configured by the host
 *   const fs = webFilesystem;
 * }
 * ```
 */
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  // Tauri v2 uses __TAURI_INTERNALS__, v1 used __TAURI__
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

/**
 * Check if running in web browser (not Tauri).
 *
 * @returns true if running in a web browser, false if running in Tauri
 */
export function isWeb(): boolean {
  return typeof window !== 'undefined' && !isTauri();
}

/**
 * Get the platform name for the current environment.
 *
 * @returns 'desktop' for Tauri, 'web' for browser
 */
export function getPlatformName(): 'desktop' | 'web' {
  return isTauri() ? 'desktop' : 'web';
}
