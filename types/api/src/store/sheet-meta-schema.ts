/**
 * SheetMeta Schema - Type Definitions Only
 *
 * Runtime schema objects, defaults, and utility functions have been moved to:
 * @see @mog-sdk/kernel/defaults/sheet-meta
 *
 * This file retains only the type exports for the contracts layer.
 */

/**
 * Type for the schema keys - all valid SheetMeta field names.
 *
 * NOTE: The actual SHEET_META_SCHEMA object lives in @mog-sdk/kernel/defaults/sheet-meta.
 * This type is kept here for contracts-level type checking.
 */
export type SheetMetaField =
  | 'id'
  | 'name'
  | 'defaultRowHeight'
  | 'defaultColWidth'
  | 'frozenRows'
  | 'frozenCols'
  | 'tabColor'
  | 'hidden'
  | 'showGridlines'
  | 'showRowHeaders'
  | 'showColumnHeaders'
  | 'isProtected'
  | 'protectionPasswordHash'
  | 'protectionOptions'
  | 'showZeroValues'
  | 'gridlineColor'
  | 'rightToLeft'
  | 'rowPageBreaks'
  | 'colPageBreaks'
  | 'printArea'
  | 'printTitles'
  | 'printSettings'
  | 'splitConfig'
  | 'usedRange'
  | 'showFormulas'
  | 'zoomScale';
