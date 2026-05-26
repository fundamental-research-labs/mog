/**
 * Spreadsheet Indicators Component
 *
 * Displays status indicators and notifications for the spreadsheet.
 * Extracted from Spreadsheet.tsx to improve maintainability.
 *
 * Features:
 * - Export notifications (progress, success, error)
 */

// =============================================================================
// Types
// =============================================================================

interface ExportNotification {
  type: 'progress' | 'success' | 'error';
  message: string;
}

interface ExportState {
  progress?: number;
}

interface SpreadsheetIndicatorsProps {
  /** Export state from useExport hook */
  exportState: ExportState;
  /** Current export notification to display */
  exportNotification: ExportNotification | null;
}

// =============================================================================
// Component
// =============================================================================

export function SpreadsheetIndicators({
  exportState,
  exportNotification,
}: SpreadsheetIndicatorsProps) {
  return (
    <>
      {/* Export notification */}
      {exportNotification && (
        <div
          className={`absolute top-2 right-2 px-4 py-2 rounded-ss-md text-body font-medium z-ss-sticky shadow-ss-md flex items-center gap-2 ${
            exportNotification.type === 'progress'
              ? 'bg-ss-primary/95 text-ss-text-inverse'
              : exportNotification.type === 'success'
                ? 'bg-ss-success/95 text-ss-text-inverse'
                : 'bg-ss-error/95 text-ss-text-inverse'
          }`}
        >
          {exportNotification.type === 'progress' && (exportState.progress ?? 0) > 0 && (
            <span>{Math.round(exportState.progress ?? 0)}%</span>
          )}
          <span>{exportNotification.message}</span>
        </div>
      )}
    </>
  );
}
