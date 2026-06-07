/**
 * Workbook Statistics Dialog
 *
 * A dialog that displays statistics for the current sheet and entire workbook.
 * Shows counts for cells with data, formulas, tables, charts, images, comments, etc.
 *
 * Excel Parity: Review > Workbook Statistics
 *
 * Features:
 * - Sheet-level statistics (current sheet)
 * - Workbook-level statistics (all sheets)
 * - Loading state for large workbooks
 * - Data staleness detection (non-modal dialog)
 * - Refresh button to recalculate
 */

import { useCallback, useEffect, useState } from 'react';
import { useActiveSheetId, useUIStore, useWorkbook } from '../../internal-api';

import { Button, Dialog, DialogBody, DialogFooter, DialogHeader } from '@mog/shell';
import { useFloatingObjectCacheApi } from '../../hooks/objects/use-floating-object-cache';
import {
  formatEndOfSheet,
  formatStatValue,
  getSheetStatistics,
  getWorkbookStatistics,
  type SheetStatistics,
  type WorkbookStatistics,
} from '../../infra/utils/workbook-statistics';

// =============================================================================
// Safari Compatibility: requestIdleCallback polyfill
// =============================================================================

const scheduleIdleTask =
  typeof requestIdleCallback !== 'undefined'
    ? requestIdleCallback
    : (cb: IdleRequestCallback) =>
        window.setTimeout(
          () => cb({ didTimeout: false, timeRemaining: () => 50 } as IdleDeadline),
          1,
        );

const cancelIdleTask =
  typeof cancelIdleCallback !== 'undefined' ? cancelIdleCallback : clearTimeout;

// =============================================================================
// Component
// =============================================================================

