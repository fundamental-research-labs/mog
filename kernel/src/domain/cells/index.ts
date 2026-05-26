/**
 * Cells Domain Barrel (Kernel)
 *
 * Complete Cells namespace - re-exports all cell operations.
 */

// Cell Values - core get/set operations
export {
  getCount,
  getData,
  getDataById,
  getDisplayValue,
  getEffectiveValue,
  getPropertiesById,
  getRawValue,
  getValue,
  getValueForEditing,
  setFormulaDirect,
  setPropertiesById,
  setValue,
  setValueAsText,
  setValues,
} from './cell-values';

// Cell Identity - CellId management
export { getCellIdAt, getOrCreateCellId, updateCellPosition } from './cell-identity';

// Cell Iteration - iteration and range operations
export {
  clearRange,
  clearRangeAndReturnIds,
  forEach,
  forEachInRange,
  getCurrentRegion,
  getDataBoundsForRange,
  relocateCells,
  type RelocationResult,
} from './cell-iteration';

// Cell Hyperlinks
export { getHyperlink, removeHyperlink, setHyperlink } from './cell-hyperlinks';

// Built-in Styles
export {
  BUILT_IN_STYLES,
  STYLE_CATEGORY_LABELS,
  STYLE_CATEGORY_ORDER,
  getBuiltInStyleById,
  getBuiltInStyles,
  getBuiltInStylesByCategory,
  isBuiltInStyle,
} from './built-in-styles';

// Cell Data Operations - advanced data manipulation
export {
  detectHeaders,
  getColumnHeaders,
  previewTextToColumns,
  removeDuplicates,
  textToColumns,
  type RemoveDuplicatesOptions,
  type RemoveDuplicatesResult,
  type TextToColumnsOptions,
  type TextToColumnsResult,
} from './cell-data-operations';
