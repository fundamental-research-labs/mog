/**
 * Browser Keyboard Layout API wrapper.
 *
 * Wraps navigator.keyboard (Chromium-only) to provide layout-aware key labels.
 * Falls back to QWERTY labels when the API is unavailable (Safari/Firefox).
 *
 * This module lives in the platform layer (not kernel) because it calls
 * browser APIs directly. The kernel receives the layout map as data via injection.
 *
 * @see https://wicg.github.io/keyboard-map/
 */

/// <reference path="./keyboard-api.d.ts" />

import type { PhysicalKeyCode } from '@mog-sdk/contracts/keyboard';

// =============================================================================
// QWERTY Fallback Map
// =============================================================================

/**
 * QWERTY fallback labels for letter and digit keys.
 *
 * Used when the Keyboard API is unavailable or returns null.
 * This produces the same labels as the previous code path
 * (stripping 'Key' or 'Digit' prefix).
 */
function fallbackQwertyLabel(code: PhysicalKeyCode): string {
  if (code.startsWith('Key')) {
    return code.slice(3); // KeyA -> A
  }
  if (code.startsWith('Digit')) {
    return code.slice(5); // Digit1 -> 1
  }
  // For any other code, return the code itself — callers handle
  // special keys, function keys, etc. before reaching this point.
  return code;
}

// =============================================================================
// Layout Map
// =============================================================================

/**
 * Get the current keyboard layout map from the browser.
 *
 * Returns null when:
 * - The Keyboard API is unavailable (Safari, Firefox, non-browser)
 * - The API is denied by Permissions-Policy (cross-origin iframes)
 * - Any other error occurs
 *
 * @returns Layout map mapping physical key codes to characters, or null
 */
export async function getLayoutMap(): Promise<ReadonlyMap<string, string> | null> {
  if (!navigator.keyboard?.getLayoutMap) return null;
  try {
    return await navigator.keyboard.getLayoutMap();
  } catch {
    // API exists but denied — happens in cross-origin iframes (Permissions-Policy: keyboard-map=())
    // or when the browser restricts the API for other security reasons.
    // Fallback to QWERTY labels is correct behavior.
    return null;
  }
}

// =============================================================================
// Layout Change Subscription
// =============================================================================

/**
 * Subscribe to keyboard layout changes.
 *
 * When the user switches keyboard layout (e.g., from QWERTY to AZERTY),
 * the callback fires. Returns an unsubscribe function.
 *
 * Returns a no-op unsubscribe when the API is unavailable.
 *
 * @param cb - Callback invoked when the layout changes
 * @returns Unsubscribe function
 */
export function onLayoutChange(cb: () => void): () => void {
  if (!navigator.keyboard?.addEventListener) return () => {};
  navigator.keyboard.addEventListener('layoutchange', cb);
  return () => navigator.keyboard?.removeEventListener('layoutchange', cb);
}

// =============================================================================
// Key Label Resolution
// =============================================================================

/**
 * Resolve a physical key code to the layout-correct display label.
 *
 * Pure function. Uses the layout map when available, falls back to
 * QWERTY labels (stripping Key/Digit prefix) when the map is null
 * or doesn't contain the code.
 *
 * Only meaningful for letter and digit keys — special keys (arrows,
 * F-keys, modifiers, etc.) should be handled by the display name
 * tables in display-utils.ts before calling this function.
 *
 * The returned label is uppercase for consistency with display conventions.
 *
 * @param code - The physical key code (e.g., 'KeyQ')
 * @param layoutMap - The layout map from getLayoutMap(), or null
 * @returns The display label (e.g., 'A' on AZERTY for 'KeyQ')
 */
export function resolveKeyLabel(
  code: PhysicalKeyCode,
  layoutMap: ReadonlyMap<string, string> | null,
): string {
  const layoutValue = layoutMap?.get(code);
  if (layoutValue) {
    return layoutValue.toUpperCase();
  }
  return fallbackQwertyLabel(code);
}
