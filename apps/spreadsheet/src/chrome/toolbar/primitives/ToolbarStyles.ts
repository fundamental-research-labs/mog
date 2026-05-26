/**
 * Toolbar Constants
 *
 * Data constants for toolbar components.
 * Style definitions have been migrated to Tailwind CSS.
 *
 * @see components/ui/Button.tsx - Button primitive with xs size for toolbar icons
 * @see components/ui/Select.tsx - Select primitive with xs size for toolbar
 * @see styles/globals.css - Design tokens
 */

// =============================================================================
// Font Constants
// =============================================================================

export const FONT_FAMILIES = [
  'Arial',
  'Calibri',
  'Times New Roman',
  'Georgia',
  'Verdana',
  'Courier New',
  'Comic Sans MS',
  'Impact',
  'Trebuchet MS',
  'Palatino Linotype',
];

export const FONT_SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72];

export const DEFAULT_FONT_FAMILY = 'Arial';
export const DEFAULT_FONT_SIZE = 11;

// Font size validation constants (C2: Custom Font Size Input)
export const MIN_FONT_SIZE = 1;
export const MAX_FONT_SIZE = 409;
export const FONT_SIZE_STEP = 1;

/**
 * Threshold below which a font size warning is shown.
 * Font sizes below 6pt are technically valid but may be difficult to read.
 */
export const FONT_SIZE_WARNING_THRESHOLD = 6;
