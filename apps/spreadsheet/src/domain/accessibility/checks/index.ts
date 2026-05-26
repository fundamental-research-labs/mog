/**
 * Accessibility Check Functions
 *
 * Individual check functions for accessibility issues.
 * All functions are PURE FUNCTIONS - no side effects, no Yjs writes.
 *
 */

// Check functions
export { checkChartTitles } from './check-chart-titles';
export { checkHyperlinkText } from './check-hyperlink-text';
export { checkImagesAltText } from './check-images-alt-text';
export { checkMergedCells } from './check-merged-cells';
export { checkAllSheetNames, checkSheetNames, isDefaultSheetName } from './check-sheet-names';
export { checkTableHeaders } from './check-table-headers';

// Types
export { generateIssueId } from './types';
export type { AccessibilityCheckContext, AccessibilityCheckFunction } from './types';
