/**
 * CSS Variable Reader & Writer for Canvas
 *
 * Utilities for reading CSS custom properties (design tokens) from globals.css
 * for use in canvas rendering. Canvas can't directly use CSS variables, so we
 * read them from computed styles and cache them.
 *
 * Also provides applyChromeTheme() — the CSS Variable Bridge that writes
 * ChromeTheme values as CSS custom properties on a container element,
 * enabling shell UI (toolbar, dialogs, context menus) to pick up theme
 * colors via var(--color-ss-*).
 *
 * ARCHITECTURE:
 * - Single source of truth: globals.css @theme section
 * - Canvas layers call getCSSVariable() to read tokens
 * - Values are cached and invalidated on theme/root style changes
 * - applyChromeTheme() bridges canvas ChromeTheme → CSS variables
 *
 * @module canvas/styles/css-variables
 */

import type { ChromeTheme } from '@mog-sdk/contracts/rendering';

// =============================================================================
// CSS Variable Cache
// =============================================================================

/**
 * Cache for CSS variable values.
 * Invalidated when document root styles change.
 */
const cssVariableCache = new Map<string, string>();

/**
 * Whether the cache has been initialized.
 */
let cacheInitialized = false;

// =============================================================================
// CSS Variable Reader
// =============================================================================

/**
 * Get a CSS variable value from :root.
 *
 * Reads the computed value of a CSS custom property and caches it.
 * Returns the fallback if the variable is not defined or we're in a
 * non-browser environment (SSR, tests).
 *
 * @param name - Variable name WITHOUT the -- prefix (e.g., 'color-trace-precedent')
 * @param fallback - Fallback value if variable is not defined
 * @returns The CSS variable value or fallback
 *
 * @example
 * // Read trace arrow colors from globals.css
 * const precedentColor = getCSSVariable('color-trace-precedent', '#0066cc');
 * const dependentColor = getCSSVariable('color-trace-dependent', '#cc0000');
 */
export function getCSSVariable(name: string, fallback: string): string {
  // Check cache first
  if (cssVariableCache.has(name)) {
    return cssVariableCache.get(name)!;
  }

  // In non-browser environments, return fallback
  if (typeof document === 'undefined') {
    return fallback;
  }

  // Initialize cache listener on first call
  if (!cacheInitialized) {
    initCacheInvalidation();
    cacheInitialized = true;
  }

  // Read from computed styles
  const value = getComputedStyle(document.documentElement).getPropertyValue(`--${name}`).trim();

  // Cache and return (use fallback if empty)
  const result = value || fallback;
  cssVariableCache.set(name, result);
  return result;
}

/**
 * Clear the CSS variable cache.
 * Call this when theme changes or styles are dynamically updated.
 */
export function clearCSSVariableCache(): void {
  cssVariableCache.clear();
}

/**
 * Pre-load multiple CSS variables into the cache.
 * Useful for batch initialization during layer setup.
 *
 * @param variables - Map of variable names to fallback values
 * @returns Map of variable names to resolved values
 */
export function preloadCSSVariables(variables: Record<string, string>): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [name, fallback] of Object.entries(variables)) {
    result[name] = getCSSVariable(name, fallback);
  }
  return result;
}

// =============================================================================
// Cache Invalidation
// =============================================================================

/**
 * Initialize cache invalidation listeners.
 * Watches for style changes that might affect CSS variables.
 */
function initCacheInvalidation(): void {
  // Clear cache when window resizes (can trigger media query changes)
  // Using a debounced approach to avoid excessive clearing
  let resizeTimeout: ReturnType<typeof setTimeout>;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimeout);
    resizeTimeout = setTimeout(clearCSSVariableCache, 250);
  });

  // Note: For dynamic theme switching, call clearCSSVariableCache() explicitly
  // after updating CSS variables. MutationObserver on :root styles is possible
  // but adds complexity for a rare use case.
}

// =============================================================================
// Trace Arrow Color Tokens
// =============================================================================

/**
 * Trace arrow color token names (as defined in globals.css).
 * These are the semantic names WITHOUT the -- prefix.
 */
export const TRACE_ARROW_CSS_VARS = {
  precedent: 'color-trace-precedent',
  dependent: 'color-trace-dependent',
  external: 'color-trace-external',
} as const;

/**
 * Fallback values for trace arrow colors.
 * Used when CSS variables are not available (tests, SSR).
 */
export const TRACE_ARROW_FALLBACKS = {
  precedent: '#0066cc',
  dependent: '#cc0000',
  external: '#000000',
} as const;

/**
 * Get trace arrow colors from CSS variables.
 * Convenience function for TraceArrowsLayer initialization.
 *
 * @returns Object with precedent, dependent, and external colors
 */
export function getTraceArrowColors(): {
  precedent: string;
  dependent: string;
  external: string;
} {
  return {
    precedent: getCSSVariable(TRACE_ARROW_CSS_VARS.precedent, TRACE_ARROW_FALLBACKS.precedent),
    dependent: getCSSVariable(TRACE_ARROW_CSS_VARS.dependent, TRACE_ARROW_FALLBACKS.dependent),
    external: getCSSVariable(TRACE_ARROW_CSS_VARS.external, TRACE_ARROW_FALLBACKS.external),
  };
}

