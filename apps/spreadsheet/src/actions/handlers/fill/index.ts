/**
 * Fill Action Handlers
 *
 * This module exports all fill-related action handlers.
 */

// Fill Series Dialog handlers
export {
  CLOSE_FILL_SERIES_DIALOG,
  EXECUTE_FILL_SERIES,
  OPEN_FILL_SERIES_DIALOG,
} from './fill-series-dialog';

// Double-Click Fill Handle
export {
  DOUBLE_CLICK_FILL_HANDLE,
  findAdjacentDataExtent,
  findColumnExtent,
} from './double-click-fill';

// AutoFill Options Button
export {
  APPLY_AUTOFILL_OPTION,
  HIDE_AUTOFILL_OPTIONS,
  SHOW_AUTOFILL_OPTIONS,
} from './autofill-options';

// Custom Lists
export {
  ADD_CUSTOM_LIST,
  CLOSE_CUSTOM_LISTS_DIALOG,
  DELETE_CUSTOM_LIST,
  EDIT_CUSTOM_LIST,
  OPEN_CUSTOM_LISTS_DIALOG,
} from './custom-lists';

// Fill Context Menu (Right-Click Drag Fill)
export {
  EXECUTE_FILL_COPY_CELLS,
  EXECUTE_FILL_DAYS,
  EXECUTE_FILL_FORMATTING_ONLY,
  EXECUTE_FILL_GROWTH_TREND,
  EXECUTE_FILL_LINEAR_TREND,
  EXECUTE_FILL_MONTHS,
  EXECUTE_FILL_SERIES_CONTEXT,
  EXECUTE_FILL_WEEKDAYS,
  EXECUTE_FILL_WITHOUT_FORMATTING,
  EXECUTE_FILL_YEARS,
  HIDE_FILL_CONTEXT_MENU,
  SHOW_FILL_CONTEXT_MENU,
} from './fill-context-menu';

// Flash Fill (Ctrl+E)
export {
  ACCEPT_FLASH_FILL,
  FLASH_FILL,
  REJECT_FLASH_FILL,
  SHOW_FLASH_FILL_PREVIEW,
} from './flash-fill';
