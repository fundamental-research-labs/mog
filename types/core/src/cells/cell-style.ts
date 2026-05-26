/**
 * Cell Text Style - THE CANONICAL SOURCE OF TRUTH
 *
 * This module defines how cell text appears. Both canvas rendering and in-cell
 * editing MUST derive their styling from this module.
 *
 * ARCHITECTURAL CONTRACT:
 * - Canvas renderer uses resolveCellTextStyle() → getCellCanvasFont() adapter
 * - In-cell editor uses resolveCellTextStyle() → getCellDOMStyle() adapter
 * - Changes here automatically update both systems
 *
 * DO NOT duplicate these values elsewhere. If you need cell styling defaults,
 * import from this module.
 *
 * @see engine/src/canvas/cell-style-adapters.ts for platform-specific adapters
 */

import type { CellFormat } from '../core';

// =============================================================================
// Default Cell Style Constants
// =============================================================================

/**
 * Default cell styling values.
 * These define the contract for how an unformatted cell appears.
 */
export const DEFAULT_CELL_STYLE = {
  /** Default font size in pixels */
  fontSize: 12,
  /** Default font family stack */
  fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, sans-serif',
  /** Default font color */
  fontColor: '#000000',
  /** Horizontal padding inside cells (pixels) */
  padding: 4,
  /** Default horizontal alignment */
  horizontalAlign: 'left' as const,
  /** Default vertical alignment - matches Excel default ('bottom') */
  verticalAlign: 'bottom' as const,
  /** Default background (transparent, falls back to surface) */
  backgroundColor: undefined as string | undefined,
} as const;

// =============================================================================
// Resolved Cell Text Style Interface
// =============================================================================

/**
 * Fully resolved cell text style.
 *
 * This is the complete, computed style for rendering cell text.
 * All optional CellFormat properties are resolved to concrete values.
 */
export interface CellTextStyle {
  // Positioning
  /** Horizontal padding in pixels */
  paddingX: number;

  // Typography
  /** Font size in pixels */
  fontSize: number;
  /** Font family CSS value */
  fontFamily: string;
  /** Font weight */
  fontWeight: 'normal' | 'bold';
  /** Font style */
  fontStyle: 'normal' | 'italic';
  /** Text color */
  color: string;
  /** Text decoration (underline, line-through, or both) */
  textDecoration: string;
  /** Horizontal text alignment */
  textAlign: 'left' | 'center' | 'right' | 'justify';

  // Vertical alignment
  /** Vertical text alignment */
  verticalAlign: 'top' | 'middle' | 'bottom';
  /** Line height multiplier (1 = tight, matches canvas) */
  lineHeight: number;

  // Background
  /** Background color (undefined = transparent/inherit) */
  backgroundColor: string | undefined;
}