// =============================================================================
// UI Layer Color Tokens (Stream C4)
// =============================================================================

/**
 * Resize visual feedback color token names.
 * Used by UILayer for column/row header resize drag visualization.
 */
export const RESIZE_CSS_VARS = {
  line: 'color-resize-line',
  tooltipBg: 'color-resize-tooltip-bg',
  tooltipText: 'color-resize-tooltip-text',
} as const;

/**
 * Fallback values for resize colors.
 * Used when CSS variables are not available (tests, SSR).
 */
export const RESIZE_FALLBACKS = {
  line: '#34a853',
  tooltipBg: 'rgba(50, 50, 50, 0.9)',
  tooltipText: '#ffffff',
} as const;

/**
 * Get resize colors from CSS variables.
 * Convenience function for UILayer initialization.
 *
 * @returns Object with resize line and tooltip colors
 */
export function getResizeColors(): {
  line: string;
  tooltipBg: string;
  tooltipText: string;
} {
  return {
    line: getCSSVariable(RESIZE_CSS_VARS.line, RESIZE_FALLBACKS.line),
    tooltipBg: getCSSVariable(RESIZE_CSS_VARS.tooltipBg, RESIZE_FALLBACKS.tooltipBg),
    tooltipText: getCSSVariable(RESIZE_CSS_VARS.tooltipText, RESIZE_FALLBACKS.tooltipText),
  };
}

/**
 * Cell drag-drop color token names.
 * Used by UILayer for drag source/target visualization.
 */
export const DRAG_DROP_CSS_VARS = {
  source: 'color-drag-source',
  target: 'color-drag-target',
  targetFill: 'color-drag-target-fill',
  copyMode: 'color-drag-copy-mode',
} as const;

/**
 * Fallback values for drag-drop colors.
 * Used when CSS variables are not available (tests, SSR).
 */
export const DRAG_DROP_FALLBACKS = {
  source: 'rgba(33, 115, 70, 0.15)',
  target: '#217346',
  targetFill: 'rgba(33, 115, 70, 0.1)',
  copyMode: '#34a853',
} as const;

/**
 * Get drag-drop colors from CSS variables.
 * Convenience function for UILayer initialization.
 *
 * @returns Object with drag source and target colors
 */
export function getDragDropColors(): {
  source: string;
  target: string;
  targetFill: string;
  copyMode: string;
} {
  return {
    source: getCSSVariable(DRAG_DROP_CSS_VARS.source, DRAG_DROP_FALLBACKS.source),
    target: getCSSVariable(DRAG_DROP_CSS_VARS.target, DRAG_DROP_FALLBACKS.target),
    targetFill: getCSSVariable(DRAG_DROP_CSS_VARS.targetFill, DRAG_DROP_FALLBACKS.targetFill),
    copyMode: getCSSVariable(DRAG_DROP_CSS_VARS.copyMode, DRAG_DROP_FALLBACKS.copyMode),
  };
}

// =============================================================================
// Chrome Theme → CSS Variable Bridge
// =============================================================================

/**
 * Apply ChromeTheme values as CSS custom properties on a container element.
 *
 * This bridges the canvas ChromeTheme (used by grid-renderer layers for direct
 * canvas drawing) to CSS variables that shell UI components (toolbar, dialogs,
 * context menus, sheet tabs) can consume via `var(--color-ss-*)`.
 *
 * Variable names follow the existing `--color-ss-` convention from tokens.css.
 * Some variables (--color-ss-primary, --color-ss-surface) override the default
 * Tailwind theme tokens when a custom ChromeTheme is applied, ensuring the
 * entire UI responds to theme changes.
 *
 * @param theme - The ChromeTheme to apply
 * @param container - The container element to set CSS variables on
 */
export function applyChromeTheme(theme: ChromeTheme, container: HTMLElement): void {
  clearCSSVariableCache();
  const style = container.style;

  // Surface & grid
  style.setProperty('--color-ss-surface', theme.canvasBackground);
  style.setProperty('--color-ss-grid-line', theme.gridlineColor);

  // Headers
  style.setProperty('--color-ss-header-bg', theme.headerBackground);
  style.setProperty('--color-ss-header-text', theme.headerText);
  style.setProperty('--color-ss-header-border', theme.headerBorder);
  style.setProperty('--color-ss-header-highlight-bg', theme.headerHighlightBackground);
  style.setProperty('--color-ss-header-highlight-text', theme.headerHighlightText);

  // Selection
  style.setProperty('--color-ss-primary', theme.selectionBorder);
  style.setProperty('--color-ss-selection-fill', theme.selectionFill);
  style.setProperty('--color-ss-selection-border', theme.selectionBorder);
  style.setProperty('--color-ss-active-cell-border', theme.activeCellBorder);
  style.setProperty('--color-ss-fill-handle', theme.fillHandleColor);

  // Scrollbar
  style.setProperty('--color-ss-scrollbar-track', theme.scrollbarTrack);
  style.setProperty('--color-ss-scrollbar-thumb', theme.scrollbarThumb);
}
