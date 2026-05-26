/**
 * Check Merged Cells
 *
 * Checks for merged cells in the sheet.
 * Merged cells can confuse screen reader cell navigation.
 */

import type { AccessibilityIssue } from '@mog-sdk/contracts/accessibility';
import type { Worksheet } from '@mog-sdk/contracts/api';

import type { AccessibilityCheckContext } from './types';
import { generateIssueId } from './types';

/**
 * Check for merged cells in the sheet.
 *
 * @param checkCtx - Accessibility check context
 * @param ws - Worksheet to check
 * @param sheetName - Sheet name for display
 * @returns Array of accessibility issues for merged cell regions
 */
export async function checkMergedCells(
  _checkCtx: AccessibilityCheckContext,
  ws: Worksheet,
  sheetName: string,
): Promise<AccessibilityIssue[]> {
  const sheetId = ws.getSheetId();
  const mergedRegions = await ws.structure.getMergedRegions();
  const issues: AccessibilityIssue[] = [];

  for (const region of mergedRegions) {
    const { startRow, startCol, endRow, endCol } = region;
    // Build A1 reference for the merged region
    const ref = `${colToLetter(startCol)}${startRow + 1}:${colToLetter(endCol)}${endRow + 1}`;

    issues.push({
      id: generateIssueId('merged-cells', sheetId, startRow, startCol, endRow, endCol),
      severity: 'warning',
      category: 'cells',
      issueType: 'merged-cells',
      title: 'Merged cells',
      description: `Merged cell region at ${ref}`,
      location: {
        sheetId,
        sheetName,
        type: 'range',
        ref,
      },
      recommendedAction: 'Consider unmerging cells for better screen reader navigation',
      whyFix: 'Merged cells can confuse screen reader cell navigation',
    });
  }

  return issues;
}

/**
 * Convert column index to letter (A, B, ..., Z, AA, AB, ...).
 */
function colToLetter(col: number): string {
  let result = '';
  let c = col;
  while (c >= 0) {
    result = String.fromCharCode((c % 26) + 65) + result;
    c = Math.floor(c / 26) - 1;
  }
  return result;
}
