/**
 * InputMessageTooltip
 *
 * Data Validation Parity - Input Message Display
 *
 * Shows the input message tooltip when a cell with data validation is selected.
 * Excel displays this as a yellow callout-style tooltip near the cell.
 *
 * Enhanced with arrow pointer, draggable position, and position persistence.
 *
 * Migrated to use Popover primitive for positioning (maintains drag functionality).
 *
 * Architecture:
 * - Uses selection state to track active cell
 * - Looks up RangeSchema for the cell to get inputMessage
 * - Positioned below-right of the cell (Excel behavior)
 * - Automatically hides when selection changes or no inputMessage exists
 * - User can drag to reposition (position persists until cell changes)
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import { createVirtualRef, Popover, PopoverAnchor, PopoverContent } from '@mog/shell/components/ui';

export interface InputMessageTooltipProps {
  /** Title of the input message (optional) */
  title?: string;
  /** Message content (required for display) */
  message: string;
  /** Position of the tooltip (screen coordinates) */
  position: { x: number; y: number };
  /** Cell identifier for position persistence (changes reset drag position) */
  cellKey?: string;
}

/**
 * Arrow direction from tooltip to cell
 */
type ArrowDirection = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * Input message tooltip component.
 * Excel-style: yellow/cream background with callout appearance.
 *
 * Enhanced with:
 * - Arrow pointer toward the cell
 * - Draggable positioning
 * - Position persistence until cell changes
 */
export function InputMessageTooltip({
  title,
  message,
  position,
  cellKey,
}: InputMessageTooltipProps) {
  const visible = Boolean(message);
  // Drag state management
  const [dragOffset, setDragOffset] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef<{
    mouseX: number;
    mouseY: number;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const previousCellKeyRef = useRef<string | undefined>(cellKey);

  // Reset drag offset when cell changes
  useEffect(() => {
    if (cellKey !== previousCellKeyRef.current) {
      setDragOffset({ x: 0, y: 0 });
      previousCellKeyRef.current = cellKey;
    }
  }, [cellKey]);

  // Handle drag start
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      // Only start drag on left mouse button
      if (e.button !== 0) return;

      e.preventDefault();
      e.stopPropagation();

      setIsDragging(true);
      dragStartRef.current = {
        mouseX: e.clientX,
        mouseY: e.clientY,
        offsetX: dragOffset.x,
        offsetY: dragOffset.y,
      };
    },
    [dragOffset],
  );

  // Handle drag move
  useEffect(() => {
    if (!isDragging) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStartRef.current) return;

      const deltaX = e.clientX - dragStartRef.current.mouseX;
      const deltaY = e.clientY - dragStartRef.current.mouseY;

      setDragOffset({
        x: dragStartRef.current.offsetX + deltaX,
        y: dragStartRef.current.offsetY + deltaY,
      });
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      dragStartRef.current = null;
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isDragging]);

  if (!message) return null;

  // Calculate final position with drag offset (applied to anchor)
  const anchorPosition = {
    x: position.x + dragOffset.x,
    y: position.y + dragOffset.y,
  };

  // Determine arrow direction based on position relative to default
  // Arrow points back toward the cell (opposite of tooltip position relative to cell)
  const arrowDirection: ArrowDirection =
    dragOffset.x < 0 && dragOffset.y < 0
      ? 'bottom-right'
      : dragOffset.x < 0 && dragOffset.y >= 0
        ? 'top-right'
        : dragOffset.x >= 0 && dragOffset.y < 0
          ? 'bottom-left'
          : 'top-left'; // Default: tooltip is bottom-right of cell, arrow points top-left

  // Arrow styles based on direction
  const getArrowStyles = () => {
    const arrowSize = 8;
    const baseStyles = {
      position: 'absolute' as const,
      width: 0,
      height: 0,
      borderStyle: 'solid' as const,
    };

    switch (arrowDirection) {
      case 'top-left':
        return {
          ...baseStyles,
          top: -arrowSize,
          left: 8,
          borderWidth: `0 ${arrowSize}px ${arrowSize}px ${arrowSize}px`,
          borderColor: 'transparent transparent rgb(var(--color-warning-bg)) transparent',
        };
      case 'top-right':
        return {
          ...baseStyles,
          top: -arrowSize,
          right: 8,
          borderWidth: `0 ${arrowSize}px ${arrowSize}px ${arrowSize}px`,
          borderColor: 'transparent transparent rgb(var(--color-warning-bg)) transparent',
        };
      case 'bottom-left':
        return {
          ...baseStyles,
          bottom: -arrowSize,
          left: 8,
          borderWidth: `${arrowSize}px ${arrowSize}px 0 ${arrowSize}px`,
          borderColor: 'rgb(var(--color-warning-bg)) transparent transparent transparent',
        };
      case 'bottom-right':
        return {
          ...baseStyles,
          bottom: -arrowSize,
          right: 8,
          borderWidth: `${arrowSize}px ${arrowSize}px 0 ${arrowSize}px`,
          borderColor: 'rgb(var(--color-warning-bg)) transparent transparent transparent',
        };
    }
  };

  return (
    <Popover open={visible} onOpenChange={() => {}}>
      <PopoverAnchor
        virtualRef={{ current: createVirtualRef(anchorPosition.x, anchorPosition.y) }}
      />
      <PopoverContent
        side="bottom"
        align="start"
        sideOffset={4}
        shadow="md"
        rounded="default"
        closeOnClickOutside={false}
        closeOnEscape={false}
        closeOnScroll={false}
        width="auto"
        role="tooltip"
        aria-label="Input message"
        className={`max-w-[280px] p-0 ${isDragging ? 'cursor-grabbing' : 'cursor-grab'}`}
      >
        <div onMouseDown={handleMouseDown} style={{ userSelect: 'none' }}>
          {/* Arrow pointer */}
          <div style={getArrowStyles()} />

          {/* Excel-style input message: cream/yellow background with subtle shadow */}
          <div
            data-testid="dv-input-message"
            className="px-2 py-1.5 rounded border bg-ss-warning-bg border-ss-warning/50 relative"
          >
            {title && (
              <div
                data-testid="dv-input-title"
                className="font-semibold text-body-sm text-ss-warning-text mb-0.5"
              >
                {title}
              </div>
            )}
            <div
              data-testid="dv-input-body"
              className="text-body-sm text-ss-warning-text whitespace-pre-wrap"
            >
              {message}
            </div>

            {/* Drag hint on hover */}
            {!isDragging && (
              <div className="absolute -top-5 left-0 right-0 text-center text-ribbon-compact text-ss-text-tertiary opacity-0 hover:opacity-100 transition-opacity pointer-events-none">
                Drag to move
              </div>
            )}
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default InputMessageTooltip;
