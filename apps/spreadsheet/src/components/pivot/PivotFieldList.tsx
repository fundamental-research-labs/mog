/**
 * PivotFieldList Component
 *
 * Displays available fields and drop zones for pivot table configuration.
 * Supports drag-and-drop field arrangement between areas.
 */

import { useCallback, useState, type DragEvent } from 'react';

import type {
  AggregateFunction,
  PivotField,
  PivotFieldArea,
  PivotFieldPlacementFlat as PivotFieldPlacement,
} from '@mog-sdk/contracts/pivot';
// =============================================================================
// Types
// =============================================================================

export interface PivotFieldListProps {
  /** Available fields from source data */
  fields: PivotField[];
  /** Current field placements */
  placements: PivotFieldPlacement[];
  /** Callback when a field is added to an area */
  onAddField: (
    fieldId: string,
    area: PivotFieldArea,
    options?: { aggregateFunction?: AggregateFunction },
  ) => void;
  /** Callback when a field is removed from an area */
  onRemoveField: (fieldId: string, area: PivotFieldArea) => void;
  /** Callback when a field is moved between areas */
  onMoveField: (
    fieldId: string,
    fromArea: PivotFieldArea,
    toArea: PivotFieldArea,
    position: number,
  ) => void;
  /** Callback when aggregate function changes */
  onAggregateChange?: (placementId: string, aggregate: AggregateFunction) => void;
  /** Whether the component is disabled */
  disabled?: boolean;
}

interface DragState {
  fieldId: string;
  fromArea: PivotFieldArea | 'available';
}

function getPlacementId(field: PivotField, area: PivotFieldArea, placement?: PivotFieldPlacement) {
  return placement?.placementId || `${area}:${field.id}:${placement?.position ?? 0}`;
}

// =============================================================================
// Helper Components
// =============================================================================

function DataTypeIcon({ dataType }: { dataType: string }) {
  const icons: Record<string, string> = {
    string: 'Aa',
    number: '#',
    date: 'D',
    boolean: '?',
  };
  return <span className="text-hint text-ss-text-disabled">{icons[dataType] || '?'}</span>;
}

