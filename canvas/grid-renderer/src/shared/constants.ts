/**
 * Canvas rendering constants
 *
 * Core dimension constants re-exported from contracts as the canonical import path.
 *
 * TYPOGRAPHY NOTE: Cell typography constants (DEFAULT_FONT_SIZE, DEFAULT_FONT_FAMILY,
 * CELL_PADDING) are not defined here. Use the single source of truth instead:
 * @see @mog-sdk/contracts/cell-style for DEFAULT_CELL_STYLE
 */

import type { ChromeTheme } from '@mog-sdk/contracts/rendering';
// Re-export from contracts — the canonical source of truth.
// eslint-disable-next-line no-duplicate-imports
export { DEFAULT_CHROME_THEME } from '@mog-sdk/contracts/rendering';

// =============================================================================
// Re-exported from contracts - these are the canonical definitions
// =============================================================================

export {
  BUFFER_COLS,
  BUFFER_ROWS,
  COL_HEADER_HEIGHT,
  DEFAULT_COL_WIDTH,
  DEFAULT_ROW_HEIGHT,
  DEFAULT_ZOOM,
  MAX_OUTLINE_LEVELS,
  MAX_ZOOM,
  MIN_COL_WIDTH,
  MIN_ROW_HEIGHT,
  MIN_ZOOM,
  MOUSE_HIT_AREA_SIZE,
  OUTLINE_BUTTON_SIZE,
  OUTLINE_LEVEL_HEIGHT,
  OUTLINE_LEVEL_WIDTH,
  ROW_HEADER_WIDTH,
  SCROLL_BAR_WIDTH,
  TOUCH_HIT_AREA_SIZE,
  ZOOM_PRESETS,
  ZOOM_STEP,
} from '@mog-sdk/contracts/rendering';
export {
  getEffectiveHeaderDimensions,
  getHitAreaSize,
} from '@mog/spreadsheet-utils/rendering/constants';

export type { HeaderVisibility } from '@mog-sdk/contracts/rendering';

// =============================================================================
// Spill Colors
// =============================================================================

export const SPILL_CELL_BG_COLOR = '#E6F2FF';

// Default Chrome Theme — re-exported from contracts above
