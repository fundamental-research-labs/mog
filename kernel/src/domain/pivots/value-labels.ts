import type {
  AggregateFunction,
  PivotFieldPlacementFlat,
  PivotTableConfig,
} from '@mog-sdk/contracts/pivot';

type PivotFieldPlacement = PivotFieldPlacementFlat;

const PIVOT_AGGREGATE_LABELS: Record<AggregateFunction, string> = {
  sum: 'Sum',
  count: 'Count',
  counta: 'Count',
  countunique: 'Count',
  average: 'Average',
  min: 'Min',
  max: 'Max',
  product: 'Product',
  stdev: 'StdDev',
  stdevp: 'StdDevP',
  var: 'Var',
  varp: 'VarP',
};

function pivotAggregateLabel(aggregate: AggregateFunction | string | null | undefined): string {
  if (!aggregate) return PIVOT_AGGREGATE_LABELS.sum;
  const aggregateText = String(aggregate);
  const normalized = aggregateText.toLowerCase() as AggregateFunction;
  return (
    PIVOT_AGGREGATE_LABELS[normalized] ??
    (aggregateText.length > 0
      ? `${aggregateText.charAt(0).toUpperCase()}${aggregateText.slice(1)}`
      : PIVOT_AGGREGATE_LABELS.sum)
  );
}

export function pivotValueFieldDisplayName(input: {
  displayName?: string | null;
  sourceFieldName?: string | null;
  fieldId?: string | null;
  aggregateFunction?: AggregateFunction | string | null;
}): string {
  const explicitName = input.displayName?.trim();
  if (explicitName) return explicitName;
  const sourceName = input.sourceFieldName?.trim() || input.fieldId?.trim() || '?';
  return `${pivotAggregateLabel(input.aggregateFunction)} of ${sourceName}`;
}

function isAutomaticPivotValueFieldDisplayName(
  displayName: string | null | undefined,
  input: {
    sourceFieldName?: string | null;
    fieldId?: string | null;
    aggregateFunction?: AggregateFunction | string | null;
  },
): boolean {
  const label = displayName?.trim();
  if (!label) return true;
  if (label === pivotValueFieldDisplayName(input)) return true;
  const sourceName = input.sourceFieldName?.trim() || input.fieldId?.trim();
  return (
    Boolean(sourceName) &&
    label === sourceName &&
    (!input.aggregateFunction || String(input.aggregateFunction).toLowerCase() === 'sum')
  );
}

function calculatedFieldName(
  config: PivotTableConfig,
  placement: PivotFieldPlacement,
): string | null {
  const calculatedFieldId = placement.calculatedFieldId;
  if (!calculatedFieldId) return null;
  return (
    (config.calculatedFields ?? []).find(
      (field) => (field.calculatedFieldId ?? field.fieldId) === calculatedFieldId,
    )?.name ?? null
  );
}

export function pivotSourceFieldName(
  config: PivotTableConfig,
  placementOrFieldId: PivotFieldPlacement | string,
): string {
  if (typeof placementOrFieldId !== 'string') {
    const calculatedName = calculatedFieldName(config, placementOrFieldId);
    if (calculatedName) return calculatedName;
    const fieldId = placementOrFieldId.fieldId;
    return config.fields.find((field) => field.id === fieldId)?.name ?? fieldId;
  }
  return config.fields.find((field) => field.id === placementOrFieldId)?.name ?? placementOrFieldId;
}

export function automaticPivotValueDisplayName(options: {
  config: PivotTableConfig;
  fieldId: string;
  aggregateFunction?: AggregateFunction | string | null;
  displayName?: string | null;
}): string {
  return pivotValueFieldDisplayName({
    displayName: options.displayName,
    sourceFieldName: pivotSourceFieldName(options.config, options.fieldId),
    fieldId: options.fieldId,
    aggregateFunction: options.aggregateFunction,
  });
}

export function automaticPivotValuePlacementDisplayName(options: {
  config: PivotTableConfig;
  placement: PivotFieldPlacement;
  aggregateFunction?: AggregateFunction | string | null;
  displayName?: string | null;
}): string {
  return pivotValueFieldDisplayName({
    displayName: options.displayName,
    sourceFieldName: pivotSourceFieldName(options.config, options.placement),
    fieldId: options.placement.fieldId,
    aggregateFunction: options.aggregateFunction ?? options.placement.aggregateFunction ?? 'sum',
  });
}

export function valuePlacementWithAggregate(options: {
  config: PivotTableConfig;
  placement: PivotFieldPlacement;
  aggregateFunction: AggregateFunction;
}): PivotFieldPlacement {
  const { config, placement, aggregateFunction } = options;
  if (placement.area !== 'value') return { ...placement, aggregateFunction };

  const sourceFieldName = pivotSourceFieldName(config, placement);
  const shouldUpdateDisplayName = isAutomaticPivotValueFieldDisplayName(placement.displayName, {
    sourceFieldName,
    fieldId: placement.fieldId,
    aggregateFunction: placement.aggregateFunction ?? 'sum',
  });

  return {
    ...placement,
    aggregateFunction,
    ...(shouldUpdateDisplayName
      ? {
          displayName: pivotValueFieldDisplayName({
            sourceFieldName,
            fieldId: placement.fieldId,
            aggregateFunction,
          }),
        }
      : {}),
  };
}
