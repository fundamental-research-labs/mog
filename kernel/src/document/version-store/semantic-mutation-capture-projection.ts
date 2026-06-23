import type { VersionSemanticValue } from '@mog-sdk/contracts/api';
import type { VersionAuthor, VersionOperationContext } from '@mog-sdk/contracts/versioning';
import { toA1 } from '@mog/spreadsheet-utils/a1';

import type {
  CellChange,
  CfChange,
  CommentChange,
  FilterChange,
  FloatingObjectChange,
  MutationResult,
  NamedRangeChange,
  RangeChange,
  SheetChange,
  SortingChange,
  StructureChangeResult,
  TableChange,
} from '../../bridges/compute/compute-types.gen';
import type { DirectEditPosition, DirectEditRange } from '../../bridges/compute/mutation-admission';
import {
  isDirectCellFormatOperation,
  mapDirectCellFormatChanges,
} from './semantic-mutation-direct-format-capture';
import {
  decodeRangeChangeMeta,
  directEditKey,
  filterEntityId,
  isInDirectEditRange,
  isLikelyDefinedName,
  isSheetIndex,
  isStableSheetId,
  isStableString,
  metadataChange,
  semanticCellEditValue,
  semanticChartSourceValue,
  semanticFilterValue,
  semanticFloatingObjectAnchorValue,
  semanticObjectValue,
  semanticRangeDomain,
  semanticRangeValue,
  semanticSheetValue,
} from './semantic-mutation-capture-projection-helpers';
import { mapSyncAuthoredCellChanges } from './semantic-mutation-sync-cell-capture';

export interface SemanticMutationCaptureProjectionInput {
  readonly operation: string;
  readonly result: MutationResult;
  readonly directEdits?: readonly DirectEditPosition[];
  readonly directEditRanges?: readonly DirectEditRange[];
  readonly operationContext?: VersionOperationContext;
}

export type VersionSemanticChangeRecord = {
  readonly structural: {
    readonly kind: 'metadata';
    readonly changeId: string;
    readonly domain: string;
    readonly entityId: string;
    readonly propertyPath: readonly string[];
  };
  readonly before: {
    readonly kind: 'value';
    readonly value: VersionSemanticValue;
  };
  readonly after: {
    readonly kind: 'value';
    readonly value: VersionSemanticValue;
  };
  readonly display?: {
    readonly address?: { readonly kind: 'value'; readonly value: string };
    readonly entityLabel?: { readonly kind: 'value'; readonly value: string };
  };
};

export type PendingSemanticMutation = {
  readonly sequence: number;
  readonly operation: string;
  readonly capturedAt: string;
  readonly operationContext?: VersionOperationContext;
  readonly directEdits: readonly DirectEditPosition[];
  readonly directEditRanges: readonly DirectEditRange[];
  readonly changes: readonly VersionSemanticChangeRecord[];
};

export function mapMutationResultToSemanticChanges(
  input: SemanticMutationCaptureProjectionInput,
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  if (input.operation === 'compute_apply_sync_update')
    changes.push(...mapSyncAuthoredCellChanges(input.result.authoredCellChanges ?? [], sequence));
  if (isDirectCellValueOperation(input.operation)) {
    changes.push(
      ...mapCellWriteChanges(
        input.result.recalc?.changedCells ?? [],
        input.directEdits ?? [],
        input.directEditRanges ?? [],
        sequence,
      ),
    );
  }
  if (isDirectCellFormatOperation(input.operation, input.operationContext)) {
    changes.push(...mapDirectCellFormatChanges(input.result.propertyChanges ?? [], sequence));
  }
  if (input.operation === 'compute_rename_compute_sheet') {
    changes.push(...mapSheetRenameChanges(input.result.sheetChanges ?? [], sequence));
  }
  if (input.operation === 'compute_set_tab_color') {
    changes.push(...mapSheetTabColorChanges(input.result.sheetChanges ?? [], sequence));
  }
  if (input.operation === 'compute_create_sheet_with_default_col_width') {
    changes.push(...mapSheetCreateChanges(input.result.sheetChanges ?? [], sequence));
  }
  if (input.operation === 'compute_delete_sheet') {
    changes.push(...mapSheetRemoveChanges(input.result.sheetChanges ?? [], sequence));
  }
  if (input.operation === 'compute_copy_sheet') {
    changes.push(...mapSheetCopyChanges(input.result.sheetChanges ?? [], sequence));
  }
  if (input.operation === 'compute_move_sheet') {
    changes.push(...mapSheetMoveChanges(input.result.sheetChanges ?? [], sequence));
  }
  changes.push(...mapNamedRangeChanges(input.result.namedRangeChanges ?? [], sequence));
  changes.push(...mapTableChanges(input.result.tableChanges ?? [], sequence));
  changes.push(...mapCommentChanges(input.result.commentChanges ?? [], sequence));
  changes.push(...mapCfChanges(input.result.cfChanges ?? [], sequence));
  changes.push(...mapFilterChanges(input.result.filterChanges ?? [], sequence));
  changes.push(...mapSortingChanges(input.result.sortingChanges ?? [], sequence));
  changes.push(...mapFloatingObjectChanges(input.result.floatingObjectChanges ?? [], sequence));
  changes.push(...mapRangeChanges(input.result.rangeChanges ?? [], sequence));
  changes.push(...mapStructureChanges(input.result.structureChanges ?? [], sequence));
  return changes;
}

