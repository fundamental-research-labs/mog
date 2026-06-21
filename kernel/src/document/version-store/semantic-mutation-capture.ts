import type { VersionSemanticValue } from '@mog-sdk/contracts/api';
import type { VersionAuthor, VersionOperationContext } from '@mog-sdk/contracts/versioning';
import { toA1 } from '@mog/spreadsheet-utils/a1';

import type {
  CellChange,
  CfChange,
  CommentChange,
  FilterChange,
  FloatingObjectAnchor,
  FloatingObjectBounds,
  FloatingObjectChange,
  MutationResult,
  NamedRangeChange,
  RangeChange,
  SheetChange,
  SortingChange,
  TableChange,
} from '../../bridges/compute/compute-types.gen';
import type { DirectEditPosition } from '../../bridges/compute/mutation-admission';
import { decodeRangeMetaJson, type RangeMeta } from '../../bridges/wire/range-metadata-cache';
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

type SemanticField = { key: string; value: VersionSemanticValue };
type SemanticDisplay = VersionSemanticChangeRecord['display'];

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

const rangeMetaDecoder = new TextDecoder();
const FLOATING_OBJECT_ANCHOR_FIELDS = ['anchorRow', 'anchorCol', 'anchorRowOffsetEmu', 'anchorColOffsetEmu', 'anchorMode', 'absoluteXEmu', 'absoluteYEmu', 'endRow', 'endCol', 'endRowOffsetEmu', 'endColOffsetEmu', 'extentCxEmu', 'extentCyEmu'] as const;
const FLOATING_OBJECT_BOUNDS_FIELDS = ['x', 'y', 'width', 'height', 'rotation'] as const;
const FLOATING_OBJECT_ANCHOR_CHANGE_FIELDS = new Set<string>(['anchor', 'width', 'height', 'bounds', ...FLOATING_OBJECT_ANCHOR_FIELDS]);
const RANGE_KIND_DOMAINS: Partial<Record<RangeMeta['kind'], string>> = {
  NamedRange: 'named-ranges',
  Table: 'tables',
  CondFormat: 'conditional-formatting',
  Validation: 'data-validation',
  PrintArea: 'print-areas',
  Protection: 'protected-ranges',
};

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
  changes.push(...mapNamedRangeChanges(input.result.namedRangeChanges ?? [], sequence));
  changes.push(...mapTableChanges(input.result.tableChanges ?? [], sequence));
  changes.push(...mapCommentChanges(input.result.commentChanges ?? [], sequence));
  changes.push(...mapCfChanges(input.result.cfChanges ?? [], sequence));
  changes.push(...mapFilterChanges(input.result.filterChanges ?? [], sequence));
  changes.push(...mapSortingChanges(input.result.sortingChanges ?? [], sequence));
  changes.push(...mapFloatingObjectChanges(input.result.floatingObjectChanges ?? [], sequence));
  changes.push(...mapRangeChanges(input.result.rangeChanges ?? [], sequence));
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

function mapNamedRangeChanges(namedRangeChanges: readonly NamedRangeChange[], sequence: number): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of namedRangeChanges) {
    if (!isLikelyDefinedName(change.name)) continue;
    const value = semanticObjectValue([
      { key: 'kind', value: change.kind },
      { key: 'name', value: change.name },
    ]);
    changes.push(metadataChange({ sequence, prefix: 'named-range', index: changes.length, domain: 'named-ranges', entityId: `name:${change.name}`, propertyPath: ['definition'], value, removed: change.kind === 'Removed', display: { entityLabel: { kind: 'value', value: change.name } } }));
  }
  return changes;
}

function mapTableChanges(tableChanges: readonly TableChange[], sequence: number): readonly VersionSemanticChangeRecord[] {
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
    changes.push(metadataChange({ sequence, prefix: 'table', index: changes.length, domain: 'tables', entityId, propertyPath: ['definition'], value, removed: change.kind === 'Removed', display: { entityLabel: { kind: 'value', value: label } } }));
  }
  return changes;
}

function mapCommentChanges(commentChanges: readonly CommentChange[], sequence: number): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of commentChanges) {
    if (!isStableSheetId(change.sheetId) || !isStableString(change.cellId)) continue;

    const address = change.position ? toA1(change.position.row, change.position.col) : undefined;
    const value = semanticObjectValue([
      { key: 'kind', value: change.kind },
      { key: 'cellId', value: change.cellId },
      ...(address ? [{ key: 'address', value: address }] : []),
    ]);
    changes.push(metadataChange({ sequence, prefix: 'comment', index: changes.length, domain: 'comments-notes', entityId: `${change.sheetId}!comment:${change.cellId}`, propertyPath: ['cell'], value, removed: change.kind === 'Removed', ...(address ? { display: { address: { kind: 'value', value: address } } } : {}) }));
  }
  return changes;
}

