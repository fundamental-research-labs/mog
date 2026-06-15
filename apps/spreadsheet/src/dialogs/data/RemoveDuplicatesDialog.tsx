/**
 * Remove Duplicates Dialog
 *
 * A dialog that allows users to remove duplicate rows from a selected range.
 * Users can:
 * - Specify if the first row contains headers
 * - Select which columns to compare for duplicates
 * - Choose case-sensitive or case-insensitive comparison
 *
 * Matches Excel's Remove Duplicates dialog for familiarity.
 *
 *
 * Architecture Compliance:
 * - UIStore slice for dialog state (data-tools.ts)
 */

import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  RadioGroup,
  SectionLabel,
} from '@mog/shell';
import type { CellRange } from '@mog-sdk/contracts/core';
import { colToLetter } from '@mog/spreadsheet-utils/a1';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUIStore } from '../../internal-api';
import { trackDialogAction } from '../dialog-action-scheduler';

/** Options for removing duplicate rows. */
export interface RemoveDuplicatesOptions {
  /** Whether the first row contains headers */
  hasHeaders: boolean;
  /** Column indices to compare for duplicates */
  columnsToCompare: number[];
  /** Whether comparison is case-sensitive */
  caseSensitive: boolean;
}

/** Result of a remove-duplicates operation. */
export interface RemoveDuplicatesResult {
  /** Number of duplicates found */
  duplicatesFound: number;
  /** Number of duplicate rows removed */
  duplicatesRemoved: number;
  /** Number of unique rows remaining */
  uniqueValuesRemaining: number;
}

// =============================================================================
// Helper Functions
// =============================================================================

/**
 * Format a range as A1 notation (e.g., "A1:D10").
 */
function formatRangeA1(range: CellRange): string {
  return `${colToLetter(range.startCol)}${range.startRow + 1}:${colToLetter(range.endCol)}${range.endRow + 1}`;
}

// =============================================================================
// Component
// =============================================================================

interface RemoveDuplicatesDialogProps {
  /** Called when duplicates should be removed */
  onRemove: (
    options: RemoveDuplicatesOptions,
  ) => RemoveDuplicatesResult | Promise<RemoveDuplicatesResult>;
  /** The current selection range */
  range: CellRange | null;
  /** Column headers from the first row */
  columnHeaders: Array<{ col: number; header: string }>;
  /** Whether the first row likely contains headers */
  detectedHeaders: boolean;
}

