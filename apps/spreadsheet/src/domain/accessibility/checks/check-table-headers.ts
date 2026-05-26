/**
 * Check Table Headers
 *
 * Checks for tables without header rows.
 * Screen readers use header rows to navigate table structure.
 *
 * Uses the unified Workbook/Worksheet API (ws.tables.list()).
 */

import type { AccessibilityIssue } from '@mog-sdk/contracts/accessibility';
import type { Worksheet } from '@mog-sdk/contracts/api';

import type { AccessibilityCheckContext } from './types';
import { generateIssueId } from './types';

/**
 * Check tables for missing header rows.
 *
 * Uses the unified Workbook/Worksheet API to list tables and check headers.
 *
 * @param checkCtx - Accessibility check context
 * @param ws - Worksheet to check
 * @param sheetName - Sheet name for display
 * @returns Array of accessibility issues for tables without headers
 */
export async function checkTableHeaders(
  _checkCtx: AccessibilityCheckContext,
  ws: Worksheet,
  sheetName: string,
): Promise<AccessibilityIssue[]> {
  const sheetId = ws.getSheetId();
  const tables = await ws.tables.list();
  const issues: AccessibilityIssue[] = [];

  for (const table of tables) {
    // Check if table has a header row
    if (!table.hasHeaderRow) {
      issues.push({
        id: generateIssueId('missing-table-header', sheetId, table.name),
        severity: 'error',
        category: 'tables',
        issueType: 'missing-table-header',
        title: 'Table missing header row',
        description: `Table "${table.name}" has no header row`,
        location: {
          sheetId,
          sheetName,
          type: 'range',
          ref: table.range,
        },
        recommendedAction: 'Add a header row to describe each column',
        whyFix: 'Screen readers use header rows to navigate table structure',
      });
    }
  }

  return issues;
}
