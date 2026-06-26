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
 * Receives the target filter context from FilterDropdownContent and reports the
 * selected Top/Bottom settings back to that owner.
 */

import React, { useState } from 'react';

export interface Top10FilterConfig {
  type: 'top' | 'bottom';
  count: number;
  by: 'items' | 'percent';
}

export interface Top10FilterDialogProps {
  /** Dialog open state */
  isOpen: boolean;
  /** Called when user applies the Top/Bottom N configuration */
  onApply: (config: Top10FilterConfig) => void;
  /** Called to close without applying */
  onCancel: () => void;
}

/**
 * Top 10 filter dialog
 */
export function Top10FilterDialog({
  isOpen,
  onApply,
  onCancel,
}: Top10FilterDialogProps): React.ReactElement | null {
  const [type, setType] = useState<'top' | 'bottom'>('top');
  const [count, setCount] = useState<number>(10);
  const [by, setBy] = useState<'items' | 'percent'>('items');

  if (!isOpen) return null;

  const handleApply = () => {
    onApply({ type, count, by });
  };

  const handleCancel = () => {
    setType('top');
    setCount(10);
    setBy('items');
    onCancel();
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
