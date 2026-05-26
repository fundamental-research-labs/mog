/**
 * StatusBar Component
 *
 * Shows selection aggregations (Sum, Average, Count, Min, Max) in the
 * spreadsheet footer. Only calculates stats when selection is stable (idle).
 *
 *
 * Reactive cell value updates
 * Tables - 10.5 Status Bar Filter Count
 *
 * Architecture:
 * - Uses XState selection machine state to check if selection is stable
 * - Reads cell values via Cells domain module
 * - Performance guard: caps calculation at 10K cells
 * - **Reactive**: Subscribes to cell change events to update stats when values change
 * - **Filter Count**: Subscribes to filter:applied/cleared events to show "X of Y records"
 * - Debounced recalculation prevents UI thrashing during rapid changes
 * - Right-click context menu to customize displayed stats (future enhancement)
 *
 * @see STREAM-C3-COMMENTS-RICHTEXT.md - Status Bar
 */

import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';

// Side-effect import: ensures window.__dt is available for the RecordButton,
// even in production builds where dev/app's main.tsx isn't the entry point.
import '@mog/devtools';

import type { Workbook } from '@mog-sdk/contracts/api';
import type { CellRange, SheetId } from '@mog-sdk/contracts/core';
import type { CellChangedEvent, CellsBatchChangedEvent } from '@mog-sdk/contracts/events';
import { useShallow } from 'zustand/react/shallow';
import { useEditorModeIndicator } from '../../hooks/editing/use-editor';
import { useDebouncedSelection } from '../../hooks/selection/use-debounced-selection';
import { useSelectionModeIndicator } from '../../hooks/selection/use-granular-selection';
import { useActiveSheetId, useUIStore, useWorkbook } from '../../infra/context';
import { DebugReportDialog } from '../../dialogs/debug-report';
// G5: Zoom Slider
import { ZoomSlider } from './ZoomSlider';

// =============================================================================
// Types
// =============================================================================

interface SelectionStats {
  sum: number | null;
  average: number | null;
  count: number; // Non-empty cells
  numericalCount: number; // Cells with numbers
  min: number | null;
  max: number | null;
}

type StatKey = 'sum' | 'average' | 'count' | 'min' | 'max';

interface StatDisplayItem {
  key: StatKey;
  label: string;
  value: string;
}

// =============================================================================
// Constants
// =============================================================================

/**
 * Maximum cells to calculate stats for.
 * Beyond this, show "Selection too large" to prevent UI lag.
 */
const MAX_CELLS_FOR_STATS = 10000;

/**
 * Debounce delay for recalculation (ms).
 * Prevents UI thrashing during rapid cell changes.
 */
const RECALC_DEBOUNCE_MS = 150;

/**
 * Default visible stats (Excel-like behavior)
 */
const DEFAULT_VISIBLE_STATS: StatKey[] = ['average', 'count', 'sum'];

// =============================================================================
// Calculation Logic
// =============================================================================

/**
 * Calculate selection statistics via Worksheet.getSelectionAggregates().
 * Returns a Promise - caller must handle async.
 */
async function calculateSelectionStats(
  wb: Workbook,
  sheetId: SheetId,
  ranges: CellRange[],
): Promise<SelectionStats> {
  try {
    const ws = wb.getSheetById(sheetId);
    const aggregates = await ws.getSelectionAggregates(ranges);
    return {
      sum: aggregates.numericCount > 0 ? aggregates.sum : null,
      average: aggregates.numericCount > 0 ? aggregates.average : null,
      count: aggregates.count,
      numericalCount: aggregates.numericCount,
      min: aggregates.numericCount > 0 ? aggregates.min : null,
      max: aggregates.numericCount > 0 ? aggregates.max : null,
    };
  } catch {
    // Fallback: return empty stats on error
    return { sum: null, average: null, count: 0, numericalCount: 0, min: null, max: null };
  }
}

/**
 * Count total cells in ranges.
 */
function countCellsInRanges(ranges: CellRange[]): number {
  let total = 0;
  for (const range of ranges) {
    total += (range.endRow - range.startRow + 1) * (range.endCol - range.startCol + 1);
  }
  return total;
}

/**
 * Check if a cell is within any of the given ranges.
 */
function isCellInRanges(row: number, col: number, ranges: CellRange[]): boolean {
  for (const range of ranges) {
    if (
      row >= range.startRow &&
      row <= range.endRow &&
      col >= range.startCol &&
      col <= range.endCol
    ) {
      return true;
    }
  }
  return false;
}

/**
 * Format a stat value for display.
 */
function formatStatValue(value: number | null): string {
  if (value === null) {
    return '-';
  }

  // Format with appropriate precision
  if (Number.isInteger(value)) {
    return value.toLocaleString();
  }

  // Show up to 2 decimal places, but trim trailing zeros
  return value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  });
}