function isDirectCellValueOperation(operation: string): boolean {
  return (
    operation === 'compute_batch_set_cells_by_position' ||
    operation === 'compute_set_date_value' ||
    operation === 'compute_set_time_value' ||
    operation === 'compute_clear_range_by_position' ||
    operation === 'compute_clear_range' ||
    operation === 'compute_clear_range_and_return_ids' ||
    operation === 'compute_clear_range_with_mode' ||
    operation === 'compute_replace_all_in_range'
  );
}

function mapCellWriteChanges(
  changedCells: readonly CellChange[],
  directEdits: readonly DirectEditPosition[],
  directEditRanges: readonly DirectEditRange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const directEditKeys = new Set(directEdits.map((edit) => directEditKey(edit)));
  if (directEditKeys.size === 0 && directEditRanges.length === 0) return [];

  const changes: VersionSemanticChangeRecord[] = [];
  for (const cell of changedCells) {
    if (!cell.position) continue;
    const key = directEditKey({
      sheetId: cell.sheetId,
      row: cell.position.row,
      col: cell.position.col,
    });
    if (
      directEditKeys.size > 0
        ? !directEditKeys.has(key)
        : !isInDirectEditRange(cell, directEditRanges)
    )
      continue;

    const address = toA1(cell.position.row, cell.position.col);
    changes.push({
      structural: {
        kind: 'metadata',
        changeId: `mutation-${sequence}:cell:${changes.length}`,
        domain: 'cell',
        entityId: `${cell.sheetId}!${address}`,
        propertyPath: ['value'],
      },
      before: {
        kind: 'value',
        value: semanticCellEditValue(cell.oldFormula, cell.oldValue),
      },
      after: {
        kind: 'value',
        value: semanticCellEditValue(cell.newFormula, cell.value),
      },
      display: {
        address: { kind: 'value', value: address },
      },
    });
  }
  return changes;
}

function mapSheetRenameChanges(
  sheetChanges: readonly SheetChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of sheetChanges) {
    if (
      change.field !== 'name' ||
      typeof change.oldName !== 'string' ||
      typeof change.name !== 'string'
    ) {
      continue;
    }
    changes.push({
      structural: {
        kind: 'metadata',
        changeId: `mutation-${sequence}:sheet:${changes.length}`,
        domain: 'sheet',
        entityId: change.sheetId,
        propertyPath: ['name'],
      },
      before: { kind: 'value', value: change.oldName },
      after: { kind: 'value', value: change.name },
      display: {
        entityLabel: { kind: 'value', value: change.name },
      },
    });
  }
  return changes;
}

function mapSheetTabColorChanges(
  sheetChanges: readonly SheetChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of sheetChanges) {
    if (change.field !== 'tabColor') continue;
    if (change.oldColor === undefined && change.color === undefined) continue;
    changes.push({
      structural: {
        kind: 'metadata',
        changeId: `mutation-${sequence}:sheet:${changes.length}`,
        domain: 'sheet',
        entityId: change.sheetId,
        propertyPath: ['tabColor'],
      },
      before: { kind: 'value', value: change.oldColor ?? null },
      after: { kind: 'value', value: change.color ?? null },
    });
  }
  return changes;
}

