/**
 * Hyperlink Tooltip Hook
 *
 * Tracks mouse hover over cells and shows a tooltip when the cell contains a hyperlink.
 *
 * Architecture:
 * - Reads hyperlink data from cell via ws.viewport (sync ViewportReader)
 * - Shows tooltip after delay (300ms) when hovering over cell with hyperlink
 * - Hides tooltip immediately when mouse leaves cell
 * - No dispatch needed - tooltip is local UI state
 */

import { useCallback, useEffect, useRef, useState } from 'react';

import type { CellCoord } from '@mog-sdk/contracts/rendering';

import { useActiveSheetId, useWorkbook } from '../../infra/context';

// =============================================================================
// Types
// =============================================================================

export interface UseHyperlinkTooltipOptions {
  /** Whether tooltip functionality is enabled */
  enabled?: boolean;
  /** Delay before showing tooltip in ms (default: 300ms) */
  delay?: number;
}

export interface HyperlinkTooltipState {
  /** Whether tooltip is visible */
  visible: boolean;
  /** URL to display */
  url: string;
  /** Position in screen coordinates */
  position: { x: number; y: number };
}

export interface UseHyperlinkTooltipReturn {
  /** Current tooltip state */
  tooltip: HyperlinkTooltipState;
  /** Handle mouse move on a cell - call when mouse moves over grid */
  handleCellHover: (cell: CellCoord | null, screenPosition: { x: number; y: number }) => void;
  /** Handle mouse leave - call when mouse leaves grid area */
  handleMouseLeave: () => void;
}

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_DELAY = 300; // Shorter than overflow tooltip for quicker feedback
const TOOLTIP_OFFSET = { x: 12, y: 20 }; // Offset from cursor

// =============================================================================
// Hook Implementation
// =============================================================================

/**
 * Hook for managing hyperlink tooltip display.
 *
 * @example
 * ```tsx
 * function Grid() {
 * const { tooltip, handleCellHover, handleMouseLeave } = useHyperlinkTooltip;
 *
 * const onMouseMove = (e: React.MouseEvent) => {
 * const cell = hitTestCell(e);
 * handleCellHover(cell, { x: e.clientX, y: e.clientY });
 * };
 *
 * return (
 * <div onMouseMove={onMouseMove} onMouseLeave={handleMouseLeave}>
 * <Canvas />
 * <HyperlinkTooltip {...tooltip} />
 * </div>
 * );
 * }
 * ```
 */
export function useHyperlinkTooltip(
  options: UseHyperlinkTooltipOptions = {},
): UseHyperlinkTooltipReturn {
  const { enabled = true, delay = DEFAULT_DELAY } = options;

  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const ws = wb.getSheetById(activeSheetId);

  // Tooltip state
  const [tooltip, setTooltip] = useState<HyperlinkTooltipState>({
    visible: false,
    url: '',
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

      const prev = hoveredCellRef.current;
      const isSameCell = prev && prev.row === cell.row && prev.col === cell.col;
      // When re-arming for the same cell (hyperlink just set while already
      // hovering), skip the hover delay so the tooltip appears immediately.
      let effectiveDelay = delay;

      if (isSameCell) {
        // Tooltip already showing — just nudge position and bail.
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
        if (showTimeoutRef.current !== null) {
          // A fetch is already queued — nothing to do.
          return;
        }
        // Tooltip not visible and no fetch in flight. This happens when the
        // user was already hovering a cell (no hyperlink), then set a
        // hyperlink via the dialog, then moved the mouse back to the same
        // cell. Re-arm the fetch so the tooltip appears immediately (no
        // hover delay — the user already "hovered" this cell).
        // Do NOT reset hoveredCellRef or hide visible state — the ref is
        // already correct and visible=false already.
        effectiveDelay = 0;
      } else {
        // New cell — update ref and reset state.
        hoveredCellRef.current = { row: cell.row, col: cell.col };
        clearShowTimeout();
        setTooltip((p) => ({ ...p, visible: false }));
      }

      // Resolve the hyperlink via the kernel API, then show the tooltip
      // after the configured hover delay. We don't pre-filter on the
      // binary viewport record's `hasHyperlink` bit because that bit is
      // unreliable for cells whose only mutation was a hyperlink set —
      // Rust's set_hyperlink path doesn't currently re-publish a viewport
      // patch (see compute/core/src/storage/engine/objects.rs:876), so
      // value-less hyperlinked cells appear as `hasHyperlink=false` until
      // some other event refreshes the buffer. The async API is the
      // source of truth.
      showTimeoutRef.current = setTimeout(() => {
        showTimeoutRef.current = null; // no longer pending
        // Verify we're still hovering over the same cell
        const current = hoveredCellRef.current;
        if (!current || current.row !== cell.row || current.col !== cell.col) {
          return;
        }
        void (async () => {
          let url: string;
          try {
            const fetched = await ws.hyperlinks.get(cell.row, cell.col);
            if (!fetched) return;
            url = fetched;
          } catch {
            return;
          }
          // Re-check we're still on the same cell after the async hop.
          const stillHere = hoveredCellRef.current;
          if (!stillHere || stillHere.row !== cell.row || stillHere.col !== cell.col) {
            return;
          }
          setTooltip({
            visible: true,
            url,
            position: {
              x: screenPosition.x + TOOLTIP_OFFSET.x,
              y: screenPosition.y + TOOLTIP_OFFSET.y,
            },
          });
        })();
      }, effectiveDelay);
    },
    [enabled, delay, ws, hideTooltip, clearShowTimeout],
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

export default useHyperlinkTooltip;
