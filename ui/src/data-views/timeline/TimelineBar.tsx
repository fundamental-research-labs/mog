/**
 * TimelineBar Component
 *
 * Individual bar component for timeline.
 * Kernel-agnostic - uses plain string IDs.
 */

import React, { useCallback, useState } from 'react';

/**
 * Props for TimelineBar component.
 */
export interface TimelineBarProps {
  /** Bar ID (plain string) */
  id: string;
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
  /** Bar color (CSS color) */
  color: string;
  /** Whether this is a milestone (single point in time) */
  isMilestone?: boolean;
  /** Whether the bar is selected */
  isSelected?: boolean;
  /** Whether the bar is focused */
  isFocused?: boolean;
  /** Callback when bar is clicked */
  onClick?: (id: string, event: React.MouseEvent) => void;
  /** Callback when bar is double-clicked */
  onDoubleClick?: (id: string) => void;
  /** Callback when drag starts */
  onDragStart?: (id: string, x: number) => void;
  /** Callback when resize starts */
  onResizeStart?: (id: string, edge: 'start' | 'end', x: number) => void;
  /** Optional class name */
  className?: string;
}

/**
 * DOM-based timeline bar component.
 */
export function TimelineBar({
  id,
  x,
  y,
  width,
  height,
  title,
  color,
  isMilestone = false,
  isSelected = false,
  isFocused = false,
  onClick,
  onDoubleClick,
  onDragStart,
  onResizeStart,
  className = '',
}: TimelineBarProps): React.ReactElement {
  const [isHovered, setIsHovered] = useState(false);

  // Handle click
  const handleClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onClick?.(id, event);
    },
    [id, onClick],
  );

  // Handle double click
  const handleDoubleClick = useCallback(
    (event: React.MouseEvent) => {
      event.stopPropagation();
      onDoubleClick?.(id);
    },
    [id, onDoubleClick],
  );

  // Handle mouse down for drag/resize
  const handleMouseDown = useCallback(
    (event: React.MouseEvent) => {
      if (event.button !== 0) return; // Only left click

      event.stopPropagation();

      // Check if clicking on resize handle
      const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
      const localX = event.clientX - rect.left;
      const handleSize = 8;

      if (!isMilestone) {
        if (localX <= handleSize) {
          onResizeStart?.(id, 'start', event.clientX);
          return;
        }
        if (localX >= rect.width - handleSize) {
          onResizeStart?.(id, 'end', event.clientX);
          return;
        }
      }

      // Start drag
      onDragStart?.(id, event.clientX);
    },
    [id, isMilestone, onDragStart, onResizeStart],
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
        className={className}
      />
    );
  }

  return (
    <div
      className={`timeline-bar absolute rounded cursor-grab overflow-hidden flex items-center px-2 box-border transition-shadow ${
        isSelected ? 'ring-2 ring-blue-500 ring-offset-1' : ''
      } ${isFocused ? 'ring-2 ring-yellow-500 ring-offset-2 ring-offset-dashed' : ''} ${
        isHovered ? 'shadow-lg' : 'shadow'
      } ${className}`}
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
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      title={title}
    >
      {/* Bar label */}
      {width > 30 && (
        <span className="text-white text-sm font-medium whitespace-nowrap overflow-hidden text-ellipsis drop-shadow">
          {title}
        </span>
      )}

      {/* Resize handles */}
      {(isSelected || isHovered) && (
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
  onDoubleClick: (event: React.MouseEvent) => void;
  onMouseDown: (event: React.MouseEvent) => void;
  className?: string;
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
  className = '',
}: MilestoneMarkerProps): React.ReactElement {
  const [isHovered, setIsHovered] = useState(false);
  const size = Math.min(height - 8, 16);

  return (
    <div
      className={`timeline-milestone absolute rotate-45 cursor-grab transition-shadow ${
        isSelected ? 'ring-2 ring-blue-500 ring-offset-1' : ''
      } ${isFocused ? 'ring-2 ring-yellow-500 ring-offset-2' : ''} ${
        isHovered ? 'shadow-lg' : 'shadow'
      } ${className}`}
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
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
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
      className={`timeline-resize-handle absolute top-0 w-2 h-full cursor-ew-resize bg-blue-500/30 opacity-0 hover:opacity-100 transition-opacity ${
        edge === 'start' ? 'left-0' : 'right-0'
      }`}
    />
  );
}
