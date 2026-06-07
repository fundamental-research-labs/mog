/**
 * PivotFieldList Component
 *
 * Displays available source fields and ordered placement wells for pivot table
 * configuration. Placed chips are keyed and mutated by placementId so duplicate
 * source fields remain independently addressable.
 */

import { useCallback, useMemo, useState, type DragEvent } from 'react';

import type {
  AggregateFunction,
  PivotField,
  PivotFieldArea,
  PivotFieldPlacementFlat as PivotFieldPlacement,
  SortOrder,
} from '@mog-sdk/contracts/pivot';

export interface PivotFieldListProps {
  fields: PivotField[];
  placements: PivotFieldPlacement[];
  onAddField: (
    fieldId: string,
    area: PivotFieldArea,
    options?: { position?: number; aggregateFunction?: AggregateFunction },
  ) => void;
  onRemovePlacement: (placementId: string) => void;
  onMovePlacement: (placementId: string, toArea: PivotFieldArea, position: number) => void;
  onAggregateChange?: (placementId: string, aggregate: AggregateFunction) => void;
  onSortOrderChange?: (placementId: string, sortOrder: SortOrder) => void;
  onValueSortChange?: (valuePlacementId: string, sortOrder: SortOrder) => void;
  disabled?: boolean;
  canAddFields?: boolean;
  canReorderFields?: boolean;
  canRemoveFields?: boolean;
  canChangeAggregate?: boolean;
  canSortLabels?: boolean;
  canSortByValue?: boolean;
}

type DragState =
  | { kind: 'field'; fieldId: string }
  | {
      kind: 'placement';
      placementId: string;
      fieldId: string;
      fromArea: PivotFieldArea;
      fromIndex: number;
    };

interface PlacedField {
  field: PivotField;
  placement: PivotFieldPlacement;
}

const PIVOT_AREAS: PivotFieldArea[] = ['filter', 'column', 'row', 'value'];
const DROP_PAYLOAD_TYPE = 'application/x-mog-pivot-field-pane';

function placementId(placement: PivotFieldPlacement): string {
  return String(placement.placementId);
}

function displayName(field: PivotField, placement: PivotFieldPlacement): string {
  return placement.displayName || field.name;
}

function defaultAggregate(area: PivotFieldArea, field?: PivotField): AggregateFunction {
  return area === 'value' && field?.dataType === 'number' ? 'sum' : 'count';
}

function serializeDragState(state: DragState): string {
  return JSON.stringify(state);
}

function parseDragState(value: string): DragState | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as Partial<DragState>;
    if (parsed.kind === 'field' && typeof parsed.fieldId === 'string') {
      return { kind: 'field', fieldId: parsed.fieldId };
    }
    if (
      parsed.kind === 'placement' &&
      typeof parsed.placementId === 'string' &&
      typeof parsed.fieldId === 'string' &&
      typeof parsed.fromArea === 'string' &&
      PIVOT_AREAS.includes(parsed.fromArea as PivotFieldArea) &&
      typeof parsed.fromIndex === 'number'
    ) {
      return {
        kind: 'placement',
        placementId: parsed.placementId,
        fieldId: parsed.fieldId,
        fromArea: parsed.fromArea as PivotFieldArea,
        fromIndex: parsed.fromIndex,
      };
    }
  } catch {
    return null;
  }
  return null;
}

function DataTypeIcon({ dataType }: { dataType: string }) {
  const icons: Record<string, string> = {
    string: 'Aa',
    number: '#',
    date: 'D',
    boolean: '?',
  };
  return <span className="shrink-0 text-hint text-ss-text-disabled">{icons[dataType] || '?'}</span>;
}

