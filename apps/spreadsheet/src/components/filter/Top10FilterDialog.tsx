/**
 * Top10FilterDialog Component
 *
 * B4: Filter Dropdown Panel - Top/Bottom N filter dialog
 *
 * Dialog for configuring Top/Bottom N or Top/Bottom % filters.
 * Provides options for:
 * - Top or Bottom
 * - Count (default 10)
 * - Items or Percent
 *
 * ARCHITECTURE:
 * - Uses Draft + Apply pattern: stores pending config in UIStore, then dispatches
 * - Dispatches APPLY_TOP10_FILTER to apply the filter
 * - Dispatches CLOSE_TOP10_DIALOG to close without applying
 * - Top10FilterDialogWrapper subscribes to its own state to prevent re-renders in parent components
 */

import type { CellId } from '@mog-sdk/contracts/cell-identity';
import React, { useState } from 'react';
import { dispatch } from '../../actions';
import { useActionDependencies } from '../../hooks/toolbar/use-action-dependencies';
import { useUIStore } from '../../infra/context';

export interface Top10FilterDialogProps {
  /** Dialog open state */
  isOpen: boolean;
  /** Filter ID from the filter dropdown context */
  filterId: string;
  /** Header cell ID from the filter dropdown context */
  headerCellId: CellId;
}

/**
 * Wrapper component that subscribes to its own state from UIStore.
 * This prevents SpreadsheetContent from re-rendering when filter dropdown state changes.
 * Follows render isolation pattern - see ARCHITECTURE-CHECKLIST.md Section 14.
 */
export function Top10FilterDialogWrapper(): React.ReactElement | null {
  const isTop10DialogOpen = useUIStore((s) => s.filterDropdown.isTop10DialogOpen);
  const filterId = useUIStore((s) => s.filterDropdown.filterId);
  const headerCellId = useUIStore((s) => s.filterDropdown.headerCellId);

  if (!isTop10DialogOpen || !filterId || !headerCellId) {
    return null;
  }

  return (
    <Top10FilterDialog isOpen={isTop10DialogOpen} filterId={filterId} headerCellId={headerCellId} />
  );
}

/**
 * Top 10 filter dialog
 *
 * Uses Draft + Apply pattern:
 * 1. Store pending config in UIStore via setPendingTop10Config
 * 2. Dispatch APPLY_TOP10_FILTER to apply
 */
export function Top10FilterDialog({
  isOpen,
  filterId,
  headerCellId,
}: Top10FilterDialogProps): React.ReactElement | null {
  const deps = useActionDependencies();
  const setPendingTop10Config = useUIStore((s) => s.setPendingTop10Config);

  const [type, setType] = useState<'top' | 'bottom'>('top');
  const [count, setCount] = useState<number>(10);
  const [by, setBy] = useState<'items' | 'percent'>('items');

  if (!isOpen) return null;

  /**
   * Handle apply button click.
   * Uses Draft + Apply pattern: store config, then dispatch.
   */
  const handleApply = () => {
    // Store pending config in UIStore (Draft step)
    setPendingTop10Config({
      filterId,
      headerCellId,
      type,
      count,
      by,
    });

    // Dispatch to apply filter (Apply step)
    dispatch('APPLY_TOP10_FILTER', deps);
  };

  /**
   * Handle cancel button click.
   * Dispatches CLOSE_TOP10_DIALOG to close without applying.
   */
  const handleCancel = () => {
    // Reset to defaults
    setType('top');
    setCount(10);
    setBy('items');

    // Dispatch to close dialog
    dispatch('CLOSE_TOP10_DIALOG', deps);
  };

  return (
    <div className="fixed inset-0 z-ss-modal flex items-center justify-center bg-ss-overlay">
      <div
        className="bg-ss-surface rounded shadow-ss-lg p-4 w-80"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-section font-medium mb-4">Top 10 Filter</h3>

        {/* Top/Bottom selector */}
        <div className="mb-4">
          <label className="block text-body-sm font-medium mb-2">Show</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={type === 'top'}
                onChange={() => setType('top')}
                className="w-4 h-4 accent-primary"
              />
              <span>Top</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={type === 'bottom'}
                onChange={() => setType('bottom')}
                className="w-4 h-4 accent-primary"
              />
              <span>Bottom</span>
            </label>
          </div>
        </div>

        {/* Count input */}
        <div className="mb-4">
          <label className="block text-body-sm font-medium mb-2">Count</label>
          <input
            type="number"
            value={count}
            onChange={(e) => setCount(Math.max(1, parseInt(e.target.value) || 1))}
            min="1"
            className="w-full px-3 py-2 border border-ss-border rounded focus:outline-none focus:ring-1 focus:ring-ss-primary"
          />
        </div>

        {/* Items/Percent selector */}
        <div className="mb-6">
          <label className="block text-body-sm font-medium mb-2">By</label>
          <div className="flex gap-4">
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={by === 'items'}
                onChange={() => setBy('items')}
                className="w-4 h-4 accent-primary"
              />
              <span>Items</span>
            </label>
            <label className="flex items-center gap-2">
              <input
                type="radio"
                checked={by === 'percent'}
                onChange={() => setBy('percent')}
                className="w-4 h-4 accent-primary"
              />
              <span>Percent</span>
            </label>
          </div>
        </div>

        {/* Action buttons */}
        <div className="flex gap-2 justify-end">
          <button
            type="button"
            onClick={handleCancel}
            className="px-4 py-2 border border-ss-border rounded hover:bg-ss-surface-hover"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={handleApply}
            className="px-4 py-2 bg-ss-primary text-ss-text-inverse rounded hover:bg-ss-primary-hover"
          >
            OK
          </button>
        </div>
      </div>
    </div>
  );
}
