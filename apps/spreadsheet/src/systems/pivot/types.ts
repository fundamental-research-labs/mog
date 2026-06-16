import type {
  AggregateFunction,
  PivotFieldArea,
  PivotFieldPlacementFlat,
  PivotTableConfig,
} from '@mog-sdk/contracts/pivot';

export const PIVOT_READBACK_REVISION = 1;

export const PIVOT_AGGREGATE_FUNCTION_OPTIONS: ReadonlyArray<{
  type: AggregateFunction;
  label: string;
}> = [
  { type: 'sum', label: 'Sum' },
  { type: 'count', label: 'Count' },
  { type: 'counta', label: 'Count (Non-Empty)' },
  { type: 'countunique', label: 'Count Unique' },
  { type: 'average', label: 'Average' },
  { type: 'min', label: 'Min' },
  { type: 'max', label: 'Max' },
  { type: 'product', label: 'Product' },
  { type: 'stdev', label: 'StdDev' },
  { type: 'stdevp', label: 'StdDevP' },
  { type: 'var', label: 'Var' },
  { type: 'varp', label: 'VarP' },
];

export type PivotSemanticTarget =
  | 'layer'
  | 'wrapper'
  | 'table-view'
  | 'readback-table'
  | 'readback-row'
  | 'readback-cell'
  | 'field-panel'
  | 'field-list'
  | 'available-fields'
  | 'field-zone'
  | 'field-chip'
  | 'empty-state'
  | 'empty-state-name'
  | 'stats';

export interface PivotSemanticTargetDescriptor {
  target: PivotSemanticTarget;
  pivotId?: string;
  fieldId?: string;
  fieldName?: string;
  area?: PivotFieldArea | 'available';
}

export interface PivotInteractionReceipt {
  action:
    | 'create'
    | 'select'
    | 'edit'
    | 'add-field'
    | 'remove-field'
    | 'move-field'
    | 'set-aggregate'
    | 'refresh'
    | 'delete'
    | 'context-menu'
    | 'readback';
  pivotId?: string;
  target?: PivotSemanticTargetDescriptor;
  revision: number;
  timestamp: number;
}

export interface PivotDialogDraft {
  sessionId: string;
  sourceRange: string;
  name: string;
  locationMode: 'newWorksheet' | 'existingWorksheet';
  destinationSheetId: string | null;
  destinationCellRef: string;
}

export interface PivotDialogSession {
  sessionId: string;
  openedAt: number;
  hostId: 'create-pivot-dialog';
  draft: PivotDialogDraft;
}

export interface PivotReadbackCell {
  rowIndex: number;
  columnIndex: number;
  text: string;
  role: 'header' | 'value' | 'grand-total' | 'empty';
}

export interface PivotReadbackRevision {
  revision: typeof PIVOT_READBACK_REVISION;
  pivotId: string;
  rows: PivotReadbackCell[][];
  rowFields: string[];
  columnFields: string[];
  valueFields: Array<{
    name: string;
    sourceField: string;
    aggregation: AggregateFunction | string;
  }>;
  filterFields: string[];
}

export interface PivotReadbackMetadata {
  rowFields: string[];
  columnFields: string[];
  filterFields: string[];
  valueFields: PivotReadbackRevision['valueFields'];
}

export function pivotAggregateLabel(
  aggregate: AggregateFunction | string | null | undefined,
): string {
  if (!aggregate) return 'Sum';
  const aggregateText = String(aggregate);
  const option = PIVOT_AGGREGATE_FUNCTION_OPTIONS.find(
    (candidate) => candidate.type === aggregateText,
  );
  return (
    option?.label ??
    (aggregateText.length > 0
      ? `${aggregateText.charAt(0).toUpperCase()}${aggregateText.slice(1)}`
      : 'Sum')
  );
}

export function pivotFieldLabel(config: PivotTableConfig, fieldId: string): string {
  return config.fields.find((field) => field.id === fieldId)?.name ?? fieldId;
}

export function pivotPlacementsFor(
  config: PivotTableConfig,
  area: PivotFieldArea,
): PivotFieldPlacementFlat[] {
  return config.placements
    .filter((placement) => placement.area === area)
    .sort((a, b) => a.position - b.position);
}

function calculatedFieldName(
  config: PivotTableConfig,
  placement: PivotFieldPlacementFlat,
): string | null {
  const calculatedFieldId = placement.calculatedFieldId;
  if (!calculatedFieldId) return null;
  return (
    (config.calculatedFields ?? []).find(
      (field) => (field.calculatedFieldId ?? field.fieldId) === calculatedFieldId,
    )?.name ?? null
  );
}

export function pivotSourceFieldLabel(
  config: PivotTableConfig,
  placement: PivotFieldPlacementFlat,
): string {
  return calculatedFieldName(config, placement) ?? pivotFieldLabel(config, placement.fieldId);
}

export function createPivotReadbackMetadata(config: PivotTableConfig): PivotReadbackMetadata {
  return {
    rowFields: pivotPlacementsFor(config, 'row').map((placement) =>
      pivotFieldLabel(config, placement.fieldId),
    ),
    columnFields: pivotPlacementsFor(config, 'column').map((placement) =>
      pivotFieldLabel(config, placement.fieldId),
    ),
    filterFields: pivotPlacementsFor(config, 'filter').map((placement) =>
      pivotFieldLabel(config, placement.fieldId),
    ),
    valueFields: pivotPlacementsFor(config, 'value').map((placement) => {
      const sourceField = pivotSourceFieldLabel(config, placement);
      const name = placement.displayName ?? sourceField;
      return {
        name,
        sourceField,
        aggregation: placement.aggregateFunction ?? 'sum',
      };
    }),
  };
}

export function pivotReadbackAttributes(config: PivotTableConfig): {
  'data-pivot-readback-revision': typeof PIVOT_READBACK_REVISION;
  'data-pivot-row-fields': string;
  'data-pivot-column-fields': string;
  'data-pivot-filter-fields': string;
  'data-pivot-value-fields': string;
} {
  const metadata = createPivotReadbackMetadata(config);
  return {
    'data-pivot-readback-revision': PIVOT_READBACK_REVISION,
    'data-pivot-row-fields': JSON.stringify(metadata.rowFields),
    'data-pivot-column-fields': JSON.stringify(metadata.columnFields),
    'data-pivot-filter-fields': JSON.stringify(metadata.filterFields),
    'data-pivot-value-fields': JSON.stringify(metadata.valueFields),
  };
}

export function createPivotInteractionReceipt(
  action: PivotInteractionReceipt['action'],
  options: Omit<PivotInteractionReceipt, 'action' | 'revision' | 'timestamp'> = {},
): PivotInteractionReceipt {
  return {
    ...options,
    action,
    revision: PIVOT_READBACK_REVISION,
    timestamp: Date.now(),
  };
}
