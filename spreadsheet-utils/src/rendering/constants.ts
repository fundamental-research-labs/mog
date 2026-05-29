/**
 * Rendering Constants Runtime Functions
 *
 * Extracted from @mog-sdk/contracts/rendering/constants.
 */

import {
  MOUSE_HIT_AREA_SIZE,
  TOUCH_HIT_AREA_SIZE,
  ROW_HEADER_WIDTH,
  COL_HEADER_HEIGHT,
} from '@mog-sdk/contracts/rendering/constants';
import type { HeaderVisibility } from '@mog-sdk/contracts/rendering';

/**
 * Get the appropriate hit area size based on pointer type.
 */
export function getHitAreaSize(isTouch: boolean): number {
  return isTouch ? TOUCH_HIT_AREA_SIZE : MOUSE_HIT_AREA_SIZE;
}

/**
 * Get effective header dimensions based on visibility settings.
 */
export function getEffectiveHeaderDimensions(headerVisibility?: HeaderVisibility): {
  rowHeaderWidth: number;
  colHeaderHeight: number;
} {
  return {
    rowHeaderWidth: headerVisibility?.showRowHeaders !== false ? ROW_HEADER_WIDTH : 0,
    colHeaderHeight: headerVisibility?.showColumnHeaders !== false ? COL_HEADER_HEIGHT : 0,
  };
}
