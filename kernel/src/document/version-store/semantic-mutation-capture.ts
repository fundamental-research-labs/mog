import type { VersionAuthor, VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type {
  MutationResult,
  SemanticWorkbookStateEnvelope,
} from '../../bridges/compute/compute-types.gen';
import type { DirectEditPosition, DirectEditRange } from '../../bridges/compute/mutation-admission';
import type {
  VersionNormalCommitCapture,
  VersionNormalCommitCaptureFinalizeResult,
} from './commit-service';
import { createVersionObjectRecord, type VersionGraphNamespace } from './object-store';
import {
  capturePendingRemoteSemanticMutations,
  type VersionPendingRemoteCapture,
} from './pending-remote-capture-service';
import {
  normalCommitSemanticMutationAdmissionFailure,
  type PendingUncapturedNormalMutation,
} from './semantic-mutation-capture-admission';
import {
  classifySemanticMutationCaptureLane,
  isUncapturedNormalDirtyMutation,
} from './semantic-mutation-capture-lanes';
import {
  authorForRecords,
  isDirectCellValueOperation,
  mapMutationResultToSemanticChanges,
  mutationSegmentPayload,
  type PendingSemanticMutation,
} from './semantic-mutation-capture-projection';
import { buildRustBackedSemanticChangeSetPayload } from './semantic-mutation-rust-diff-capture';
import type { VersionSemanticStateReaderPort } from './semantic-state-reader';

export interface VersionMutationCaptureRecordInput {
  readonly operation: string;
  readonly result: MutationResult;
  readonly directEdits?: readonly DirectEditPosition[];
  readonly directEditRanges?: readonly DirectEditRange[];
  readonly operationContext?: VersionOperationContext;
}

export interface VersionMutationCapturePreMutationInput {
  readonly operation: string;
  readonly directEdits?: readonly DirectEditPosition[];
  readonly directEditRanges?: readonly DirectEditRange[];
  readonly operationContext?: VersionOperationContext;
}

export interface VersionMutationCaptureSink {
  recordPreMutation?(input: VersionMutationCapturePreMutationInput): void | Promise<void>;
  recordMutationResult(input: VersionMutationCaptureRecordInput): void;
}

export interface SemanticMutationCaptureServices {
  readonly mutationCapture: VersionMutationCaptureSink;
  readonly captureNormalCommit: VersionNormalCommitCapture;
  readonly capturePendingRemoteSegment: VersionPendingRemoteCapture;
  readNormalCommitCaptureState(): SemanticMutationCaptureNormalState;
  resetNormalCaptureForCheckout(input: VersionMutationCaptureResetInput): void;
}

export interface VersionMutationCaptureResetInput {
  readonly semanticStateReader?: VersionSemanticStateReaderPort;
}

export interface SemanticMutationCaptureOptions {
  readonly author?: VersionAuthor;
  readonly now?: () => Date;
  readonly semanticStateReader?: VersionSemanticStateReaderPort;
  readonly requireOperationContext?: boolean;
}

export interface SemanticMutationCaptureNormalState {
  readonly revision: number;
  readonly pendingCapturedNormalMutationCount: number;
  readonly pendingUncapturedNormalMutationCount: number;
  readonly hasPendingNormalMutations: boolean;
  readonly hasUncapturedNormalMutations: boolean;
}

const DEFAULT_CAPTURE_AUTHOR: VersionAuthor = Object.freeze({
  authorId: 'mog.version-capture',
  actorKind: 'system',
  displayName: 'Mog Version Capture',
});

const UNCAPTURED_ROW_COL_FORMAT_OPERATIONS = new Set([
  'compute_clear_col_format',
  'compute_set_col_format',
  'compute_set_col_format_range',
  'compute_set_col_formats',
  'compute_set_row_format',
  'compute_set_row_formats',
]);

export function createSemanticMutationCapture(
  options: SemanticMutationCaptureOptions = {},
): SemanticMutationCaptureServices {
  const buffer = new SemanticMutationCaptureBuffer(options);
  return {
    mutationCapture: buffer,
    captureNormalCommit: (input) => buffer.captureNormalCommit(input),
    capturePendingRemoteSegment: (input) => buffer.capturePendingRemoteSegment(input),
    readNormalCommitCaptureState: () => buffer.readNormalCommitCaptureState(),
    resetNormalCaptureForCheckout: (input) => buffer.resetNormalCaptureForCheckout(input),
  };
}

class SemanticMutationCaptureBuffer implements VersionMutationCaptureSink {
  private readonly author: VersionAuthor;
  private readonly now: () => Date;
  private readonly requireOperationContext: boolean;
  private semanticStateReader?: VersionSemanticStateReaderPort;
  private nextNormalSequence = 1;
  private nextPendingRemoteSequence = 1;
  private pendingNormal: PendingSemanticMutation[] = [];
  private pendingUncapturedNormal: PendingUncapturedNormalMutation[] = [];
  private pendingRemote: PendingSemanticMutation[] = [];
  private normalCaptureRevision = 0;
  private beforeNormalSemanticState?: SemanticWorkbookStateEnvelope;
  private semanticStateCaptureFailure?: string;

  constructor(options: SemanticMutationCaptureOptions) {
    this.author = options.author ?? DEFAULT_CAPTURE_AUTHOR;
    this.now = options.now ?? (() => new Date());
    this.requireOperationContext = options.requireOperationContext ?? false;
    this.semanticStateReader = options.semanticStateReader;
  }

  async recordPreMutation(input: VersionMutationCapturePreMutationInput): Promise<void> {
    if (
      (this.requireOperationContext && !input.operationContext) ||
      !this.semanticStateReader ||
      !shouldCapturePreMutationSemanticState(input) ||
      this.beforeNormalSemanticState ||
      this.pendingNormal.length > 0 ||
      this.pendingUncapturedNormal.length > 0
    ) {
      return;
    }

    try {
      this.beforeNormalSemanticState = await this.semanticStateReader.readCurrentSemanticState();
      this.semanticStateCaptureFailure = undefined;
    } catch (error) {
      this.semanticStateCaptureFailure =
        error instanceof Error ? error.message : 'semantic state read failed';
    }
  }

  recordMutationResult(input: VersionMutationCaptureRecordInput): void {
    if (this.requireOperationContext && !input.operationContext) {
      this.recordUncapturedNormalMutation(input, 'missingOperationContext');
      return;
    }

    const lane = classifySemanticMutationCaptureLane(input.operationContext);
    if (lane === 'skip') {
      if (isUncapturedNormalDirtyMutation(input.operationContext)) {
        this.recordUncapturedNormalMutation(input, 'captureLaneSkipped');
      }
      return;
    }

    const sequence =
      lane === 'normalLocal' ? this.nextNormalSequence : this.nextPendingRemoteSequence;
    const capturedAt = input.operationContext?.createdAt ?? this.now().toISOString();
    const directEdits = input.directEdits ? [...input.directEdits] : [];
    const directEditRanges = input.directEditRanges ? [...input.directEditRanges] : [];
    const changes = mapMutationResultToSemanticChanges(input, sequence);
    if (changes.length === 0) {
      if (shouldDeferEmptySemanticChangeSetToRustDiff(input, lane)) {
        this.pendingNormal.push({
          sequence,
          operation: input.operation,
          capturedAt,
          ...(input.operationContext ? { operationContext: input.operationContext } : {}),
          directEdits,
          directEditRanges,
          changes,
        });
        this.nextNormalSequence++;
        this.bumpNormalCaptureRevision();
        return;
      }
      if (lane === 'normalLocal') {
        this.recordUncapturedNormalMutation(input, 'emptySemanticChangeSet', {
          sequence,
          capturedAt,
        });
      }
      return;
    }

    const record = {
      sequence,
      operation: input.operation,
      capturedAt,
      ...(input.operationContext ? { operationContext: input.operationContext } : {}),
      directEdits,
      directEditRanges,
      changes,
    };

    if (lane === 'normalLocal') {
      this.nextNormalSequence++;
      this.pendingNormal.push(record);
      this.bumpNormalCaptureRevision();
    } else {
      this.nextPendingRemoteSequence++;
      this.pendingRemote.push(record);
    }
  }

  resetNormalCaptureForCheckout(input: VersionMutationCaptureResetInput): void {
    this.nextNormalSequence = 1;
    this.pendingNormal = [];
    this.pendingUncapturedNormal = [];
    this.bumpNormalCaptureRevision();
    this.beforeNormalSemanticState = undefined;
    this.semanticStateCaptureFailure = undefined;
    if (input.semanticStateReader) {
      this.semanticStateReader = input.semanticStateReader;
    }
  }

  async captureNormalCommit(input: Parameters<VersionNormalCommitCapture>[0]) {
    const admissionFailure = normalCommitSemanticMutationAdmissionFailure({
      commit: input,
      pendingUncapturedNormal: this.pendingUncapturedNormal,
    });
    if (admissionFailure) return admissionFailure;

    const records = [...this.pendingNormal];
    const changes = records.flatMap((record) => [...record.changes]);
    const semanticChangeSetPayload = await buildRustBackedSemanticChangeSetPayload({
      commit: input,
      semanticStateReader: this.semanticStateReader,
      beforeSemanticState: this.beforeNormalSemanticState,
      semanticStateCaptureFailure: this.semanticStateCaptureFailure,
      reviewChanges: changes,
    });
    if (semanticChangeSetPayload.status !== 'success') return semanticChangeSetPayload;
    const semanticChangeSetRecord = await objectRecord(
      input.namespace,
      'workbook.semanticChangeSet.v1',
      semanticChangeSetPayload.payload,
    );
    const mutationSegmentRecords = await Promise.all(
      records.map((record) =>
        objectRecord(
          input.namespace,
          'workbook.mutationSegment.v1',
          mutationSegmentPayload(record),
        ),
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
          this.drainNormalThrough(lastSequence);
        }
      },
    };
  }

  async capturePendingRemoteSegment(input: Parameters<VersionPendingRemoteCapture>[0]) {
    const result = await capturePendingRemoteSemanticMutations({
      capture: input,
      records: [...this.pendingRemote],
      mutationSegmentPayload,
    });
    if (result.status === 'success' && result.capturedRecordSequences.length > 0) {
      this.drainPendingRemoteSequences(result.capturedRecordSequences);
    }
    return result;
  }

  snapshotPendingRemoteMutations(): readonly PendingSemanticMutation[] {
    return [...this.pendingRemote];
  }

  readNormalCommitCaptureState(): SemanticMutationCaptureNormalState {
    const pendingCapturedNormalMutationCount = this.pendingNormal.length;
    const pendingUncapturedNormalMutationCount = this.pendingUncapturedNormal.length;
    return {
      revision: this.normalCaptureRevision,
      pendingCapturedNormalMutationCount,
      pendingUncapturedNormalMutationCount,
      hasPendingNormalMutations:
        pendingCapturedNormalMutationCount > 0 || pendingUncapturedNormalMutationCount > 0,
      hasUncapturedNormalMutations: pendingUncapturedNormalMutationCount > 0,
    };
  }

  private recordUncapturedNormalMutation(
    input: VersionMutationCaptureRecordInput,
    reason: PendingUncapturedNormalMutation['reason'],
    options: { readonly sequence?: number; readonly capturedAt?: string } = {},
  ): void {
    const sequence = options.sequence ?? this.nextNormalSequence;
    const capturedAt =
      options.capturedAt ?? input.operationContext?.createdAt ?? this.now().toISOString();
    this.nextNormalSequence = Math.max(this.nextNormalSequence, sequence + 1);
    this.pendingUncapturedNormal.push({
      sequence,
      operation: input.operation,
      capturedAt,
      reason,
      ...(input.operationContext ? { operationContext: input.operationContext } : {}),
    });
    this.bumpNormalCaptureRevision();
  }

  private drainNormalThrough(sequence: number): void {
    if (sequence <= 0) return;
    const beforeLength = this.pendingNormal.length;
    this.pendingNormal = this.pendingNormal.filter((record) => record.sequence > sequence);
    if (this.pendingNormal.length !== beforeLength) {
      this.bumpNormalCaptureRevision();
    }
    if (this.pendingNormal.length === 0) {
      this.beforeNormalSemanticState = undefined;
      this.semanticStateCaptureFailure = undefined;
    }
  }

  private drainPendingRemoteSequences(sequences: readonly number[]): void {
    if (sequences.length === 0) return;
    const drained = new Set(sequences);
    this.pendingRemote = this.pendingRemote.filter((record) => !drained.has(record.sequence));
  }

  private bumpNormalCaptureRevision(): void {
    this.normalCaptureRevision += 1;
  }
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

function shouldDeferEmptySemanticChangeSetToRustDiff(
  input: VersionMutationCaptureRecordInput,
  lane: ReturnType<typeof classifySemanticMutationCaptureLane>,
): boolean {
  if (lane !== 'normalLocal') return false;
  if (!isDirectCellValueOperation(input.operation)) return false;
  return hasDirectEditEvidence(input);
}

function shouldCapturePreMutationSemanticState(
  input: VersionMutationCapturePreMutationInput,
): boolean {
  if (classifySemanticMutationCaptureLane(input.operationContext) !== 'normalLocal') return false;

  // Row/column format mutations currently update sparse metadata and viewport
  // patches, but row/column formats are not represented in the semantic
  // workbook state. The receipt is therefore recorded as uncaptured; reading a
  // full semantic preimage cannot make the mutation committable.
  if (UNCAPTURED_ROW_COL_FORMAT_OPERATIONS.has(input.operation)) return false;

  // Empty direct cell write receipts can fall back to a Rust semantic diff only
  // when the caller supplies the edited cells/ranges. Without that evidence the
  // post-mutation recorder marks the write uncaptured, so skip the preimage too.
  if (isDirectCellValueOperation(input.operation)) {
    return hasDirectEditEvidence(input);
  }

  return true;
}

function hasDirectEditEvidence(input: {
  readonly directEdits?: readonly DirectEditPosition[];
  readonly directEditRanges?: readonly DirectEditRange[];
}): boolean {
  return (input.directEdits?.length ?? 0) > 0 || (input.directEditRanges?.length ?? 0) > 0;
}