export function WorkbookStatisticsDialog() {
  // Get state from UIStore
  const isOpen = useUIStore((s) => s.workbookStatisticsDialogOpen);
  const closeDialog = useUIStore((s) => s.closeWorkbookStatisticsDialog);

  // Get context
  const wb = useWorkbook();
  const activeSheetId = useActiveSheetId();
  const ws = wb.getSheetById(activeSheetId);
  const cacheApi = useFloatingObjectCacheApi();

  // Create image count provider - reads from floating object cache directly
  const getImageCount = useCallback(
    (sheetId: string) => {
      const { objects, objectsBySheet } = cacheApi.getState();
      const ids = objectsBySheet.get(sheetId);
      if (!ids) return 0;
      let count = 0;
      for (const id of ids) {
        const obj = objects.get(id);
        if (obj?.type === 'picture') count++;
      }
      return count;
    },
    [cacheApi],
  );

  // Loading state for large workbooks
  const [isCalculating, setIsCalculating] = useState(false);
  const [isStale, setIsStale] = useState(false);
  const [stats, setStats] = useState<{
    sheet: SheetStatistics;
    workbook: WorkbookStatistics;
  } | null>(null);

  // Recalculate function for reuse
  const recalculateStats = useCallback(() => {
    if (!activeSheetId) return;
    setIsCalculating(true);
    setIsStale(false);

    const handle = scheduleIdleTask(
      () => {
        const ws = wb.getSheetById(activeSheetId);
        void Promise.all([
          getSheetStatistics(ws, getImageCount(activeSheetId)),
          getWorkbookStatistics(wb, { getImageCount }),
        ]).then(([sheet, workbook]) => {
          setStats({ sheet, workbook });
          setIsCalculating(false);
        });
      },
      { timeout: 1000 },
    );

    return () => cancelIdleTask(handle);
  }, [wb, activeSheetId, getImageCount]);

  // Calculate stats asynchronously to avoid blocking UI
  useEffect(() => {
    if (!isOpen || !activeSheetId) {
      setStats(null);
      setIsStale(false);
      return;
    }

    return recalculateStats();
  }, [isOpen, activeSheetId, recalculateStats]);

  // Subscribe to data changes to detect staleness (non-modal dialog)
  useEffect(() => {
    if (!isOpen) return;

    let timeoutId: ReturnType<typeof setTimeout> | null = null;

    const handleDataChange = () => {
      // Debounce: clear previous timeout
      if (timeoutId) clearTimeout(timeoutId);
      timeoutId = setTimeout(() => {
        setIsStale(true);
      }, 500);
    };

    const unsub = ws.on('cellChanged', handleDataChange);

    return () => {
      unsub();
      if (timeoutId) clearTimeout(timeoutId);
    };
  }, [isOpen, ws]);

  // Get sheet name for display via unified API.
  const [sheetName, setSheetName] = useState('Current Sheet');
  useEffect(() => {
    let disposed = false;

    if (!activeSheetId) {
      setSheetName('Current Sheet');
      return () => {
        disposed = true;
      };
    }

    void (async () => {
      try {
        const ws = wb.getSheetById(activeSheetId);
        const name = await ws.getName();
        if (!disposed) setSheetName(name || 'Current Sheet');
      } catch {
        if (!disposed) setSheetName('Current Sheet');
      }
    })();

    return () => {
      disposed = true;
    };
  }, [activeSheetId, wb]);

  // Handle closing
  const handleClose = useCallback(() => {
    closeDialog();
  }, [closeDialog]);

  if (!isOpen) return null;

  // Statistics rows configuration
  const statisticsRows = [
    {
      label: 'End of sheet',
      sheet: formatEndOfSheet(stats?.sheet.endOfSheet ?? null),
      workbook: '-',
    },
    {
      label: 'Cells with data',
      sheet: formatStatValue(stats?.sheet.cellsWithData),
      workbook: formatStatValue(stats?.workbook.cellsWithData),
    },
    {
      label: 'Tables',
      sheet: formatStatValue(stats?.sheet.tables),
      workbook: formatStatValue(stats?.workbook.tables),
    },
    {
      label: 'PivotTables',
      sheet: formatStatValue(stats?.sheet.pivotTables),
      workbook: formatStatValue(stats?.workbook['pivotTables']),
    },
    {
      label: 'Formulas',
      sheet: formatStatValue(stats?.sheet.formulas),
      workbook: formatStatValue(stats?.workbook.formulas),
    },
    {
      label: 'Charts',
      sheet: formatStatValue(stats?.sheet.charts),
      workbook: formatStatValue(stats?.workbook.charts),
    },
    {
      label: 'Images',
      sheet: formatStatValue(stats?.sheet.images),
      workbook: formatStatValue(stats?.workbook.images),
    },
    {
      label: 'Comments',
      sheet: formatStatValue(stats?.sheet.comments),
      workbook: formatStatValue(stats?.workbook.comments),
    },
    {
      label: 'Sheets',
      sheet: '-',
      workbook: formatStatValue(stats?.workbook.sheets),
    },
  ];

  return (
    <Dialog
      onEnterKeyDown={handleClose}
      open={isOpen}
      onClose={handleClose}
      dialogId="workbook-statistics-dialog"
      width="md"
      aria-labelledby="workbook-stats-title"
      aria-describedby="workbook-stats-desc"
    >
      <DialogHeader onClose={handleClose}>
        <span id="workbook-stats-title">Workbook Statistics</span>
      </DialogHeader>

      <DialogBody>
        <p id="workbook-stats-desc" className="sr-only">
          Statistics about the current sheet and entire workbook
        </p>

        {isStale && !isCalculating && (
          <div className="flex items-center justify-between p-2 mb-4 bg-ss-warning/10 border border-ss-warning/30 rounded text-body-sm">
            <span>Data may have changed since statistics were calculated.</span>
            <Button variant="ghost" size="sm" onClick={recalculateStats}>
              Refresh
            </Button>
          </div>
        )}

        {isCalculating ? (
          <div className="flex items-center justify-center p-8">
            <div className="w-5 h-5 border-2 border-ss-primary border-t-transparent rounded-full animate-ss-spin" />
            <span className="ml-2 text-body text-ss-text-secondary">Calculating...</span>
          </div>
        ) : (
          <table className="w-full border-collapse text-body-sm">
            <thead>
              <tr className="border-b border-ss-border">
                <th scope="col" className="text-left py-2 px-3 font-medium text-ss-text-secondary">
                  Statistic
                </th>
                <th scope="col" className="text-right py-2 px-3 font-medium text-ss-text-secondary">
                  {sheetName}
                </th>
                <th scope="col" className="text-right py-2 px-3 font-medium text-ss-text-secondary">
                  Workbook
                </th>
              </tr>
            </thead>
            <tbody>
              {statisticsRows.map((row) => (
                <tr key={row.label} className="border-b border-ss-border/50">
                  <th scope="row" className="text-left py-2 px-3 font-normal">
                    {row.label}
                  </th>
                  <td className="text-right py-2 px-3 tabular-nums">{row.sheet}</td>
                  <td className="text-right py-2 px-3 tabular-nums">{row.workbook}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </DialogBody>

      <DialogFooter>
        <Button variant="secondary" onClick={recalculateStats} disabled={isCalculating}>
          Refresh
        </Button>
        <Button variant="primary" onClick={handleClose} aria-label="Close dialog">
          Close
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
