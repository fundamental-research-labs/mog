/**
 * Accessibility Module
 *
 * Public API for the accessibility checker.
 *
 */

// Main checker
export {
  checkSingleSheet,
  runAccessibilityCheck,
  type AccessibilityCheckOptions,
  type AccessibilityCheckResult,
} from './checker';

// Individual check functions (for direct use or testing)
export {
  checkAllSheetNames,
  checkChartTitles,
  checkHyperlinkText,
  checkImagesAltText,
  checkMergedCells,
  checkSheetNames,
  checkTableHeaders,
  isDefaultSheetName,
} from './checks';

// Check types (for extending checks)
export { generateIssueId } from './checks/types';
export type { AccessibilityCheckContext, AccessibilityCheckFunction } from './checks/types';
