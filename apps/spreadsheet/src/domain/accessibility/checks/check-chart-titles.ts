/**
 * Check Chart Titles
 *
 * Checks for charts without titles.
 * Screen readers need chart titles to provide context.
 */

import type { AccessibilityIssue } from '@mog-sdk/contracts/accessibility';
import type { Worksheet } from '@mog-sdk/contracts/api';

import type { AccessibilityCheckContext } from './types';
import { generateIssueId } from './types';

/**
 * Check charts for missing titles.
 *
 * Uses the unified Workbook/Worksheet API (ws.listCharts()) for async chart access.
 *
 * @param checkCtx - Accessibility check context
 * @param ws - Worksheet to check
 * @param sheetName - Sheet name for display
 * @returns Array of accessibility issues for charts without titles
 */
export async function checkChartTitles(
  _checkCtx: AccessibilityCheckContext,
  ws: Worksheet,
  sheetName: string,
): Promise<AccessibilityIssue[]> {
  const sheetId = ws.getSheetId();
  const charts = await ws.charts.list();
  const issues: AccessibilityIssue[] = [];

  for (const chart of charts) {
    // Check if chart has a title (not missing and not empty/whitespace)
    if (!chart.title || chart.title.trim() === '') {
      issues.push({
        id: generateIssueId('missing-chart-title', sheetId, chart.id),
        severity: 'warning',
        category: 'charts',
        issueType: 'missing-chart-title',
        title: 'Chart missing title',
        description: `Chart "${chart.id}" has no title`,
        location: {
          sheetId,
          sheetName,
          type: 'object',
          objectId: chart.id,
        },
        recommendedAction: 'Add a descriptive title to the chart',
        whyFix: 'Screen readers need chart titles to provide context',
      });
    }
  }

  return issues;
}
