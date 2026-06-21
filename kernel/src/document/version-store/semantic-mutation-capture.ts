import type { VersionSemanticValue } from '@mog-sdk/contracts/api';
import type { VersionAuthor, VersionOperationContext } from '@mog-sdk/contracts/versioning';
import { toA1 } from '@mog/spreadsheet-utils/a1';

import type {
  CellChange,
  FilterChange,
  MutationResult,
  SheetChange,
  SortingChange,
} from '../../bridges/compute/compute-types.gen';
import type { DirectEditPosition } from '../../bridges/compute/mutation-admission';
import type {
  VersionNormalCommitCapture,
  VersionNormalCommitCaptureFinalizeResult,
} from './commit-service';
import { createVersionObjectRecord, type VersionGraphNamespace } from './object-store';

export interface VersionMutationCaptureRecordInput {
  readonly operation: string;
  readonly result: MutationResult;
  readonly directEdits?: readonly DirectEditPosition[];
  readonly operationContext?: VersionOperationContext;
}

export interface VersionMutationCaptureSink {
  recordMutationResult(input: VersionMutationCaptureRecordInput): void;
}

export interface SemanticMutationCaptureServices {
  readonly mutationCapture: VersionMutationCaptureSink;
  readonly captureNormalCommit: VersionNormalCommitCapture;
}

export interface SemanticMutationCaptureOptions {
  readonly author?: VersionAuthor;
  readonly now?: () => Date;
}

