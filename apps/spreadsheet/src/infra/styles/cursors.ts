/**
 * Custom Cursors
 *
 * CSS cursor definitions for specialized tools.
 *
 * SVG cursors are embedded as data URIs, which cannot reference CSS custom
 * properties. Instead, we define JS constants sourced from the design token
 * system (tokens.css) so that color values remain in sync with the theme.
 *
 * @see infra/styles/tokens.css
 */

// =============================================================================
// Color Constants (from design tokens - keep in sync with tokens.css)
// =============================================================================
// SVG data URIs cannot use CSS `var()` references, so we duplicate the token
// values here as JS constants. If the token values change, update these too.

/** --color-ss-primary */
const TOKEN_PRIMARY = '#217346';
/** --color-ss-success */
const TOKEN_SUCCESS = '#34a853';
/** --color-ss-text (nearest semantic match for black strokes) */
const TOKEN_TEXT = '#202124';
/** --color-ss-text-secondary (nearest semantic match for dark gray) */
const TOKEN_TEXT_SECONDARY = '#5f6368';
/** --color-ss-text-tertiary (nearest semantic match for medium gray) */
const TOKEN_TEXT_TERTIARY = '#80868b';
/** --color-ss-surface / --color-ss-text-inverse (white) */
const TOKEN_SURFACE = '#ffffff';
/** --color-ss-warning (gold/yellow accents) */
const TOKEN_WARNING = '#f9ab00';
/** --color-ss-warning dark variant for strokes (--color-ss-warning-text) */
const TOKEN_WARNING_DARK = '#b45309';
/** --color-ss-error for erase/destructive cursors */
const TOKEN_ERROR = '#ea4335';
/** --color-ss-error dark variant (--color-ss-error-text) */
const TOKEN_ERROR_DARK = '#991b1b';

// Tool-specific colors with no direct token equivalent
const BRISTLE_BROWN = '#8B4513';
const HANDLE_FILL = '#E8D4B8';
const ERASER_PINK = '#FFB6C1';
const ERASER_PINK_DARK = '#FF6B81';
const HIGHLIGHTER_YELLOW = '#FFFF00';

// =============================================================================
// Format Painter Cursor
// =============================================================================

/**
 * SVG paintbrush cursor for format painter mode.
 * 16x16 icon optimized for cursor usage with hotspot at top-left.
 *
 * The SVG is converted to a data URL for use with CSS cursor property.
 */
const FORMAT_PAINTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
 <g fill="none" stroke="${TOKEN_TEXT}" stroke-linecap="round" stroke-linejoin="round" stroke-width="1">
 <!-- Brush head -->
 <rect x="9" y="1" width="5" height="7" rx="0.5" fill="${TOKEN_SUCCESS}" stroke="${TOKEN_PRIMARY}"/>
 <!-- Bristles -->
 <line x1="10" y1="8" x2="10" y2="10" stroke="${BRISTLE_BROWN}"/>
 <line x1="11.5" y1="8" x2="11.5" y2="10" stroke="${BRISTLE_BROWN}"/>
 <line x1="13" y1="8" x2="13" y2="10" stroke="${BRISTLE_BROWN}"/>
 <!-- Handle -->
 <rect x="10" y="10" width="3" height="5" rx="0.3" fill="${HANDLE_FILL}" stroke="${BRISTLE_BROWN}"/>
 </g>
</svg>`;

/**
 * Convert SVG to data URL for cursor property.
 */
function svgToDataUrl(svg: string): string {
  // Encode the SVG for use in a data URL
  const encoded = encodeURIComponent(svg).replace(/'/g, '%27').replace(/"/g, '%22');
  return `data:image/svg+xml,${encoded}`;
}

/**
 * Format painter cursor CSS value.
 *
 * The cursor has:
 * - Paintbrush icon (SVG)
 * - Hotspot at (0, 0) - top left corner
 * - Fallback to crosshair for browsers that don't support custom cursors
 *
 * Usage:
 * ```tsx
 * import { FORMAT_PAINTER_CURSOR } from '../styles/cursors';
 *
 * <div style={{ cursor: FORMAT_PAINTER_CURSOR }} />
 * ```
 */
export const FORMAT_PAINTER_CURSOR = `url('${svgToDataUrl(FORMAT_PAINTER_SVG)}') 0 0, crosshair`;

// =============================================================================
// Draw Border Cursors
// =============================================================================

/**
 * SVG pencil cursor for draw border mode.
 * 16x16 icon optimized for cursor usage with hotspot at bottom-left (the tip).
 */
const DRAW_BORDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
 <g fill="none" stroke="${TOKEN_TEXT}" stroke-linecap="round" stroke-linejoin="round" stroke-width="1">
 <!-- Pencil body -->
 <path d="M2 14 L4 12 L12 4 L14 2" fill="${TOKEN_WARNING}" stroke="${TOKEN_WARNING_DARK}"/>
 <!-- Pencil tip -->
 <path d="M2 14 L1 15 L2 16 L4 12 Z" fill="${TOKEN_TEXT_SECONDARY}" stroke="${TOKEN_TEXT}"/>
 <!-- Eraser -->
 <path d="M12 4 L14 2 L15 3 L13 5 Z" fill="${ERASER_PINK}" stroke="${TOKEN_TEXT}"/>
 </g>
</svg>`;

/**
 * Draw border cursor CSS value.
 * Hotspot at (1, 15) - near the pencil tip at bottom-left.
 */
export const DRAW_BORDER_CURSOR = `url('${svgToDataUrl(DRAW_BORDER_SVG)}') 1 15, crosshair`;

/**
 * SVG eraser cursor for erase border mode.
 * 16x16 icon optimized for cursor usage.
 */
