/**
 * ConsolidateDialog
 *
 * Dialog for Data > Consolidate feature. Allows users to combine data from
 * multiple ranges into a single destination using aggregation functions.
 *
 * Matches Excel's Consolidate dialog: function selector, reference list with
 * Add/Delete, destination input, checkboxes for top row / left column labels
 * and create links to source data.
 */

import { useCallback } from 'react';
import { Button, Dialog, DialogBody, DialogFooter, DialogHeader } from '@mog/shell';
import { useDispatch, useUIStore } from '../../internal-api';
import type {
  ConsolidateFunction,
  ConsolidateSourceRef,
} from '../../ui-store/slices/dialogs/consolidate-dialog';

const FUNCTION_OPTIONS: Array<{ value: ConsolidateFunction; label: string }> = [
  { value: 'sum', label: 'Sum' },
  { value: 'count', label: 'Count' },
  { value: 'average', label: 'Average' },
  { value: 'max', label: 'Max' },
  { value: 'min', label: 'Min' },
  { value: 'product', label: 'Product' },
  { value: 'countNumbers', label: 'Count Numbers' },
  { value: 'stdDev', label: 'StdDev' },
  { value: 'stdDevP', label: 'StdDevP' },
  { value: 'var', label: 'Var' },
  { value: 'varP', label: 'VarP' },
];

export function ConsolidateDialog() {
  const isOpen = useUIStore((s) => s.consolidateDialog.isOpen);
  const func = useUIStore((s) => s.consolidateDialog.func);
  const destination = useUIStore((s) => s.consolidateDialog.destination);
  const currentReference = useUIStore((s) => s.consolidateDialog.currentReference);
  const sourceReferences = useUIStore((s) => s.consolidateDialog.sourceReferences);
  const useTopRowLabels = useUIStore((s) => s.consolidateDialog.useTopRowLabels);
  const useLeftColumnLabels = useUIStore((s) => s.consolidateDialog.useLeftColumnLabels);
  const createLinks = useUIStore((s) => s.consolidateDialog.createLinks);

  const setConsolidateFunction = useUIStore((s) => s.setConsolidateFunction);
  const setConsolidateDestination = useUIStore((s) => s.setConsolidateDestination);
  const setConsolidateCurrentReference = useUIStore((s) => s.setConsolidateCurrentReference);
  const addConsolidateReference = useUIStore((s) => s.addConsolidateReference);
  const removeConsolidateReference = useUIStore((s) => s.removeConsolidateReference);
  const toggleConsolidateTopRowLabels = useUIStore((s) => s.toggleConsolidateTopRowLabels);
  const toggleConsolidateLeftColumnLabels = useUIStore((s) => s.toggleConsolidateLeftColumnLabels);
  const toggleConsolidateCreateLinks = useUIStore((s) => s.toggleConsolidateCreateLinks);

  const dispatch = useDispatch();

  const handleClose = useCallback(() => {
    dispatch('CLOSE_CONSOLIDATE_DIALOG');
  }, [dispatch]);

  const handleOk = useCallback(() => {
    dispatch('EXECUTE_CONSOLIDATE');
  }, [dispatch]);

  const handleAdd = useCallback(() => {
    if (currentReference.trim()) {
      addConsolidateReference(currentReference);
    }
  }, [addConsolidateReference, currentReference]);

  const handleDelete = useCallback(() => {
    if (sourceReferences.length > 0) {
      removeConsolidateReference(sourceReferences[sourceReferences.length - 1].id);
    }
  }, [removeConsolidateReference, sourceReferences]);

  if (!isOpen) return null;

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) handleClose();
      }}
      data-dialog-id="consolidate-dialog"
    >
      <DialogHeader>Consolidate</DialogHeader>
      <DialogBody>
        <div className="flex flex-col gap-3 p-2" style={{ minWidth: 360 }}>
          {/* Function selector */}
          <div className="flex items-center gap-2">
            <label htmlFor="consolidate-function" className="text-sm font-medium w-20">
              Function:
            </label>
            <select
              id="consolidate-function"
              aria-label="Function"
              value={func}
              onChange={(e) => setConsolidateFunction(e.target.value as ConsolidateFunction)}
              className="flex-1 border rounded px-2 py-1 text-sm bg-white"
            >
              {FUNCTION_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>

          {/* Destination input */}
          <div className="flex items-center gap-2">
            <label htmlFor="consolidate-destination" className="text-sm font-medium w-20">
              Destination:
            </label>
            <input
              id="consolidate-destination"
              type="text"
              aria-label="Destination"
              placeholder="Destination"
              value={destination}
              onChange={(e) => setConsolidateDestination(e.target.value)}
              className="flex-1 border rounded px-2 py-1 text-sm"
            />
          </div>

          {/* Reference input and Add button */}
          <div className="flex items-center gap-2">
            <label htmlFor="consolidate-reference" className="text-sm font-medium w-20">
              Reference:
            </label>
            <input
              id="consolidate-reference"
              type="text"
              aria-label="Reference"
              placeholder="Reference"
              value={currentReference}
              onChange={(e) => setConsolidateCurrentReference(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleAdd();
              }}
              className="flex-1 border rounded px-2 py-1 text-sm"
            />
            <Button variant="secondary" size="sm" onClick={handleAdd} aria-label="Add">
              Add
            </Button>
          </div>

          {/* Source references list */}
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium">All references:</label>
            <div className="border rounded p-1 min-h-[60px] max-h-[120px] overflow-y-auto bg-white text-sm">
              {sourceReferences.length === 0 ? (
                <div className="text-gray-400 text-xs p-1">No references added</div>
              ) : (
                sourceReferences.map((ref: ConsolidateSourceRef) => (
                  <div key={ref.id} className="px-1 py-0.5">
                    {ref.reference}
                  </div>
                ))
              )}
            </div>
            {sourceReferences.length > 0 && (
              <Button variant="secondary" size="sm" onClick={handleDelete}>
                Delete
              </Button>
            )}
          </div>

          {/* Checkboxes */}
          <div className="flex flex-col gap-1 mt-1">
            <span className="text-sm font-medium">Use labels in:</span>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                role="checkbox"
                aria-label="Top row"
                checked={useTopRowLabels}
                onChange={toggleConsolidateTopRowLabels}
              />
              Top row
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                role="checkbox"
                aria-label="Left column"
                checked={useLeftColumnLabels}
                onChange={toggleConsolidateLeftColumnLabels}
              />
              Left column
            </label>
            <label className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                role="checkbox"
                aria-label="Create links to source data"
                checked={createLinks}
                onChange={toggleConsolidateCreateLinks}
              />
              Create links to source data
            </label>
          </div>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={handleClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleOk} aria-label="OK">
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
