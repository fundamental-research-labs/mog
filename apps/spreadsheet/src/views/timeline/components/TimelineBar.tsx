/**
 * TimelineBar Component
 *
 * A React component for a single timeline bar.
 * Used for DOM-based rendering (alternative to canvas).
 * Useful for accessibility or when DOM interactions are needed.
 */

import type { RowId } from '@mog-sdk/contracts/cell-identity';
import React, { useCallback } from 'react';
/**
 * Props for TimelineBar component.
 */
export interface TimelineBarProps {
  /** Row ID */
  rowId: RowId;
  /** X position in pixels */
  x: number;
  /** Y position in pixels */
  y: number;
  /** Width in pixels (0 for milestones) */
  width: number;
  /** Height in pixels */
  height: number;
  /** Display title */
  title: string;
  /** Bar color */
  color: string;
  /** Whether this is a milestone (single day) */
  isMilestone: boolean;
  /** Whether the bar is selected */
  isSelected: boolean;
  /** Whether the bar is focused */
  isFocused: boolean;
  /** Callback when bar is clicked */
  onClick?: (rowId: RowId, event: React.MouseEvent) => void;
  /** Callback when bar is double-clicked */
  onDoubleClick?: (rowId: RowId) => void;
  /** Callback when drag starts */
  onDragStart?: (rowId: RowId, x: number) => void;
  /** Callback when resize starts */
  onResizeStart?: (rowId: RowId, edge: 'start' | 'end', x: number) => void;
}

/**
 * DOM-based timeline bar component.
 */
export function TimelineBar({
  rowId,
  x,
  y,
  width,
  height,
  title,
  color,
  isMilestone,
  isSelected,
  isFocused,
  onClick,
  onDoubleClick,
  onDragStart,
  onResizeStart,
}: TimelineBarProps): React.ReactElement {
  // Handle click
  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onClick?.(rowId, event);
    },
    [rowId, onClick],
  );

  // Handle double click
  const handleDoubleClick = useCallback(() => {
    onDoubleClick?.(rowId);
  }, [rowId, onDoubleClick]);

  // Handle mouse down for drag
  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0) return; // Only left click

      // Check if clicking on resize handle
      const rect = (event.target as HTMLElement).getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const handleSize = 8;

      if (!isMilestone) {
        if (localX <= handleSize) {
          onResizeStart?.(rowId, 'start', event.clientX);
          return;
        }
        if (localX >= rect.width - handleSize) {
          onResizeStart?.(rowId, 'end', event.clientX);
          return;
        }
      }

      // Start drag
      onDragStart?.(rowId, event.clientX);
    },
    [rowId, isMilestone, onDragStart, onResizeStart],
  );

  if (isMilestone) {
    return (
      <MilestoneMarker
        x={x}
        y={y}
        height={height}
        title={title}
        color={color}
        isSelected={isSelected}
        isFocused={isFocused}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        onMouseDown={handleMouseDown}
      />
    );
  }

  return (
    <div
      className={`timeline-bar absolute rounded-ss-sm cursor-grab overflow-hidden flex items-center px-2 box-border ${isSelected ? 'border-2 border-ss-primary' : 'border-0'} ${isFocused ? 'outline-2 outline-dashed outline-ss-warning outline-offset-2' : ''}`}
      style={{
        left: x,
        top: y,
        width: Math.max(width, 4),
        height,
        backgroundColor: color,
      }}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onMouseDown={handleMouseDown}
      title={title}
    >
      {/* Bar label */}
      {width > 30 && (
        <span className="text-ss-text-inverse text-caption whitespace-nowrap overflow-hidden text-ellipsis drop-shadow-ss-sm">
          {title}
        </span>
      )}

      {/* Resize handles */}
      {isSelected && (
        <>
          <ResizeHandle edge="start" />
          <ResizeHandle edge="end" />
        </>
      )}
    </div>
  );
}

/**
 * Milestone marker (diamond shape).
 */
interface MilestoneMarkerProps {
  x: number;
  y: number;
  height: number;
  title: string;
  color: string;
  isSelected: boolean;
  isFocused: boolean;
  onClick: (event: React.MouseEvent) => void;
  onDoubleClick: () => void;
  onMouseDown: (event: React.MouseEvent) => void;
}

function MilestoneMarker({
  x,
  y,
  height,
  title,
  color,
  isSelected,
  isFocused,
  onClick,
  onDoubleClick,
  onMouseDown,
}: MilestoneMarkerProps): React.ReactElement {
  const size = Math.min(height - 8, 16);

  return (
    <div
      className={`timeline-milestone absolute rotate-45 cursor-grab ${isSelected ? 'border-2 border-ss-primary' : 'border-0'} ${isFocused ? 'outline-2 outline-dashed outline-ss-warning outline-offset-2' : ''}`}
      style={{
        left: x - size / 2,
        top: y + (height - size) / 2,
        width: size,
        height: size,
        backgroundColor: color,
      }}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      onMouseDown={onMouseDown}
      title={title}
    />
  );
}

/**
 * Resize handle for bar edges.
 */
interface ResizeHandleProps {
  edge: 'start' | 'end';
}

function ResizeHandle({ edge }: ResizeHandleProps): React.ReactElement {
  return (
    <div
      className={`timeline-resize-handle timeline-resize-${edge} absolute top-0 w-2 h-full cursor-ew-resize bg-ss-primary/30 opacity-0 transition-opacity duration-ss hover:opacity-100 ${edge === 'start' ? 'left-0' : 'right-0'}`}
    />
  );
}
