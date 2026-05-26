/**
 * Accessibility Check Types
 *
 * Shared types for accessibility check functions.
 */

import type { AccessibilityIssue } from '@mog-sdk/contracts/accessibility';
import type { Workbook, Worksheet } from '@mog-sdk/contracts/api';

/**
 * Context passed to accessibility check functions.
 *
 * Check functions are PURE FUNCTIONS - they only read from domain modules.
 * No side effects, no Yjs writes.
 */
export interface AccessibilityCheckContext {
  /** Workbook for unified API access */
  workbook: Workbook;
}

/**
 * Signature for accessibility check functions.
 *
 * All check functions:
 * - Are pure functions (no side effects)
 * - Take check context and the Worksheet to check
 * - Return an array of AccessibilityIssue
 * - Check only ONE sheet at a time (caller iterates sheets)
 */
export type AccessibilityCheckFunction = (
  checkCtx: AccessibilityCheckContext,
  ws: Worksheet,
  sheetName: string,
) => AccessibilityIssue[] | Promise<AccessibilityIssue[]>;

/**
 * Generate a unique issue ID.
 * Combines type and location info for uniqueness.
 */
export function generateIssueId(type: string, ...parts: (string | number)[]): string {
  return `${type}-${parts.join('-')}`;
}
