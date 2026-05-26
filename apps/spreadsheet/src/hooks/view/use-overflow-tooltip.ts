/**
 * Overflow Tooltip Hook
 *
 * UI Micro-Polish - Overflow Tooltip
 *
 * Tracks mouse hover over cells and shows a tooltip when the cell content
 * is clipped (displayed with ellipsis).
 *
 * Architecture:
 * - CellsLayer tracks clipped cells during render
 * - This hook reads from CellsLayer via useRenderer.getClippedCellContent()
 * - Shows tooltip after delay (500ms) when hovering over clipped cell
 * - Hides tooltip immediately when mouse leaves cell
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { CellCoord } from '@mog-sdk/contracts/rendering';
import { useRenderer } from './use-renderer';

// =============================================================================
// Types
// =============================================================================

export interface UseOverflowTooltipOptions {
  /** Whether tooltip functionality is enabled */
  enabled?: boolean;
  /** Delay before showing tooltip in ms (default: 500ms) */
  delay?: number;
}

export interface OverflowTooltipState {
  /** Whether tooltip is visible */
  visible: boolean;
  /** Full content to display */
  content: string;
  /** Position in screen coordinates */
  position: { x: number; y: number };
}

export interface UseOverflowTooltipReturn {
  /** Current tooltip state */
  tooltip: OverflowTooltipState;
  /** Handle mouse move on a cell - call when mouse moves over grid */
  handleCellHover: (cell: CellCoord | null, screenPosition: { x: number; y: number }) => void;
  /** Handle mouse leave - call when mouse leaves grid area */
  handleMouseLeave: () => void;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_DELAY = 500; // Excel-style 500ms delay
const TOOLTIP_OFFSET = { x: 8, y: 16 }; // Offset from cursor

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for managing overflow tooltip display.
 *
 * @example
 * ```tsx
 * function Grid() {
 * const { tooltip, handleCellHover, handleMouseLeave } = useOverflowTooltip;
 *
 * const onMouseMove = (e: React.MouseEvent) => {
 * const cell = hitTestCell(e);
 * handleCellHover(cell, { x: e.clientX, y: e.clientY });
 * };
 *
 * return (
 * <div onMouseMove={onMouseMove} onMouseLeave={handleMouseLeave}>
 * <Canvas />
 * <CellOverflowTooltip {...tooltip} />
 * </div>
 * );
 * }
 * ```
 */
export function useOverflowTooltip(
  options: UseOverflowTooltipOptions = {},
): UseOverflowTooltipReturn {
  const { enabled = true, delay = DEFAULT_DELAY } = options;

  const renderer = useRenderer();

  // Tooltip state
  const [tooltip, setTooltip] = useState<OverflowTooltipState>({
    visible: false,
    content: '',
    position: { x: 0, y: 0 },
  });

  // Track current hovered cell for debouncing
  const hoveredCellRef = useRef<{ row: number; col: number } | null>(null);
  const showTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clear any pending timeout
  const clearShowTimeout = useCallback(() => {
    if (showTimeoutRef.current) {
      clearTimeout(showTimeoutRef.current);
      showTimeoutRef.current = null;
    }
  }, []);

  // Hide tooltip
  const hideTooltip = useCallback(() => {
    clearShowTimeout();
    setTooltip((prev) => ({ ...prev, visible: false }));
  }, [clearShowTimeout]);

  // Handle cell hover
  const handleCellHover = useCallback(
    (cell: CellCoord | null, screenPosition: { x: number; y: number }) => {
      if (!enabled) {
        hideTooltip();
        return;
      }

      // No cell - hide tooltip
      if (!cell) {
        hoveredCellRef.current = null;
        hideTooltip();
        return;
      }

      // Same cell - just update position
      const prev = hoveredCellRef.current;
      if (prev && prev.row === cell.row && prev.col === cell.col) {
        // Update position if tooltip is visible
        setTooltip((t) =>
          t.visible
            ? {
                ...t,
                position: {
                  x: screenPosition.x + TOOLTIP_OFFSET.x,
                  y: screenPosition.y + TOOLTIP_OFFSET.y,
                },
              }
            : t,
        );
        return;
      }

      // New cell - update ref and check if clipped
      hoveredCellRef.current = { row: cell.row, col: cell.col };
      clearShowTimeout();

      // Check if cell is clipped
      const clippedContent = renderer.getClippedCellContent(cell.row, cell.col);

      if (!clippedContent) {
        // Not clipped - hide tooltip
        setTooltip((prev) => ({ ...prev, visible: false }));
        return;
      }

      // Clipped - show tooltip after delay
      showTimeoutRef.current = setTimeout(() => {
        // Verify we're still hovering over the same cell
        const current = hoveredCellRef.current;
        if (current && current.row === cell.row && current.col === cell.col) {
          setTooltip({
            visible: true,
            content: clippedContent,
            position: {
              x: screenPosition.x + TOOLTIP_OFFSET.x,
              y: screenPosition.y + TOOLTIP_OFFSET.y,
            },
          });
        }
      }, delay);
    },
    [enabled, delay, renderer, hideTooltip, clearShowTimeout],
  );

  // Handle mouse leave
  const handleMouseLeave = useCallback(() => {
    hoveredCellRef.current = null;
    hideTooltip();
  }, [hideTooltip]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      clearShowTimeout();
    };
  }, [clearShowTimeout]);

  return {
    tooltip,
    handleCellHover,
    handleMouseLeave,
  };
}

export default useOverflowTooltip;