function mapSheetCreateChanges(
  sheetChanges: readonly SheetChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of sheetChanges) {
    if (
      change.field !== 'sheet' ||
      change.kind !== 'Set' ||
      !isStableSheetId(change.sheetId) ||
      typeof change.name !== 'string' ||
      !isSheetIndex(change.index) ||
      change.sourceSheetId !== undefined
    ) {
      continue;
    }
    changes.push({
      structural: {
        kind: 'metadata',
        changeId: `mutation-${sequence}:sheet:${changes.length}`,
        domain: 'sheet',
        entityId: change.sheetId,
        propertyPath: ['sheet'],
      },
      before: { kind: 'value', value: null },
      after: {
        kind: 'value',
        value: semanticSheetValue({ name: change.name, index: change.index }),
      },
      display: {
        entityLabel: { kind: 'value', value: change.name },
      },
    });
  }
  return changes;
}

function mapSheetRemoveChanges(
  sheetChanges: readonly SheetChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of sheetChanges) {
    if (
      change.field !== 'sheet' ||
      change.kind !== 'Removed' ||
      !isStableSheetId(change.sheetId) ||
      typeof change.name !== 'string'
    ) {
      continue;
    }
    changes.push({
      structural: {
        kind: 'metadata',
        changeId: `mutation-${sequence}:sheet:${changes.length}`,
        domain: 'sheet',
        entityId: change.sheetId,
        propertyPath: ['sheet'],
      },
      before: {
        kind: 'value',
        value: semanticSheetValue({ name: change.name }),
      },
      after: { kind: 'value', value: null },
      display: {
        entityLabel: { kind: 'value', value: change.name },
      },
    });
  }
  return changes;
}

function mapSheetCopyChanges(
  sheetChanges: readonly SheetChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of sheetChanges) {
    if (
      change.field !== 'sheet' ||
      change.kind !== 'Set' ||
      !isStableSheetId(change.sheetId) ||
      typeof change.name !== 'string' ||
      !isSheetIndex(change.index) ||
      !isStableSheetId(change.sourceSheetId)
    ) {
      continue;
    }
    changes.push({
      structural: {
        kind: 'metadata',
        changeId: `mutation-${sequence}:sheet:${changes.length}`,
        domain: 'sheet',
        entityId: change.sheetId,
        propertyPath: ['sheet'],
      },
      before: { kind: 'value', value: null },
      after: {
        kind: 'value',
        value: semanticSheetValue({
          name: change.name,
          index: change.index,
          sourceSheetId: change.sourceSheetId,
        }),
      },
      display: {
        entityLabel: { kind: 'value', value: change.name },
      },
    });
  }
  return changes;
}

function mapSheetMoveChanges(
  sheetChanges: readonly SheetChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of sheetChanges) {
    if (
      change.field !== 'order' ||
      change.kind !== 'Set' ||
      !isStableSheetId(change.sheetId) ||
      !isSheetIndex(change.oldIndex) ||
      !isSheetIndex(change.index)
    ) {
      continue;
    }
    changes.push({
      structural: {
        kind: 'metadata',
        changeId: `mutation-${sequence}:sheet:${changes.length}`,
        domain: 'sheet',
        entityId: change.sheetId,
        propertyPath: ['order'],
      },
      before: { kind: 'value', value: change.oldIndex },
      after: { kind: 'value', value: change.index },
    });
  }
  return changes;
}

function mapStructureChanges(
  structureChanges: readonly StructureChangeResult[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of structureChanges) {
    if (!isStableSheetId(change.sheetId) || !isSheetIndex(change.at) || change.count <= 0) {
      continue;
    }

    const axis = structureChangeAxis(change.changeType);
    const removed = structureChangeRemoved(change.changeType);
    if (!axis || removed === undefined) continue;

    for (let offset = 0; offset < change.count; offset += 1) {
      const index = change.at + offset;
      const displayRef = structureDisplayRef(axis, index);
      changes.push(
        metadataChange({
          sequence,
          prefix: axis,
          index: changes.length,
          domain: 'rows-columns',
          entityId: `${change.sheetId}!${axis}:${index}`,
          propertyPath: ['order'],
          value: semanticObjectValue([
            { key: 'axis', value: axis },
            { key: 'sheetId', value: change.sheetId },
            { key: 'index', value: index },
            { key: 'displayRef', value: displayRef },
          ]),
          removed,
          display: { address: { kind: 'value', value: displayRef } },
        }),
      );
    }
  }
  return changes;
}

function structureChangeAxis(
  changeType: StructureChangeResult['changeType'],
): 'row' | 'column' | null {
  switch (changeType) {
    case 'insertRows':
    case 'deleteRows':
      return 'row';
    case 'insertCols':
    case 'deleteCols':
      return 'column';
    default:
      return null;
  }
}