function AggregateSelector({
  value,
  disabled,
  onChange,
}: {
  value: AggregateFunction;
  disabled?: boolean;
  onChange: (value: AggregateFunction) => void;
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
      className="min-w-0 flex-1 px-1.5 py-0.5 border border-ss-border rounded-ss-sm text-caption bg-ss-surface"
      value={value}
      aria-label="Aggregate value field"
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as AggregateFunction)}
      onClick={(event) => event.stopPropagation()}
      data-pivot-target="aggregate-selector"
    >
      {options.map((option) => (
        <option key={option.value} value={option.value}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

function LabelSortSelector({
  value,
  label,
  disabled,
  onChange,
}: {
  value: SortOrder;
  label: string;
  disabled?: boolean;
  onChange: (value: SortOrder) => void;
}) {
  return (
    <select
      className="min-w-0 flex-1 px-1.5 py-0.5 border border-ss-border rounded-ss-sm text-caption bg-ss-surface"
      value={value}
      aria-label={`Sort ${label}`}
      title={`Sort ${label}`}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as SortOrder)}
      onClick={(event) => event.stopPropagation()}
      data-pivot-target="label-sort-control"
    >
      <option value="none">No sort</option>
      <option value="asc">Sort Ascending</option>
      <option value="desc">Sort Descending</option>
    </select>
  );
}

function ValueSortSelector({
  value,
  label,
  disabled,
  onChange,
}: {
  value: SortOrder;
  label: string;
  disabled?: boolean;
  onChange: (value: SortOrder) => void;
}) {
  return (
    <select
      className="min-w-0 flex-1 px-1.5 py-0.5 border border-ss-border rounded-ss-sm text-caption bg-ss-surface"
      value={value}
      aria-label={`Sort values by ${label}`}
      title={`Sort values by ${label}`}
      disabled={disabled}
      onChange={(event) => onChange(event.target.value as SortOrder)}
      onClick={(event) => event.stopPropagation()}
      data-pivot-target="value-sort-control"
    >
      <option value="none">No value sort</option>
      <option value="desc">Largest to Smallest</option>
      <option value="asc">Smallest to Largest</option>
    </select>
  );
}

export function PivotFieldList({
  fields,
  placements,
  onAddField,
  onRemovePlacement,
  onMovePlacement,
  onAggregateChange,
  onSortOrderChange,
  onValueSortChange,
  disabled = false,
  canAddFields = !disabled,
  canReorderFields = !disabled,
  canRemoveFields = !disabled,
  canChangeAggregate = !disabled,
  canSortLabels = !disabled,
  canSortByValue = !disabled,
}: PivotFieldListProps) {
  const [dragState, setDragState] = useState<DragState | null>(null);
  const [dragOverArea, setDragOverArea] = useState<PivotFieldArea | null>(null);
  const [selectedItem, setSelectedItem] = useState<DragState | null>(null);

  const fieldById = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);
  const placementsByArea = useMemo<Record<PivotFieldArea, PlacedField[]>>(() => {
    const byArea: Record<PivotFieldArea, PlacedField[]> = {
      filter: [],
      column: [],
      row: [],
      value: [],
    };

    for (const placement of [...placements].sort((a, b) => a.position - b.position)) {
      const field = fieldById.get(placement.fieldId);
      if (field) byArea[placement.area].push({ field, placement });
    }

    return byArea;
  }, [fieldById, placements]);

  const firstAxisPlacement =
    placementsByArea.row[0]?.placement ?? placementsByArea.column[0]?.placement ?? null;

  const currentValueSortOrder = useCallback(
    (valuePlacement: PivotFieldPlacement): SortOrder => {
      const sortByValue = firstAxisPlacement?.sortByValue;
      if (!sortByValue) return 'none';
      if (sortByValue.valuePlacementId === valuePlacement.placementId) return sortByValue.order;
      if (!sortByValue.valuePlacementId && sortByValue.valueFieldId === valuePlacement.fieldId) {
        return sortByValue.order;
      }
      return 'none';
    },
    [firstAxisPlacement],
  );

  const canDragState = useCallback(
    (state: DragState | null) => {
      if (!state || disabled) return false;
      return state.kind === 'field' ? canAddFields : canReorderFields;
    },
    [canAddFields, canReorderFields, disabled],
  );

  const dragStateFromEvent = useCallback(
    (event: DragEvent): DragState | null => {
      if (dragState) return dragState;
      const parsed = parseDragState(event.dataTransfer.getData(DROP_PAYLOAD_TYPE));
      if (parsed) return parsed;
      const fieldId = event.dataTransfer.getData('text/plain');
      return fieldId ? { kind: 'field', fieldId } : null;
    },
    [dragState],
  );

  const handleDragStart = useCallback(
    (event: DragEvent, state: DragState) => {
      if (!canDragState(state)) return;
      setDragState(state);
      event.dataTransfer.effectAllowed = 'move';
      event.dataTransfer.setData(DROP_PAYLOAD_TYPE, serializeDragState(state));
      event.dataTransfer.setData(
        'text/plain',
        state.kind === 'field' ? state.fieldId : state.placementId,
      );
    },
    [canDragState],
  );

  const handleDragEnd = useCallback(() => {
    setDragState(null);
    setDragOverArea(null);
  }, []);

  const handleDragOver = useCallback(
    (event: DragEvent, area: PivotFieldArea) => {
      const state = dragStateFromEvent(event);
      if (!canDragState(state)) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
      setDragOverArea(area);
    },
    [canDragState, dragStateFromEvent],
  );

  const handleDropAtPosition = useCallback(
    (event: DragEvent, toArea: PivotFieldArea, toPosition: number) => {
      event.preventDefault();
      event.stopPropagation();
      const state = dragStateFromEvent(event);
      if (!state || !canDragState(state)) return;

      if (state.kind === 'field') {
        const field = fieldById.get(state.fieldId);
        onAddField(state.fieldId, toArea, {
          position: Math.max(0, Math.min(toPosition, placementsByArea[toArea].length)),
          aggregateFunction: defaultAggregate(toArea, field),
        });
      } else {
        const maxPosition =
          state.fromArea === toArea
            ? Math.max(0, placementsByArea[toArea].length - 1)
            : placementsByArea[toArea].length;
        const finalPosition = Math.max(0, Math.min(toPosition, maxPosition));
        if (state.fromArea !== toArea || finalPosition !== state.fromIndex) {
          onMovePlacement(state.placementId, toArea, finalPosition);
        }
      }

      setDragState(null);
      setDragOverArea(null);
      setSelectedItem(null);
    },
    [canDragState, dragStateFromEvent, fieldById, onAddField, onMovePlacement, placementsByArea],
  );

  const handleDropOnZone = useCallback(
    (event: DragEvent, toArea: PivotFieldArea) => {
      const state = dragStateFromEvent(event);
      const appendPosition =
        state?.kind === 'placement' && state.fromArea === toArea
          ? Math.max(0, placementsByArea[toArea].length - 1)
          : placementsByArea[toArea].length;
      handleDropAtPosition(event, toArea, appendPosition);
    },
    [dragStateFromEvent, handleDropAtPosition, placementsByArea],
  );

  const handleDropOnPlacement = useCallback(
    (event: DragEvent, item: PlacedField, targetIndex: number) => {
      const state = dragStateFromEvent(event);
      if (!state) return;

      const rect = event.currentTarget.getBoundingClientRect();
      const dropAfter = rect.height > 0 ? event.clientY > rect.top + rect.height / 2 : false;
      const insertionBeforeRemoval = targetIndex + (dropAfter ? 1 : 0);
      const adjustedPosition =
        state.kind === 'placement' &&
        state.fromArea === item.placement.area &&
        state.fromIndex < insertionBeforeRemoval
          ? insertionBeforeRemoval - 1
          : insertionBeforeRemoval;

      handleDropAtPosition(event, item.placement.area, adjustedPosition);
    },
    [dragStateFromEvent, handleDropAtPosition],
  );

  const handleZoneClick = useCallback(
    (toArea: PivotFieldArea) => {
      if (!selectedItem || !canDragState(selectedItem)) return;
      const appendPosition =
        selectedItem.kind === 'placement' && selectedItem.fromArea === toArea
          ? Math.max(0, placementsByArea[toArea].length - 1)
          : placementsByArea[toArea].length;

      if (selectedItem.kind === 'field') {
        const field = fieldById.get(selectedItem.fieldId);
        onAddField(selectedItem.fieldId, toArea, {
          position: appendPosition,
          aggregateFunction: defaultAggregate(toArea, field),
        });
      } else if (selectedItem.fromArea !== toArea || selectedItem.fromIndex !== appendPosition) {
        onMovePlacement(selectedItem.placementId, toArea, appendPosition);
      }

      setSelectedItem(null);
    },
    [canDragState, fieldById, onAddField, onMovePlacement, placementsByArea, selectedItem],
  );

  const applySelectedItemAtPosition = useCallback(
    (toArea: PivotFieldArea, position: number) => {
      if (!selectedItem || !canDragState(selectedItem)) return false;

      if (selectedItem.kind === 'field') {
        const field = fieldById.get(selectedItem.fieldId);
        onAddField(selectedItem.fieldId, toArea, {
          position: Math.max(0, Math.min(position, placementsByArea[toArea].length)),
          aggregateFunction: defaultAggregate(toArea, field),
        });
        setSelectedItem(null);
        return true;
      }

      const maxPosition =
        selectedItem.fromArea === toArea
          ? Math.max(0, placementsByArea[toArea].length - 1)
          : placementsByArea[toArea].length;
      const finalPosition = Math.max(0, Math.min(position, maxPosition));
      if (selectedItem.fromArea !== toArea || selectedItem.fromIndex !== finalPosition) {
        onMovePlacement(selectedItem.placementId, toArea, finalPosition);
      }
      setSelectedItem(null);
      return true;
    },
    [canDragState, fieldById, onAddField, onMovePlacement, placementsByArea, selectedItem],
  );

  const renderSourceFieldChip = (field: PivotField) => {
    const state: DragState = { kind: 'field', fieldId: field.id };
    const isDragging = dragState?.kind === 'field' && dragState.fieldId === field.id;
    const isSelected = selectedItem?.kind === 'field' && selectedItem.fieldId === field.id;
    const canDrag = canDragState(state);

    return (
      <div
        key={`available-${field.id}`}
        className={`flex max-w-full min-w-0 items-center gap-1.5 px-2 py-1.5 rounded text-body-sm select-none transition-colors ${
          canDrag ? 'cursor-grab' : 'cursor-default'
        } ${isDragging ? 'opacity-50' : ''} ${isSelected ? 'ring-2 ring-ss-primary' : ''} bg-ss-surface-hover`}
        draggable={canDrag}
        onDragStart={(event) => handleDragStart(event, state)}
        onDragEnd={handleDragEnd}
        onClick={(event) => {
          event.stopPropagation();
          if (canDrag) setSelectedItem(state);
        }}
        data-pivot-target="field-chip"
        data-pivot-field-id={field.id}
        data-pivot-field-name={field.name}
        data-pivot-display-name={field.name}
        data-pivot-placement-id={field.id}
        data-pivot-area="available"
        data-pivot-selected={isSelected ? 'true' : 'false'}
      >
        <DataTypeIcon dataType={field.dataType} />
        <span className="min-w-0 flex-1 truncate">{field.name}</span>
      </div>
    );
  };

  const renderPlacementChip = (item: PlacedField, index: number) => {
    const { field, placement } = item;
    const id = placementId(placement);
    const label = displayName(field, placement);
    const state: DragState = {
      kind: 'placement',
      placementId: id,
      fieldId: field.id,
      fromArea: placement.area,
      fromIndex: index,
    };
    const isDragging = dragState?.kind === 'placement' && dragState.placementId === id;
    const isSelected = selectedItem?.kind === 'placement' && selectedItem.placementId === id;
    const canDrag = canDragState(state);
    const isValueField = placement.area === 'value';
    const canRenderLabelSort = placement.area === 'row' || placement.area === 'column';
    const canRenderValueSort = isValueField && firstAxisPlacement != null;
    const showControls =
      (isValueField && onAggregateChange) ||
      (canRenderLabelSort && onSortOrderChange) ||
      (canRenderValueSort && onValueSortChange);

    return (
      <div
        key={id}
        className={`flex w-full max-w-full min-w-0 flex-col gap-1.5 px-2 py-1.5 rounded text-body-sm select-none transition-colors ${
          canDrag ? 'cursor-grab' : 'cursor-default'
        } ${isDragging ? 'opacity-50' : ''} ${isSelected ? 'ring-2 ring-ss-primary' : ''} ${
          isValueField ? 'bg-ss-primary-light' : 'bg-ss-surface-hover'
        }`}
        draggable={canDrag}
        onDragStart={(event) => handleDragStart(event, state)}
        onDragEnd={handleDragEnd}
        onDragOver={(event) => handleDragOver(event, placement.area)}
        onDrop={(event) => handleDropOnPlacement(event, item, index)}
        onClick={(event) => {
          event.stopPropagation();
          if (selectedItem && canDragState(selectedItem)) {
            if (selectedItem.kind === 'field') {
              if (applySelectedItemAtPosition(placement.area, index + 1)) return;
            } else if (selectedItem.placementId !== id) {
              const insertionBeforeRemoval = index + 1;
              const adjustedPosition =
                selectedItem.fromArea === placement.area &&
                selectedItem.fromIndex < insertionBeforeRemoval
                  ? insertionBeforeRemoval - 1
                  : insertionBeforeRemoval;
              if (applySelectedItemAtPosition(placement.area, adjustedPosition)) return;
            }
          }
          if (canDrag) setSelectedItem(state);
        }}
        data-pivot-target="field-chip"
        data-pivot-field-id={field.id}
        data-pivot-field-name={field.name}
        data-pivot-display-name={label}
        data-pivot-placement-id={id}
        data-pivot-area={placement.area}
        data-pivot-selected={isSelected ? 'true' : 'false'}
      >
        <div className="flex w-full min-w-0 items-center gap-1.5">
          <DataTypeIcon dataType={field.dataType} />
          <span className="min-w-0 flex-1 truncate">{label}</span>
          {canRemoveFields && (
            <button
              type="button"
              className="flex shrink-0 items-center justify-center w-5 h-5 p-0 border-none rounded-full bg-transparent cursor-pointer text-ss-text-secondary text-caption leading-none hover:bg-ss-surface-active disabled:cursor-default disabled:opacity-50"
              onClick={(event) => {
                event.stopPropagation();
                onRemovePlacement(id);
              }}
              title="Remove field"
              aria-label={`Remove ${label}`}
              disabled={disabled || !canRemoveFields}
              data-pivot-target="remove-field"
              data-pivot-field-id={field.id}
              data-pivot-placement-id={id}
              data-pivot-area={placement.area}
            >
              ×
            </button>
          )}
        </div>
        {showControls && (
          <div className="flex w-full min-w-0 gap-1" data-pivot-target="placement-controls">
            {isValueField && placement.aggregateFunction && onAggregateChange && (
              <AggregateSelector
                value={placement.aggregateFunction}
                disabled={disabled || !canChangeAggregate}
                onChange={(aggregate) => onAggregateChange(id, aggregate)}
              />
            )}
            {canRenderLabelSort && onSortOrderChange && (
              <LabelSortSelector
                value={placement.sortOrder ?? 'none'}
                label={label}
                disabled={disabled || !canSortLabels}
                onChange={(sortOrder) => onSortOrderChange(id, sortOrder)}
              />
            )}
            {canRenderValueSort && onValueSortChange && (
              <ValueSortSelector
                value={currentValueSortOrder(placement)}
                label={label}
                disabled={disabled || !canSortByValue || !firstAxisPlacement}
                onChange={(sortOrder) => onValueSortChange(id, sortOrder)}
              />
            )}
          </div>
        )}
      </div>
    );
  };

  const renderDropZone = (area: PivotFieldArea, label: string) => {
    const placedFields = placementsByArea[area];
    const dropAreaClass = `flex flex-col gap-1.5 min-h-9 p-1.5 bg-ss-surface border border-dashed rounded transition-colors ${
      dragOverArea === area ? 'bg-ss-primary-light border-ss-primary' : 'border-ss-border'
    }`;

    return (
      <div
        className="flex min-w-0 flex-col gap-1.5"
        data-pivot-target="field-zone-wrapper"
        data-pivot-zone={area}
      >
        <div className="text-caption font-medium text-ss-text-secondary">{label}</div>
        <div
          className={dropAreaClass}
          onDragOver={(event) => handleDragOver(event, area)}
          onDragLeave={() => setDragOverArea(null)}
          onDrop={(event) => handleDropOnZone(event, area)}
          onClick={() => handleZoneClick(area)}
          data-pivot-target="field-zone"
          data-pivot-zone={area}
          data-pivot-accepts-selected={selectedItem ? 'true' : 'false'}
        >
          {placedFields.length === 0 ? (
            <span className="text-caption text-ss-text-disabled italic p-1">Drop fields here</span>
          ) : (
            placedFields.map((item, index) => renderPlacementChip(item, index))
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
      <div className="flex flex-col gap-2">
        <div className="font-semibold text-caption text-ss-text-secondary uppercase tracking-wide">
          Available Fields
        </div>
        <div
          className="flex flex-wrap gap-1.5 min-h-9 p-1.5 bg-ss-surface border border-dashed border-ss-border rounded"
          data-pivot-target="available-fields"
          data-pivot-zone="available"
        >
          {fields.length === 0 ? (
            <span className="text-caption text-ss-text-disabled italic p-1">No fields</span>
          ) : (
            fields.map(renderSourceFieldChip)
          )}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {renderDropZone('filter', 'Filters')}
        {renderDropZone('column', 'Columns')}
        {renderDropZone('row', 'Rows')}
        {renderDropZone('value', 'Values')}
      </div>
    </div>
  );
}
