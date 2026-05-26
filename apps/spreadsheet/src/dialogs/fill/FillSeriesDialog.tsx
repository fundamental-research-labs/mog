/**
 * Fill Series Dialog
 *
 * Excel Parity Quickwin A9: Fill Series Dialog
 *
 * Provides advanced fill options matching Excel's Fill Series dialog.
 * Allows users to configure:
 * - Series direction (Rows/Columns)
 * - Series type (Linear, Growth, Date, AutoFill)
 * - Date unit (when Type=Date)
 * - Step value (increment)
 * - Stop value (optional end limit)
 * - Trend checkbox (for formula extension via linear regression)
 *
 * Uses position-based CellRange (not CellIds) because the selection may include
 * empty cells that don't have CellIds yet.
 *
 */

import { useCallback, useEffect, useState } from 'react';
import { dispatch, useActionDependencies, useUIStore } from '../../internal-api';

import {
  Button,
  Checkbox,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Input,
  Label,
  RadioGroup,
} from '@mog/shell';
import type { FillDirection, SeriesType } from '../../domain/fill';

// =============================================================================
// Types
// =============================================================================

/**
 * UI state for the fill series form.
 */
interface FillSeriesFormState {
  /** Series direction */
  seriesIn: 'rows' | 'columns';
  /** Series type */
  type: SeriesType;
  /** Date unit (only when type='date') */
  dateUnit: 'day' | 'weekday' | 'month' | 'year';
  /** Step value (increment or multiplier) */
  stepValue: number;
  /** Stop value (optional) */
  stopValue: string;
  /** Trend option (for formulas) */
  trend: boolean;
}

// =============================================================================
// Constants
// =============================================================================

const SERIES_IN_OPTIONS = [
  { value: 'rows', label: 'Rows' },
  { value: 'columns', label: 'Columns' },
];

const TYPE_OPTIONS = [
  { value: 'linear', label: 'Linear' },
  { value: 'growth', label: 'Growth' },
  { value: 'date', label: 'Date' },
  { value: 'auto', label: 'AutoFill' },
];

const DATE_UNIT_OPTIONS = [
  { value: 'day', label: 'Day' },
  { value: 'weekday', label: 'Weekday' },
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
];

// =============================================================================
// Component
// =============================================================================

export function FillSeriesDialog() {
  // Action dependencies for dispatch
  const deps = useActionDependencies();

  // UI Store state and methods
  const fillSeriesDialog = useUIStore((s) => s.fillSeriesDialog);
  const setPendingFillSeriesOptions = useUIStore((s) => s.setPendingFillSeriesOptions);
  const { isOpen, sourceRange, direction } = fillSeriesDialog;

  // Local form state
  const [formState, setFormState] = useState<FillSeriesFormState>({
    seriesIn: 'columns',
    type: 'linear',
    dateUnit: 'day',
    stepValue: 1,
    stopValue: '',
    trend: false,
  });

  // Reset form when dialog opens
  useEffect(() => {
    if (isOpen) {
      setFormState({
        seriesIn: direction === 'row' ? 'rows' : 'columns',
        type: 'linear',
        dateUnit: 'day',
        stepValue: 1,
        stopValue: '',
        trend: false,
      });
    }
  }, [isOpen, direction]);

  // Update form field
  const updateField = useCallback((field: keyof FillSeriesFormState, value: any) => {
    setFormState((prev) => ({ ...prev, [field]: value }));
  }, []);

  // Convert form state to FillOptions
  const formToFillOptions = useCallback(
    (
      form: FillSeriesFormState,
    ): {
      direction: FillDirection;
      seriesType: SeriesType;
      dateUnit?: 'day' | 'weekday' | 'month' | 'year';
      step: number;
    } => ({
      direction: form.seriesIn === 'rows' ? 'right' : 'down',
      seriesType: form.type,
      dateUnit: form.type === 'date' ? form.dateUnit : undefined,
      step: form.stepValue,
    }),
    [],
  );

  // Handle OK button - execute fill series via dispatch
  // Uses Draft + Apply pattern: store options in UIStore, then dispatch action
  const handleOK = useCallback(() => {
    if (!sourceRange) return;

    // Step 1: Store pending options in UIStore (Draft)
    const options = formToFillOptions(formState);
    setPendingFillSeriesOptions({
      direction: options.direction,
      seriesType: options.seriesType,
      dateUnit: options.dateUnit,
      step: options.step,
      stopValue: formState.stopValue ? parseFloat(formState.stopValue) : undefined,
      trend: formState.trend,
    });

    // Step 2: Dispatch action (handler reads from UIStore - Apply)
    dispatch('EXECUTE_FILL_SERIES', deps);
  }, [deps, sourceRange, formState, formToFillOptions, setPendingFillSeriesOptions]);

  // Handle Cancel button - close via dispatch
  const handleCancel = useCallback(() => {
    dispatch('CLOSE_FILL_SERIES_DIALOG', deps);
  }, [deps]);

  // Don't render if not open
  if (!isOpen || !sourceRange) return null;

  return (
    <Dialog
      onEnterKeyDown={handleOK}
      open={isOpen}
      onClose={handleCancel}
      dialogId="fill-series-dialog"
      width={400}
    >
      <DialogHeader onClose={handleCancel}>Fill Series</DialogHeader>

      <DialogBody>
        <div className="space-y-4">
          {/* Series in */}
          <div className="space-y-2">
            <Label>Series in</Label>
            <RadioGroup
              name="seriesIn"
              value={formState.seriesIn}
              onChange={(value) => updateField('seriesIn', value)}
              options={SERIES_IN_OPTIONS}
              orientation="horizontal"
              size="sm"
            />
          </div>

          {/* Type */}
          <div className="space-y-2">
            <Label>Type</Label>
            <RadioGroup
              name="type"
              value={formState.type}
              onChange={(value) => updateField('type', value as SeriesType)}
              options={TYPE_OPTIONS}
              orientation="vertical"
              size="sm"
            />
          </div>

          {/* Date Unit (conditional) */}
          {formState.type === 'date' && (
            <div className="space-y-2 pl-6">
              <Label>Date unit</Label>
              <RadioGroup
                name="dateUnit"
                value={formState.dateUnit}
                onChange={(value) =>
                  updateField('dateUnit', value as 'day' | 'weekday' | 'month' | 'year')
                }
                options={DATE_UNIT_OPTIONS}
                orientation="vertical"
                size="sm"
              />
            </div>
          )}

          {/* Step value */}
          <div className="space-y-1">
            <Label htmlFor="step-value">Step value</Label>
            <Input
              id="step-value"
              type="number"
              value={formState.stepValue}
              onChange={(e) => updateField('stepValue', parseFloat(e.target.value) || 1)}
              size="sm"
              className="w-32"
            />
          </div>

          {/* Stop value */}
          <div className="space-y-1">
            <Label htmlFor="stop-value">Stop value (optional)</Label>
            <Input
              id="stop-value"
              type="text"
              value={formState.stopValue}
              onChange={(e) => updateField('stopValue', e.target.value)}
              placeholder="Leave empty for selection"
              size="sm"
              className="w-32"
            />
          </div>

          {/* Trend */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="trend"
              checked={formState.trend}
              onChange={(checked) => updateField('trend', checked)}
              label="Trend (linear regression for formulas)"
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
