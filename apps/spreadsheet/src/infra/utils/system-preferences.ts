/**
 * System Preferences Detection
 *
 * Detects system-level preferences for scroll behavior, motion, and accessibility.
 *
 */

// =============================================================================
// DEFAULT VALUES
// =============================================================================

/**
 * Default scroll line height in pixels.
 * Used when system preference cannot be detected.
 *
 * This value is based on typical OS defaults:
 * - Windows: 3 lines * ~17px line height = ~51px per wheel notch
 * - macOS: Varies by trackpad sensitivity, typically 20-30px per tick
 * - Linux: Usually 3 lines, similar to Windows
 *
 * We use 20px as a conservative default that works well across platforms.
 */
export const DEFAULT_LINE_HEIGHT = 20;

/**
 * Default page size multiplier.
 * When deltaMode is 2 (pages), multiply by this fraction of viewport.
 */
export const DEFAULT_PAGE_MULTIPLIER = 0.9;

// =============================================================================
// CACHED SYSTEM PREFERENCES
// =============================================================================

interface SystemScrollPreferences {
  /** Scroll line height in pixels */
  lineHeight: number;
  /** Whether reduced motion is preferred */
  prefersReducedMotion: boolean;
  /** Whether the system uses smooth scrolling */
  smoothScrolling: boolean;
}

let cachedPreferences: SystemScrollPreferences | null = null;

// =============================================================================
// DETECTION FUNCTIONS
// =============================================================================

/**
 * Detect whether the user prefers reduced motion.
 * This should disable momentum scrolling and animations.
 */
function detectReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return false;
  }

  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

/**
 * Detect system scroll line height based on OS.
 *
 * Unfortunately, browsers don't expose the system's scroll line height setting directly.
 * The best we can do is use sensible defaults based on the platform.
 *
 * On macOS, the trackpad scroll is pixel-based (deltaMode: 0), so this mostly
 * affects mouse wheel users with deltaMode: 1 (lines).
 *
 * @param os - The operating system identifier. When omitted, falls back to DEFAULT_LINE_HEIGHT.
 */
function detectLineHeight(os?: 'macos' | 'windows' | 'linux'): number {
  if (os === 'macos') {
    return 16; // Smaller increment for smooth trackpad scrolling
  }

  if (os === 'windows') {
    return 40; // Larger increment for mouse wheel
  }

  // Linux and unknown platforms
  return DEFAULT_LINE_HEIGHT;
}

/**
 * Detect whether smooth scrolling is enabled.
 * Not reliably detectable, so we default to true and let reduced motion override.
 */
function detectSmoothScrolling(): boolean {
  // If reduced motion is preferred, disable smooth scrolling
  return !detectReducedMotion();
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Get system scroll preferences.
 * Cached after first call for performance.
 *
 * @param os - The operating system identifier, used for line height detection.
 *
 * Usage:
 * ```typescript
 * const prefs = getSystemScrollPreferences('macos');
 * const scrollAmount = event.deltaY * prefs.lineHeight;
 * ```
 */
export function getSystemScrollPreferences(
  os?: 'macos' | 'windows' | 'linux',
): SystemScrollPreferences {
  if (cachedPreferences) {
    return cachedPreferences;
  }

  cachedPreferences = {
    lineHeight: detectLineHeight(os),
    prefersReducedMotion: detectReducedMotion(),
    smoothScrolling: detectSmoothScrolling(),
  };

  return cachedPreferences;
}

/**
 * Get scroll line height in pixels.
 * Convenience function for the most common use case.
 */
export function getScrollLineHeight(): number {
  return getSystemScrollPreferences().lineHeight;
}

/**
 * Check if reduced motion is preferred.
 * When true, disable momentum scrolling and animations.
 */
export function prefersReducedMotion(): boolean {
  return getSystemScrollPreferences().prefersReducedMotion;
}

/**
 * Clear cached preferences.
 * Call this if system preferences might have changed (e.g., on visibility change).
 */
export function clearPreferencesCache(): void {
  cachedPreferences = null;
}

/**
 * Subscribe to reduced motion preference changes.
 * Returns an unsubscribe function.
 *
 * Usage:
 * ```typescript
 * const unsubscribe = subscribeToMotionPreference((prefersReduced) => {
 * config.momentumEnabled = !prefersReduced;
 * });
 * ```
 */
export function subscribeToMotionPreference(
  callback: (prefersReduced: boolean) => void,
): () => void {
  if (typeof window === 'undefined' || !window.matchMedia) {
    return () => {};
  }

  try {
    const mediaQuery = window.matchMedia('(prefers-reduced-motion: reduce)');

    const handler = (event: MediaQueryListEvent) => {
      // Clear cache so new value is picked up
      clearPreferencesCache();
      callback(event.matches);
    };

    // Modern API (supported by all modern browsers)
    // The legacy addListener/removeListener API was deprecated but may still exist in older browsers.
    // We use addEventListener which is the standard API.
    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  } catch {
    return () => {};
  }
}
