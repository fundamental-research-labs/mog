/**
 * AccessibilityAnnouncer Component
 *
 * Provides ARIA live regions for screen reader announcements.
 * This component announces:
 * - Cell selections (single cell: "A1 selected")
 * - Range selections ("Selected A1 to B5, 10 cells")
 * - Multi-range selections ("3 ranges selected, 25 cells total")
 * - Selection mode changes ("Extend Selection mode active", "End Mode activated")
 * - Cell content when selection moves
 * - Table context when navigating in tables
 * - Current position: "Row X of Y, Column Name"
 * - Header row announced as headers
 * - Filter state announced
 * - Total row values announced with function
 *
 * ARCHITECTURE:
 * - Uses visually hidden live regions (polite and assertive)
 * - Consumes selection state from useSelection hook
 * - Consumes selection mode state from selection actor
 * - Announces cell value from Worksheet viewport
 * - Announces stable selection changes immediately; async table context refines single-cell announcements
 * - Follows WAI-ARIA best practices for live regions
 *
 * @see https://www.w3.org/WAI/ARIA/apg/patterns/grid/ - ARIA Grid Pattern
 */

import type { CellFormat } from '@mog-sdk/contracts/core';
import { displayStringOrNull } from '@mog-sdk/contracts/core';
import { toA1, parseA1Range } from '@mog/spreadsheet-utils/a1';
// Table reads now go through Worksheet API ws.tables.getAtCell() (async).
import { type RefObject, useCallback, useEffect, useId, useRef, useState } from 'react';
import { useActiveSheetId, useUIStore, useWorkbook } from '../../internal-api';
import { useActiveCell } from '../../hooks/selection/use-active-cell';
import {
  useSelectionModes,
  useSelectionRanges,
} from '../../hooks/selection/use-granular-selection';
import type { CellRange } from '../../systems/shared/types';
import {
  buildBaseSelectionAnnouncement,
  isSingleCellSelection,
} from './accessibility-announcements';

// =============================================================================
// Utility Functions
// =============================================================================

function scheduleNextFrame(callback: () => void): () => void {
  if (typeof requestAnimationFrame === 'function' && typeof cancelAnimationFrame === 'function') {
    const frameId = requestAnimationFrame(callback);
    return () => cancelAnimationFrame(frameId);
  }

  const timerId = setTimeout(callback, 0);
  return () => clearTimeout(timerId);
}

function useLiveRegionMessage(): [string, (message: string) => void] {
  const [message, setMessage] = useState('');
  const lastMessageRef = useRef('');
  const cancelReplayRef = useRef<(() => void) | null>(null);

  const announce = useCallback((nextMessage: string) => {
    if (!nextMessage) return;

    cancelReplayRef.current?.();
    cancelReplayRef.current = null;

    if (lastMessageRef.current === nextMessage) {
      setMessage('');
      cancelReplayRef.current = scheduleNextFrame(() => {
        setMessage(nextMessage);
        cancelReplayRef.current = null;
      });
    } else {
      setMessage(nextMessage);
    }

    lastMessageRef.current = nextMessage;
  }, []);

  useEffect(
    () => () => {
      cancelReplayRef.current?.();
    },
    [],
  );

  return [message, announce];
}

// =============================================================================
// Component
// =============================================================================

export interface AccessibilityAnnouncerProps {
  /**
   * Whether announcements are enabled.
   * Can be used to disable for performance or user preference.
   */
  enabled?: boolean;
  /**
   * Focusable grid container that owns the active descendant.
   * Canvas-rendered cells are exposed through a lightweight hidden proxy cell.
   */
  gridContainerRef?: RefObject<HTMLDivElement | null>;
}