function structureChangeRemoved(
  changeType: StructureChangeResult['changeType'],
): boolean | undefined {
  switch (changeType) {
    case 'deleteRows':
    case 'deleteCols':
      return true;
    case 'insertRows':
    case 'insertCols':
      return false;
    default:
      return undefined;
  }
}

function structureDisplayRef(axis: 'row' | 'column', index: number): string {
  if (axis === 'row') {
    const rowLabel = String(index + 1);
    return `${rowLabel}:${rowLabel}`;
  }
  const columnLabel = toA1(0, index).replace(/\d+$/, '');
  return `${columnLabel}:${columnLabel}`;
}

function mapFilterChanges(
  filterChanges: readonly FilterChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of filterChanges) {
    if (!isStableSheetId(change.sheetId)) continue;

    const entityId = filterEntityId(change);
    const value = semanticFilterValue(change);
    changes.push({
      structural: {
        kind: 'metadata',
        changeId: `mutation-${sequence}:filter:${changes.length}`,
        domain: 'filters',
        entityId,
        propertyPath: ['state'],
      },
      before: { kind: 'value', value: change.kind === 'Removed' ? value : null },
      after: { kind: 'value', value: change.kind === 'Removed' ? null : value },
      display: {
        entityLabel: { kind: 'value', value: entityId },
      },
    });
  }
  return changes;
}

function mapSortingChanges(
  sortingChanges: readonly SortingChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of sortingChanges) {
    if (
      !isStableSheetId(change.sheetId) ||
      !isSheetIndex(change.startRow) ||
      !isSheetIndex(change.startCol) ||
      !isSheetIndex(change.endRow) ||
      !isSheetIndex(change.endCol) ||
      change.endRow < change.startRow ||
      change.endCol < change.startCol
    ) {
      continue;
    }

    const rangeLabel = `${toA1(change.startRow, change.startCol)}:${toA1(change.endRow, change.endCol)}`;
    const entityId = `${change.sheetId}!${rangeLabel}`;
    const value = semanticObjectValue([
      { key: 'kind', value: change.kind },
      { key: 'range', value: rangeLabel },
      { key: 'rowsMoved', value: change.rowsMoved },
    ]);
    changes.push({
      structural: {
        kind: 'metadata',
        changeId: `mutation-${sequence}:sort:${changes.length}`,
        domain: 'sorts',
        entityId,
        propertyPath: ['order'],
      },
      before: { kind: 'value', value: change.kind === 'Removed' ? value : null },
      after: { kind: 'value', value: change.kind === 'Removed' ? null : value },
      display: {
        address: { kind: 'value', value: rangeLabel },
      },
    });
  }
  return changes;
}

function mapNamedRangeChanges(
  namedRangeChanges: readonly NamedRangeChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of namedRangeChanges) {
    if (!isLikelyDefinedName(change.name)) continue;
    const value = semanticObjectValue([
      { key: 'kind', value: change.kind },
      { key: 'name', value: change.name },
    ]);
    changes.push(
      metadataChange({
        sequence,
        prefix: 'named-range',
        index: changes.length,
        domain: 'named-ranges',
        entityId: `name:${change.name}`,
        propertyPath: ['definition'],
        value,
        removed: change.kind === 'Removed',
        display: { entityLabel: { kind: 'value', value: change.name } },
      }),
    );
  }
  return changes;
}

function mapTableChanges(
  tableChanges: readonly TableChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of tableChanges) {
    if (!isStableSheetId(change.sheetId) || !isStableString(change.tableId)) continue;

    const entityId = `${change.sheetId}!table:${change.tableId}`;
    const label = isStableString(change.name) ? change.name : entityId;
    const value = semanticObjectValue([
      { key: 'kind', value: change.kind },
      { key: 'tableId', value: change.tableId },
      ...(isStableString(change.name) ? [{ key: 'name', value: change.name }] : []),
      { key: 'sheetId', value: change.sheetId },
    ]);
    changes.push(
      metadataChange({
        sequence,
        prefix: 'table',
        index: changes.length,
        domain: 'tables',
        entityId,
        propertyPath: ['definition'],
        value,
        removed: change.kind === 'Removed',
        display: { entityLabel: { kind: 'value', value: label } },
      }),
    );
  }
  return changes;
}

