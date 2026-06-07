/**
 * Consolidate Dialog
 *
 * Spreadsheet compatibility: Data > Data Tools > Consolidate
 */

import { useCallback, useEffect, useState } from 'react';

import { Button, Checkbox, Dialog, DialogBody, DialogFooter, DialogHeader } from '@mog/shell';

import { CollapsibleRangeInput, useDispatch, useUIStore } from '../../internal-api';
import { useRangeSelectionEnterGuard } from '../../hooks/dialogs/use-range-selection-enter-guard';
import type { ConsolidateFunction } from '../../domain/data/consolidate';
import type { ConsolidateSourceRef } from '../../ui-store/slices/dialogs/consolidate-dialog';

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
  const dispatch = useDispatch();

  const isOpen = useUIStore((s) => s.consolidateDialog.isOpen);
  const func = useUIStore((s) => s.consolidateDialog.func);
  const destination = useUIStore((s) => s.consolidateDialog.destination);
  const currentReference = useUIStore((s) => s.consolidateDialog.currentReference);
  const sourceReferences = useUIStore(
    (s) => s.consolidateDialog.sourceReferences,
  ) as ConsolidateSourceRef[];
  const useTopRowLabels = useUIStore((s) => s.consolidateDialog.useTopRowLabels);
  const useLeftColumnLabels = useUIStore((s) => s.consolidateDialog.useLeftColumnLabels);
  const createLinks = useUIStore((s) => s.consolidateDialog.createLinks);

  const closeConsolidateDialog = useUIStore((s) => s.closeConsolidateDialog);
  const setConsolidateFunction = useUIStore((s) => s.setConsolidateFunction);
  const setConsolidateDestination = useUIStore((s) => s.setConsolidateDestination);
  const setConsolidateCurrentReference = useUIStore((s) => s.setConsolidateCurrentReference);
  const addConsolidateReference = useUIStore((s) => s.addConsolidateReference);
  const removeConsolidateReference = useUIStore((s) => s.removeConsolidateReference);
  const toggleConsolidateTopRowLabels = useUIStore((s) => s.toggleConsolidateTopRowLabels);
  const toggleConsolidateLeftColumnLabels = useUIStore((s) => s.toggleConsolidateLeftColumnLabels);
  const toggleConsolidateCreateLinks = useUIStore((s) => s.toggleConsolidateCreateLinks);

  const [validationError, setValidationError] = useState<string | null>(null);

  useEffect(() => {
    setValidationError(null);
  }, [destination, currentReference, sourceReferences.length, func]);

  const handleClose = useCallback(() => {
    closeConsolidateDialog();
    setValidationError(null);
  }, [closeConsolidateDialog]);

  const handleAddReference = useCallback(() => {
    const trimmed = currentReference.trim();
    if (!trimmed) {
      setValidationError('Reference is required.');
      return;
    }
    addConsolidateReference(trimmed);
  }, [addConsolidateReference, currentReference]);

  const validateInputs = useCallback(() => {
    if (!destination.trim()) {
      setValidationError('Destination is required.');
      return false;
    }
    if (sourceReferences.length === 0) {
      setValidationError('Add at least one reference.');
      return false;
    }
    return true;
  }, [destination, sourceReferences.length]);

  const handleOk = useCallback(() => {
    if (!validateInputs()) return;
    void dispatch('EXECUTE_CONSOLIDATE');
  }, [dispatch, validateInputs]);

  const guardedEnter = useRangeSelectionEnterGuard(handleOk);

  if (!isOpen) return null;

  return (
    <Dialog
      onEnterKeyDown={guardedEnter}
      open={isOpen}
      onClose={handleClose}
      dialogId="consolidate-dialog"
      width={460}
      dataAttributes={{ 'data-testid': 'overlay-consolidate' }}
    >
      <DialogHeader onClose={handleClose}>Consolidate</DialogHeader>

      <DialogBody>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label htmlFor="consolidate-function" className="text-body-sm text-ss-text-secondary">
              Function:
            </label>
            <select
              id="consolidate-function"
              className="h-8 rounded-ss-sm border border-ss-border bg-ss-surface px-2 text-body-sm text-ss-text"
              value={func}
              onChange={(event) =>
                setConsolidateFunction(event.target.value as ConsolidateFunction)
              }
            >
              {FUNCTION_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>

          <div className="flex flex-col gap-1">
            <label htmlFor="consolidate-reference" className="text-body-sm text-ss-text-secondary">
              Reference:
            </label>
            <div className="flex items-center gap-2">
              <div className="min-w-0 flex-1">
                <CollapsibleRangeInput
                  value={currentReference}
                  onChange={setConsolidateCurrentReference}
                  dialogId="consolidate-dialog"
                  inputId="consolidate-reference"
                  placeholder="A1:B10"
                  label="Reference"
                />
              </div>
              <Button variant="secondary" size="sm" onClick={handleAddReference}>
                Add
              </Button>
            </div>
          </div>

          {sourceReferences.length > 0 && (
            <div className="max-h-[120px] overflow-y-auto rounded-ss-sm border border-ss-border bg-ss-surface-secondary">
              {sourceReferences.map((ref, index) => (
                <div
                  key={ref.id}
                  className={`flex items-center justify-between gap-2 px-3 py-2 text-body-sm ${
                    index < sourceReferences.length - 1 ? 'border-b border-ss-border' : ''
                  }`}
                >
                  <span className="truncate text-ss-text">{ref.reference}</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => removeConsolidateReference(ref.id)}
                  >
                    Remove
                  </Button>
                </div>
              ))}
            </div>
          )}

          <div className="flex flex-col gap-1">
            <label
              htmlFor="consolidate-destination"
              className="text-body-sm text-ss-text-secondary"
            >
              Destination:
            </label>
            <CollapsibleRangeInput
              value={destination}
              onChange={setConsolidateDestination}
              dialogId="consolidate-dialog"
              inputId="consolidate-destination"
              placeholder="H1"
              label="Destination"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <Checkbox
              id="consolidate-top-row"
              checked={useTopRowLabels}
              onChange={toggleConsolidateTopRowLabels}
              label="Top row"
            />
            <Checkbox
              id="consolidate-left-column"
              checked={useLeftColumnLabels}
              onChange={toggleConsolidateLeftColumnLabels}
              label="Left column"
            />
            <Checkbox
              id="consolidate-create-links"
              checked={createLinks}
              onChange={toggleConsolidateCreateLinks}
              label="Create links"
              className="col-span-2"
            />
          </div>

          {validationError && (
            <div
              className="rounded-ss-sm bg-ss-error/10 px-3 py-2 text-body-sm text-ss-error"
              role="alert"
            >
              {validationError}
            </div>
          )}
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleClose}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleOk}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
