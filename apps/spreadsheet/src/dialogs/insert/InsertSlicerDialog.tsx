/**
 * Insert Slicer Dialog
 *
 * Slicers Implementation
 *
 * A dialog for creating slicers from:
 * - Table columns (displays available columns, allows multi-select)
 * - Pivot fields (displays row/column/filter fields)
 *
 * Architecture:
 * - UI state managed by Zustand (insertSlicerDialog slice)
 * - Uses Cell Identity Model (CellId) for column references
 *
 * Uses Worksheet API (ws.addSlicer) for slicer creation.
 *
 */

import { useCallback, useMemo } from 'react';
import { useActiveSheetId, useUIStore, useWorkbook } from '../../internal-api';

import { Button, Checkbox, Dialog, DialogBody, DialogFooter, DialogHeader } from '@mog/shell';
import { toCellId } from '@mog-sdk/contracts/cell-identity';

// =============================================================================
// Component
// =============================================================================

export function InsertSlicerDialog() {
  const activeSheetId = useActiveSheetId();
  const wb = useWorkbook();

  // UI Store state
  const dialogState = useUIStore((s) => s.insertSlicerDialog);
  const closeDialog = useUIStore((s) => s.closeInsertSlicerDialog);
  const toggleColumn = useUIStore((s) => s.toggleSlicerColumn);
  const selectAll = useUIStore((s) => s.selectAllSlicerColumns);
  const deselectAll = useUIStore((s) => s.deselectAllSlicerColumns);

  const { isOpen, sourceType, tableId, columns, selectedColumns } = dialogState;

  // Check if any columns are selected
  const hasSelection = selectedColumns.length > 0;
  const allSelected = selectedColumns.length === columns.length && columns.length > 0;

  // Compute columns available for new slicers (exclude existing)
  const availableColumns = useMemo(() => {
    return columns.filter((col: { hasExistingSlicer?: boolean }) => !col.hasExistingSlicer);
  }, [columns]);

  // Worksheet API: Handle OK - create slicers via ws.addSlicer
  const handleOk = useCallback(() => {
    if (!hasSelection || !tableId) {
      closeDialog();
      return;
    }

    // Create a slicer for each selected column (async, fire-and-forget per slicer)
    void (async () => {
      let xOffset = 0;
      const slicerWidth = 200;
      const slicerSpacing = 20;

      for (const columnCellId of selectedColumns) {
        const column = columns.find(
          (c: { columnCellId: string }) => c.columnCellId === columnCellId,
        );
        if (!column) continue;

        try {
          // Create slicer via Worksheet API
          const ws = wb.getSheetById(activeSheetId);
          await ws.slicers.add({
            source: { type: 'table', tableId, columnCellId: toCellId(columnCellId) },
            caption: column.columnName,
            position: {
              x: 100 + xOffset,
              y: 100,
              width: slicerWidth,
              height: 300,
            },
          });
          xOffset += slicerWidth + slicerSpacing;
        } catch (err) {
          console.error(`Failed to create slicer for column ${column.columnName}:`, err);
        }
      }

      closeDialog();
    })();
  }, [hasSelection, tableId, selectedColumns, columns, wb, activeSheetId, closeDialog]);

  // Handle cancel
  const handleClose = useCallback(() => {
    closeDialog();
  }, [closeDialog]);

  // Handle select all / deselect all toggle
  const handleToggleAll = useCallback(() => {
    if (allSelected) {
      deselectAll();
    } else {
      selectAll();
    }
  }, [allSelected, selectAll, deselectAll]);

  if (!isOpen) return null;

  return (
    <Dialog
      onEnterKeyDown={handleOk}
      open={isOpen}
      onClose={handleClose}
      dialogId="insert-slicer-dialog"
      width="sm"
    >
      <DialogHeader onClose={handleClose}>
        {sourceType === 'table' ? 'Insert Slicers' : 'Insert Pivot Slicers'}
      </DialogHeader>

      <DialogBody>
        {/* Description */}
        <p className="text-body-sm text-ss-text-secondary mb-4">
          Select the columns for which you want to create slicers.
          {availableColumns.length < columns.length && (
            <span className="block text-caption text-ss-warning-text mt-1">
              Some columns already have slicers and are marked below.
            </span>
          )}
        </p>

        {/* Select All / Deselect All */}
        <div className="flex items-center justify-between mb-2 pb-2 border-b border-ss-border">
          <span className="text-body-sm font-medium">Available Columns</span>
          <Button variant="ghost" size="sm" onClick={handleToggleAll}>
            {allSelected ? 'Deselect All' : 'Select All'}
          </Button>
        </div>

        {/* Column List */}
        <div className="max-h-64 overflow-y-auto space-y-1">
          {columns.length === 0 ? (
            <p className="text-body-sm text-ss-text-secondary italic py-4 text-center">
              No columns available for slicers.
            </p>
          ) : (
            columns.map(
              (column: {
                columnCellId: string;
                columnName: string;
                hasExistingSlicer?: boolean;
              }) => (
                <div
                  key={column.columnCellId}
                  className={`flex items-center gap-2 px-2 py-1.5 rounded hover:bg-ss-surface-secondary ${
                    column.hasExistingSlicer ? 'opacity-60' : ''
                  }`}
                >
                  <Checkbox
                    checked={selectedColumns.includes(column.columnCellId)}
                    onChange={() => toggleColumn(column.columnCellId)}
                    disabled={column.hasExistingSlicer}
                  />
                  <span className="text-body-sm flex-1 truncate">{column.columnName}</span>
                  {column.hasExistingSlicer && (
                    <span className="text-caption text-ss-text-secondary">(has slicer)</span>
                  )}
                </div>
              ),
            )
          )}
        </div>

        {/* Selected Count */}
        <div className="mt-3 pt-3 border-t border-ss-border text-caption text-ss-text-secondary">
          {selectedColumns.length} of {columns.length} column{columns.length !== 1 ? 's' : ''}{' '}
          selected
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleOk} disabled={!hasSelection}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}

export default InsertSlicerDialog;
