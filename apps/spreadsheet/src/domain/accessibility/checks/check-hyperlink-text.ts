/**
 * Check Hyperlink Text
 *
 * Checks for hyperlinks where the display text is just a URL.
 * Descriptive link text helps users understand where the link leads.
 *
 * Uses STRICT patterns: only flags if text is ONLY a URL (not descriptive text containing a URL).
 */

import type { AccessibilityIssue } from '@mog-sdk/contracts/accessibility';
import type { Worksheet } from '@mog-sdk/contracts/api';

import type { AccessibilityCheckContext } from './types';
import { generateIssueId } from './types';

// Strict URL patterns - must be ONLY a URL, not descriptive text containing URL
const URL_ONLY_PATTERNS = [
  /^https?:\/\/\S+$/i, // http:// or https:// URLs
  /^www\.\S+$/i, // www. URLs
];

/**
 * Check if text is ONLY a URL (not descriptive text containing a URL).
 *
 * @param text - Text to check
 * @param address - The hyperlink address for exact match comparison
 * @returns True if text is only a URL
 */
function isTextOnlyUrl(text: string, address: string): boolean {
  // Exact match to address is always a URL-only case
  if (text === address) return true;

  // Check strict patterns
  return URL_ONLY_PATTERNS.some((pattern) => pattern.test(text));
}

/**
 * Check hyperlinks for non-descriptive URL text.
 *
 * @param checkCtx - Accessibility check context
 * @param ws - Worksheet to check
 * @param sheetName - Sheet name for display
 * @returns Array of accessibility issues for hyperlinks with URL-only text
 */
export async function checkHyperlinkText(
  _checkCtx: AccessibilityCheckContext,
  ws: Worksheet,
  sheetName: string,
): Promise<AccessibilityIssue[]> {
  const sheetId = ws.getSheetId();
  const issues: AccessibilityIssue[] = [];

  // Get sheet bounds to iterate over used range
  const rowCount = await ws.structure.getRowCount();
  const colCount = await ws.structure.getColumnCount();
  if (rowCount === 0 && colCount === 0) return [];

  // Cap iteration to reasonable bounds
  const maxRow = Math.min(rowCount, 10000);
  const maxCol = Math.min(colCount, 1000);

  for (let row = 0; row < maxRow; row++) {
    for (let col = 0; col < maxCol; col++) {
      // Check if cell has a hyperlink
      const hyperlink = await ws.hyperlinks.get(row, col);
      if (!hyperlink) continue;

      // Get the display text from the cell value
      const cellData = await ws.getCell(row, col);
      const cellValue = cellData.value;
      const displayText =
        cellValue !== null && cellValue !== undefined && String(cellValue) !== ''
          ? String(cellValue)
          : hyperlink;

      // Check if display text is ONLY a URL
      if (displayText && isTextOnlyUrl(displayText, hyperlink)) {
        const ref = `${colToLetter(col)}${row + 1}`;

        issues.push({
          id: generateIssueId('hyperlink-text-is-url', sheetId, row, col),
          severity: 'tip',
          category: 'hyperlinks',
          issueType: 'hyperlink-text-is-url',
          title: 'Hyperlink text is URL',
          description: `Link text "${truncateText(displayText, 50)}" is not descriptive`,
          location: {
            sheetId,
            sheetName,
            type: 'cell',
            ref,
          },
          recommendedAction: 'Use descriptive text like "Company Website" instead of the URL',
          whyFix: 'Descriptive link text helps users understand where the link leads',
        });
      }
    }
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

/**
 * Truncate text with ellipsis if too long.
 */
function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}
