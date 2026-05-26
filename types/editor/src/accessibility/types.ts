/**
 * Accessibility Checker Types
 *
 * Type definitions for accessibility issues found during spreadsheet analysis.
 * Used by the accessibility checker to report problems and help users fix them.
 *
 */

// =============================================================================
// Issue Severity & Categories
// =============================================================================

/**
 * Severity level for accessibility issues.
 * - error: Critical issues that must be fixed (e.g., missing alt text)
 * - warning: Potential issues that may confuse screen readers (e.g., merged cells)
 * - tip: Improvement suggestions (e.g., default sheet names)
 */
export type AccessibilityIssueSeverity = 'error' | 'warning' | 'tip';

/**
 * Category of accessibility issue.
 * Maps to the collapsible sections in the accessibility checker panel.
 */
export type AccessibilityIssueCategory =
  | 'images'
  | 'tables'
  | 'sheets'
  | 'cells'
  | 'charts'
  | 'hyperlinks';

/**
 * Type of location that the issue refers to.
 */
export type AccessibilityLocationType = 'cell' | 'range' | 'object' | 'sheet';

/**
 * Specific types of accessibility issues.
 * Used for mapping to fix actions and filtering.
 */
export type AccessibilityIssueType =
  | 'missing-alt-text'
  | 'missing-table-header'
  | 'default-sheet-name'
  | 'merged-cells'
  | 'missing-chart-title'
  | 'hyperlink-text-is-url';

// =============================================================================
// Issue Location
// =============================================================================

/**
 * Location of an accessibility issue within the workbook.
 * Provides enough information to navigate to and highlight the issue.
 */
export interface AccessibilityIssueLocation {
  /** The sheet containing the issue */
  sheetId: string;
  /** Human-readable sheet name for display */
  sheetName: string;
  /** Type of location */
  type: AccessibilityLocationType;
  /** Cell reference like "A1" or range like "A1:B5" (for cell/range types) */
  ref?: string;
  /** Floating object ID (for images, charts, etc.) */
  objectId?: string;
}

// =============================================================================
// Accessibility Issue
// =============================================================================

/**
 * An accessibility issue found during workbook analysis.
 *
 * Issues contain all information needed to:
 * - Display in the accessibility checker panel
 * - Navigate to the problem location
 * - Provide fix suggestions
 * - Explain why it matters
 */
export interface AccessibilityIssue {
  /** Unique identifier for this issue */
  id: string;
  /** Severity level */
  severity: AccessibilityIssueSeverity;
  /** Category for grouping in UI */
  category: AccessibilityIssueCategory;
  /** Specific issue type for fix action mapping */
  issueType: AccessibilityIssueType;
  /** Short title describing the issue */
  title: string;
  /** Detailed description of the problem */
  description: string;
  /** Location of the issue in the workbook */
  location: AccessibilityIssueLocation;
  /** Suggested action to fix the issue */
  recommendedAction: string;
  /** Explanation of why this issue matters for accessibility */
  whyFix: string;
}
