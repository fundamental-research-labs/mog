import type {
  AggregateFunction,
  PivotField,
  PivotFieldArea,
  PivotFieldPlacementFlat as PivotFieldPlacement,
} from '@mog-sdk/contracts/pivot';

export interface PendingAutoActivatedMove {
  fieldId: string;
  fromArea: PivotFieldArea;
  toArea: PivotFieldArea;
  position: number;
}

export function displayName(field: PivotField, placement: PivotFieldPlacement): string {
  return placement.displayName || field.name;
}

export function defaultAggregate(area: PivotFieldArea, field?: PivotField): AggregateFunction {
  return area === 'value' && field?.dataType === 'number' ? 'sum' : 'count';
}

export function defaultAreaForField(field: PivotField): PivotFieldArea {
  return field.dataType === 'number' ? 'value' : 'row';
}
