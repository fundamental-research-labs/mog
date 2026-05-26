/**
 * Environment detection for transport selection.
 *
 * Self-contained detection — no dependency on platform package.
 */

/**
 * Check if running in Tauri desktop environment.
 *
 * Tauri v2 uses __TAURI_INTERNALS__ (not __TAURI__ which was v1).
 * This function checks for both for compatibility.
 */
export function isTauri(): boolean {
  if (typeof window === 'undefined') return false;
  return '__TAURI_INTERNALS__' in window || '__TAURI__' in window;
}

/**
 * Check if we're running in a Node.js environment (not browser, not Tauri).
 *
 * Used to determine if the napi transport is available. The napi addon
 * requires `require()` which is only available in Node.js / Electron.
 */
export function isNodeEnvironment(): boolean {
  return (
    typeof process !== 'undefined' && process.versions != null && process.versions.node != null
  );
}