// =============================================================================
// Component
// =============================================================================

// =============================================================================
// Record Button
// =============================================================================

/**
 * RecordButton — toggles debug recording on/off.
 * First click starts recording (red dot pulses).
 * Second click stops recording and opens the bug report dialog.
 */
function RecordButton() {
  const [showDialog, setShowDialog] = useState(false);
  const [recordingBundle, setRecordingBundle] = useState<unknown>(null);

  const dt = typeof window !== 'undefined' ? (window as any).__dt : null;

  // Subscribe to recording state changes
  const isRecording = useSyncExternalStore(
    useCallback(
      (onStoreChange: () => void) => {
        const recorder = dt?.getRecording?.();
        if (!recorder?.subscribe) return () => {};
        return recorder.subscribe(onStoreChange);
      },
      [dt],
    ),
    useCallback(() => dt?.isRecording?.() ?? false, [dt]),
    useCallback(() => false, []),
  );

  const handleClick = useCallback(() => {
    if (!dt) return;
    if (isRecording) {
      // Stop recording and show dialog
      const bundle = dt.stopRecording();
      setRecordingBundle(bundle);
      setShowDialog(true);
    } else {
      // Start recording
      dt.startRecording();
    }
  }, [dt, isRecording]);

  const handleDialogClose = useCallback(() => {
    setShowDialog(false);
    setRecordingBundle(null);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={handleClick}
        data-testid="debug-record-button"
        className="w-[16px] h-[16px] flex items-center justify-center rounded-full transition-colors hover:bg-ss-surface-hover cursor-pointer"
        title={isRecording ? 'Stop recording (click to file bug report)' : 'Start debug recording'}
        aria-label={isRecording ? 'Stop debug recording' : 'Start debug recording'}
      >
        <span
          className={`block w-[8px] h-[8px] rounded-full ${
            isRecording ? 'bg-red-500 animate-pulse' : 'bg-ss-text-tertiary'
          }`}
        />
      </button>
      {showDialog && <DebugReportDialog bundle={recordingBundle} onClose={handleDialogClose} />}
    </>
  );
}

export interface StatusBarProps {
  className?: string;
}

/**
 * StatusBar component - wrapped with React.memo to prevent unnecessary re-renders from parent.
 *
 * Performance optimization:
 * - Does NOT use useSelection() hook (which subscribes to all selection changes)
 * - Instead, subscribes directly to selection actor and only updates state when selection settles
 * - Uses debouncing to prevent thrashing during rapid selection changes
 * - This reduces re-renders from 591 to only when selection settles (idle state)
 */
function StatusBarComponent({ className = '' }: StatusBarProps) {
  const wb = useWorkbook();
  const sheetId = useActiveSheetId();
  const ws = useMemo(() => wb.getSheetById(sheetId), [wb, sheetId]);

  // Get editing mode state for mode indicator
  // Performance: Use minimal hook to avoid re-renders from unrelated editor state changes
  const { isEditing, isEditMode } = useEditorModeIndicator();

  // Excel Parity 2.6: Get selection mode indicator (EXT/ADD) for F8/Shift+F8.
  // reads from selection actor's ctx.modes bundle
  // instead of the deleted UIStore slice fields.
  const selectionModeIndicator = useSelectionModeIndicator();

  // Track which stats are visible (can be customized via right-click in future)
  const [visibleStats] = useState<StatKey[]>(DEFAULT_VISIBLE_STATS);

  const { ranges: debouncedRanges, isSelecting } = useDebouncedSelection();
  const isSelectionStable = !isSelecting;

  // Reactive stats state - updated when selection or cell values change
  const [stats, setStats] = useState<SelectionStats | 'too_large' | null>(null);
  const statsRequestSeqRef = useRef(0);

  // Filter info state - shows "X of Y records found" when filter active
  const [filterInfo, setFilterInfo] = useState<{
    visible: number;
    total: number;
    filterCount: number;
  } | null>(null);

  // Debounce timer ref for cell value changes
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const selectionStatsTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Store current ranges in ref for event handler access (avoid stale closure)
  const rangesRef = useRef(debouncedRanges);
  rangesRef.current = debouncedRanges;

  // Calculate stats function (called on selection change and cell value changes)
  // Aggregation is performed via Worksheet.getSelectionAggregates(),
  // so the main thread is not blocked even for large selections.
  const recalculateStats = useCallback(() => {
    const requestSeq = ++statsRequestSeqRef.current;
    const currentRanges = rangesRef.current;

    // Only calculate when selection is stable
    if (!isSelectionStable) {
      setStats(null);
      return;
    }

    // Check if selection is empty
    if (currentRanges.length === 0) {
      setStats(null);
      return;
    }

    // Performance guard
    const cellCount = countCellsInRanges(currentRanges);
    if (cellCount > MAX_CELLS_FOR_STATS) {
      setStats('too_large');
      return;
    }

    // Async: fire and set state on completion
    void calculateSelectionStats(wb, sheetId, currentRanges).then((result) => {
      if (statsRequestSeqRef.current === requestSeq) {
        setStats(result);
      }
    });
  }, [wb, sheetId, isSelectionStable]);

  useEffect(() => {
    return () => {
      statsRequestSeqRef.current += 1;
    };
  }, []);

  // Debounced recalculation for cell value changes
  const debouncedRecalculate = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    debounceTimerRef.current = setTimeout(() => {
      recalculateStats();
      debounceTimerRef.current = null;
    }, RECALC_DEBOUNCE_MS);
  }, [recalculateStats]);

  // Recalculate when debounced ranges change (only when selection settles)
  useEffect(() => {
    statsRequestSeqRef.current += 1;
    if (selectionStatsTimerRef.current) {
      clearTimeout(selectionStatsTimerRef.current);
    }
    selectionStatsTimerRef.current = setTimeout(() => {
      recalculateStats();
      selectionStatsTimerRef.current = null;
    }, 120);
    return () => {
      if (selectionStatsTimerRef.current) {
        clearTimeout(selectionStatsTimerRef.current);
        selectionStatsTimerRef.current = null;
      }
    };
  }, [recalculateStats, debouncedRanges, isSelectionStable]);

  // Subscribe to cell change events to update stats reactively
  useEffect(() => {
    const handleCellChanged = (event: CellChangedEvent) => {
      // Check if changed cell is within current selection
      if (isCellInRanges(event.row, event.col, rangesRef.current)) {
        debouncedRecalculate();
      }
    };

    const handleBatchChanged = (event: CellsBatchChangedEvent) => {
      // Check if any changed cell is within current selection
      const hasRelevantChange = event.changes.some((change) =>
        isCellInRanges(change.row, change.col, rangesRef.current),
      );
      if (hasRelevantChange) {
        debouncedRecalculate();
      }
    };

    const handleRecalcCompleted = () => {
      // Recalculation might have updated values in our selection
      debouncedRecalculate();
    };

    // Subscribe to value changes via ws.on() (sheet-scoped, auto-filters by sheetId).
    const unsubCellChanged = ws.on('cell:changed', handleCellChanged);
    const unsubBatchChanged = ws.on('cells:batch-changed', handleBatchChanged);
    const unsubRecalcCompleted = ws.on('recalcComplete', handleRecalcCompleted);

    return () => {
      unsubCellChanged();
      unsubBatchChanged();
      unsubRecalcCompleted();
      // Clear any pending debounce timer
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      if (selectionStatsTimerRef.current) {
        clearTimeout(selectionStatsTimerRef.current);
        selectionStatsTimerRef.current = null;
      }
    };
  }, [ws, debouncedRecalculate]);

  // Filter count in status bar ("X of Y records found")
  const updateFilterInfo = useCallback(() => {
    void wb
      .getSheetById(sheetId)
      .filters.list()
      .then((filters) => {
        const filterCount = filters.reduce(
          (n, f) => n + Object.keys(f.columnFilters ?? {}).length,
          0,
        );
        setFilterInfo(filterCount > 0 ? { visible: 0, total: 0, filterCount } : null);
      })
      .catch(() => setFilterInfo(null));
  }, [wb, sheetId]);

  // Update filter info on mount and when sheet changes
  useEffect(() => {
    updateFilterInfo();
  }, [updateFilterInfo]);

  // Subscribe to filter events via ws.on() (sheet-scoped, auto-filters by sheetId)
  useEffect(() => {
    const handleFilterChanged = () => {
      updateFilterInfo();
    };

    // 'filterChanged' coarse event covers filter:applied, filter:cleared, filter:changed, filter:column-changed
    const unsubFilter = ws.on('filterChanged', handleFilterChanged);

    return () => {
      unsubFilter();
    };
  }, [ws, updateFilterInfo]);

  // Build stat items to display
  const statItems = useMemo(() => {
    if (!stats || stats === 'too_large') {
      return [];
    }

    const items: StatDisplayItem[] = [];

    for (const key of visibleStats) {
      switch (key) {
        case 'average':
          if (stats.average !== null) {
            items.push({ key, label: 'Average', value: formatStatValue(stats.average) });
          }
          break;
        case 'count':
          if (stats.count > 0) {
            items.push({ key, label: 'Count', value: stats.count.toLocaleString() });
          }
          break;
        case 'sum':
          if (stats.sum !== null) {
            items.push({ key, label: 'Sum', value: formatStatValue(stats.sum) });
          }
          break;
        case 'min':
          if (stats.min !== null) {
            items.push({ key, label: 'Min', value: formatStatValue(stats.min) });
          }
          break;
        case 'max':
          if (stats.max !== null) {
            items.push({ key, label: 'Max', value: formatStatValue(stats.max) });
          }
          break;
      }
    }

    return items;
  }, [stats, visibleStats]);

  // Handle context menu (future: toggle stats visibility)
  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    // TODO: Show context menu to toggle stat visibility
  }, []);

  // Calculate mode indicator text
  // Priority: Selection modes (EXT/ADD) > Edit mode (Enter/Edit) > Ready
  // - EXT: Extend Selection mode active (F8)
  // - ADD: Add to Selection mode active (Shift+F8)
  // - Enter/Edit: Cell editing modes
  // - Ready: Default idle state
  const modeIndicator = selectionModeIndicator
    ? selectionModeIndicator // EXT or ADD takes priority
    : isEditing
      ? isEditMode
        ? 'Edit'
        : 'Enter'
      : 'Ready';

  // Performance: Combine selectors with useShallow to avoid separate subscriptions
  const { scrollLockEnabled, toggleScrollLock } = useUIStore(
    useShallow((s) => ({
      scrollLockEnabled: s.scrollLockEnabled,
      toggleScrollLock: s.toggleScrollLock,
    })),
  );

  // Chrome-symmetry: visible close button. Reopen via View ribbon
  // "Show status bar" (data-action="open-panel-status-bar").
  const setStatusBarVisible = useUIStore((s) => s.setStatusBarVisible);
  const handleClosePanel = useCallback(() => {
    setStatusBarVisible(false);
  }, [setStatusBarVisible]);

  return (
    <div
      className={`flex items-center justify-between h-[22px] px-3 bg-ss-surface-secondary text-ribbon text-ss-text-secondary select-none ${className}`}
      onContextMenu={handleContextMenu}
    >
      {/* Mode indicator (left side) */}
      <div className="flex items-center gap-3">
        <RecordButton />
        <span className="text-ss-text-tertiary">{modeIndicator}</span>
        {scrollLockEnabled && (
          <button
            onClick={toggleScrollLock}
            className="px-1.5 py-0.5 text-ribbon-compact rounded bg-ss-primary text-ss-text-inverse transition-colors hover:opacity-80"
            title="Scroll Lock ON — Click or press Ctrl+Alt+L to turn off"
          >
            Scroll Lock
          </button>
        )}
      </div>

      {/* Center: Filter info and Stats display */}
      <div className="flex-1 flex items-center justify-center gap-6">
        {/* Filter record count */}
        {filterInfo && (
          <span className="flex items-center gap-1 text-ss-text-secondary">
            <span className="font-medium">{filterInfo.visible.toLocaleString()}</span>
            <span className="text-ss-text-tertiary">of</span>
            <span className="font-medium">{filterInfo.total.toLocaleString()}</span>
            <span className="text-ss-text-tertiary">records found</span>
          </span>
        )}
        {/* Selection stats */}
        {stats === 'too_large' ? (
          <span className="text-ss-text-tertiary italic">Selection too large</span>
        ) : statItems.length > 0 ? (
          <div className="flex items-center gap-4">
            {statItems.map((item) => (
              <span
                key={item.key}
                className="flex items-center gap-1"
                data-testid={`status-bar-stat-${item.key}`}
              >
                <span className="text-ss-text-tertiary">{item.label}:</span>
                <span
                  className="text-text font-medium"
                  data-testid={`status-bar-stat-${item.key}-value`}
                >
                  {item.value}
                </span>
              </span>
            ))}
          </div>
        ) : null}
      </div>

      {/* G5: Zoom slider (right side) */}
      <ZoomSlider />

      {/* Chrome-symmetry: hide the status bar. Reopen via View ribbon. */}
      <button
        type="button"
        onClick={handleClosePanel}
        data-testid="panel-status-bar-close"
        className="ml-2 w-[20px] h-[20px] flex items-center justify-center text-ss-text-secondary shrink-0 hover:bg-ss-surface-hover rounded cursor-pointer transition-colors"
        title="Hide status bar"
        aria-label="Hide status bar"
      >
        <span aria-hidden="true">&times;</span>
      </button>
    </div>
  );
}

/**
 * StatusBar - Memoized export to prevent parent re-renders from causing unnecessary renders.
 *
 * Performance optimizations:
 * 1. React.memo wrapper prevents re-renders when parent (SpreadsheetLayout) re-renders
 * 2. Internal debounced selection subscription only updates when selection settles (idle state)
 * 3. Cell value change subscription uses debouncing to prevent thrashing
 *
 * Expected impact: Reduces renders from 591 (every mouse move) to ~10-20 (only on selection settle)
 */
export const StatusBar = memo(StatusBarComponent);
