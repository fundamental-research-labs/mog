import type { ObjectDigest, VersionObjectType } from './object-digest';
import type {
  PendingRemoteSegmentObjectValidationResult,
  PendingRemoteSegmentReserveResult,
  PendingRemoteSegmentStoreDiagnostic,
  ReservePendingRemoteSegmentInput,
  ReservePersistedPendingRemoteSegmentOptions,
} from './pending-remote-segment-types';
import type { VersionGraphStore } from './provider-graph-store';

export async function reservePersistedPendingRemoteSegment(
  options: ReservePersistedPendingRemoteSegmentOptions,
): Promise<PendingRemoteSegmentReserveResult> {
  const validation = await validatePendingRemoteSegmentObjects(options.graph, options.input);
  if (validation.status !== 'success') {
    return { status: 'failed', record: null, diagnostics: validation.diagnostics };
  }
  return options.store.reserveSegment(options.input);
}

export async function validatePendingRemoteSegmentObjects(
  graph: Pick<VersionGraphStore, 'getObjectRecord'>,
  input: Pick<
    ReservePendingRemoteSegmentInput,
    'mutationSegmentDigest' | 'snapshotRootDigest' | 'semanticChangeSetDigest'
  >,
): Promise<PendingRemoteSegmentObjectValidationResult> {
  const diagnostics: PendingRemoteSegmentStoreDiagnostic[] = [];
  await validatePendingRemoteObject(
    graph,
    'workbook.mutationSegment.v1',
    input.mutationSegmentDigest,
    'mutationSegmentDigest',
    diagnostics,
  );
  if (input.snapshotRootDigest !== undefined) {
    await validatePendingRemoteObject(
      graph,
      'workbook.snapshotRoot.v1',
      input.snapshotRootDigest,
      'snapshotRootDigest',
      diagnostics,
    );
  }
  if (input.semanticChangeSetDigest !== undefined) {
    await validatePendingRemoteObject(
      graph,
      'workbook.semanticChangeSet.v1',
      input.semanticChangeSetDigest,
      'semanticChangeSetDigest',
      diagnostics,
    );
  }

  return diagnostics.length === 0
    ? { status: 'success', diagnostics: [] }
    : { status: 'failed', diagnostics };
}

async function validatePendingRemoteObject(
  graph: Pick<VersionGraphStore, 'getObjectRecord'>,
  objectType: VersionObjectType,
  digest: ObjectDigest,
  field: string,
  diagnostics: PendingRemoteSegmentStoreDiagnostic[],
): Promise<void> {
  try {
    await graph.getObjectRecord({ kind: 'object', objectType, digest });
  } catch (error) {
    diagnostics.push(diagnosticForPendingRemoteObjectReadError(error, objectType, digest, field));
  }
}

function diagnosticForPendingRemoteObjectReadError(
  error: unknown,
  objectType: VersionObjectType,
  digest: ObjectDigest,
  field: string,
): PendingRemoteSegmentStoreDiagnostic {
  const sourceCode = diagnosticCodeFromError(error);
  const details = { objectType, digest: digest.digest, field, sourceCode: sourceCode ?? null };
  if (sourceCode === 'VERSION_OBJECT_NOT_FOUND') {
    return diagnostic(
      'VERSION_PENDING_REMOTE_MISSING_OBJECT',
      'Pending remote segment references a version object that is not persisted.',
      'repair',
      details,
    );
  }
  if (
    sourceCode === 'VERSION_OBJECT_TYPE_MISMATCH' ||
    sourceCode === 'VERSION_OBJECT_CORRUPTION' ||
    sourceCode === 'VERSION_DIGEST_MISMATCH'
  ) {
    return diagnostic(
      'VERSION_PENDING_REMOTE_OBJECT_CORRUPTION',
      'Pending remote segment references an invalid version object.',
      'repair',
      details,
    );
  }
  return diagnostic(
    'VERSION_PROVIDER_FAILED',
    'Pending remote segment object validation failed.',
    'retry',
    details,
  );
}

function diagnosticCodeFromError(error: unknown): string | undefined {
  if (!isRecord(error) || !isRecord(error.diagnostic)) return undefined;
  return typeof error.diagnostic.code === 'string' ? error.diagnostic.code : undefined;
}

function diagnostic(
  code: PendingRemoteSegmentStoreDiagnostic['code'],
  message: string,
  recoverability: PendingRemoteSegmentStoreDiagnostic['recoverability'],
  details?: PendingRemoteSegmentStoreDiagnostic['details'],
): PendingRemoteSegmentStoreDiagnostic {
  return details === undefined
    ? { code, message, recoverability }
    : { code, message, recoverability, details };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
