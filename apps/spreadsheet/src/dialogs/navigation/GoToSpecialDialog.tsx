/**
 * Go To Special Dialog
 *
 * Dialog for selecting cells by type (blanks, formulas, constants, etc.).
 * Opens from the Go To dialog's "Special..." button.
 *
 * Excel parity 14.1: Go To Special Dialog
 */

import { useCallback, useState } from 'react';
import { dispatch, useActionDependencies, useUIStore } from '../../internal-api';

import type { RadioOption } from '@mog/shell';
import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  RadioGroup,
} from '@mog/shell';
import type { GoToSpecialType } from '../../ui-store/slices/dialogs/goto-special-dialog';

// =============================================================================
// Constants
// =============================================================================

/**
 * Map Go To Special types to their action types for dispatch.
 */
const TYPE_TO_ACTION: Record<GoToSpecialType, string | null> = {
  blanks: 'SELECT_BLANKS',
  constants: 'SELECT_CONSTANTS',
  formulas: 'SELECT_FORMULAS',
  comments: 'SELECT_CELLS_WITH_COMMENTS',
  currentRegion: 'SELECT_CURRENT_REGION',
  currentArray: 'SELECT_CURRENT_ARRAY',
  objects: 'SELECT_OBJECTS',
  rowDifferences: 'SELECT_ROW_DIFFERENCES',
  columnDifferences: 'SELECT_COLUMN_DIFFERENCES',
  precedents: 'SELECT_PRECEDENTS',
  dependents: 'SELECT_DEPENDENTS',
  lastCell: 'SELECT_LAST_CELL',
  visibleCellsOnly: 'SELECT_VISIBLE_CELLS',
  conditionalFormats: 'SELECT_CELLS_WITH_CONDITIONAL_FORMATS',
  dataValidation: 'SELECT_CELLS_WITH_DATA_VALIDATION',
  sameValidation: 'SELECT_CELLS_WITH_SAME_VALIDATION',
};

/**
 * Radio options for Go To Special types.
 * Organized in two columns like Excel.
 */
const LEFT_COLUMN_OPTIONS: RadioOption[] = [
  { value: 'comments', label: 'Comments' },
  { value: 'constants', label: 'Constants' },
  { value: 'formulas', label: 'Formulas' },
  { value: 'blanks', label: 'Blanks' },
  { value: 'currentRegion', label: 'Current region' },
  { value: 'currentArray', label: 'Current array' },
  { value: 'objects', label: 'Objects' },
];

const RIGHT_COLUMN_OPTIONS: RadioOption[] = [
  { value: 'rowDifferences', label: 'Row differences' },
  { value: 'columnDifferences', label: 'Column differences' },
  { value: 'precedents', label: 'Precedents' },
  { value: 'dependents', label: 'Dependents' },
  { value: 'lastCell', label: 'Last cell' },
  { value: 'visibleCellsOnly', label: 'Visible cells only' },
  { value: 'conditionalFormats', label: 'Conditional formats' },
  { value: 'dataValidation', label: 'Data validation' },
  { value: 'sameValidation', label: 'Same validation (as active cell)' },
];

// =============================================================================
// Component
// =============================================================================

