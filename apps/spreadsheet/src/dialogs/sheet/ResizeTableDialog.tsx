/**
 * Resize Table Dialog
 *
 * Dialog for resizing an existing table's range. Allows users to expand
 * or contract the table boundaries while ensuring:
 * - At least 1 data row exists
 * - At least 1 column exists
 * - No overlap with other tables
 * - Start position cannot change (only bottom-right can move)
 *
 *
 * Architecture Compliance:
 * - All user interactions use dispatch()
 * - UIStore slice for dialog state (table-dialogs.ts)
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  CollapsibleRangeInput,
  dispatch,
  MinimizableDialog,
  useActionDependencies,
  useActiveSheetId,
  useUIStore,
  useWorkbook,
} from '../../internal-api';

import { Button, DialogBody, DialogFooter, DialogHeader, FormField } from '@mog/shell';
import type { TableInfo } from '@mog-sdk/contracts/api';
import { colToLetter } from '@mog/spreadsheet-utils/a1';
// =============================================================================
// Range Helpers
// =============================================================================

/**
 * Parse an A1-style range reference (e.g., "A1:D10").
 * Returns null if invalid.
 */
function parseA1Range(
  ref: string,
): { startRow: number; startCol: number; endRow: number; endCol: number } | null {
  const rangeMatch = ref.match(/^([A-Z]+)(\d+):([A-Z]+)(\d+)$/i);
  if (!rangeMatch) return null;

  const [, startColStr, startRowStr, endColStr, endRowStr] = rangeMatch;

  const letterToCol = (s: string): number => {
    let col = 0;
    for (let i = 0; i < s.length; i++) {
      col = col * 26 + (s.charCodeAt(i) - 64);
    }
    return col - 1; // 0-indexed
  };

  const startCol = letterToCol(startColStr.toUpperCase());
  const startRow = parseInt(startRowStr, 10) - 1; // 0-indexed
  const endCol = letterToCol(endColStr.toUpperCase());
  const endRow = parseInt(endRowStr, 10) - 1;

  if (startRow < 0 || startCol < 0 || endRow < startRow || endCol < startCol) {
    return null;
  }

  return { startRow, startCol, endRow, endCol };
}

/**
 * Format a range as A1 notation.
 */
function formatA1Range(range: {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
}): string {
  return `${colToLetter(range.startCol)}${range.startRow + 1}:${colToLetter(range.endCol)}${range.endRow + 1}`;
}

// =============================================================================
// Component
// =============================================================================

/**
 * ResizeTableDialog - Dialog for resizing an existing table's boundaries.
 *
 * Shows current table range and allows user to input a new range.
 * Validates that the new range is valid before applying.
 */
