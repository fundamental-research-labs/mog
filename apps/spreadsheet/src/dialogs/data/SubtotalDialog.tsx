/**
 * Subtotals Dialog
 *
 * A dialog that allows users to create automatic subtotals for grouped data.
 * Users can:
 * - Select which column to group by (at each change in)
 * - Choose the aggregate function (Sum, Count, Average, etc.)
 * - Select which columns to add subtotals to
 * - Configure summary row placement
 *
 * Matches Excel's Subtotals dialog for familiarity.
 *
 * Uses Dialog primitive for proper keyboard event isolation.
 * @see FOCUS-BASED-KEYBOARD-HANDLING.md
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useUIStore } from '../../internal-api';

import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Label,
  Select,
} from '@mog/shell';
import type { CellRange } from '@mog-sdk/contracts/core';
import { colToLetter } from '@mog/spreadsheet-utils/a1';
import type { SubtotalResult } from '@mog-sdk/contracts/api';
import type { SubtotalFunction, SubtotalOptions } from '@mog-sdk/contracts/grouping';
// =============================================================================
// Types
// =============================================================================

interface SubtotalDialogProps {
  /** Called when subtotals should be created */
  onApply: (options: SubtotalOptions) => SubtotalResult | Promise<SubtotalResult>;
  /** Called when subtotals should be removed */
  onRemoveAll: () => void;
  /** The current selection range */
  range: CellRange | null;
  /** Column headers from the first row */
  columnHeaders: Array<{ col: number; header: string }>;
}

// =============================================================================
// Constants
// =============================================================================

const SUBTOTAL_FUNCTION_OPTIONS: Array<{ value: SubtotalFunction; label: string }> = [
  { value: 'sum', label: 'Sum' },
  { value: 'count', label: 'Count' },
  { value: 'average', label: 'Average' },
  { value: 'max', label: 'Max' },
  { value: 'min', label: 'Min' },
  { value: 'product', label: 'Product' },
  { value: 'countNums', label: 'Count Numbers' },
  { value: 'stdDev', label: 'StdDev' },
  { value: 'stdDevP', label: 'StdDevP' },
  { value: 'var', label: 'Var' },
  { value: 'varP', label: 'VarP' },
];

// =============================================================================
// Component
// =============================================================================

