import type { AggregateFunction, PivotFieldArea } from '@mog-sdk/contracts/pivot';

export const PIVOT_READBACK_REVISION = 1;

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