export function ResizeTableDialog() {
  const deps = useActionDependencies();
  const wb = useWorkbook();
  useActiveSheetId();

  // Get dialog state from UIStore
  const isOpen = useUIStore((s) => s.resizeTableDialog.isOpen);
  const tableId = useUIStore((s) => s.resizeTableDialog.tableId);

  // Form state
  const [rangeInput, setRangeInput] = useState('');
  const [rangeError, setRangeError] = useState<string | null>(null);

  // Get current table and its range (async) via Worksheet API
  const [table, setTable] = useState<(TableInfo & { sheetId?: string }) | null>(null);
  const [currentRange, setCurrentRange] = useState<{
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
  } | null>(null);

  useEffect(() => {
    if (!tableId) {
      setTable(null);
      setCurrentRange(null);
      return;
    }
    // Search all sheets for the table by ID
    void (async () => {
      const sheetNames = wb.sheetNames;
      for (const sheetName of sheetNames) {
        const ws = await wb.getSheet(sheetName);
        const tables = await ws.tables.list();
        const found = tables.find((t) => t.name === tableId || t.id === tableId);
        if (found) {
          setTable({ ...found, sheetId: ws.getSheetId() });
          // Parse the range string from TableInfo
          if (found.range) {
            const parsed = parseA1Range(found.range);
            setCurrentRange(parsed);
          } else {
            setCurrentRange(null);
          }
          return;
        }
      }
      setTable(null);
      setCurrentRange(null);
    })();
  }, [wb, tableId]);

  // Initialize range input when dialog opens
  useEffect(() => {
    if (isOpen && currentRange) {
      setRangeInput(formatA1Range(currentRange));
      setRangeError(null);
    }
  }, [isOpen, currentRange]);

  // Validate range input
  const validateRange = useCallback(
    async (value: string): Promise<string | null> => {
      if (!value.trim()) {
        return 'Range is required';
      }
      const parsed = parseA1Range(value.trim());
      if (!parsed) {
        return 'Invalid range format. Use format like A1:D10';
      }

      // Basic validation: start position must match current range
      if (currentRange) {
        if (
          parsed.startRow !== currentRange.startRow ||
          parsed.startCol !== currentRange.startCol
        ) {
          return 'The top-left corner of the table cannot be changed';
        }
      }

      // Validate at least 1 column and 1 data row
      if (parsed.endCol < parsed.startCol) {
        return 'Table must have at least 1 column';
      }
      if (parsed.endRow <= parsed.startRow) {
        return 'Table must have at least 1 data row (plus header)';
      }

      return null;
    },
    [currentRange],
  );

  // Handle range input change
  const handleRangeChange = useCallback(
    (value: string) => {
      const upperValue = value.toUpperCase();
      setRangeInput(upperValue);
      // Defer validation to avoid constant error display while typing
      void validateRange(upperValue).then(setRangeError);
    },
    [validateRange],
  );

  // Parse current input
  const parsedRange = useMemo(() => parseA1Range(rangeInput), [rangeInput]);

  // Handle OK button - confirm resize
  const handleConfirm = useCallback(async () => {
    if (!tableId || !table) return;

    const error = await validateRange(rangeInput);
    if (error || !parsedRange) {
      setRangeError(error || 'Invalid range');
      return;
    }

    // Dispatch resize action
    dispatch('RESIZE_TABLE', deps, {
      tableId,
      newRange: {
        ...parsedRange,
        sheetId: table.sheetId,
      },
    });
  }, [deps, tableId, table, rangeInput, parsedRange, validateRange]);

  // Handle Cancel button
  const handleCancel = useCallback(() => {
    dispatch('CLOSE_RESIZE_TABLE_DIALOG', deps);
  }, [deps]);

  // Don't render if no table
  if (!isOpen || !table || !currentRange) return null;

  return (
    <MinimizableDialog
      onEnterKeyDown={handleConfirm}
      open={isOpen}
      onClose={handleCancel}
      dialogId="resize-table-dialog"
      title="Resize Table"
      width="md"
    >
      <DialogHeader onClose={handleCancel}>Resize Table</DialogHeader>
      <DialogBody>
        <p className="text-body text-text m-0 mb-3">Select the new data range for your table.</p>
        <div className="text-body-sm text-ss-text-secondary mb-4">
          <p className="m-0">
            Table: <strong>{table.name}</strong>
          </p>
          <p className="m-0">
            Current range: <strong>{formatA1Range(currentRange)}</strong>
          </p>
        </div>

        <FormField label="New range (include headers):" error={rangeError ?? undefined}>
          <CollapsibleRangeInput
            value={rangeInput}
            onChange={handleRangeChange}
            dialogId="resize-table-dialog"
            inputId="new-range"
            label="New range (include headers)"
            placeholder="e.g., A1:D10"
            error={!!rangeError}
            autoFocus
          />
        </FormField>

        <div className="text-body-sm text-ss-text-secondary mt-4 space-y-1">
          <p className="m-0">Note:</p>
          <ul className="list-disc pl-5 m-0 space-y-1">
            <li>The table must have at least 1 data row</li>
            <li>The table must have at least 1 column</li>
            <li>The new range cannot overlap with other tables</li>
            <li>The top-left corner must remain at the same position</li>
          </ul>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleConfirm} disabled={!!rangeError || !parsedRange}>
          OK
        </Button>
      </DialogFooter>
    </MinimizableDialog>
  );
}
