/**
 * Go To Dialog
 *
 * A compact dialog for navigating to cells, ranges, and named ranges (F5 / Ctrl+G).
 * Matches Excel's Go To dialog behavior.
 *
 * Features:
 * - Reference input field for typing cell addresses (A1, Sheet2!B5, C10:D20)
 * - Recent locations list showing the last 15 navigation targets
 * - "Special..." button to open Go To Special dialog
 * - "OK" button to navigate to entered reference
 *
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { dispatch, useActionDependencies, useUIStore } from '../../internal-api';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader, Input } from '@mog/shell';

// =============================================================================
// Component
// =============================================================================

export function GoToDialog() {
  const deps = useActionDependencies();
  const isOpen = useUIStore((s) => s.goToDialog.isOpen);
  const recentLocations = useUIStore((s) => s.goToDialog.recentLocations);
  const setPendingGoToReference = useUIStore((s) => s.setPendingGoToReference);

  const [referenceValue, setReferenceValue] = useState('');
  const [errorMessage, setErrorMessage] = useState('');

  const inputRef = useRef<HTMLInputElement>(null);

  // Focus input when dialog opens
  useEffect(() => {
    if (isOpen && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isOpen]);

  // Reset state when dialog opens
  useEffect(() => {
    if (isOpen) {
      setReferenceValue('');
      setErrorMessage('');
    }
  }, [isOpen]);

  // Handle close
  const handleClose = useCallback(() => {
    dispatch('CLOSE_GO_TO_DIALOG', deps);
  }, [deps]);

  // Handle OK button - navigate to reference
  const handleOk = useCallback(() => {
    const trimmedRef = referenceValue.trim();
    if (!trimmedRef) {
      setErrorMessage('Please enter a cell reference');
      return;
    }

    // Store reference in UIStore (Draft + Apply pattern)
    setPendingGoToReference(trimmedRef);

    // Dispatch navigation action (handler will validate and navigate)
    dispatch('NAVIGATE_TO_REFERENCE', deps);

    // Error handling happens in the action handler
    // Dialog will be closed by the handler on success
  }, [deps, referenceValue, setPendingGoToReference]);

  // Handle Special button - close this dialog and open Go To Special
  const handleSpecialClick = useCallback(() => {
    dispatch('CLOSE_GO_TO_DIALOG', deps);
    dispatch('OPEN_GO_TO_SPECIAL_DIALOG', deps);
  }, [deps]);

  // Handle input change - clear error on edit
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setReferenceValue(e.target.value);
    setErrorMessage('');
  }, []);

  // Handle clicking a recent location
  const handleRecentLocationClick = useCallback(
    (reference: string) => {
      // Store reference in UIStore
      setPendingGoToReference(reference);

      // Dispatch navigation action
      dispatch('NAVIGATE_TO_REFERENCE', deps);
    },
    [deps, setPendingGoToReference],
  );

  if (!isOpen) return null;

  return (
    <Dialog
      open={isOpen}
      onClose={handleClose}
      dialogId="goto-dialog"
      width="sm"
      onEnterKeyDown={handleOk}
    >
      <DialogHeader onClose={handleClose}>Go To</DialogHeader>

      <DialogBody>
        <div className="flex flex-col gap-3">
          {/* Reference Input */}
          <div className="flex flex-col gap-1">
            <label htmlFor="goto-input" className="text-body-sm text-ss-text-secondary">
              Reference:
            </label>
            <Input
              ref={inputRef}
              id="goto-input"
              type="text"
              value={referenceValue}
              onChange={handleInputChange}
              placeholder="e.g., A1, Sheet2!B5, C1:D10"
              size="sm"
              autoComplete="off"
              spellCheck={false}
            />
            {errorMessage && <div className="text-body-sm text-ss-error mt-1">{errorMessage}</div>}
          </div>

          {/* Recent Locations */}
          {recentLocations.length > 0 && (
            <div className="flex flex-col gap-1">
              <label className="text-body-sm text-ss-text-secondary">Recent locations:</label>
              <div
                className="border border-ss-border rounded overflow-y-auto"
                style={{ maxHeight: '150px' }}
              >
                {recentLocations.map(
                  (location: { reference: string; timestamp: number }, index: number) => (
                    <button
                      key={`${location.reference}-${location.timestamp}-${index}`}
                      onClick={() => handleRecentLocationClick(location.reference)}
                      className="w-full text-left px-2 py-1 text-body-sm hover:bg-ss-surface-hover cursor-pointer"
                    >
                      {location.reference}
                    </button>
                  ),
                )}
              </div>
            </div>
          )}
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleSpecialClick}>
          Special...
        </Button>
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