function AggregateSelector({
  value,
  onChange,
  disabled,
}: {
  value: AggregateFunction;
  onChange: (value: AggregateFunction) => void;
  disabled?: boolean;
}) {
  const options: { value: AggregateFunction; label: string }[] = [
    { value: 'sum', label: 'Sum' },
    { value: 'count', label: 'Count' },
    { value: 'counta', label: 'Count A' },
    { value: 'average', label: 'Average' },
    { value: 'min', label: 'Min' },
    { value: 'max', label: 'Max' },
    { value: 'product', label: 'Product' },
    { value: 'stdev', label: 'StdDev' },
    { value: 'var', label: 'Var' },
  ];

  return (
    <select
      className="px-1.5 py-0.5 border border-ss-border rounded-ss-sm text-caption bg-ss-surface"
      value={value}
      onChange={(e) => onChange(e.target.value as AggregateFunction)}
      onClick={(e) => e.stopPropagation()}
      disabled={disabled}
      data-pivot-target="aggregate-selector"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}

// =============================================================================
// Main Component
// =============================================================================

export function PivotFieldList({
  fields,
  placements,
  onAddField,
  onRemoveField,
  onMoveField,
  onAggregateChange,
  disabled = false,
}: PivotFieldListProps) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragOverArea, setDragOverArea] = useState<PivotFieldArea | null>(null);
  const [selectedField, setSelectedField] = useState<DragState | null>(null);

  // Get fields by area
  const getFieldsInArea = (area: PivotFieldArea): Array<PivotField & PivotFieldPlacement> => {
    return placements
      .filter((p) => p.area === area)
      .sort((a, b) => a.position - b.position)
      .map((p) => {
        const field = fields.find((f) => f.id === p.fieldId);
        return field ? { ...field, ...p } : null;
      })
      .filter((f): f is PivotField & PivotFieldPlacement => f !== null);
  };

  // Get unplaced fields
  const availableFields = fields.filter(
    (f) => !placements.some((p) => p.fieldId === f.id && p.area !== 'value'),
  );

  // Drag handlers
  const handleDragStart = useCallback(
    (e: DragEvent, fieldId: string, fromArea: PivotFieldArea | 'available') => {
      if (disabled) return;
      setDragState({ fieldId, fromArea });
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', fieldId);
    },
    [disabled],
  );

  const handleDragEnd = useCallback(() => {
    setDragState(null);
    setDragOverArea(null);
  }, []);

  const handleDragOver = useCallback(
    (e: DragEvent, area: PivotFieldArea) => {
      if (disabled) return;
      if (!dragState && !e.dataTransfer.types.includes('text/plain')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      setDragOverArea(area);
    },
    [disabled, dragState],
  );

  const handleDragLeave = useCallback(() => {
    setDragOverArea(null);
  }, []);

  const handleDrop = useCallback(
    (e: DragEvent, toArea: PivotFieldArea) => {
      e.preventDefault();
      if (disabled) return;

      const fieldId = dragState?.fieldId || e.dataTransfer.getData('text/plain');
      const fromArea = dragState?.fromArea || 'available';
      if (!fieldId) return;

      if (fromArea === 'available') {
        // Adding new field to area
        const field = fields.find((f) => f.id === fieldId);
        const defaultAggregate: AggregateFunction =
          toArea === 'value' && field?.dataType === 'number' ? 'sum' : 'count';
        onAddField(fieldId, toArea, { aggregateFunction: defaultAggregate });
      } else if (fromArea !== toArea) {
        // Moving field between areas
        const position = getFieldsInArea(toArea).length;
        onMoveField(fieldId, fromArea, toArea, position);
      }

      setDragState(null);
      setDragOverArea(null);
      setSelectedField(null);
    },
    [disabled, dragState, fields, onAddField, onMoveField, getFieldsInArea],
  );

  const handleZoneClick = useCallback(
    (toArea: PivotFieldArea) => {
      if (disabled || !selectedField) return;

      const { fieldId, fromArea } = selectedField;
      if (fromArea === 'available') {
        const field = fields.find((f) => f.id === fieldId);
        const defaultAggregate: AggregateFunction =
          toArea === 'value' && field?.dataType === 'number' ? 'sum' : 'count';
        onAddField(fieldId, toArea, { aggregateFunction: defaultAggregate });
      } else if (fromArea !== toArea) {
        const position = getFieldsInArea(toArea).length;
        onMoveField(fieldId, fromArea, toArea, position);
      }

      setSelectedField(null);
    },
    [disabled, fields, getFieldsInArea, onAddField, onMoveField, selectedField],
  );

  // Render a field chip
  const renderFieldChip = (
    field: PivotField,
    area: PivotFieldArea | 'available',
    placement?: PivotFieldPlacement,
  ) => {
    const isDragging = dragState?.fieldId === field.id;
    const isSelected = selectedField?.fieldId === field.id && selectedField.fromArea === area;
    const isValueField = area === 'value';
    const placementId = area === 'available' ? field.id : getPlacementId(field, area, placement);

    const chipClass = `flex items-center gap-1.5 px-2 py-1.5 rounded cursor-grab text-body-sm select-none transition-colors ${
      isDragging ? 'opacity-50' : ''
    } ${isSelected ? 'ring-2 ring-ss-primary' : ''} ${
      isValueField ? 'bg-ss-primary-light' : 'bg-ss-surface-hover'
    }`;

    return (
      <div
        key={`${placementId}-${area}-${placement?.position ?? 'available'}`}
        className={chipClass}
        draggable={!disabled}
        onDragStart={(e) => handleDragStart(e, field.id, area)}
        onDragEnd={handleDragEnd}
        onClick={() => {
          if (!disabled) setSelectedField({ fieldId: field.id, fromArea: area });
        }}
        data-pivot-target="field-chip"
        data-pivot-field-id={field.id}
        data-pivot-field-name={field.name}
        data-pivot-display-name={placement?.displayName || field.name}
        data-pivot-placement-id={placementId}
        data-pivot-area={area}
        data-pivot-selected={isSelected ? 'true' : 'false'}
      >
        <DataTypeIcon dataType={field.dataType} />
        <span>{placement?.displayName || field.name}</span>

        {isValueField && placement?.aggregateFunction && onAggregateChange && (
          <AggregateSelector
            value={placement.aggregateFunction}
            onChange={(agg) => onAggregateChange(placementId, agg)}
            disabled={disabled}
          />
        )}

        {area !== 'available' && !disabled && (
          <button
            type="button"
            className="flex items-center justify-center w-5 h-5 p-0 border-none rounded-full bg-transparent cursor-pointer text-ss-text-secondary text-caption leading-none hover:bg-ss-surface-active"
            onClick={() => onRemoveField(field.id, area)}
            title="Remove field"
            data-pivot-target="remove-field"
            data-pivot-field-id={field.id}
            data-pivot-area={area}
          >
            ×
          </button>
        )}
      </div>
    );
  };

  // Render a drop zone
  const renderDropZone = (area: PivotFieldArea, label: string) => {
    const fieldsInArea = getFieldsInArea(area);
    const isDragOver = dragOverArea === area;

    const dropAreaClass = `flex flex-wrap gap-1.5 min-h-9 p-1.5 bg-ss-surface border border-dashed rounded transition-colors ${
      isDragOver ? 'bg-ss-primary-light border-ss-primary' : 'border-ss-border'
    }`;

    return (
      <div
        className="flex flex-col gap-1.5"
        data-pivot-target="field-zone-wrapper"
        data-pivot-zone={area}
      >
        <div className="text-caption font-medium text-ss-text-secondary">{label}</div>
        <div
          className={dropAreaClass}
          onDragOver={(e) => handleDragOver(e, area)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, area)}
          onClick={() => handleZoneClick(area)}
          data-pivot-target="field-zone"
          data-pivot-zone={area}
          data-pivot-accepts-selected={selectedField ? 'true' : 'false'}
        >
          {fieldsInArea.length === 0 ? (
            <span className="text-caption text-ss-text-disabled italic p-1">Drop fields here</span>
          ) : (
            fieldsInArea.map((field) => renderFieldChip(field, area, field))
          )}
        </div>
      </div>
    );
  };

  return (
    <div
      className="flex flex-col gap-4 p-4 bg-ss-surface-secondary rounded-ss-lg text-body-sm"
      data-pivot-target="field-list"
    >
      {/* Available Fields */}
      <div className="flex flex-col gap-2">
        <div className="font-semibold text-caption text-ss-text-secondary uppercase tracking-wide">
          Available Fields
        </div>
        <div
          className="flex flex-wrap gap-1.5 min-h-9 p-1.5 bg-ss-surface border border-dashed border-ss-border rounded"
          data-pivot-target="available-fields"
          data-pivot-zone="available"
        >
          {availableFields.length === 0 ? (
            <span className="text-caption text-ss-text-disabled italic p-1">
              All fields are in use
            </span>
          ) : (
            availableFields.map((field) => renderFieldChip(field, 'available'))
          )}
        </div>
      </div>

      {/* Drop Zones */}
      <div className="grid grid-cols-2 gap-3">
        {renderDropZone('filter', 'Filters')}
        {renderDropZone('column', 'Columns')}
        {renderDropZone('row', 'Rows')}
        {renderDropZone('value', 'Values')}
      </div>
    </div>
  );
}
