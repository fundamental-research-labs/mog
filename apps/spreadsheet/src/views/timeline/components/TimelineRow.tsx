/**
 * TimelineRow Component
 *
 * Renders a row label (left sidebar) for a timeline row.
 * Shows the record title and optional group header.
 */

import type { RowId } from '@mog-sdk/contracts/cell-identity';
import React from 'react';
/**
 * Props for TimelineRow component.
 */
export interface TimelineRowProps {
  /** Row ID */
  rowId: RowId;
  /** Display label */
  label: string;
  /** Row height in pixels */
  height?: number;
  /** Whether this row is selected */
  isSelected?: boolean;
  /** Whether this row is focused */
  isFocused?: boolean;
  /** Optional color indicator */
  color?: string;
  /** Callback when row is clicked */
  onClick?: (rowId: RowId, event: React.MouseEvent) => void;
  /** Callback when row is double-clicked */
  onDoubleClick?: (rowId: RowId) => void;
}

/**
 * Row label component for the timeline sidebar.
 */
export function TimelineRow({
  rowId,
  label,
  height = 40,
  isSelected = false,
  isFocused = false,
  color,
  onClick,
  onDoubleClick,
}: TimelineRowProps): React.ReactElement {
  const handleClick = (event: React.MouseEvent) => {
    onClick?.(rowId, event);
  };

  const handleDoubleClick = () => {
    onDoubleClick?.(rowId);
  };

  return (
    <div
      className={`timeline-row flex items-center px-2 border-b border-ss-border-light cursor-pointer select-none overflow-hidden ${isSelected ? 'bg-ss-row-selected' : 'bg-transparent'} ${isFocused ? 'outline outline-2 outline-ss-warning -outline-offset-2' : ''}`}
      style={{ height: `${height}px` }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
    >
      {/* Color indicator */}
      {color && (
        <div
          className="w-1 h-5 rounded-ss-sm mr-2 flex-shrink-0"
          style={{ backgroundColor: color }}
        />
      )}

      {/* Label */}
      <span className="text-body-sm text-ss-text whitespace-nowrap overflow-hidden text-ellipsis">
        {label}
      </span>
    </div>
  );
}

/**
 * Props for TimelineGroupHeader component.
 */
export interface TimelineGroupHeaderProps {
  /** Group key */
  groupKey: string;
  /** Display label */
  label: string;
  /** Header height in pixels */
  height?: number;
  /** Number of items in group */
  itemCount: number;
  /** Whether the group is collapsed */
  isCollapsed: boolean;
  /** Callback when collapse is toggled */
  onToggle?: (groupKey: string) => void;
}

/**
 * Group header component for the timeline sidebar.
 */
export function TimelineGroupHeader({
  groupKey,
  label,
  height = 32,
  itemCount,
  isCollapsed,
  onToggle,
}: TimelineGroupHeaderProps): React.ReactElement {
  const handleClick = () => {
    onToggle?.(groupKey);
  };

  return (
    <div
      className="timeline-group-header flex items-center px-2 border-b border-ss-border bg-ss-surface-secondary cursor-pointer select-none"
      style={{ height: `${height}px` }}
      onClick={handleClick}
    >
      {/* Collapse indicator */}
      <span
        className={`inline-flex items-center justify-center w-4 h-4 mr-1 text-caption text-ss-text-secondary transition-transform duration-ss ${isCollapsed ? '-rotate-90' : 'rotate-0'}`}
      >
        &#x25BC;
      </span>

      {/* Label */}
      <span className="text-body-sm font-medium text-ss-text whitespace-nowrap overflow-hidden text-ellipsis flex-1">
        {label}
      </span>

      {/* Item count */}
      <span className="text-caption text-ss-text-disabled ml-2">({itemCount})</span>
    </div>
  );
}
