/**
 * SplitDivider Component
 *
 * Draggable divider for split view functionality.
 * Renders as a horizontal or vertical line that users can drag
 * to adjust split positions.
 *
 * Architecture:
 * - Uses RAF for smooth position updates during drag
 * - CSS transform for visual movement (no layout thrash)
 * - Commits final position to UIStore only on drag end
 *
 */

import type { ViewportDivider } from '@mog-sdk/contracts/viewport';
import { memo, useCallback, useRef, useState } from 'react';
// =============================================================================
// Constants
// =============================================================================

/** Width/height of the draggable divider line */
const DIVIDER_SIZE = 4;

/** Hit area for easier mouse targeting */
const HIT_AREA_SIZE = 8;

/** Z-index for split dividers (UI layer) */
const SPLIT_DIVIDER_Z_INDEX = 4;

// =============================================================================
// Types
// =============================================================================

export interface SplitDividerProps {
  /** The divider configuration from ViewportLayout */
  divider: ViewportDivider;
  /** Called when drag starts */
  onDragStart?: () => void;
  /** Called during drag with the new position (CSS pixels) */
  onDrag?: (position: number) => void;
  /** Called when drag ends with the final position */
  onDragEnd?: (position: number) => void;
  /** Double-click handler (typically removes the split) */
  onDoubleClick?: () => void;
  /** Container bounds for clamping drag position */
  containerBounds?: { min: number; max: number };
}

// =============================================================================
// Component
// =============================================================================

/**
 * SplitDivider - A draggable divider line for split views
 *
 * Renders a visible line with an invisible hit area for easier targeting.
 * Uses RAF-batched updates during drag for smooth performance.
 */
export const SplitDivider = memo(function SplitDivider({
  divider,
  onDragStart,
  onDrag,
  onDragEnd,
  onDoubleClick,
  containerBounds,
}: SplitDividerProps) {
  const { orientation, position, draggable, type } = divider;

  // Drag state
  const [isDragging, setIsDragging] = useState(false);
  const [dragOffset, setDragOffset] = useState(0);
  const dragStartPos = useRef(0);
  const rafRef = useRef<number | null>(null);
  const latestPosition = useRef(position);

  // Only render split dividers (freeze dividers are rendered differently)
  if (type !== 'split') {
    return null;
  }

  const isHorizontal = orientation === 'horizontal';
  const cursor = isHorizontal ? 'row-resize' : 'col-resize';

  // Clamp position within container bounds
  const clampPosition = useCallback(
    (pos: number): number => {
      if (!containerBounds) return pos;
      return Math.max(containerBounds.min, Math.min(containerBounds.max, pos));
    },
    [containerBounds],
  );

  // Handle mouse down - start drag
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (!draggable) return;

      e.preventDefault();
      e.stopPropagation();

      setIsDragging(true);
      dragStartPos.current = isHorizontal ? e.clientY : e.clientX;
      latestPosition.current = position;
      onDragStart?.();

      // Add document-level listeners for drag tracking
      const handleMouseMove = (moveEvent: MouseEvent) => {
        const currentPos = isHorizontal ? moveEvent.clientY : moveEvent.clientX;
        const delta = currentPos - dragStartPos.current;
        const newPosition = clampPosition(position + delta);

        // Use RAF for smooth updates
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
        }

        rafRef.current = requestAnimationFrame(() => {
          setDragOffset(delta);
          latestPosition.current = newPosition;
          onDrag?.(newPosition);
        });
      };

      const handleMouseUp = () => {
        setIsDragging(false);
        setDragOffset(0);

        // Cancel any pending RAF
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }

        // Commit final position
        onDragEnd?.(latestPosition.current);

        // Remove document listeners
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleMouseUp);
      };

      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleMouseUp);
    },
    [draggable, isHorizontal, position, clampPosition, onDragStart, onDrag, onDragEnd],
  );

  // Handle double-click - remove split
  const handleDoubleClick = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      onDoubleClick?.();
    },
    [onDoubleClick],
  );

  // Calculate transform for smooth drag movement
  const transform = isDragging
    ? isHorizontal
      ? `translateY(${dragOffset}px)`
      : `translateX(${dragOffset}px)`
    : undefined;

  // Styles for the divider
  const containerStyle: React.CSSProperties = isHorizontal
    ? {
        position: 'absolute',
        left: 0,
        right: 0,
        top: position - HIT_AREA_SIZE / 2,
        height: HIT_AREA_SIZE,
        cursor: draggable ? cursor : 'default',
        zIndex: SPLIT_DIVIDER_Z_INDEX,
        transform,
        willChange: isDragging ? 'transform' : undefined,
      }
    : {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: position - HIT_AREA_SIZE / 2,
        width: HIT_AREA_SIZE,
        cursor: draggable ? cursor : 'default',
        zIndex: SPLIT_DIVIDER_Z_INDEX,
        transform,
        willChange: isDragging ? 'transform' : undefined,
      };

  const lineStyle: React.CSSProperties = isHorizontal
    ? {
        position: 'absolute',
        left: 0,
        right: 0,
        top: (HIT_AREA_SIZE - DIVIDER_SIZE) / 2,
        height: DIVIDER_SIZE,
        backgroundColor: isDragging
          ? 'var(--ss-accent, #217346)'
          : 'var(--ss-border-dark, #bdbdbd)',
        transition: isDragging ? 'none' : 'background-color 0.15s ease',
      }
    : {
        position: 'absolute',
        top: 0,
        bottom: 0,
        left: (HIT_AREA_SIZE - DIVIDER_SIZE) / 2,
        width: DIVIDER_SIZE,
        backgroundColor: isDragging
          ? 'var(--ss-accent, #217346)'
          : 'var(--ss-border-dark, #bdbdbd)',
        transition: isDragging ? 'none' : 'background-color 0.15s ease',
      };

  return (
    <div
      className="split-divider"
      style={containerStyle}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      role="separator"
      aria-orientation={isHorizontal ? 'horizontal' : 'vertical'}
      aria-valuenow={position}
      aria-label={`Split divider at ${position}px`}
      data-testid={`split-divider-${orientation}`}
    >
      {/* Visible divider line */}
      <div className="split-divider-line" style={lineStyle} />
    </div>
  );
});