function mapCfChanges(cfChanges: readonly CfChange[], sequence: number): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of cfChanges) {
    if (!isStableSheetId(change.sheetId) || !isStableString(change.ruleId)) continue;
    const value = semanticObjectValue([
      { key: 'kind', value: change.kind },
      { key: 'ruleId', value: change.ruleId },
    ]);
    changes.push(metadataChange({ sequence, prefix: 'conditional-format', index: changes.length, domain: 'conditional-formatting', entityId: `${change.sheetId}!cf:${change.ruleId}`, propertyPath: ['rule'], value, removed: change.kind === 'Removed', display: { entityLabel: { kind: 'value', value: change.ruleId } } }));
  }
  return changes;
}

function mapFloatingObjectChanges(floatingObjectChanges: readonly FloatingObjectChange[], sequence: number): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of floatingObjectChanges) {
    if (!isStableSheetId(change.sheetId) || !isStableString(change.objectId)) continue;

    const chartValue = semanticChartSourceValue(change);
    if (chartValue) {
      changes.push(metadataChange({ sequence, prefix: 'chart', index: changes.length, domain: 'charts.source-range', entityId: `${change.sheetId}!chart:${change.objectId}`, propertyPath: ['sourceRange'], value: chartValue, removed: change.kind.type === 'removed', display: { entityLabel: { kind: 'value', value: change.objectId } } }));
      continue;
    }

    const objectValue = semanticFloatingObjectAnchorValue(change);
    if (!objectValue) continue;
    changes.push(metadataChange({ sequence, prefix: 'floating-object', index: changes.length, domain: 'floating-objects.anchors', entityId: `${change.sheetId}!object:${change.objectId}`, propertyPath: ['anchor'], value: objectValue, removed: change.kind.type === 'removed', display: { entityLabel: { kind: 'value', value: change.objectId } } }));
  }
  return changes;
}

function mapRangeChanges(rangeChanges: readonly RangeChange[], sequence: number): readonly VersionSemanticChangeRecord[] {
  const changes: VersionSemanticChangeRecord[] = [];
  for (const change of rangeChanges) {
    if (!isStableSheetId(change.sheetId) || !isStableString(change.rangeId)) continue;

    const meta = decodeRangeChangeMeta(change.data);
    if (!meta || meta.rangeId !== change.rangeId) continue;

    const domain = semanticRangeDomain(meta.kind);
    if (!domain) continue;

    const value = semanticRangeValue(change, meta);
    changes.push(metadataChange({ sequence, prefix: 'range', index: changes.length, domain, entityId: `${change.sheetId}!range:${change.rangeId}`, propertyPath: ['range'], value, removed: change.kind === 'Removed', display: { entityLabel: { kind: 'value', value: `${meta.kind}:${change.rangeId}` } } }));
  }
  return changes;
}

function semanticSheetValue(input: {
  readonly name: string;
  readonly index?: number;
  readonly sourceSheetId?: string;
}): VersionSemanticValue {
  const fields: SemanticField[] = [{ key: 'name', value: input.name }];
  if (input.index !== undefined) {
    fields.push({ key: 'index', value: input.index });
  }
  if (input.sourceSheetId !== undefined) {
    fields.push({ key: 'sourceSheetId', value: input.sourceSheetId });
  }
  return semanticObjectValue(fields);
}

