/**
 * Advanced Filter Dialog
 *
 * Excel parity: Data > Sort & Filter > Advanced
 *
 * Allows criteria-based filtering with options to filter in place
 * or copy filtered results to another location.
 *
 */

import { useCallback } from 'react';
import {
  CollapsibleRangeInput,
  dispatch,
  useActionDependencies,
  useUIStore,
} from '../../internal-api';
import { useRangeSelectionEnterGuard } from '../../hooks/dialogs/use-range-selection-enter-guard';

import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  FormField,
  RadioGroup,
} from '@mog/shell';

// =============================================================================
// Constants
// =============================================================================

const ACTION_OPTIONS = [
  { value: 'inPlace', label: 'Filter the list, in-place' },
  { value: 'copyTo', label: 'Copy to another location' },
];

// =============================================================================
// Component
// =============================================================================

export function AdvancedFilterDialog() {
  const deps = useActionDependencies();

  // UI Store state
  const advancedFilterDialog = useUIStore((s) => s.advancedFilterDialog);
  const setAdvancedFilterInPlace = useUIStore((s) => s.setAdvancedFilterInPlace);
  const setAdvancedFilterListRange = useUIStore((s) => s.setAdvancedFilterListRange);
  const setAdvancedFilterCriteriaRange = useUIStore((s) => s.setAdvancedFilterCriteriaRange);
  const setAdvancedFilterCopyToRange = useUIStore((s) => s.setAdvancedFilterCopyToRange);
  const setAdvancedFilterUniqueRecordsOnly = useUIStore(
    (s) => s.setAdvancedFilterUniqueRecordsOnly,
  );

  const { isOpen, filterInPlace, listRange, criteriaRange, copyToRange, uniqueRecordsOnly, error } =
    advancedFilterDialog;

  // Handle action change (filter in place vs copy to)
  const handleActionChange = useCallback(
    (value: string) => {
      setAdvancedFilterInPlace(value === 'inPlace');
    },
    [setAdvancedFilterInPlace],
  );

  // Handle OK click - apply the advanced filter
  const handleOK = useCallback(() => {
    dispatch('APPLY_ADVANCED_FILTER', deps);
  }, [deps]);

  // Handle Cancel click
  const handleCancel = useCallback(() => {
    dispatch('CLOSE_ADVANCED_FILTER_DIALOG', deps);
  }, [deps]);

  // Handle close (X button or Escape)
  const handleClose = useCallback(() => {
    dispatch('CLOSE_ADVANCED_FILTER_DIALOG', deps);
  }, [deps]);

  const guardedEnter = useRangeSelectionEnterGuard(handleOK);

  // Don't render if not open
  if (!isOpen) return null;

  return (
    <Dialog
      onEnterKeyDown={guardedEnter}
      open={isOpen}
      onClose={handleClose}
      dialogId="advanced-filter-dialog"
      width={440}
    >
      <DialogHeader onClose={handleClose}>Advanced Filter</DialogHeader>

      <DialogBody>
        <div className="space-y-4">
          {/* Error message */}
          {error && (
            <div className="bg-ss-error-bg border border-ss-error rounded-ss-md p-3 text-ss-error text-body-sm">
              {error}
            </div>
          )}

          {/* Action selection */}
          <FormField label="Action">
            <RadioGroup
              name="advanced-filter-action"
              options={ACTION_OPTIONS}
              value={filterInPlace ? 'inPlace' : 'copyTo'}
              onChange={handleActionChange}
            />
          </FormField>

          {/* List range */}
          <FormField label="List range">
            <CollapsibleRangeInput
              value={listRange}
              onChange={setAdvancedFilterListRange}
              dialogId="advanced-filter-dialog"
              inputId="list-range"
              placeholder="$A$1:$D$100"
              label="List range"
            />
          </FormField>

          {/* Criteria range */}
          <FormField label="Criteria range">
            <CollapsibleRangeInput
              value={criteriaRange}
              onChange={setAdvancedFilterCriteriaRange}
              dialogId="advanced-filter-dialog"
              inputId="criteria-range"
              placeholder="$F$1:$G$2"
              label="Criteria range"
            />
          </FormField>

          {/* Copy to range (only enabled when copying) */}
          <FormField label="Copy to">
            <CollapsibleRangeInput
              value={copyToRange}
              onChange={setAdvancedFilterCopyToRange}
              dialogId="advanced-filter-dialog"
              inputId="copy-to-range"
              placeholder="$H$1"
              label="Copy to"
              disabled={filterInPlace}
            />
            {filterInPlace && (
              <div className="mt-1 text-body-sm text-ss-text-tertiary">
                Select &quot;Copy to another location&quot; to enable this field
              </div>
            )}
          </FormField>

          {/* Unique records only checkbox */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="unique-records-only"
              checked={uniqueRecordsOnly}
              onChange={(checked) => setAdvancedFilterUniqueRecordsOnly(checked)}
              label="Unique records only"
            />
          </div>
        </div>
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleOK}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
