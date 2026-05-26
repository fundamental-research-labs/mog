/**
 * Accessibility Checker Engine
 *
 * Main entry point for running accessibility checks on a workbook.
 * Runs all check functions across all sheets and aggregates results.
 *
 * Features:
 * - Async with progress reporting for large workbooks
 * - AbortSignal support for cancellation
 * - Yields to event loop to keep UI responsive
 * - Returns partial results if aborted
 *
 */

import type { AccessibilityIssue } from '@mog-sdk/contracts/accessibility';
import type { Workbook } from '@mog-sdk/contracts/api';
import type { SheetId } from '@mog-sdk/contracts/core';

// Import check functions
import { checkChartTitles } from './checks/check-chart-titles';
import { checkHyperlinkText } from './checks/check-hyperlink-text';
import { checkImagesAltText } from './checks/check-images-alt-text';
import { checkMergedCells } from './checks/check-merged-cells';
import { checkSheetNames } from './checks/check-sheet-names';
import { checkTableHeaders } from './checks/check-table-headers';
import type { AccessibilityCheckContext, AccessibilityCheckFunction } from './checks/types';

// =============================================================================
// Types
// =============================================================================

/**
 * Options for running an accessibility check.
 */
export interface AccessibilityCheckOptions {
  /** AbortSignal for cancellation when panel closes during check */
  signal?: AbortSignal;
  /** Progress callback for large workbooks (0-100 percent) */
  onProgress?: (percent: number) => void;
}

/**
 * Result of an accessibility check.
 */
export interface AccessibilityCheckResult {
  /** Issues found during the check */
  issues: AccessibilityIssue[];
  /** Whether the check was aborted */
  aborted: boolean;
  /** Number of sheets checked */
  sheetsChecked: number;
  /** Total number of sheets */
  totalSheets: number;
}

// =============================================================================
// Check Function Registry
// =============================================================================

/**
 * All per-sheet check functions to run.
 * Each function is called once per sheet.
 */
const PER_SHEET_CHECKS: AccessibilityCheckFunction[] = [
  checkImagesAltText,
  checkTableHeaders,
  checkMergedCells,
  checkChartTitles,
  checkHyperlinkText,
];

// =============================================================================
// Main Checker
// =============================================================================

/**
 * Run accessibility check on the workbook.
 *
 * @param workbook - Workbook for unified API access
 * @param options - Check options (signal, progress callback)
 * @returns Check result with issues and status
 */
export async function runAccessibilityCheck(
  workbook: Workbook,
  options?: AccessibilityCheckOptions,
): Promise<AccessibilityCheckResult> {
  const { signal, onProgress } = options ?? {};
  const issues: AccessibilityIssue[] = [];
  let aborted = false;

  // Get sheet names via Workbook API
  const sheetNames: string[] = workbook.sheetNames;
  const totalSheets = sheetNames.length;
  let sheetsChecked = 0;

  // Create check context
  const checkCtx: AccessibilityCheckContext = {
    workbook,
  };

  // Run sheet name check for all sheets first
  for (const name of sheetNames) {
    // Check for abort before each sheet
    if (signal?.aborted) {
      aborted = true;
      break;
    }

    const ws = await workbook.getSheet(name);
    const sheetNameIssues = checkSheetNames(checkCtx, ws, name);
    issues.push(...sheetNameIssues);
  }

  // Run per-sheet checks
  for (let i = 0; i < sheetNames.length; i++) {
    const name = sheetNames[i];

    // Check for abort before each sheet
    if (signal?.aborted) {
      aborted = true;
      break;
    }

    const ws = await workbook.getSheet(name);

    // Run all per-sheet check functions
    for (const checkFn of PER_SHEET_CHECKS) {
      // Check for abort before each check function
      if (signal?.aborted) {
        aborted = true;
        break;
      }

      try {
        const sheetIssues = await checkFn(checkCtx, ws, name);
        issues.push(...sheetIssues);
      } catch (error) {
        // Log error but continue with other checks
        console.error(`Accessibility check error in ${checkFn.name} for sheet ${name}:`, error);
      }
    }

    if (aborted) break;

    sheetsChecked++;

    // Report progress
    const percent = Math.round(((i + 1) / totalSheets) * 100);
    onProgress?.(percent);

    // Yield to event loop periodically to keep UI responsive
    // Do this after every sheet to prevent blocking
    if (i < sheetNames.length - 1) {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
    }
  }

  return {
    issues,
    aborted,
    sheetsChecked,
    totalSheets,
  };
}

/**
 * Quick check for a single sheet.
 * Used for auto-refresh when panel is open.
 *
 * @param workbook - Workbook for unified API access
 * @param sheetId - Sheet ID to check
 * @returns Array of issues for this sheet
 */
export async function checkSingleSheet(
  workbook: Workbook,
  sheetId: SheetId,
): Promise<AccessibilityIssue[]> {
  const issues: AccessibilityIssue[] = [];

  const ws = workbook.getSheetById(sheetId);
  const sheetName = await ws.getName();

  const checkCtx: AccessibilityCheckContext = {
    workbook,
  };

  // Run sheet name check
  const sheetNameIssues = checkSheetNames(checkCtx, ws, sheetName);
  issues.push(...sheetNameIssues);

  // Run all per-sheet check functions
  for (const checkFn of PER_SHEET_CHECKS) {
    try {
      const sheetIssues = await checkFn(checkCtx, ws, sheetName);
      issues.push(...sheetIssues);
    } catch (error) {
      console.error(`Accessibility check error in ${checkFn.name} for sheet ${sheetName}:`, error);
    }
  }

  return issues;
}
