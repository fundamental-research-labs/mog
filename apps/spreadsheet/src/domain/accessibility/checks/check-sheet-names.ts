/**
 * Check Sheet Names
 *
 * Checks for default/generic sheet names.
 * Descriptive sheet names help users navigate workbooks with multiple sheets.
 *
 * Handles localized default names for multiple languages:
 * - English: Sheet1, Sheet2
 * - French: Feuil1, Feuil2
 * - Spanish: Hoja1, Hoja2
 * - German: Blatt1, Blatt2
 * - Italian: Foglio1, Foglio2
 * - Portuguese: Folha1, Folha2
 * - Russian: Лист1, Лист2
 * - Japanese: シート1, シート2
 * - Chinese Simplified: 工作表1, 工作表2
 * - Danish/Norwegian: Ark1, Ark2
 * - Dutch/Swedish: Blad1, Blad2
 */

import type { AccessibilityIssue } from '@mog-sdk/contracts/accessibility';
import type { Worksheet } from '@mog-sdk/contracts/api';

import type { AccessibilityCheckContext } from './types';
import { generateIssueId } from './types';

/**
 * Patterns for default sheet names in various languages.
 * Each pattern matches the language's default sheet naming pattern.
 */
const DEFAULT_SHEET_PATTERNS = [
  /^Sheet\d+$/i, // English (Sheet1, Sheet2)
  /^Feuil\d+$/i, // French (Feuil1, Feuil2)
  /^Hoja\d+$/i, // Spanish (Hoja1, Hoja2)
  /^Blatt\d+$/i, // German (Blatt1, Blatt2)
  /^Foglio\d+$/i, // Italian (Foglio1, Foglio2)
  /^Folha\d+$/i, // Portuguese (Folha1, Folha2)
  /^Лист\d+$/i, // Russian (Лист1, Лист2)
  /^シート\d+$/, // Japanese (シート1, シート2)
  /^工作表\d+$/, // Chinese Simplified (工作表1, 工作表2)
  /^Ark\d+$/i, // Danish/Norwegian (Ark1, Ark2)
  /^Blad\d+$/i, // Dutch/Swedish (Blad1, Blad2)
];

/**
 * Check if a sheet name is a default/generic name.
 *
 * @param name - Sheet name to check
 * @returns True if name matches a default pattern
 */
export function isDefaultSheetName(name: string): boolean {
  return DEFAULT_SHEET_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * Check sheet names for default/generic naming.
 *
 * Note: This check is unique - it checks a single sheet at a time
 * but the issue relates to the sheet itself, not content within it.
 *
 * @param checkCtx - Accessibility check context
 * @param ws - Worksheet to check
 * @param sheetName - Sheet name for display
 * @returns Array of accessibility issues for default sheet names
 */
export function checkSheetNames(
  _checkCtx: AccessibilityCheckContext,
  ws: Worksheet,
  sheetName: string,
): AccessibilityIssue[] {
  const sheetId = ws.getSheetId();
  const issues: AccessibilityIssue[] = [];

  // Check if this sheet's name is a default name
  if (isDefaultSheetName(sheetName)) {
    issues.push({
      id: generateIssueId('default-sheet-name', sheetId),
      severity: 'tip',
      category: 'sheets',
      issueType: 'default-sheet-name',
      title: 'Default sheet name',
      description: `Sheet "${sheetName}" uses a default name`,
      location: {
        sheetId,
        sheetName,
        type: 'sheet',
      },
      recommendedAction: 'Rename to a descriptive name like "Sales Data" or "Summary"',
      whyFix: 'Descriptive sheet names help users navigate workbooks with multiple sheets',
    });
  }

  return issues;
}

/**
 * Get all default sheet names in the workbook.
 * Utility function to check multiple sheets at once.
 *
 * @param checkCtx - Accessibility check context
 * @returns Array of accessibility issues for all default sheet names
 */
export async function checkAllSheetNames(
  checkCtx: AccessibilityCheckContext,
): Promise<AccessibilityIssue[]> {
  const { workbook } = checkCtx;
  if (!workbook) return [];

  const issues: AccessibilityIssue[] = [];
  const sheetNames = workbook.sheetNames;

  for (const name of sheetNames) {
    const ws = await workbook.getSheet(name);
    issues.push(...checkSheetNames(checkCtx, ws, name));
  }

  return issues;
}
