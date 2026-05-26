/**
 * Machine Utilities
 *
 * Pure utility functions used by state machines.
 * These are co-located with machines to avoid cross-package dependencies
 * during extraction.
 *
 * @module engine/src/state/machines/utils
 */

// Clipboard parsing
export { parseHTML } from '../../../infra/utils/clipboard-utils';
export type { ParsedHTMLData } from '../../../infra/utils/clipboard-utils';

// Position adjustment for structure changes
export {
  StructureChanges,
  adjustPosition,
  adjustRange,
  changeAffectsSheet,
  getDeletedCellFallback,
  singleCellRange,
} from './position-adjusters';
export type { StructureChange } from './position-adjusters';

// Formula context analysis
export { analyzeFormulaContext, isInsideString } from './formula-context';
export type { FormulaContext, FunctionStackEntry } from './formula-context';

// Formula range parsing
export {
  extractFormulaRanges,
  findActiveReferenceIndex,
  updateFormulaReference,
} from './formula-range-parser';
export type { FormulaRangeReference } from './formula-range-parser';
