/**
 * Autofit Operations
 *
 * Functions for auto-fitting column widths and row heights based on cell content.
 * These operations use TextMeasurementService for text measurement (dependency injection).
 *
 * @module state/coordinator/operations/autofit
 */

export { autoFitColumns, calculateColumnAutoFitWidth } from './column-autofit';
export { autoFitRows, calculateRowAutoFitHeight } from './row-autofit';
export {
  getAutofitColumnsForResize,
  getAutofitColumnsForSelection,
  getAutofitRowsForResize,
  getAutofitRowsForSelection,
} from './selection-targets';