export function GoToSpecialDialog() {
  const deps = useActionDependencies();
  const isOpen = useUIStore((s) => s.goToSpecialDialog.isOpen);
  const selectedType = useUIStore((s) => s.goToSpecialDialog.selectedType);
  const valueTypeFilters = useUIStore((s) => s.goToSpecialDialog.valueTypeFilters);
  const setGoToSpecialType = useUIStore((s) => s.setGoToSpecialType);
  const setGoToSpecialValueTypeFilter = useUIStore((s) => s.setGoToSpecialValueTypeFilter);
  const closeGoToSpecialDialog = useUIStore((s) => s.closeGoToSpecialDialog);

  // Local error state for showing "no cells found" messages
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  // Clear error when type changes
  const handleTypeChange = useCallback(
    (newType: string) => {
      setGoToSpecialType(newType as GoToSpecialType);
      setErrorMessage(null);
    },
    [setGoToSpecialType],
  );

  // Handle OK - dispatch the appropriate selection action
  const handleOk = useCallback(() => {
    const actionType = TYPE_TO_ACTION[selectedType as GoToSpecialType];

    if (!actionType) {
      setErrorMessage(`"${selectedType}" is not yet implemented.`);
      return;
    }

    // For constants and formulas, we may need to pass filter options as payload
    // The handlers check the UIStore for valueTypeFilters
    dispatch(actionType as Parameters<typeof dispatch>[0], deps);

    // Close dialog
    closeGoToSpecialDialog();
  }, [selectedType, deps, closeGoToSpecialDialog]);

  // Handle Cancel
  const handleClose = useCallback(() => {
    closeGoToSpecialDialog();
    setErrorMessage(null);
  }, [closeGoToSpecialDialog]);

  // Check if value type filters should be shown
  const showValueTypeFilters = selectedType === 'constants' || selectedType === 'formulas';

  // Handle checkbox changes
  const handleNumbersChange = useCallback(
    (checked: boolean) => {
      setGoToSpecialValueTypeFilter({ numbers: checked });
    },
    [setGoToSpecialValueTypeFilter],
  );

  const handleTextChange = useCallback(
    (checked: boolean) => {
      setGoToSpecialValueTypeFilter({ text: checked });
    },
    [setGoToSpecialValueTypeFilter],
  );

  const handleLogicalsChange = useCallback(
    (checked: boolean) => {
      setGoToSpecialValueTypeFilter({ logicals: checked });
    },
    [setGoToSpecialValueTypeFilter],
  );

  const handleErrorsChange = useCallback(
    (checked: boolean) => {
      setGoToSpecialValueTypeFilter({ errors: checked });
    },
    [setGoToSpecialValueTypeFilter],
  );

  if (!isOpen) return null;

  return (
    <Dialog
      onEnterKeyDown={handleOk}
      open={isOpen}
      onClose={handleClose}
      dialogId="goto-special-dialog"
      width="md"
    >
      <DialogHeader onClose={handleClose}>Go To Special</DialogHeader>

      <DialogBody>
        <div className="flex flex-col gap-4">
          {/* Selection type - two column layout */}
          <div className="text-body-sm text-ss-text-secondary mb-1">Select:</div>
          <div className="grid grid-cols-2 gap-x-6 gap-y-1">
            {/* Left column */}
            <div className="flex flex-col gap-2">
              <RadioGroup
                name="gotoSpecialType"
                options={LEFT_COLUMN_OPTIONS}
                value={selectedType}
                onChange={handleTypeChange}
                size="sm"
              />
            </div>
            {/* Right column */}
            <div className="flex flex-col gap-2">
              <RadioGroup
                name="gotoSpecialType"
                options={RIGHT_COLUMN_OPTIONS}
                value={selectedType}
                onChange={handleTypeChange}
                size="sm"
              />
            </div>
          </div>

          {/* Value type filters (for Constants and Formulas) */}
          {showValueTypeFilters && (
            <div className="border border-ss-border rounded p-3 mt-2">
              <div className="text-body-sm text-ss-text-secondary mb-2">Include:</div>
              <div className="grid grid-cols-2 gap-2">
                <Checkbox
                  checked={valueTypeFilters.numbers}
                  onChange={handleNumbersChange}
                  label="Numbers"
                />
                <Checkbox
                  checked={valueTypeFilters.text}
                  onChange={handleTextChange}
                  label="Text"
                />
                <Checkbox
                  checked={valueTypeFilters.logicals}
                  onChange={handleLogicalsChange}
                  label="Logicals"
                />
                <Checkbox
                  checked={valueTypeFilters.errors}
                  onChange={handleErrorsChange}
                  label="Errors"
                />
              </div>
            </div>
          )}

          {/* Error message */}
          {errorMessage && (
            <div
              className="text-body-sm text-ss-error bg-ss-error/10 px-3 py-2 rounded"
              role="alert"
            >
              {errorMessage}
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
