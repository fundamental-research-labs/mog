/**
 * Paste Validation Summary Dialog
 *
 * Dialog shown after pasting values into cells with validation rules
 * when some pasted values don't match the validation constraints.
 *
 * This dialog appears when:
 * - User pastes values into cells with existing data validation rules
 * - Some pasted values violate the validation constraints
 * - Shows summary of violations grouped by enforcement level
 *
 * User can choose to:
 * - Keep the invalid values (acknowledge and close)
 * - Undo/revert the paste operation
 * - Highlight cells that failed validation
 *
 */

import { useCallback, useMemo } from 'react';
import { dispatch, useActionDependencies, useUIStore } from '../../internal-api';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader } from '@mog/shell';
import type { PasteValidationViolation } from '../../domain/clipboard/paste-executor';

// =============================================================================
// Types
// =============================================================================

interface ViolationGroup {
  level: 'strict' | 'warn' | 'info';
  label: string;
  description: string;
  violations: PasteValidationViolation[];
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Get display label for enforcement level
 */
function getEnforcementLabel(level: 'strict' | 'warn' | 'info'): string {
  switch (level) {
    case 'strict':
      return 'Errors';
    case 'warn':
      return 'Warnings';
    case 'info':
      return 'Information';
  }
}

/**
 * Get description for enforcement level
 */
function getEnforcementDescription(level: 'strict' | 'warn' | 'info'): string {
  switch (level) {
    case 'strict':
      return 'Values that do not match the required validation criteria';
    case 'warn':
      return 'Values that may not be optimal for the cell validation';
    case 'info':
      return 'Values that differ from the suggested input format';
  }
}

/**
 * Get CSS class for enforcement level indicator
 */
function getEnforcementClass(level: 'strict' | 'warn' | 'info'): string {
  switch (level) {
    case 'strict':
      return 'bg-danger';
    case 'warn':
      return 'bg-ss-warning';
    case 'info':
      return 'bg-ss-info';
  }
}

/**
 * Format cell address from row/col
 */
function formatCellAddress(row: number, col: number): string {
  const colLetter = String.fromCharCode(65 + col); // A=0, B=1, etc.
  return `${colLetter}${row + 1}`;
}

// =============================================================================
// Component
// =============================================================================

/**
 * PasteValidationSummaryDialog - Summary dialog for paste validation results.
 *
 * Shows a summary of cells that failed validation after a paste operation,
 * grouped by enforcement level (strict/warn/info).
 */
export function PasteValidationSummaryDialog() {
  const deps = useActionDependencies();

  // Get dialog state from UIStore
  const isOpen = useUIStore((s) => s.pasteValidationDialog.isOpen);
  const summary = useUIStore((s) => s.pasteValidationDialog.summary);

  // Group violations by enforcement level
  const violationGroups = useMemo((): ViolationGroup[] => {
    if (!summary?.violations) return [];

    const groups: ViolationGroup[] = [];

    // Group by enforcement level in order: strict, warn, info
    const levels: Array<'strict' | 'warn' | 'info'> = ['strict', 'warn', 'info'];

    for (const level of levels) {
      const violations = summary.violations.filter(
        (v: { enforcement: string }) => v.enforcement === level,
      );
      if (violations.length > 0) {
        groups.push({
          level,
          label: getEnforcementLabel(level),
          description: getEnforcementDescription(level),
          violations,
        });
      }
    }

    return groups;
  }, [summary?.violations]);

  // Calculate totals
  const totalPasted = summary?.totalPasted ?? 0;
  const totalViolations = summary?.violations.length ?? 0;
  const hasStrictViolations = violationGroups.some((g) => g.level === 'strict');

  // Handle Keep Values button - acknowledge and close
  const handleKeepValues = useCallback(() => {
    dispatch('CONFIRM_PASTE_WITH_INVALID', deps);
  }, [deps]);

  // Handle Undo/Revert button
  const handleRevert = useCallback(() => {
    dispatch('REVERT_INVALID_PASTE', deps);
  }, [deps]);

  // Handle Highlight Cells button
  const handleHighlight = useCallback(() => {
    dispatch('HIGHLIGHT_INVALID_CELLS', deps);
  }, [deps]);

  // Handle close (same as keep values)
  const handleClose = useCallback(() => {
    dispatch('CLOSE_PASTE_VALIDATION_SUMMARY', deps);
  }, [deps]);

  return (
    <Dialog
      onEnterKeyDown={handleClose}
      open={isOpen}
      onClose={handleClose}
      dialogId="paste-validation-summary-dialog"
      width="md"
    >
      <DialogHeader onClose={handleClose}>Paste Validation Summary</DialogHeader>
      <DialogBody>
        {/* Summary header */}
        <div className="mb-4">
          <p className="text-body text-text-ss-primary font-medium m-0">
            {totalViolations} of {totalPasted} pasted values failed validation
          </p>
          {hasStrictViolations && (
            <p className="text-body text-danger mt-1 mb-0">
              Some values do not meet the required validation criteria.
            </p>
          )}
        </div>

        {/* Violations grouped by enforcement level */}
        <div className="space-y-3">
          {violationGroups.map((group) => (
            <div key={group.level} className="border border-ss-border-light rounded p-3">
              {/* Group header */}
              <div className="flex items-center gap-2 mb-2">
                <span
                  className={`inline-block w-2 h-2 rounded-full ${getEnforcementClass(group.level)}`}
                />
                <span className="font-medium text-text-ss-primary">
                  {group.label} ({group.violations.length})
                </span>
              </div>

              {/* Group description */}
              <p className="text-body-sm text-ss-text-secondary mb-2">{group.description}</p>

              {/* Cell list (show first few, then summarize) */}
              <div className="text-body-sm text-ss-text-tertiary">
                {group.violations.length <= 5 ? (
                  // Show all cells if 5 or fewer
                  <span>
                    Cells: {group.violations.map((v) => formatCellAddress(v.row, v.col)).join(', ')}
                  </span>
                ) : (
                  // Show first 5 and count for remainder
                  <span>
                    Cells:{' '}
                    {group.violations
                      .slice(0, 5)
                      .map((v) => formatCellAddress(v.row, v.col))
                      .join(', ')}
                    {' and '}
                    {group.violations.length - 5} more...
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>
      </DialogBody>
      <DialogFooter>
        <div className="flex justify-between w-full">
          <Button variant="ghost" onClick={handleHighlight}>
            Highlight Cells
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" onClick={handleRevert}>
              Undo Paste
            </Button>
            <Button variant="primary" onClick={handleKeepValues}>
              Keep Values
            </Button>
          </div>
        </div>
      </DialogFooter>
    </Dialog>
  );
}