function mapCommentChanges(
  commentChanges: readonly CommentChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of commentChanges) {
    if (!isStableSheetId(change.sheetId) || !isStableString(change.cellId)) continue;

    const address = change.position ? toA1(change.position.row, change.position.col) : undefined;
    const value = semanticObjectValue([
      { key: 'kind', value: change.kind },
      { key: 'cellId', value: change.cellId },
      ...(address ? [{ key: 'address', value: address }] : []),
    ]);
    changes.push(
      metadataChange({
        sequence,
        prefix: 'comment',
        index: changes.length,
        domain: 'comments-notes',
        entityId: `${change.sheetId}!comment:${change.cellId}`,
        propertyPath: ['cell'],
        value,
        removed: change.kind === 'Removed',
        ...(address ? { display: { address: { kind: 'value', value: address } } } : {}),
      }),
    );
  }
  return changes;
}

function mapCfChanges(
  cfChanges: readonly CfChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of cfChanges) {
    if (!isStableSheetId(change.sheetId) || !isStableString(change.ruleId)) continue;
    const value = semanticObjectValue([
      { key: 'kind', value: change.kind },
      { key: 'ruleId', value: change.ruleId },
    ]);
    changes.push(
      metadataChange({
        sequence,
        prefix: 'conditional-format',
        index: changes.length,
        domain: 'conditional-formatting',
        entityId: `${change.sheetId}!cf:${change.ruleId}`,
        propertyPath: ['rule'],
        value,
        removed: change.kind === 'Removed',
        display: { entityLabel: { kind: 'value', value: change.ruleId } },
      }),
    );
  }
  return changes;
}

function mapFloatingObjectChanges(
  floatingObjectChanges: readonly FloatingObjectChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of floatingObjectChanges) {
    if (!isStableSheetId(change.sheetId) || !isStableString(change.objectId)) continue;

    const chartValue = semanticChartSourceValue(change);
    if (chartValue) {
      changes.push(
        metadataChange({
          sequence,
          prefix: 'chart',
          index: changes.length,
          domain: 'charts.source-range',
          entityId: `${change.sheetId}!chart:${change.objectId}`,
          propertyPath: ['sourceRange'],
          value: chartValue,
          removed: change.kind.type === 'removed',
          display: { entityLabel: { kind: 'value', value: change.objectId } },
        }),
      );
      continue;
    }

    const objectValue = semanticFloatingObjectAnchorValue(change);
    if (!objectValue) continue;
    changes.push(
      metadataChange({
        sequence,
        prefix: 'floating-object',
        index: changes.length,
        domain: 'floating-objects.anchors',
        entityId: `${change.sheetId}!object:${change.objectId}`,
        propertyPath: ['anchor'],
        value: objectValue,
        removed: change.kind.type === 'removed',
        display: { entityLabel: { kind: 'value', value: change.objectId } },
      }),
    );
  }
  return changes;
}

function mapRangeChanges(
  rangeChanges: readonly RangeChange[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of rangeChanges) {
    if (!isStableSheetId(change.sheetId) || !isStableString(change.rangeId)) continue;

    const meta = decodeRangeChangeMeta(change.data);
    if (!meta || meta.rangeId !== change.rangeId) continue;

    const domain = semanticRangeDomain(meta.kind);
    if (!domain) continue;

    const value = semanticRangeValue(change, meta);
    changes.push(
      metadataChange({
        sequence,
        prefix: 'range',
        index: changes.length,
        domain,
        entityId: `${change.sheetId}!range:${change.rangeId}`,
        propertyPath: ['range'],
        value,
        removed: change.kind === 'Removed',
        display: { entityLabel: { kind: 'value', value: `${meta.kind}:${change.rangeId}` } },
      }),
    );
  }
  return changes;
}

export function mutationSegmentPayload(record: PendingSemanticMutation): unknown {
  return {
    schemaVersion: 1,
    segmentId: `mutation-${record.sequence}`,
    operation: record.operation,
    capturedAt: record.capturedAt,
    changeIds: record.changes.map((change) => change.structural.changeId),
    directEdits: record.directEdits.map((edit) => ({
      sheetId: edit.sheetId,
      row: edit.row,
      col: edit.col,
      address: toA1(edit.row, edit.col),
    })),
    ...(record.directEditRanges.length === 0
      ? {}
      : {
          directEditRanges: record.directEditRanges.map((range) => ({
            ...range,
            address: `${toA1(range.startRow, range.startCol)}:${toA1(range.endRow, range.endCol)}`,
          })),
        }),
    ...(record.operationContext ? { operationContext: record.operationContext } : {}),
  };
}

export function authorForRecords(
  records: readonly PendingSemanticMutation[],
  fallback: VersionAuthor,
): VersionAuthor {
  return records.find((record) => record.operationContext)?.operationContext?.author ?? fallback;
}
