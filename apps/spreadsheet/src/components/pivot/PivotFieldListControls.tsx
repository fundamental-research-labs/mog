import type { AggregateFunction, PivotFieldArea, SortOrder } from '@mog-sdk/contracts/pivot';

import { PIVOT_AGGREGATE_FUNCTION_OPTIONS } from '../../systems/pivot';

const DATA_TYPE_ICONS: Record<string, string> = {
  string: 'Aa',
  number: '#',
  date: 'D',
  boolean: '?',
};

export function DataTypeIcon({ dataType }: { dataType: string }) {
  return (
    <span className="shrink-0 text-hint text-ss-text-disabled">
      {DATA_TYPE_ICONS[dataType] || '?'}
    </span>
  );
}

export function AggregateSelector({
  value,
  disabled,
  onChange,
}: {
  value: AggregateFunction;
  disabled?: boolean;
  onChange: (value: AggregateFunction) => void;
}) {
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
      {PIVOT_AGGREGATE_FUNCTION_OPTIONS.map((option) => (
        <option key={option.type} value={option.type}>
          {option.label}
        </option>
      ))}
    </select>
  );
}

export function LabelSortSelector({
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

export function ValueSortSelector({
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

export function DropInsertionIndicator({
  area,
  position,
}: {
  area: PivotFieldArea;
  position: number;
}) {
  return (
    <div
      className="h-1 w-full rounded-full bg-ss-primary"
      data-pivot-target="field-drop-indicator"
      data-pivot-area={area}
      data-pivot-drop-position={position}
      aria-hidden="true"
    />
  );
}