export function RemoveDuplicatesDialog({
  onRemove,
  range,
  columnHeaders,
  detectedHeaders,
}: RemoveDuplicatesDialogProps) {
  const isOpen = useUIStore((s) => s.removeDuplicatesDialogOpen);
  const closeDialog = useUIStore((s) => s.closeRemoveDuplicatesDialog);

  // Local state for form values
  const [hasHeaders, setHasHeaders] = useState(true);
  const [selectedColumns, setSelectedColumns] = useState<Set<number>>(new Set());
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [result, setResult] = useState<RemoveDuplicatesResult | null>(null);

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setHasHeaders(detectedHeaders);
      // Select all columns by default
      setSelectedColumns(new Set(columnHeaders.map((c) => c.col)));
      setCaseSensitive(false);
      setResult(null);
    }
  }, [isOpen, detectedHeaders, columnHeaders]);

  // Check if all columns are selected
  const allSelected = useMemo(() => {
    return columnHeaders.length > 0 && selectedColumns.size === columnHeaders.length;
  }, [columnHeaders, selectedColumns]);

  // Toggle a single column
  const toggleColumn = useCallback((col: number) => {
    setSelectedColumns((prev) => {
      const next = new Set(prev);
      if (next.has(col)) {
        next.delete(col);
      } else {
        next.add(col);
      }
      return next;
    });
  }, []);

  // Toggle all columns
  const toggleAllColumns = useCallback(() => {
    if (allSelected) {
      setSelectedColumns(new Set());
    } else {
      setSelectedColumns(new Set(columnHeaders.map((c) => c.col)));
    }
  }, [allSelected, columnHeaders]);

  // Handle Remove button click
  const handleRemove = useCallback(async () => {
    const options: RemoveDuplicatesOptions = {
      hasHeaders,
      columnsToCompare: Array.from(selectedColumns),
      caseSensitive,
    };

    const removeResult = await trackDialogAction(() => onRemove(options));
    setResult(removeResult);

    // Close dialog after showing result briefly if no duplicates found
    // Keep open if duplicates were removed so user can see the result
    if (removeResult.duplicatesRemoved === 0) {
      setTimeout(() => {
        closeDialog();
      }, 2000);
    }
  }, [hasHeaders, selectedColumns, caseSensitive, onRemove, closeDialog]);

  // Handle Cancel button click
  const handleCancel = useCallback(() => {
    closeDialog();
  }, [closeDialog]);

  // Handle OK button click after seeing result
  const handleOk = useCallback(() => {
    closeDialog();
  }, [closeDialog]);

  // Confirm handler — Remove Duplicates while form is shown, OK while result is shown
  const handleConfirm = useCallback(() => {
    if (result) {
      handleOk();
    } else if (selectedColumns.size > 0) {
      void handleRemove();
    }
  }, [result, selectedColumns.size, handleRemove, handleOk]);

  if (!isOpen || !range) return null;

  const canRemove = selectedColumns.size > 0 && !result;

  return (
    <Dialog
      onEnterKeyDown={handleConfirm}
      open={isOpen}
      onClose={closeDialog}
      dialogId="remove-duplicates-dialog"
      width={420}
    >
      <DialogHeader onClose={handleCancel}>Remove Duplicates</DialogHeader>

      <DialogBody>
        <div>
          {/* Range display */}
          <div className="text-body-sm text-ss-text-secondary mb-4">
            Remove duplicates from: {formatRangeA1(range)}
          </div>

          {/* Has Headers checkbox */}
          <div className="mb-4">
            <Checkbox
              checked={hasHeaders}
              onChange={(checked) => setHasHeaders(checked)}
              label="My data has headers"
            />
          </div>

          {/* Column selection */}
          <div className="mb-4">
            <SectionLabel>Columns</SectionLabel>
            <div className="border border-ss-border rounded max-h-[200px] overflow-y-auto bg-ss-surface-secondary">
              {/* Select All */}
              <div className="px-3 py-2 border-b border-ss-border bg-ss-surface">
                <Checkbox
                  id="select-all-columns"
                  checked={allSelected}
                  onChange={toggleAllColumns}
                  label={<span className="font-medium">Select All</span>}
                />
              </div>
              {/* Individual columns */}
              {columnHeaders.map((column, index) => (
                <div
                  key={column.col}
                  className={`px-3 py-2 ${
                    index < columnHeaders.length - 1 ? 'border-b border-ss-border' : ''
                  }`}
                >
                  <Checkbox
                    id={`col-${column.col}`}
                    checked={selectedColumns.has(column.col)}
                    onChange={() => toggleColumn(column.col)}
                    label={`Column ${colToLetter(column.col)} (${column.header})`}
                  />
                </div>
              ))}
            </div>
          </div>

          {/* Comparison options */}
          <div className="flex items-center gap-4">
            <span className="text-body-sm text-text">Comparison:</span>
            <RadioGroup
              name="comparison"
              value={caseSensitive ? 'exact' : 'insensitive'}
              onChange={(val) => setCaseSensitive(val === 'exact')}
              orientation="horizontal"
              size="sm"
              options={[
                { value: 'insensitive', label: 'Case-insensitive' },
                { value: 'exact', label: 'Exact match' },
              ]}
            />
          </div>

          {/* Result message */}
          {result && (
            <div className="mt-4 p-3 bg-ss-success/10 rounded text-body-sm text-ss-success">
              {result.duplicatesRemoved > 0 ? (
                <>
                  {result.duplicatesRemoved} duplicate{result.duplicatesRemoved !== 1 ? 's' : ''}{' '}
                  removed; {result.uniqueValuesRemaining} unique value
                  {result.uniqueValuesRemaining !== 1 ? 's' : ''} remain.
                </>
              ) : (
                <>No duplicate values found.</>
              )}
            </div>
          )}
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        {result ? (
          <Button variant="primary" onClick={handleOk}>
            OK
          </Button>
        ) : (
          <Button variant="primary" onClick={handleRemove} disabled={!canRemove}>
            Remove Duplicates
          </Button>
        )}
      </DialogFooter>
    </Dialog>
  );
}
