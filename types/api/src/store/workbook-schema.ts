/**
 * WorkbookSettings Schema - Type Definitions Only
 *
 * Runtime schema objects, defaults, and utility functions have been moved to:
 * @see @mog-sdk/kernel/defaults/workbook
 *
 * This file retains only the type exports for the contracts layer.
 */

/**
 * Type for the schema keys - all valid WorkbookSettings field names.
 *
 * NOTE: The actual WORKBOOK_SETTINGS_SCHEMA object lives in @mog-sdk/kernel/defaults/workbook.
 * This type is kept here for contracts-level type checking.
 */
export type WorkbookSettingsField =
  | 'showHorizontalScrollbar'
  | 'showVerticalScrollbar'
  | 'autoHideScrollBars'
  | 'showTabStrip'
  | 'showFormulaBar'
  | 'allowSheetReorder'
  | 'autoFitOnDoubleClick'
  | 'showCutCopyIndicator'
  | 'allowDragFill'
  | 'enterKeyDirection'
  | 'allowCellDragDrop'
  | 'themeId'
  | 'themeFontsId'
  | 'culture'
  | 'selectedSheetIds'
  | 'isWorkbookProtected'
  | 'workbookProtectionPasswordHash'
  | 'workbookProtectionOptions'
  | 'calculationSettings'
  | 'date1904'
  | 'defaultTableStyleId'
  | 'appInstances'
  | 'chartDataPointTrack';
