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

import { usePivotEditorActions } from '../../hooks/data/use-pivot-editor-actions';
import { PivotFieldPanel } from '../pivot';

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
  // Pivot editor actions hook provides all pivot manipulation functionality
  const {
    editingPivot,
    handlePivotAddField,
    handlePivotRemoveField,
    handlePivotMoveField,
    handlePivotAggregateChange,
    handlePivotRefresh,
    handlePivotDelete,
    stopEditingPivot,
  } = usePivotEditorActions();

  // Only render when a pivot table is being edited
  if (!editingPivot) {
    return null;
  }

  return (
    <div
      className={className ?? 'absolute top-0 right-0 bottom-0 z-ss-sticky'}
      data-pivot-target="field-panel-container"
      data-pivot-id={editingPivot.config.id}
    >
      <PivotFieldPanel
        pivot={editingPivot}
        onAddField={handlePivotAddField}
        onRemoveField={handlePivotRemoveField}
        onMoveField={handlePivotMoveField}
        onSetAggregateFunction={handlePivotAggregateChange}
        onRefresh={handlePivotRefresh}
        onDelete={handlePivotDelete}
        onClose={stopEditingPivot}
        readOnly={editingPivot.config.id.startsWith('imported:')}
      />
    </div>
  );
}