const ERASE_BORDER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
 <g fill="none" stroke="${TOKEN_TEXT}" stroke-linecap="round" stroke-linejoin="round" stroke-width="1">
 <!-- Eraser body -->
 <rect x="1" y="8" width="12" height="6" rx="1" fill="${ERASER_PINK}" stroke="${TOKEN_ERROR}"/>
 <!-- Eraser top (used part) -->
 <rect x="1" y="8" width="12" height="3" rx="0" fill="${ERASER_PINK_DARK}" stroke="none"/>
 <!-- Dust particles -->
 <circle cx="3" cy="6" r="0.5" fill="${TOKEN_TEXT_TERTIARY}"/>
 <circle cx="6" cy="5" r="0.5" fill="${TOKEN_TEXT_TERTIARY}"/>
 <circle cx="9" cy="6" r="0.5" fill="${TOKEN_TEXT_TERTIARY}"/>
 </g>
</svg>`;

/**
 * Erase border cursor CSS value.
 * Hotspot at (7, 14) - center bottom of eraser.
 */
export const ERASE_BORDER_CURSOR = `url('${svgToDataUrl(ERASE_BORDER_SVG)}') 7 14, not-allowed`;

// =============================================================================
// Auto-Scroll Cursors
// =============================================================================

/**
 * SVG for middle-click auto-scroll cursor.
 * Shows a 4-directional arrow icon indicating scrolling in all directions.
 * 16x16 icon with hotspot at center.
 */
const AUTO_SCROLL_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
 <g fill="${TOKEN_TEXT_SECONDARY}" stroke="${TOKEN_SURFACE}" stroke-width="0.5">
 <!-- Center circle -->
 <circle cx="8" cy="8" r="2" fill="${TOKEN_TEXT_SECONDARY}"/>
 <!-- Up arrow -->
 <path d="M8 0 L10 4 L6 4 Z"/>
 <!-- Down arrow -->
 <path d="M8 16 L10 12 L6 12 Z"/>
 <!-- Left arrow -->
 <path d="M0 8 L4 6 L4 10 Z"/>
 <!-- Right arrow -->
 <path d="M16 8 L12 6 L12 10 Z"/>
 </g>
</svg>`;

/**
 * Middle-click auto-scroll cursor CSS value.
 *
 * Shows a 4-directional arrow icon when middle-click auto-scroll mode is active.
 * Hotspot at (8, 8) - center of the icon.
 *
 * Usage:
 * ```tsx
 * import { AUTO_SCROLL_CURSOR } from '../styles/cursors';
 *
 * // When in panning/auto-scroll mode
 * <div style={{ cursor: isPanning ? AUTO_SCROLL_CURSOR : 'default' }} />
 * ```
 */
export const AUTO_SCROLL_CURSOR = `url('${svgToDataUrl(AUTO_SCROLL_SVG)}') 8 8, all-scroll`;

/**
 * Grabbing cursor for active panning.
 * Standard CSS cursor for when user is actively dragging to pan.
 */
export const GRABBING_CURSOR = 'grabbing';

/**
 * Grab cursor for indicating pan capability.
 * Standard CSS cursor for when user hovers over a pannable area while holding space.
 */
export const GRAB_CURSOR = 'grab';

// =============================================================================
// Ink Drawing Cursors (Wave 5 - Ink Engine)
// =============================================================================

/**
 * SVG pen cursor for ink drawing mode.
 * A small dot cursor matching Excel's pen tool behavior.
 * The dot indicates where the stroke will be drawn.
 */
const INK_PEN_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
 <circle cx="8" cy="8" r="3" fill="${TOKEN_TEXT}" stroke="${TOKEN_SURFACE}" stroke-width="1"/>
</svg>`;

/**
 * SVG highlighter cursor for ink highlighting mode.
 * A larger, semi-transparent yellow dot.
 */
const INK_HIGHLIGHTER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
 <circle cx="8" cy="8" r="5" fill="${HIGHLIGHTER_YELLOW}" fill-opacity="0.6" stroke="${TOKEN_WARNING_DARK}" stroke-width="1"/>
</svg>`;

/**
 * SVG eraser cursor for ink erasing mode.
 * A circle outline indicating the erase area.
 */
const INK_ERASER_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 16 16">
 <circle cx="8" cy="8" r="6" fill="none" stroke="${TOKEN_TEXT_SECONDARY}" stroke-width="2"/>
</svg>`;

/**
 * Ink pen cursor CSS value.
 * Shows a small dot indicating the pen tip position.
 * Hotspot at center (8, 8).
 */
export const INK_PEN_CURSOR = `url('${svgToDataUrl(INK_PEN_SVG)}') 8 8, crosshair`;

/**
 * Ink highlighter cursor CSS value.
 * Shows a larger yellow dot for highlighting.
 * Hotspot at center (8, 8).
 */
export const INK_HIGHLIGHTER_CURSOR = `url('${svgToDataUrl(INK_HIGHLIGHTER_SVG)}') 8 8, crosshair`;

/**
 * Ink eraser cursor CSS value.
 * Shows a circle outline for the erase area.
 * Hotspot at center (8, 8).
 */
export const INK_ERASER_CURSOR = `url('${svgToDataUrl(INK_ERASER_SVG)}') 8 8, crosshair`;

/**
 * Get the appropriate ink cursor for a given tool.
 *
 * @param tool - The ink tool type
 * @returns The CSS cursor value for the tool
 */
export function getInkCursor(tool: string): string {
  switch (tool) {
    case 'pen':
    case 'pencil':
    case 'marker':
    case 'brush':
      return INK_PEN_CURSOR;
    case 'highlighter':
      return INK_HIGHLIGHTER_CURSOR;
    case 'eraser':
      return INK_ERASER_CURSOR;
    default:
      return INK_PEN_CURSOR;
  }
}