function semanticFilterValue(change: FilterChange): VersionSemanticValue {
  const fields: SemanticField[] = [{ key: 'kind', value: change.kind }];
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

function semanticChartSourceValue(change: FloatingObjectChange): VersionSemanticValue | null {
  const objectType = floatingObjectType(change);
  if (objectType !== 'chart') return null;

  const changedFields = floatingObjectChangedFields(change);
  const data = change.data?.type === 'chart' ? change.data : undefined;
  const hasSourceEvidence =
    isStableString(data?.dataRange) ||
    isStableString(data?.seriesRange) ||
    isStableString(data?.categoryRange) ||
    isStableString(data?.sourceTableId) ||
    changedFields.some(isChartSourceField);
  if (!hasSourceEvidence) return null;

  const fields: SemanticField[] = [
    { key: 'kind', value: change.kind.type },
    { key: 'objectId', value: change.objectId },
    { key: 'objectType', value: objectType },
  ];
  pushStringArraySemanticField(fields, 'changedFields', changedFields);
  pushOptionalSemanticField(fields, 'chartType', data?.chartType);
  pushOptionalSemanticField(fields, 'dataRange', data?.dataRange);
  pushOptionalSemanticField(fields, 'seriesRange', data?.seriesRange);
  pushOptionalSemanticField(fields, 'categoryRange', data?.categoryRange);
  pushOptionalSemanticField(fields, 'sourceTableId', data?.sourceTableId);
  pushOptionalSemanticField(fields, 'tableCategoryColumn', data?.tableCategoryColumn);
  pushStringArraySemanticField(fields, 'tableDataColumns', data?.tableDataColumns ?? []);
  pushStringArraySemanticField(fields, 'tableColumnNames', data?.tableColumnNames ?? []);
  return semanticObjectValue(fields);
}

function semanticFloatingObjectAnchorValue(
  change: FloatingObjectChange,
): VersionSemanticValue | null {
  const changedFields = floatingObjectChangedFields(change);
  const hasAnchorEvidence =
    change.data?.anchor !== undefined ||
    change.bounds !== undefined ||
    changedFields.some(isFloatingObjectAnchorField) ||
    change.kind.type !== 'updated';
  if (!hasAnchorEvidence) return null;

  const fields: SemanticField[] = [
    { key: 'kind', value: change.kind.type },
    { key: 'objectId', value: change.objectId },
  ];
  pushOptionalSemanticField(fields, 'objectType', floatingObjectType(change));
  pushStringArraySemanticField(fields, 'changedFields', changedFields);
  if (change.data?.anchor) {
    fields.push({ key: 'anchor', value: semanticFloatingObjectAnchor(change.data.anchor) });
    pushOptionalSemanticField(fields, 'width', change.data.width);
    pushOptionalSemanticField(fields, 'height', change.data.height);
    pushOptionalSemanticField(fields, 'zIndex', change.data.zIndex);
    pushOptionalSemanticField(fields, 'rotation', change.data.rotation);
  }
  if (change.bounds) {
    fields.push({ key: 'bounds', value: semanticFloatingObjectBounds(change.bounds) });
  }
  return semanticObjectValue(fields);
}

function semanticFloatingObjectAnchor(anchor: FloatingObjectAnchor): VersionSemanticValue {
  const fields: SemanticField[] = [];
  for (const key of FLOATING_OBJECT_ANCHOR_FIELDS) pushOptionalSemanticField(fields, key, anchor[key]);
  return semanticObjectValue(fields);
}

function semanticFloatingObjectBounds(bounds: FloatingObjectBounds): VersionSemanticValue {
  const fields: SemanticField[] = [];
  for (const key of FLOATING_OBJECT_BOUNDS_FIELDS) pushOptionalSemanticField(fields, key, bounds[key]);
  return semanticObjectValue(fields);
}

function semanticRangeValue(change: RangeChange, meta: RangeMeta): VersionSemanticValue {
  const fields: SemanticField[] = [
    { key: 'kind', value: change.kind },
    { key: 'rangeKind', value: meta.kind },
    { key: 'rangeId', value: change.rangeId },
    { key: 'encoding', value: meta.encoding },
    { key: 'rowCount', value: meta.rowIds.length },
    { key: 'colCount', value: meta.colIds.length },
    { key: 'anchor', value: semanticRangeAnchor(meta.anchor) },
  ];
  return semanticObjectValue(fields);
}

function semanticRangeAnchor(anchor: RangeMeta['anchor']): VersionSemanticValue {
  if ('Elastic' in anchor) {
    const elastic = anchor.Elastic;
    return semanticObjectValue([
      { key: 'kind', value: 'Elastic' },
      { key: 'startRow', value: elastic.startRow },
      { key: 'endRow', value: elastic.endRow },
      { key: 'startCol', value: elastic.startCol },
      { key: 'endCol', value: elastic.endCol },
    ]);
  }
  const strict = anchor.Strict;
  const fields: SemanticField[] = [
    { key: 'kind', value: 'Strict' },
    { key: 'rowCount', value: strict.rowIds.length },
    { key: 'colCount', value: strict.colIds.length },
  ];
  pushOptionalSemanticField(fields, 'firstRowId', strict.rowIds[0]);
  pushOptionalSemanticField(fields, 'lastRowId', strict.rowIds.at(-1));
  pushOptionalSemanticField(fields, 'firstColId', strict.colIds[0]);
  pushOptionalSemanticField(fields, 'lastColId', strict.colIds.at(-1));
  return semanticObjectValue(fields);
}

function semanticRangeDomain(kind: RangeMeta['kind']): string | null {
  return RANGE_KIND_DOMAINS[kind] ?? null;
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
  fields: SemanticField[],
  key: string,
  value: string | number | boolean | undefined,
): void {
  if (typeof value === 'number' && !Number.isFinite(value)) return;
  if (value !== undefined) {
    fields.push({ key, value });
  }
}

function pushStringArraySemanticField(
  fields: SemanticField[],
  key: string,
  values: readonly string[],
): void {
  if (values.length === 0) return;
  fields.push({ key, value: { kind: 'array', values } });
}

function semanticObjectValue(
  fields: readonly SemanticField[],
): VersionSemanticValue {
  return { kind: 'object', fields };
}

function metadataChange(input: {
  readonly sequence: number;
  readonly prefix: string;
  readonly index: number;
  readonly domain: string;
  readonly entityId: string;
  readonly propertyPath: readonly string[];
  readonly value: VersionSemanticValue;
  readonly removed: boolean;
  readonly display?: SemanticDisplay;
}): VersionSemanticChangeRecord {
  return {
    structural: {
      kind: 'metadata',
      changeId: `mutation-${input.sequence}:${input.prefix}:${input.index}`,
      domain: input.domain,
      entityId: input.entityId,
      propertyPath: input.propertyPath,
    },
    before: { kind: 'value', value: input.removed ? input.value : null },
    after: { kind: 'value', value: input.removed ? null : input.value },
    ...(input.display ? { display: input.display } : {}),
  };
}

function floatingObjectType(change: FloatingObjectChange): string | undefined {
  return isStableString(change.objectType) ? change.objectType : change.data?.type;
}

function floatingObjectChangedFields(change: FloatingObjectChange): readonly string[] {
  return change.kind.type === 'updated' ? change.kind.changedFields.filter(isStableString) : [];
}

function isChartSourceField(field: string): boolean {
  return (
    field === 'chartConfig' ||
    field === 'dataRange' ||
    field === 'seriesRange' ||
    field === 'categoryRange' ||
    field === 'sourceTableId' ||
    field === 'tableDataColumns' ||
    field === 'tableCategoryColumn'
  );
}

function isFloatingObjectAnchorField(field: string): boolean {
  return FLOATING_OBJECT_ANCHOR_CHANGE_FIELDS.has(field);
}

function decodeRangeChangeMeta(data: RangeChange['data']): RangeMeta | null {
  try {
    const bytes = bytesFromBridge(data as ByteLike);
    return decodeRangeMetaJson(JSON.parse(rangeMetaDecoder.decode(bytes)));
  } catch {
    return null;
  }
}

type ByteLike = Uint8Array | ArrayBuffer | number[] | { type?: string; data?: number[] };

function bytesFromBridge(value: ByteLike): Uint8Array {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (Array.isArray(value)) return Uint8Array.from(value);
  if (isRecord(value) && value.type === 'Buffer' && Array.isArray(value.data)) {
    return Uint8Array.from(value.data);
  }
  throw new TypeError(`Unsupported byte payload shape: ${Object.prototype.toString.call(value)}`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStableSheetId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isStableString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isSheetIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isLikelyDefinedName(value: unknown): value is string {
  if (!isStableString(value)) return false;
  if (value.length > 255) return false;
  if (!/^[A-Za-z_\\][A-Za-z0-9_.]*$/.test(value)) return false;
  if (/^[A-Za-z]{1,3}[0-9]+$/.test(value)) return false;
  if (/^[Rr][0-9]+[Cc][0-9]+$/.test(value)) return false;
  const upper = value.toUpperCase();
  if (upper.startsWith('_XLNM.')) return false;
  return !RESERVED_DEFINED_NAMES.has(upper);
}

const RESERVED_DEFINED_NAMES = new Set<string>([
  'TRUE',
  'FALSE',
  'NULL',
  ...Array.from({ length: 26 }, (_, i) => String.fromCharCode(65 + i)),
  'PRINT_AREA',
  'PRINT_TITLES',
  '_FILTERDATABASE',
]);

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
