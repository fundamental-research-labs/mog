/**
 * Border Style Constants and Presets
 *
 * Provides standardized border style definitions used across border handlers.
 * These constants ensure consistent border styling throughout the application.
 *
 * Future: May be extended to support theme-aware border colors.
 */

import type { BorderStyle } from '@mog-sdk/contracts/core';

/**
 * Standard thin border (1px solid black).
 * Used for most border operations including outlines and all-borders.
 */
export const THIN_BORDER: BorderStyle = { style: 'thin', color: '#000000' };

/**
 * Thick border (2px solid black).
 * Used for emphasis borders like thick bottom.
 */
export const THICK_BORDER: BorderStyle = { style: 'thick', color: '#000000' };

/**
 * Double-line border.
 * Used for accounting-style borders and totals.
 */
export const DOUBLE_BORDER: BorderStyle = { style: 'double', color: '#000000' };
