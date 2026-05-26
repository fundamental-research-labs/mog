/**
 * Chart Title Editor Component
 *
 * Modal dialog for editing a chart's title text.
 * Since charts render on canvas (not DOM), we can't have inline title editing.
 * Instead, we follow the TextEffect pattern: double-click opens a modal dialog.
 *
 * ARCHITECTURE:
 * - Reads chart data from domain via useCharts hook
 * - Uses local state for title input (live preview while typing)
 * - Commits changes via useCharts.updateChart
 * - Uses editingChartTitleId from ChartUI slice for visibility
 *
 * KEY BEHAVIORS:
 * - Enter: Commit title changes
 * - Escape: Cancel editing (discard changes)
 * - Click OK: Commit title changes
 * - Click Cancel: Cancel editing (discard changes)
 *
 * Chart Canvas Rendering - Title Editing (Modal Pattern)
 */

import type { KeyboardEvent, ReactElement } from 'react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { useActiveSheetId, useUIStore } from '../../internal-api';
import { useCharts } from '../../hooks/charts/use-charts';
import {
  Button,
  Dialog,
  DialogBody,
  DialogFooter,
  DialogHeader,
  Input,
} from '@mog/shell/components/ui';

// =============================================================================
// Component
// =============================================================================

/**
 * Chart Title Editor
 *
 * Modal dialog for editing chart title inline.
 * Controlled by editingChartTitleId from ChartUI slice.
 *
 * Features:
 * - Appears as a modal when editingChartTitleId is set
 * - Auto-focuses input on mount
 * - Enter commits changes, Escape cancels
 * - OK/Cancel buttons for explicit actions
 *
 * @example
 * ```tsx
 * // Render in OverlayLayers alongside other overlays
 * <OverlayLayers>
 * {/* ... other overlays ... *\/}
 * <ChartTitleEditor />
 * </OverlayLayers>
 * ```
 */
export function ChartTitleEditor(): ReactElement | null {
  // Get editing state from UIStore
  const editingChartTitleId = useUIStore((s) => s.editingChartTitleId);
  const openChartTitleEditor = useUIStore((s) => s.openChartTitleEditor);
  const closeChartTitleEditor = useUIStore((s) => s.closeChartTitleEditor);

  // Suppress unused variable warning - openChartTitleEditor is exported but used elsewhere
  void openChartTitleEditor;

  // Get sheet context and charts
  const sheetId = useActiveSheetId();
  const { charts, updateChart } = useCharts({ sheetId });

  // Find the chart being edited
  const chart = editingChartTitleId ? charts.find((c) => c.id === editingChartTitleId) : null;

  // Local state for title input
  const [title, setTitle] = useState('');

  // Ref for input focus management
  const inputRef = useRef<HTMLInputElement>(null);

  // Track if we're in the process of committing to prevent double-commit
  const isCommittingRef = useRef(false);

  // ==========================================================================
  // Effects
  // ==========================================================================

  // Load initial title when editing starts
  useEffect(() => {
    if (chart) {
      setTitle(chart.config.title ?? '');
      // Reset committing flag when editing starts
      isCommittingRef.current = false;
    }
  }, [chart]);

  // Focus input when dialog opens
  useEffect(() => {
    if (editingChartTitleId && inputRef.current) {
      // Small delay to ensure dialog is fully rendered
      const timer = setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 50);
      return () => clearTimeout(timer);
    }
  }, [editingChartTitleId]);

  // ==========================================================================
  // Handlers
  // ==========================================================================

  /**
   * Commit title changes to chart.
   */
  const handleCommit = useCallback(() => {
    if (!editingChartTitleId || isCommittingRef.current) return;

    // Prevent double-commit
    isCommittingRef.current = true;

    // Update chart title
    updateChart(editingChartTitleId, { title });

    // Close dialog
    closeChartTitleEditor();
  }, [editingChartTitleId, title, updateChart, closeChartTitleEditor]);

  /**
   * Cancel editing without committing changes.
   */
  const handleCancel = useCallback(() => {
    if (isCommittingRef.current) return;

    // Mark as committing to prevent any blur handlers
    isCommittingRef.current = true;

    closeChartTitleEditor();
  }, [closeChartTitleEditor]);

  /**
   * Handle keyboard events.
   * - Enter: Commit
   * - Escape: Cancel
   */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleCancel();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        e.stopPropagation();
        handleCommit();
      }
    },
    [handleCommit, handleCancel],
  );

  /**
   * Handle dialog open state change (e.g., clicking outside or pressing Escape on dialog level).
   */
  const handleOpenChange = useCallback(
    (open: boolean) => {
      if (!open) {
        handleCancel();
      }
    },
    [handleCancel],
  );

  // ==========================================================================
  // Render
  // ==========================================================================

  // Don't render if not editing
  if (!editingChartTitleId || !chart) {
    return null;
  }

  return (
    <Dialog open={!!editingChartTitleId} onOpenChange={handleOpenChange} width="sm">
      <DialogHeader onClose={handleCancel}>Edit Chart Title</DialogHeader>
      <DialogBody>
        <Input
          ref={inputRef}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Enter chart title..."
          aria-label="Chart title"
        />
        <p className="text-caption text-ss-text-tertiary mt-2">
          Press Enter to save, Escape to cancel.
        </p>
      </DialogBody>
      <DialogFooter>
        <Button variant="secondary" onClick={handleCancel}>
          Cancel
        </Button>
        <Button variant="primary" onClick={handleCommit}>
          OK
        </Button>
      </DialogFooter>
    </Dialog>
  );
}
