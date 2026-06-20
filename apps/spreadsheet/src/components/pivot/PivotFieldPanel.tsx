/**
 * PivotFieldPanel Component
 *
 * A side panel that appears when a pivot table is selected/being edited,
 * allowing live field configuration (Excel-style UX).
 *
 * This replaces the modal-based configuration with a persistent panel
 * that provides real-time feedback as fields are added/moved/removed.
 */

import { useCallback, useEffect, useRef, type CSSProperties } from 'react';

import type {
  AggregateFunction,
  PivotFieldArea,
  PivotTableWithResult,
  SortOrder,
} from '@mog-sdk/contracts/pivot';
import { Button } from '@mog/shell/components/ui';
import {
  createPivotCapabilitiesForSource,
  type PivotCapabilities,
} from '../../pivot/pivot-capabilities';
import { PivotFieldList } from './PivotFieldList';

// =============================================================================
// Types
// =============================================================================

export interface PivotFieldPanelProps {
  /** Currently editing pivot table (with computed result) */
  pivot: PivotTableWithResult & { capabilities?: PivotCapabilities };
  /** Callbacks for field operations */
  onAddField: (
    fieldId: string,
    area: PivotFieldArea,
    options?: { position?: number; aggregateFunction?: AggregateFunction },
  ) => void;
  onRemovePlacement: (placementId: string) => void;
  onMovePlacement: (placementId: string, toArea: PivotFieldArea, position: number) => void;
  onSetAggregateFunction: (placementId: string, func: AggregateFunction) => void;
  onSetSortOrder: (placementId: string, sortOrder: SortOrder) => void;
  onSetValueSortOrder: (valuePlacementId: string, sortOrder: SortOrder) => void;
  /** Refresh the pivot table */
  onRefresh?: () => void;
  /** Delete the pivot table */
  onDelete?: () => void;
  /** Close panel */
  onClose: () => void;
  /** Operation capabilities for the selected pivot. */
  capabilities?: PivotCapabilities;
  /** Render imported cached pivots as inspect-only. */
  readOnly?: boolean;
  /** Custom style */
  style?: CSSProperties;
}

// =============================================================================
// Main Component
// =============================================================================

export function PivotFieldPanel({
  pivot,
  onAddField,
  onSetAggregateFunction,
  onRemovePlacement,
  onMovePlacement,
  onSetSortOrder,
  onSetValueSortOrder,
  onRefresh,
  onDelete,
  onClose,
  capabilities,
  readOnly = false,
  style,
}: PivotFieldPanelProps) {
  const { config, result, error } = pivot;
  const contentRef = useRef<HTMLDivElement>(null);
  const effectiveCapabilities =
    capabilities ??
    pivot.capabilities ??
    createPivotCapabilitiesForSource(readOnly ? 'unsupportedImport' : 'native');

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose]);

  // Field operation handlers that wrap the props
  const handleAddField = useCallback(
    (
      fieldId: string,
      area: PivotFieldArea,
      options?: { position?: number; aggregateFunction?: AggregateFunction },
    ) => {
      onAddField(fieldId, area, options);
    },
    [onAddField],
  );

  const handleAggregateChange = useCallback(
    (placementId: string, aggregate: AggregateFunction) => {
      onSetAggregateFunction(placementId, aggregate);
    },
    [onSetAggregateFunction],
  );

  const getContentScrollContainer = useCallback(() => {
    return contentRef.current;
  }, []);

  return (
    <div
      className="flex min-h-0 flex-col w-full h-full bg-ss-surface border-l border-ss-border shadow-ss-md overflow-hidden"
      style={style}
      data-no-grid-pointer="true"
      data-pivot-target="field-panel"
      data-pivot-id={config.id}
      data-pivot-name={config.name}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-4 border-b border-ss-border-light bg-ss-surface-secondary">
        <div className="flex flex-col gap-1">
          <h3 className="text-subtitle font-semibold text-text m-0">Pivot table fields</h3>
          <span className="text-caption text-ss-text-secondary">{config.name}</span>
        </div>
        <button
          type="button"
          className="flex items-center justify-center w-7 h-7 p-0 border-none rounded-full bg-transparent cursor-pointer text-section text-ss-text-secondary hover:bg-ss-surface-hover transition-colors"
          onClick={onClose}
          title="Close (Esc)"
          data-no-grid-pointer="true"
        >
          ×
        </button>
      </div>

      {/* Content */}
      <div ref={contentRef} className="min-h-0 flex-1 overflow-y-auto p-4">
        {/* Error banner */}
        {error && (
          <div className="px-3 py-2 bg-ss-error-bg rounded mb-4 text-body text-ss-error">
            Error: {error}
          </div>
        )}

        {/* Field List with drag-and-drop */}
        <PivotFieldList
          fields={config.fields}
          placements={config.placements}
          onAddField={handleAddField}
          onRemovePlacement={onRemovePlacement}
          onMovePlacement={onMovePlacement}
          onAggregateChange={handleAggregateChange}
          onSortOrderChange={onSetSortOrder}
          onValueSortChange={onSetValueSortOrder}
          disabled={readOnly}
          canAddFields={effectiveCapabilities.canEditFields}
          canReorderFields={effectiveCapabilities.canMove ?? effectiveCapabilities.canReorderFields}
          canRemoveFields={effectiveCapabilities.canRemove ?? effectiveCapabilities.canRemoveFields}
          canChangeAggregate={effectiveCapabilities.canChangeAggregate}
          canSortLabels={effectiveCapabilities.canSortLabels}
          canSortByValue={effectiveCapabilities.canSortByValue}
          getDragScrollContainer={getContentScrollContainer}
        />

        {effectiveCapabilities.unsupportedReason && (
          <div className="px-3 py-2 bg-ss-surface-secondary rounded mt-4 text-caption text-ss-text-secondary">
            {effectiveCapabilities.unsupportedReason}
          </div>
        )}

        {/* Stats section */}
        {result && (
          <div className="px-3 py-2 bg-ss-surface-secondary rounded mt-4 text-caption text-ss-text-secondary">
            <div className="flex justify-between py-1">
              <span>Source rows:</span>
              <span>{result.sourceRowCount.toLocaleString()}</span>
            </div>
            <div className="flex justify-between py-1">
              <span>Pivot output rows including totals:</span>
              <span>{result.rows.length.toLocaleString()}</span>
            </div>
          </div>
        )}
      </div>

      {/* Footer with actions */}
      <div className="flex gap-3 px-4 py-4 border-t border-ss-border-light bg-ss-surface-secondary">
        {effectiveCapabilities.canRefresh && onRefresh && (
          <Button
            variant="secondary"
            className="flex-1"
            onClick={onRefresh}
            title="Refresh pivot table data"
          >
            Refresh
          </Button>
        )}
        {effectiveCapabilities.canDelete && onDelete && (
          <Button variant="danger" className="flex-1" onClick={onDelete} title="Delete pivot table">
            Delete
          </Button>
        )}
      </div>
    </div>
  );
}
