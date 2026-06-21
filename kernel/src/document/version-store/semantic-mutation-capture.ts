import type { VersionSemanticValue } from '@mog-sdk/contracts/api';
import type { VersionAuthor, VersionOperationContext } from '@mog-sdk/contracts/versioning';
import { toA1 } from '@mog/spreadsheet-utils/a1';

import type {
  CellChange,
  MutationResult,
  SheetChange,
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
  if (isDirectCellValueOperation(input.operation)) {
    return mapCellWriteChanges(input.result.recalc?.changedCells ?? [], input.directEdits ?? [], sequence);
  }
  if (input.operation === 'compute_rename_compute_sheet') {
    return mapSheetRenameChanges(input.result.sheetChanges ?? [], sequence);
  }
  return [];
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
