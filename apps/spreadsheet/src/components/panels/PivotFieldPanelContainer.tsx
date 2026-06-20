/**
 * PivotFieldPanelContainer
 *
 * Container component that orchestrates pivot field panel state and renders PivotFieldPanel.
 * Extracts pivot panel logic from SpreadsheetLayout.tsx for better separation of concerns.
 *
 * This container:
 * - Uses the usePivotEditorActions hook for pivot table operations
 * - Conditionally renders PivotFieldPanel when a pivot table is being edited
 * - Provides all field manipulation handlers to the panel
 *
 * Extract Panel Containers
 */

import {
  useCallback,
  useRef,
  type KeyboardEvent as ReactKeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  useState,
} from 'react';

import type { AggregateFunction, PivotFieldArea } from '@mog-sdk/contracts/pivot';
import { useUIStore } from '../../infra/context';
import { usePivotEditorActions } from '../../hooks/data/use-pivot-editor-actions';
import { PivotFieldPanel } from '../pivot';
import {
  MAX_PIVOT_FIELD_PANEL_WIDTH,
  MIN_PIVOT_FIELD_PANEL_WIDTH,
} from '../../ui-store/slices/dialogs/pivot-dialog';

// =============================================================================
// Types
// =============================================================================

export interface PivotFieldPanelContainerProps {
  /**
   * Optional custom class name for the panel wrapper.
   */
  className?: string;
}

// =============================================================================
// Component
// =============================================================================

/**
 * Container component that manages pivot field panel state and rendering.
 * Renders PivotFieldPanel when a pivot table is being edited.
 */
export function PivotFieldPanelContainer({
  className,
}: PivotFieldPanelContainerProps): React.JSX.Element | null {
  const [isResizing, setIsResizing] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const panelWidth = useUIStore((s) => s.pivot.fieldPanelWidth);
  const setPanelWidth = useUIStore((s) => s.setPivotFieldPanelWidth);

  // Pivot editor actions hook provides all pivot manipulation functionality
  const {
    editingPivot,
    handlePivotAddPlacement,
    handlePivotRemovePlacement,
    handlePivotMovePlacement,
    handlePivotPlacementAggregateChange,
    handlePivotPlacementSortOrderChange,
    handlePivotValueSortChange,
    handlePivotRefresh,
    handlePivotDelete,
    stopEditingPivot,
  } = usePivotEditorActions();

  const handleResizePointerDown = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    setIsResizing(true);
  }, []);

  const handleResizePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!isResizing || !event.currentTarget.hasPointerCapture(event.pointerId)) return;
      const containerRect = panelRef.current?.parentElement?.getBoundingClientRect();
      const rightEdge = containerRect?.right ?? window.innerWidth;
      setPanelWidth(rightEdge - event.clientX);
    },
    [isResizing, setPanelWidth],
  );

  const finishResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setIsResizing(false);
  }, []);

  const handleResizeKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      const step = event.shiftKey ? 40 : 16;
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        setPanelWidth(panelWidth + step);
      } else if (event.key === 'ArrowRight') {
        event.preventDefault();
        setPanelWidth(panelWidth - step);
      } else if (event.key === 'Home') {
        event.preventDefault();
        setPanelWidth(MIN_PIVOT_FIELD_PANEL_WIDTH);
      } else if (event.key === 'End') {
        event.preventDefault();
        setPanelWidth(MAX_PIVOT_FIELD_PANEL_WIDTH);
      }
    },
    [panelWidth, setPanelWidth],
  );

  // Only render when a pivot table is being edited
  if (!editingPivot) {
    return null;
  }

  const handlePivotPanelAddField = (
    fieldId: string,
    area: PivotFieldArea,
    options?: { position?: number; aggregateFunction?: AggregateFunction },
  ) => {
    const position =
      options?.position ??
      editingPivot.config.placements.filter((placement) => placement.area === area).length;
    handlePivotAddPlacement(fieldId, area, position, {
      aggregateFunction: options?.aggregateFunction,
    });
  };

  return (
    <div
      ref={panelRef}
      className={className ?? 'absolute top-0 right-0 bottom-0 z-ss-sticky'}
      style={{ width: panelWidth }}
      data-no-grid-pointer="true"
      data-pivot-target="field-panel-container"
      data-pivot-id={editingPivot.config.id}
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize pivot field panel"
        tabIndex={0}
        aria-valuemin={MIN_PIVOT_FIELD_PANEL_WIDTH}
        aria-valuemax={MAX_PIVOT_FIELD_PANEL_WIDTH}
        aria-valuenow={panelWidth}
        className={`absolute left-0 top-0 z-10 h-full w-2 -translate-x-1 cursor-col-resize bg-transparent hover:bg-ss-accent/20 focus-visible:outline focus-visible:outline-2 focus-visible:outline-ss-accent ${
          isResizing ? 'bg-ss-accent/20' : ''
        }`}
        data-no-grid-pointer="true"
        data-pivot-target="field-panel-resize-handle"
        onPointerDown={handleResizePointerDown}
        onPointerMove={handleResizePointerMove}
        onPointerUp={finishResize}
        onPointerCancel={finishResize}
        onKeyDown={handleResizeKeyDown}
      />
      <PivotFieldPanel
        pivot={editingPivot}
        onAddField={handlePivotPanelAddField}
        onRemovePlacement={handlePivotRemovePlacement}
        onMovePlacement={handlePivotMovePlacement}
        onSetAggregateFunction={handlePivotPlacementAggregateChange}
        onSetSortOrder={handlePivotPlacementSortOrderChange}
        onSetValueSortOrder={handlePivotValueSortChange}
        onRefresh={handlePivotRefresh}
        onDelete={handlePivotDelete}
        onClose={stopEditingPivot}
        capabilities={editingPivot.capabilities}
      />
    </div>
  );
}