/**
 * Visually hidden live regions for screen reader announcements.
 *
 * Uses two live regions:
 * - polite: For non-urgent information (cell selection, mode changes)
 * - assertive: For urgent information (validation errors)
 *
 * Announces:
 * - Single cell: "Cell A1 selected, [value], [formatting]"
 * - Range: "Selected A1 to B5, 10 cells"
 * - Multi-range: "3 ranges selected, 25 cells total"
 * - Mode activation: "Extend Selection mode active", "End Mode activated"
 * - Mode deactivation: "Extend Selection mode off"
 */
export function AccessibilityAnnouncer({
  enabled = true,
  gridContainerRef,
}: AccessibilityAnnouncerProps) {
  const activeSheetId = useActiveSheetId();
  const wb = useWorkbook();
  const ws = wb.getSheetById(activeSheetId);
  const activeCellId = useId();
  // Use granular hooks instead of full useSelection() for performance
  // Only subscribe to activeCell and ranges, not the full selection state
  const { activeCell } = useActiveCell();
  const ranges = useSelectionRanges();

  // Selection mode state from selection actor.
  // Replaces the deleted UIStore slice fields `endMode` / `extendSelectionMode`
  // / `addToSelectionMode`. The bundle re-renders only when a flag flips.
  const {
    end: endMode,
    extend: extendSelectionMode,
    additive: addToSelectionMode,
  } = useSelectionModes();

  // Accessibility announcements from action handlers
  const pendingAnnouncement = useUIStore((s) => s.pendingAnnouncement);
  const clearAnnouncement = useUIStore((s) => s.clearAnnouncement);

  // Track previous state to detect changes
  const prevCellRef = useRef<{ row: number; col: number } | null>(null);
  const prevRangesRef = useRef<CellRange[]>([]);
  const prevEndModeRef = useRef<boolean>(false);
  const prevExtendModeRef = useRef<boolean>(false);
  const prevAddModeRef = useRef<boolean>(false);
  const selectionVersionRef = useRef(0);

  const [politeMessage, announcePoliteMessage] = useLiveRegionMessage();
  const [assertiveMessage, announceAssertiveMessage] = useLiveRegionMessage();

  useEffect(() => {
    if (!enabled || !gridContainerRef?.current) return;

    const grid = gridContainerRef.current;
    grid.setAttribute('aria-activedescendant', activeCellId);

    return () => {
      if (grid.getAttribute('aria-activedescendant') === activeCellId) {
        grid.removeAttribute('aria-activedescendant');
      }
    };
  }, [enabled, gridContainerRef, activeCellId]);

  /**
   * Build cell content announcement for a single cell.
   */
  const buildCellContentAnnouncement = useCallback(
    (row: number, col: number): string => {
      const vpCell = ws.viewport.getCellData(row, col);
      const cellValue = displayStringOrNull(vpCell?.displayText ?? null) ?? '';
      const format = (vpCell?.format ?? undefined) as CellFormat | undefined;

      // Format the cell value for announcement
      let valueDescription: string;
      if (cellValue === null || cellValue === undefined || cellValue === '') {
        valueDescription = 'empty';
      } else if (typeof cellValue === 'object' && cellValue !== null && 'type' in cellValue) {
        // Handle error objects
        const errObj = cellValue as { type: string; value?: string };
        if (errObj.type === 'error') {
          valueDescription = `error ${errObj.value ?? ''}`;
        } else {
          valueDescription = String(cellValue);
        }
      } else {
        valueDescription = String(cellValue);
      }

      // Add format information if cell has special formatting
      // Extended format announcement to include font family and font size
      const formatParts: string[] = [];
      if (format?.fontFamily) formatParts.push(format.fontFamily);
      if (format?.fontSize) formatParts.push(`${format.fontSize}pt`);
      if (format?.bold) formatParts.push('bold');
      if (format?.italic) formatParts.push('italic');
      if (format?.underlineType && format.underlineType !== 'none') formatParts.push('underlined');

      if (formatParts.length > 0) {
        return `${valueDescription}, ${formatParts.join(', ')}`;
      }
      return valueDescription;
    },
    [ws],
  );

  /**
   * Build table context announcement for a cell.
   *
   * Announces:
   * - Table name
   * - Current position: "Row X of Y, Column Name"
   * - Header row status
   * - Filter state
   * - Total row function if applicable
   */
  const buildTableContextAnnouncement = useCallback(
    async (row: number, col: number): Promise<string | null> => {
      let table: any;
      try {
        const ws = wb.getSheetById(activeSheetId);
        table = await ws.tables.getAtCell(row, col);
      } catch {
        return null;
      }
      if (!table) return null;

      // Worksheet API getTableAtCell returns TableInfo with range as A1 string
      const rangeStr = table.range;
      if (!rangeStr) return null;
      // Parse the A1 range string to get numeric bounds for row/col math
      const range = parseA1Range(rangeStr);

      const parts: string[] = [];
      parts.push(`Table "${table.name}"`);

      // Determine which row type this is
      const isHeaderRow = table.hasHeaderRow && row === range.startRow;
      const isTotalRow = table.hasTotalsRow && row === range.endRow;

      // Calculate data row position
      const dataStartRow = table.hasHeaderRow ? range.startRow + 1 : range.startRow;
      const dataEndRow = table.hasTotalsRow ? range.endRow - 1 : range.endRow;
      const totalDataRows = dataEndRow - dataStartRow + 1;

      // Get column info
      const colIndex = col - range.startCol;
      const column = table.columns[colIndex];
      const columnName = column?.name ?? `Column ${colIndex + 1}`;

      if (isHeaderRow) {
        parts.push(`Header row, column "${columnName}"`);
        // Announce filter button state
        if (table.showFilterButtons) {
          parts.push('Has filter button');
        }
      } else if (isTotalRow) {
        parts.push(`Total row, column "${columnName}"`);
        // Announce total function if set
        if (column?.totalFunction && column.totalFunction !== 'none') {
          parts.push(`Function: ${column.totalFunction.toUpperCase()}`);
        }
      } else {
        // Data row
        const dataRowNum = row - dataStartRow + 1;
        parts.push(`Row ${dataRowNum} of ${totalDataRows}, column "${columnName}"`);
      }

      return parts.join(', ');
    },
    [wb, activeSheetId],
  );

  // Announce selection changes immediately. Table context is async and only
  // refines the base single-cell announcement when it still matches selection.
  useEffect(() => {
    if (!enabled) return;

    const prevCell = prevCellRef.current;
    const prevRanges = prevRangesRef.current;

    // Check if selection actually changed
    const cellChanged =
      !prevCell || prevCell.row !== activeCell.row || prevCell.col !== activeCell.col;
    const rangesChanged =
      ranges.length !== prevRanges.length ||
      ranges.some(
        (r, i) =>
          !prevRanges[i] ||
          r.startRow !== prevRanges[i].startRow ||
          r.startCol !== prevRanges[i].startCol ||
          r.endRow !== prevRanges[i].endRow ||
          r.endCol !== prevRanges[i].endCol,
      );

    if (!cellChanged && !rangesChanged) {
      return;
    }

    // Update refs
    prevCellRef.current = { row: activeCell.row, col: activeCell.col };
    prevRangesRef.current = [...ranges];

    const version = selectionVersionRef.current + 1;
    selectionVersionRef.current = version;
    const contentAnnouncement = isSingleCellSelection(ranges)
      ? buildCellContentAnnouncement(activeCell.row, activeCell.col)
      : '';
    const baseAnnouncement = buildBaseSelectionAnnouncement(
      ranges,
      activeCell,
      contentAnnouncement,
    );

    if (baseAnnouncement) {
      announcePoliteMessage(baseAnnouncement);
    }

    if (!isSingleCellSelection(ranges) || !baseAnnouncement) return;

    let cancelled = false;
    void buildTableContextAnnouncement(activeCell.row, activeCell.col).then((tableContext) => {
      if (cancelled || selectionVersionRef.current !== version || !tableContext) return;
      announcePoliteMessage(`${baseAnnouncement}. ${tableContext}`);
    });

    return () => {
      cancelled = true;
    };
  }, [
    enabled,
    activeCell,
    ranges,
    buildCellContentAnnouncement,
    buildTableContextAnnouncement,
    announcePoliteMessage,
  ]);

  // Handle pending announcements from action handlers (e.g., Alt+Shift+F)
  useEffect(() => {
    if (!enabled || !pendingAnnouncement) return;

    // Set the message based on priority
    if (pendingAnnouncement.priority === 'assertive') {
      announceAssertiveMessage(pendingAnnouncement.message);
    } else {
      announcePoliteMessage(pendingAnnouncement.message);
    }

    // Clear the pending announcement so it doesn't re-announce
    clearAnnouncement();
  }, [
    enabled,
    pendingAnnouncement,
    clearAnnouncement,
    announceAssertiveMessage,
    announcePoliteMessage,
  ]);

  // Announce mode changes (End Mode, Extend Selection, Add to Selection)
  useEffect(() => {
    if (!enabled) return;

    const announcements: string[] = [];

    // End Mode changes
    if (endMode !== prevEndModeRef.current) {
      if (endMode) {
        announcements.push('End Mode activated');
      } else if (prevEndModeRef.current) {
        announcements.push('End Mode off');
      }
      prevEndModeRef.current = endMode;
    }

    // Extend Selection Mode changes (F8)
    if (extendSelectionMode !== prevExtendModeRef.current) {
      if (extendSelectionMode) {
        announcements.push('Extend Selection mode active');
      } else if (prevExtendModeRef.current) {
        announcements.push('Extend Selection mode off');
      }
      prevExtendModeRef.current = extendSelectionMode;
    }

    // Add to Selection Mode changes (Shift+F8)
    if (addToSelectionMode !== prevAddModeRef.current) {
      if (addToSelectionMode) {
        announcements.push('Add to Selection mode active');
      } else if (prevAddModeRef.current) {
        announcements.push('Add to Selection mode off');
      }
      prevAddModeRef.current = addToSelectionMode;
    }

    // Announce all mode changes
    if (announcements.length > 0) {
      // Mode changes are somewhat urgent - use polite but announce immediately
      announcePoliteMessage(announcements.join('. '));
    }
  }, [enabled, endMode, extendSelectionMode, addToSelectionMode, announcePoliteMessage]);

  if (!enabled) {
    return null;
  }

  return (
    <>
      {/* Active descendant proxy for canvas-rendered cells. */}
      <div role="row" aria-rowindex={activeCell.row + 1} className="sr-only">
        <div
          id={activeCellId}
          role="gridcell"
          aria-rowindex={activeCell.row + 1}
          aria-colindex={activeCell.col + 1}
          aria-selected="true"
        >
          {toA1(activeCell.row, activeCell.col)}
        </div>
      </div>

      {/* Polite live region for non-urgent announcements (cell selection, mode changes) */}
      <div role="status" aria-live="polite" aria-atomic="true" className="sr-only">
        {politeMessage}
      </div>

      {/* Assertive live region for urgent announcements (errors) */}
      <div role="alert" aria-live="assertive" aria-atomic="true" className="sr-only">
        {assertiveMessage}
      </div>
    </>
  );
}

/**
 * Hook to trigger accessibility announcements from other components.
 * Returns a function to announce messages.
 *
 * Updated to use UIStore accessibility slice for real implementation.
 */
export function useAccessibilityAnnounce() {
  const announce = useUIStore((s) => s.announce);

  return {
    announcePolite: (message: string) => {
      announce(message, 'polite');
    },
    announceAssertive: (message: string) => {
      announce(message, 'assertive');
    },
  };
}
