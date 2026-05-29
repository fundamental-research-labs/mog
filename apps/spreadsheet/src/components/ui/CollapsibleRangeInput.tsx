/**
 * Collapsible Range Input Component
 *
 * A specialized input component for selecting cell ranges that can "collapse"
 * to allow the user to select ranges directly from the sheet. This implements
 * Excel's iconic collapse button pattern used in many dialogs.
 *
 * Features:
 * - Collapse button to enter range selection mode
 * - Live updates as user selects cells on the sheet
 * - Expand button to return to dialog
 * - Escape to cancel selection
 * - Enter to confirm selection
 *
 */

import { forwardRef, useCallback, useEffect, useRef, type InputHTMLAttributes } from 'react';

import { ChevronDownSvg, SelectAllSvg } from '@mog/icons';

import { cn, Input } from '@mog/shell';

import { useUIStore } from '../../infra/context/document-context';

// =============================================================================
// Icons
// =============================================================================

function RangeSelectionIcon() {
  return <SelectAllSvg style={{ width: 14, height: 14 }} />;
}

function ExpandIcon() {
  return <ChevronDownSvg style={{ width: 14, height: 14 }} />;
}

// =============================================================================
// Component
// =============================================================================

interface CollapsibleRangeInputProps extends Omit<
  InputHTMLAttributes<HTMLInputElement>,
  'size' | 'value' | 'onChange'
> {
  /** Current range value */
  value: string;
  /** Called when range value changes */
  onChange: (value: string) => void;
  /** Unique ID for the dialog containing this input */
  dialogId: string;
  /** Unique ID for this specific input field */
  inputId: string;
  /** Label for accessibility */
  label?: string;
  /** Whether to allow multiple ranges separated by commas */
  allowMultipleRanges?: boolean;
  /** Show error styling */
  error?: boolean;
}

/**
 * CollapsibleRangeInput - Input with collapse button for range selection.
 *
 * This component integrates with the range selection mode system to allow
 * users to select ranges from the sheet while a dialog is open.
 *
 * @example
 * ```tsx
 * <CollapsibleRangeInput
 * value={rangeValue}
 * onChange={setRangeValue}
 * dialogId="sort-dialog"
 * inputId="sort-range"
 * label="Sort Range"
 * placeholder="A1:B10"
 * />
 * ```
 */
export const CollapsibleRangeInput = forwardRef<HTMLInputElement, CollapsibleRangeInputProps>(
  function CollapsibleRangeInput(
    {
      value,
      onChange,
      dialogId,
      inputId,
      label,
      allowMultipleRanges = false,
      error = false,
      placeholder,
      className,
      ...props
    },
    ref,
  ) {
    const rangeSelectionMode = useUIStore((s) => s.rangeSelectionMode);
    const startRangeSelectionMode = useUIStore((s) => s.startRangeSelectionMode);
    const updateRangeSelection = useUIStore((s) => s.updateRangeSelection);
    const completeRangeSelection = useUIStore((s) => s.completeRangeSelection);
    const cancelRangeSelection = useUIStore((s) => s.cancelRangeSelection);

    const localInputRef = useRef<HTMLInputElement>(null);
    const inputRefToUse = (ref as React.RefObject<HTMLInputElement>) || localInputRef;

    // Check if this specific input is in range selection mode
    const isInRangeSelectionMode =
      rangeSelectionMode.active &&
      rangeSelectionMode.sourceDialogId === dialogId &&
      rangeSelectionMode.sourceInputId === inputId;

    // Sync live range updates from selection to local value
    useEffect(() => {
      if (isInRangeSelectionMode && rangeSelectionMode.currentRange !== value) {
        onChange(rangeSelectionMode.currentRange);
      }
    }, [isInRangeSelectionMode, rangeSelectionMode.currentRange, value, onChange]);

    // Handle collapse button click - enter range selection mode
    const handleCollapseClick = useCallback(() => {
      startRangeSelectionMode(dialogId, inputId, value, {
        allowMultipleRanges,
        onComplete: (range: string) => {
          onChange(range);
          // Return focus to input after completion
          if (inputRefToUse.current) {
            inputRefToUse.current.focus();
          }
        },
        onCancel: () => {
          // Keep original value, just restore focus
          if (inputRefToUse.current) {
            inputRefToUse.current.focus();
          }
        },
      });
    }, [
      dialogId,
      inputId,
      value,
      allowMultipleRanges,
      startRangeSelectionMode,
      onChange,
      inputRefToUse,
    ]);

    // Handle expand button click - complete range selection mode
    const handleExpandClick = useCallback(() => {
      completeRangeSelection();
    }, [completeRangeSelection]);

    // Handle keyboard events when in range selection mode
    useEffect(() => {
      if (!isInRangeSelectionMode) return;

      const handleKeyDown = (e: KeyboardEvent) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          completeRangeSelection();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          cancelRangeSelection();
        }
      };

      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isInRangeSelectionMode, completeRangeSelection, cancelRangeSelection]);

    // Manual text input changes
    const handleInputChange = useCallback(
      (e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        onChange(newValue);

        // If in range selection mode, update the live range
        if (isInRangeSelectionMode) {
          updateRangeSelection(newValue);
        }
      },
      [onChange, isInRangeSelectionMode, updateRangeSelection],
    );

    return (
      <div className="relative">
        <Input
          ref={inputRefToUse}
          value={value}
          onChange={handleInputChange}
          error={error}
          placeholder={placeholder}
          aria-label={label}
          className={cn('pr-10', className)}
          {...props}
        />
        <button
          type="button"
          onClick={isInRangeSelectionMode ? handleExpandClick : handleCollapseClick}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded text-ss-text-secondary hover:bg-ss-surface-hover hover:text-text transition-colors"
          aria-label={isInRangeSelectionMode ? 'Expand dialog' : 'Select range from sheet'}
          title={isInRangeSelectionMode ? 'Expand dialog (Enter)' : 'Select range from sheet'}
        >
          {isInRangeSelectionMode ? <ExpandIcon /> : <RangeSelectionIcon />}
          <span className="sr-only">
            {isInRangeSelectionMode ? 'Expand dialog' : 'Select range from sheet'}
          </span>
        </button>
      </div>
    );
  },
);
