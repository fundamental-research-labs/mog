/**
 * ProtectionTab Component
 *
 * Protection tab for the Format Cells dialog.
 * Allows users to set:
 * - Locked: Cell cannot be edited when sheet is protected
 * - Hidden: Formula is hidden in formula bar when sheet is protected
 *
 * These properties only take effect when the sheet protection is enabled.
 *
 * Uses the Draft + Apply pattern:
 * - Maintains local state for user edits (before Apply)
 * - Exposes getChanges() ref method for parent dialog to call on Apply/OK
 * - Parent dialog applies changes via dispatch('APPLY_PROTECTION_FORMAT', deps)
 * - Tab does NOT have its own Apply button - parent dialog footer has Apply/OK/Cancel
 *
 */

import { forwardRef, useImperativeHandle, useRef, useState } from 'react';

import { Checkbox } from '@mog/shell';
import type { CellFormat } from '@mog-sdk/contracts/core';
// =============================================================================
// Types
// =============================================================================

/**
 * Ref handle exposed by ProtectionTab for parent dialog to call.
 */
export interface ProtectionTabRef {
  /** Get the pending format changes to apply */
  getChanges: () => Partial<CellFormat>;
  /** Check if there are any changes to apply */
  hasChanges: () => boolean;
}

/**
 * Protection tab props.
 */
export interface ProtectionTabProps {
  /**
   * Current cell format (for initializing draft state).
   * Undefined values indicate mixed state across selection.
   */
  initialFormat?: Partial<CellFormat>;
}

// =============================================================================
// Component
// =============================================================================

/**
 * ProtectionTab - Cell protection settings (Locked and Hidden).
 *
 * This is the simplest of the 6 Format Cells tabs, containing only two
 * checkboxes with explanatory text.
 *
 * Architecture:
 * - Uses forwardRef to expose getChanges() method to parent
 * - Parent dialog (FormatCellsDialog) owns the dispatch call
 * - Tab does NOT call dispatch - only accumulates changes locally
 * - Tab does NOT have its own Apply button - parent dialog footer has Apply/OK/Cancel
 */
export const ProtectionTab = forwardRef<ProtectionTabRef, ProtectionTabProps>(
  function ProtectionTab({ initialFormat }, ref) {
    // =========================================================================
    // Local State (Draft Changes)
    // =========================================================================

    /**
     * Locked state - cell cannot be edited when sheet is protected.
     * - true: All selected cells are locked
     * - false: All selected cells are unlocked
     * - 'indeterminate': Mixed state (some locked, some not)
     */
    const [locked, setLocked] = useState<boolean | 'indeterminate'>(() => {
      return initialFormat?.locked === undefined ? 'indeterminate' : initialFormat.locked;
    });

    /**
     * Hidden state - formula is hidden in formula bar when sheet is protected.
     * - true: All selected cells have hidden formulas
     * - false: All selected cells show formulas
     * - 'indeterminate': Mixed state (some hidden, some not)
     */
    const [hidden, setHidden] = useState<boolean | 'indeterminate'>(() => {
      return initialFormat?.hidden === undefined ? 'indeterminate' : initialFormat.hidden;
    });

    const dirtyRef = useRef(new Set<'locked' | 'hidden'>());

    // =========================================================================
    // Ref Methods (for parent dialog)
    // =========================================================================

    /**
     * Expose getChanges() and hasChanges() for parent dialog to call on Apply/OK.
     * Only includes properties with definite values (not indeterminate).
     */
    useImperativeHandle(ref, () => ({
      getChanges: (): Partial<CellFormat> => {
        const changes: Partial<CellFormat> = {};
        if (dirtyRef.current.has('locked') && locked !== 'indeterminate') {
          changes.locked = locked;
        }
        if (dirtyRef.current.has('hidden') && hidden !== 'indeterminate') {
          changes.hidden = hidden;
        }
        return changes;
      },
      hasChanges: (): boolean => dirtyRef.current.size > 0,
    }));

    // =========================================================================
    // Event Handlers
    // =========================================================================

    /**
     * Handle Locked checkbox change.
     * Clicking an indeterminate checkbox should check it (standard behavior).
     * Changes are NOT applied immediately - parent dialog handles Apply/OK.
     */
    const handleLockedChange = (checked: boolean) => {
      dirtyRef.current.add('locked');
      setLocked(checked);
    };

    /**
     * Handle Hidden checkbox change.
     * Clicking an indeterminate checkbox should check it (standard behavior).
     * Changes are NOT applied immediately - parent dialog handles Apply/OK.
     */
    const handleHiddenChange = (checked: boolean) => {
      dirtyRef.current.add('hidden');
      setHidden(checked);
    };

    // =========================================================================
    // Render
    // =========================================================================

    return (
      <div className="flex flex-col gap-6">
        {/* Protection Checkboxes Section */}
        <div className="space-y-3">
          <Checkbox
            checked={locked === 'indeterminate' ? 'indeterminate' : locked}
            onChange={handleLockedChange}
            label="Locked"
          />
          <Checkbox
            checked={hidden === 'indeterminate' ? 'indeterminate' : hidden}
            onChange={handleHiddenChange}
            label="Hidden"
          />
        </div>

        {/* Explanatory Text Section */}
        <div className="border-t border-ss-border pt-4">
          <p className="text-body-sm text-ss-text-secondary leading-relaxed">
            Locking cells or hiding formulas has no effect until you protect the worksheet (Review
            tab, Protect Sheet button).
          </p>
        </div>
      </div>
    );
  },
);