type VersionSemanticChangeRecord = {
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

type PendingSemanticMutation = {
  readonly sequence: number;
  readonly operation: string;
  readonly capturedAt: string;
  readonly operationContext?: VersionOperationContext;
  readonly directEdits: readonly DirectEditPosition[];
  readonly changes: readonly VersionSemanticChangeRecord[];
};

const DEFAULT_CAPTURE_AUTHOR: VersionAuthor = Object.freeze({
  authorId: 'mog.version-capture',
  actorKind: 'system',
  displayName: 'Mog Version Capture',
});

export function createSemanticMutationCapture(
  options: SemanticMutationCaptureOptions = {},
): SemanticMutationCaptureServices {
  const buffer = new SemanticMutationCaptureBuffer(options);
  return {
    mutationCapture: buffer,
    captureNormalCommit: (input) => buffer.captureNormalCommit(input),
  };
}

class SemanticMutationCaptureBuffer implements VersionMutationCaptureSink {
  private readonly author: VersionAuthor;
  private readonly now: () => Date;
  private nextSequence = 1;
  private pending: PendingSemanticMutation[] = [];

  constructor(options: SemanticMutationCaptureOptions) {
    this.author = options.author ?? DEFAULT_CAPTURE_AUTHOR;
    this.now = options.now ?? (() => new Date());
  }

  recordMutationResult(input: VersionMutationCaptureRecordInput): void {
    if (!shouldCaptureOperation(input.operationContext)) return;

    const sequence = this.nextSequence;
    const capturedAt = input.operationContext?.createdAt ?? this.now().toISOString();
    const directEdits = input.directEdits ? [...input.directEdits] : [];
    const changes = mapMutationResultToSemanticChanges(input, sequence);
    if (changes.length === 0) return;
    this.nextSequence++;

    this.pending.push({
      sequence,
      operation: input.operation,
      capturedAt,
      ...(input.operationContext ? { operationContext: input.operationContext } : {}),
      directEdits,
      changes,
    });
  }

  async captureNormalCommit(input: Parameters<VersionNormalCommitCapture>[0]) {
    const records = [...this.pending];
    const changes = records.flatMap((record) => [...record.changes]);
    const semanticChangeSetRecord = await objectRecord(input.namespace, 'workbook.semanticChangeSet.v1', {
      schemaVersion: 1,
      changes,
    });
    const mutationSegmentRecords = await Promise.all(
      records.map((record) =>
        objectRecord(input.namespace, 'workbook.mutationSegment.v1', mutationSegmentPayload(record)),
      ),
    );
    const lastSequence = records.at(-1)?.sequence ?? 0;

    return {
      status: 'success' as const,
      input: {
        semanticChangeSetRecord,
        mutationSegmentRecords,
        author: authorForRecords(records, this.author),
        createdAt: this.now().toISOString(),
      },
      finalize: (result: VersionNormalCommitCaptureFinalizeResult) => {
        if (result.status === 'success') {
          this.drainThrough(lastSequence);
        }
      },
    };
  }

  private drainThrough(sequence: number): void {
    if (sequence <= 0) return;
    this.pending = this.pending.filter((record) => record.sequence > sequence);
  }
}

function shouldCaptureOperation(context: VersionOperationContext | undefined): boolean {
  if (!context) return true;
  return context.capturePolicy === 'commitEligible' && context.writeAdmissionMode === 'capture';
}

function mapMutationResultToSemanticChanges(
  input: VersionMutationCaptureRecordInput,
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  if (isDirectCellValueOperation(input.operation)) {
    changes.push(
      ...mapCellWriteChanges(input.result.recalc?.changedCells ?? [], input.directEdits ?? [], sequence),
    );
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
  changes.push(...mapFilterChanges(input.result.filterChanges ?? [], sequence));
  changes.push(...mapSortingChanges(input.result.sortingChanges ?? [], sequence));
  return changes;
}

function isDirectCellValueOperation(operation: string): boolean {
  return (
    operation === 'compute_batch_set_cells_by_position' ||
    operation === 'compute_set_date_value' ||
    operation === 'compute_set_time_value'
  );
}

function mapCellWriteChanges(
  changedCells: readonly CellChange[],
  directEdits: readonly DirectEditPosition[],
  sequence: number,
): readonly VersionSemanticChangeRecord[] {
  const directEditKeys = new Set(directEdits.map((edit) => directEditKey(edit)));
  if (directEditKeys.size === 0) return [];

  const changes: VersionSemanticChangeRecord[] = [];
  for (const cell of changedCells) {
    if (!cell.position) continue;
    const key = directEditKey({
      sheetId: cell.sheetId,
      row: cell.position.row,
      col: cell.position.col,
    });
    if (!directEditKeys.has(key)) continue;

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

function semanticSheetValue(input: {
  readonly name: string;
  readonly index?: number;
  readonly sourceSheetId?: string;
}): VersionSemanticValue {
  const fields: { key: string; value: VersionSemanticValue }[] = [{ key: 'name', value: input.name }];
  if (input.index !== undefined) {
    fields.push({ key: 'index', value: input.index });
  }
  if (input.sourceSheetId !== undefined) {
    fields.push({ key: 'sourceSheetId', value: input.sourceSheetId });
  }
  return semanticObjectValue(fields);
}

function semanticFilterValue(change: FilterChange): VersionSemanticValue {
  const fields: { key: string; value: VersionSemanticValue }[] = [
    { key: 'kind', value: change.kind },
  ];
  pushOptionalSemanticField(fields, 'filterId', change.filterId);
  pushOptionalSemanticField(fields, 'filterKind', change.filterKind);
  pushOptionalSemanticField(fields, 'tableId', change.tableId);
  pushOptionalSemanticField(fields, 'capability', change.capability);
  pushOptionalSemanticField(fields, 'hasActiveFilter', change.hasActiveFilter);
  pushOptionalSemanticField(fields, 'clearable', change.clearable);
  pushOptionalSemanticField(fields, 'action', change.action);
  pushOptionalSemanticField(fields, 'hiddenRowCount', change.hiddenRowCount);
  pushOptionalSemanticField(fields, 'visibleRowCount', change.visibleRowCount);
  if (change.unsupportedReasons?.length) {
    fields.push({ key: 'unsupportedReasons', value: { kind: 'array', values: change.unsupportedReasons } });
  }
  return semanticObjectValue(fields);
}

function filterEntityId(change: FilterChange): string {
  if (typeof change.filterId === 'string' && change.filterId.length > 0) {
    return `${change.sheetId}!filter:${change.filterId}`;
  }
  if (typeof change.tableId === 'string' && change.tableId.length > 0) {
    return `${change.sheetId}!table:${change.tableId}:filter`;
  }
  return `${change.sheetId}!autoFilter`;
}

function pushOptionalSemanticField(
  fields: { key: string; value: VersionSemanticValue }[],
  key: string,
  value: string | number | boolean | undefined,
): void {
  if (value !== undefined) {
    fields.push({ key, value });
  }
}

function semanticObjectValue(
  fields: readonly { key: string; value: VersionSemanticValue }[],
): VersionSemanticValue {
  return { kind: 'object', fields };
}

function isStableSheetId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isSheetIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function semanticCellEditValue(
  formula: string | undefined,
  value: CellChange['value'] | CellChange['oldValue'] | undefined,
): VersionSemanticValue {
  const result = semanticCellValue(value);
  return formula ? { kind: 'formula', formula, result } : result;
}

function semanticCellValue(value: CellChange['value'] | CellChange['oldValue'] | undefined): VersionSemanticValue {
  if (value === undefined) return { kind: 'blank' };
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : { kind: 'blank' };
  if (isCellError(value)) {
    return {
      kind: 'error',
      code: value.value,
      ...(typeof value.message === 'string' ? { message: value.message } : {}),
    };
  }
  return { kind: 'blank' };
}

function isCellError(value: unknown): value is { readonly value: string; readonly message?: string } {
  return (
    typeof value === 'object' &&
    value !== null &&
    'type' in value &&
    value.type === 'error' &&
    'value' in value &&
    typeof value.value === 'string'
  );
}

function directEditKey(edit: DirectEditPosition): string {
  return `${edit.sheetId}\u0000${edit.row}\u0000${edit.col}`;
}

function mutationSegmentPayload(record: PendingSemanticMutation): unknown {
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
    ...(record.operationContext ? { operationContext: record.operationContext } : {}),
  };
}

function authorForRecords(
  records: readonly PendingSemanticMutation[],
  fallback: VersionAuthor,
): VersionAuthor {
  return records.find((record) => record.operationContext)?.operationContext?.author ?? fallback;
}

function objectRecord(
  namespace: VersionGraphNamespace,
  objectType: 'workbook.semanticChangeSet.v1' | 'workbook.mutationSegment.v1',
  payload: unknown,
) {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}