export function SubtotalDialog({
  onApply,
  onRemoveAll,
  range,
  columnHeaders,
}: SubtotalDialogProps) {
  const isOpen = useUIStore((s) => s.subtotalDialog.isOpen);
  const closeDialog = useUIStore((s) => s.closeSubtotalDialog);

  // Local state
  const [groupByColumn, setGroupByColumn] = useState<number>(0);
  const [subtotalFunction, setSubtotalFunction] = useState<SubtotalFunction>('sum');
  const [selectedColumns, setSelectedColumns] = useState<Set<number>>(new Set());
  const [replaceExisting, setReplaceExisting] = useState(true);
  const [summaryBelowData, setSummaryBelowData] = useState(true);
  const [result, setResult] = useState<SubtotalResult | null>(null);

  // Build group by column options
  const groupByOptions = useMemo(() => {
    return columnHeaders.map((column) => ({
      value: String(column.col),
      label: `${column.header} (Column ${colToLetter(column.col)})`,
    }));
  }, [columnHeaders]);

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen && columnHeaders.length > 0) {
      setGroupByColumn(columnHeaders[0]?.col ?? 0);
      setSubtotalFunction('sum');
      // Default: select all numeric columns (all columns except the first one)
      const numericCols = columnHeaders.slice(1).map((c) => c.col);
      setSelectedColumns(new Set(numericCols));
      setReplaceExisting(true);
      setSummaryBelowData(true);
      setResult(null);
    }
  }, [isOpen, columnHeaders]);

  // Check if all columns are selected
  const allSelected = useMemo(() => {
    const selectableCols = columnHeaders.filter((c) => c.col !== groupByColumn);
    return selectableCols.length > 0 && selectedColumns.size === selectableCols.length;
  }, [columnHeaders, selectedColumns, groupByColumn]);

  // Get selectable columns (exclude groupBy column)
  const selectableColumns = useMemo(() => {
    return columnHeaders.filter((c) => c.col !== groupByColumn);
  }, [columnHeaders, groupByColumn]);

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
      setSelectedColumns(new Set(selectableColumns.map((c) => c.col)));
    }
  }, [allSelected, selectableColumns]);

  // Handle group by column change - remove from selected if needed
  const handleGroupByChange = useCallback((value: string) => {
    const col = Number(value);
    setGroupByColumn(col);
    setSelectedColumns((prev) => {
      const next = new Set(prev);
      next.delete(col);
      return next;
    });
  }, []);

  // Handle Apply button
  const handleApply = useCallback(async () => {
    const options: SubtotalOptions = {
      groupByColumn,
      subtotalColumns: Array.from(selectedColumns),
      function: subtotalFunction,
      replaceExisting,
      summaryBelowData,
    };

    const applyResult = await onApply(options);
    setResult(applyResult);

    // Close dialog after brief delay if successful
    if (applyResult.groupsCreated > 0) {
      setTimeout(() => {
        closeDialog();
      }, 1500);
    }
  }, [
    groupByColumn,
    selectedColumns,
    subtotalFunction,
    replaceExisting,
    summaryBelowData,
    onApply,
    closeDialog,
  ]);

  // Handle Remove All button
  const handleRemoveAll = useCallback(() => {
    onRemoveAll();
    closeDialog();
  }, [onRemoveAll, closeDialog]);

  if (!isOpen || !range) return null;

  const canApply = selectedColumns.size > 0 && !result;

  return (
    <Dialog
      onEnterKeyDown={canApply ? handleApply : undefined}
      open={isOpen}
      onClose={closeDialog}
      dialogId="subtotal-dialog"
      width={450}
    >
      <DialogHeader onClose={closeDialog}>Subtotals</DialogHeader>

      <DialogBody className="max-h-[60vh] overflow-y-auto">
        {/* Group By Column */}
        <div className="mb-4">
          <Label className="mb-1.5">At each change in:</Label>
          <Select
            options={groupByOptions}
            value={String(groupByColumn)}
            onChange={handleGroupByChange}
          />
        </div>

        {/* Function */}
        <div className="mb-4">
          <Label className="mb-1.5">Use function:</Label>
          <Select
            options={SUBTOTAL_FUNCTION_OPTIONS}
            value={subtotalFunction}
            onChange={(value) => setSubtotalFunction(value as SubtotalFunction)}
          />
        </div>

        {/* Columns to subtotal */}
        <div className="mb-4">
          <Label className="mb-2">Add subtotal to:</Label>
          <div className="border border-ss-border rounded max-h-[150px] overflow-y-auto bg-ss-surface-secondary">
            {/* Select All */}
            {selectableColumns.length > 0 && (
              <div className="px-3 py-2 border-b border-ss-border bg-ss-surface">
                <Checkbox
                  checked={allSelected}
                  onChange={toggleAllColumns}
                  label="Select All"
                  className="font-medium"
                />
              </div>
            )}
            {/* Individual columns */}
            {selectableColumns.map((column, index) => (
              <div
                key={column.col}
                className={`px-3 py-2 ${
                  index === selectableColumns.length - 1 ? '' : 'border-b border-ss-border'
                }`}
              >
                <Checkbox
                  checked={selectedColumns.has(column.col)}
                  onChange={() => toggleColumn(column.col)}
                  label={`${column.header} (Column ${colToLetter(column.col)})`}
                />
              </div>
            ))}
          </div>
        </div>

        {/* Options */}
        <div className="mb-4">
          <Checkbox
            checked={replaceExisting}
            onChange={(checked) => setReplaceExisting(checked)}
            label="Replace current subtotals"
            className="mb-2"
          />
          <Checkbox
            checked={summaryBelowData}
            onChange={(checked) => setSummaryBelowData(checked)}
            label="Summary below data"
            className="mb-2"
          />
        </div>

        {/* Result message */}
        {result && (
          <div className="px-4 py-3 bg-ss-success-bg rounded text-body-sm text-ss-success-text">
            Created {result.groupsCreated} group{result.groupsCreated !== 1 ? 's' : ''} with{' '}
            {result.subtotalRowsInserted} subtotal row
            {result.subtotalRowsInserted !== 1 ? 's' : ''}.
          </div>
        )}
      </DialogBody>

      <DialogFooter className="justify-between">
        <Button variant="danger" onClick={handleRemoveAll}>
          Remove All
        </Button>
        <div className="flex gap-3">
          <Button variant="secondary" onClick={closeDialog}>
            Cancel
          </Button>
          <Button variant="primary" onClick={handleApply} disabled={!canApply}>
            OK
          </Button>
        </div>
      </DialogFooter>
    </Dialog>
  );
}
