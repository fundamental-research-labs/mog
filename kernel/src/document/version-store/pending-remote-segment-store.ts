import type {
  VersionOperationContext,
  VersionSyncOperationContext,
} from '@mog-sdk/contracts/versioning';

import {
  isObjectDigest,
  type ObjectDigest,
  type VersionObjectType,
  type WorkbookCommitId,
} from './object-digest';
import { objectDigestFor, objectDigestsEqual } from './merge-apply-intent-store';
import {
  normalizeVersionGraphNamespace,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
} from './object-store';
import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from './registry';
import type { VersionGraphStore } from './provider-graph-store';

export type PendingRemoteSegmentState = 'pending' | 'promoted' | 'dropped';

export type PendingRemoteSegmentId = `pending-remote-segment:sha256:${string}`;
export type PendingRemoteSegmentIdempotencyKey = `pending-remote:sha256:${string}`;

export type PendingRemoteSegmentOperationContext = VersionOperationContext & {
  readonly collaboration: VersionSyncOperationContext;
};

export type PendingRemoteSegmentSyncIdentity = {
  readonly schemaVersion: 1;
  readonly sourceKind: VersionSyncOperationContext['sourceKind'];
  readonly originKind: VersionSyncOperationContext['originKind'];
  readonly stableOriginId?: string;
  readonly providerId?: string;
  readonly roomId?: string;
  readonly epoch?: string;
  readonly updateId?: string;
  readonly sequence?: string;
  readonly payloadHash: string;
};

export type PendingRemoteSegmentTerminal =
  | {
      readonly status: 'promoted';
      readonly commitId?: WorkbookCommitId;
      readonly promotionDigest?: ObjectDigest;
    }
  | {
      readonly status: 'dropped';
      readonly reason: string;
      readonly diagnosticDigest?: ObjectDigest;
    };

export type PendingRemoteSegmentRecord = {
  readonly schemaVersion: 1;
  readonly recordKind: 'pendingRemoteSegment';
  readonly pendingRemoteSegmentId: PendingRemoteSegmentId;
  readonly idempotencyKey: PendingRemoteSegmentIdempotencyKey;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly syncIdentity: PendingRemoteSegmentSyncIdentity;
  readonly operationContext: PendingRemoteSegmentOperationContext;
  readonly mutationSegmentDigest: ObjectDigest;
  readonly semanticChangeSetDigest?: ObjectDigest;
  readonly state: PendingRemoteSegmentState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly terminal?: PendingRemoteSegmentTerminal;
};

export type ReservePendingRemoteSegmentInput = Omit<
  PendingRemoteSegmentRecord,
  | 'schemaVersion'
  | 'recordKind'
  | 'namespaceKey'
  | 'documentScopeKey'
  | 'syncIdentity'
  | 'state'
  | 'updatedAt'
  | 'terminal'
>;

export type CompletePendingRemoteSegmentInput = {
  readonly pendingRemoteSegmentId: PendingRemoteSegmentId;
  readonly mutationSegmentDigest: ObjectDigest;
  readonly completedAt: string;
  readonly terminal: PendingRemoteSegmentTerminal;
};

export type PendingRemoteSegmentStoreDiagnostic = {
  readonly code:
    | 'VERSION_INVALID_OPTIONS'
    | 'VERSION_PENDING_REMOTE_CONFLICT'
    | 'VERSION_PENDING_REMOTE_MISSING_OBJECT'
    | 'VERSION_PENDING_REMOTE_OBJECT_CORRUPTION'
    | 'VERSION_PENDING_REMOTE_NOT_FOUND'
    | 'VERSION_PROVIDER_FAILED';
  readonly message: string;
  readonly recoverability: 'retry' | 'repair' | 'none';
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
};

export type PendingRemoteSegmentReadResult =
  | {
      readonly status: 'found';
      readonly record: PendingRemoteSegmentRecord;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'missing';
      readonly record: null;
      readonly diagnostics: readonly PendingRemoteSegmentStoreDiagnostic[];
    }
  | {
      readonly status: 'failed';
      readonly record: null;
      readonly diagnostics: readonly PendingRemoteSegmentStoreDiagnostic[];
    };

export type PendingRemoteSegmentReserveResult =
  | {
      readonly status: 'created' | 'existing';
      readonly record: PendingRemoteSegmentRecord;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'conflict';
      readonly record: PendingRemoteSegmentRecord;
      readonly diagnostics: readonly PendingRemoteSegmentStoreDiagnostic[];
    }
  | {
      readonly status: 'failed';
      readonly record: null;
      readonly diagnostics: readonly PendingRemoteSegmentStoreDiagnostic[];
    };

export type PendingRemoteSegmentCompleteResult =
  | {
      readonly status: 'completed';
      readonly record: PendingRemoteSegmentRecord;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'missing' | 'conflict' | 'failed';
      readonly record: PendingRemoteSegmentRecord | null;
      readonly diagnostics: readonly PendingRemoteSegmentStoreDiagnostic[];
    };

export interface PendingRemoteSegmentStore {
  readonly namespace: VersionGraphNamespace;
  reserveSegment(
    input: ReservePendingRemoteSegmentInput,
  ): Promise<PendingRemoteSegmentReserveResult>;
  readBySegmentId(segmentId: PendingRemoteSegmentId): Promise<PendingRemoteSegmentReadResult>;
  readByIdempotencyKey(
    idempotencyKey: PendingRemoteSegmentIdempotencyKey,
  ): Promise<PendingRemoteSegmentReadResult>;
  completeSegment(
    input: CompletePendingRemoteSegmentInput,
  ): Promise<PendingRemoteSegmentCompleteResult>;
}

export type PendingRemoteSegmentStoreProvider = {
  openPendingRemoteSegmentStore(
    namespace: VersionGraphNamespace,
  ): Promise<PendingRemoteSegmentStore>;
};

export type PendingRemoteSegmentKeyMaterial = {
  readonly syncIdentity: PendingRemoteSegmentSyncIdentity;
  readonly idempotencyKey: PendingRemoteSegmentIdempotencyKey;
  readonly pendingRemoteSegmentId: PendingRemoteSegmentId;
};

export type PendingRemoteSegmentObjectValidationResult =
  | {
      readonly status: 'success';
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'failed';
      readonly diagnostics: readonly PendingRemoteSegmentStoreDiagnostic[];
    };

export type ReservePersistedPendingRemoteSegmentOptions = {
  readonly graph: Pick<VersionGraphStore, 'getObjectRecord'>;
  readonly store: PendingRemoteSegmentStore;
  readonly input: ReservePendingRemoteSegmentInput;
};

export type PendingRemoteSegmentMemoryBackendSnapshot = {
  readonly records: readonly PendingRemoteSegmentRecord[];
};

export class PendingRemoteSegmentMemoryBackend {
  private readonly recordsByKey = new Map<string, PendingRemoteSegmentRecord>();

  get(
    namespace: VersionGraphNamespace,
    idempotencyKey: PendingRemoteSegmentIdempotencyKey,
  ): PendingRemoteSegmentRecord | undefined {
    return clonePendingRemoteSegmentRecord(
      this.recordsByKey.get(memoryKey(namespace, idempotencyKey)),
    );
  }

  findBySegmentId(
    namespace: VersionGraphNamespace,
    segmentId: PendingRemoteSegmentId,
  ): PendingRemoteSegmentRecord | undefined {
    const namespaceKey = versionGraphNamespaceKey(namespace);
    for (const record of this.recordsByKey.values()) {
      if (record.namespaceKey === namespaceKey && record.pendingRemoteSegmentId === segmentId) {
        return clonePendingRemoteSegmentRecord(record);
      }
    }
    return undefined;
  }

  put(record: PendingRemoteSegmentRecord): void {
    this.recordsByKey.set(memoryKeyFromRecord(record), clonePendingRemoteSegmentRecord(record));
  }

  exportSnapshot(): PendingRemoteSegmentMemoryBackendSnapshot {
    return {
      records: [...this.recordsByKey.values()].map((record) =>
        clonePendingRemoteSegmentRecord(record),
      ),
    };
  }

  static fromSnapshot(
    snapshot: PendingRemoteSegmentMemoryBackendSnapshot,
  ): PendingRemoteSegmentMemoryBackend {
    const backend = new PendingRemoteSegmentMemoryBackend();
    for (const record of snapshot.records) backend.put(record);
    return backend;
  }
}

export class InMemoryPendingRemoteSegmentStore implements PendingRemoteSegmentStore {
  readonly namespace: VersionGraphNamespace;

  private readonly backend: PendingRemoteSegmentMemoryBackend;
  private readonly documentScopeKey: string;
  private readonly namespaceKey: string;

  constructor(options: {
    readonly namespace: VersionGraphNamespace;
    readonly documentScope: VersionDocumentScope;
    readonly backend: PendingRemoteSegmentMemoryBackend;
  }) {
    this.namespace = normalizeVersionGraphNamespace(options.namespace);
    this.namespaceKey = versionGraphNamespaceKey(this.namespace);
    this.documentScopeKey = versionDocumentScopeKey(
      normalizeVersionDocumentScope(options.documentScope),
    );
    this.backend = options.backend;
  }

  async reserveSegment(
    input: ReservePendingRemoteSegmentInput,
  ): Promise<PendingRemoteSegmentReserveResult> {
    let record: PendingRemoteSegmentRecord;
    try {
      record = this.recordFromInput(input);
    } catch {
      return failedReserve('Pending remote segment reservation has invalid sync context.');
    }

    const existingByKey = this.backend.get(this.namespace, input.idempotencyKey);
    if (existingByKey) {
      return pendingRemoteSegmentsEquivalent(existingByKey, record)
        ? { status: 'existing', record: existingByKey, diagnostics: [] }
        : conflictReserve(
            existingByKey,
            'Pending remote idempotency key is already bound to a different segment.',
          );
    }

    const existingBySegmentId = this.backend.findBySegmentId(
      this.namespace,
      input.pendingRemoteSegmentId,
    );
    if (existingBySegmentId) {
      return pendingRemoteSegmentsEquivalent(existingBySegmentId, record)
        ? { status: 'existing', record: existingBySegmentId, diagnostics: [] }
        : conflictReserve(
            existingBySegmentId,
            'Pending remote segment id is already bound to a different reservation.',
          );
    }

    this.backend.put(record);
    return { status: 'created', record, diagnostics: [] };
  }

  async readBySegmentId(
    segmentId: PendingRemoteSegmentId,
  ): Promise<PendingRemoteSegmentReadResult> {
    const record = this.backend.findBySegmentId(this.namespace, segmentId);
    return record
      ? { status: 'found', record, diagnostics: [] }
      : missingRead('Pending remote segment was not found by segment id.');
  }

  async readByIdempotencyKey(
    idempotencyKey: PendingRemoteSegmentIdempotencyKey,
  ): Promise<PendingRemoteSegmentReadResult> {
    const record = this.backend.get(this.namespace, idempotencyKey);
    return record
      ? { status: 'found', record, diagnostics: [] }
      : missingRead('Pending remote segment was not found by idempotency key.');
  }

  async completeSegment(
    input: CompletePendingRemoteSegmentInput,
  ): Promise<PendingRemoteSegmentCompleteResult> {
    const existing = this.backend.findBySegmentId(this.namespace, input.pendingRemoteSegmentId);
    if (!existing) {
      return {
        status: 'missing',
        record: null,
        diagnostics: [
          diagnostic(
            'VERSION_PENDING_REMOTE_NOT_FOUND',
            'Pending remote segment was not found.',
            'repair',
          ),
        ],
      };
    }
    if (!objectDigestsEqual(existing.mutationSegmentDigest, input.mutationSegmentDigest)) {
      return conflictComplete(
        existing,
        'Pending remote completion did not match the stored mutation segment digest.',
      );
    }
    if (existing.terminal) {
      return pendingRemoteSegmentTerminalsEqual(existing.terminal, input.terminal)
        ? { status: 'completed', record: existing, diagnostics: [] }
        : conflictComplete(
            existing,
            'Pending remote segment is already finalized with different terminal metadata.',
          );
    }

    const completed: PendingRemoteSegmentRecord = {
      ...existing,
      state: input.terminal.status,
      updatedAt: input.completedAt,
      terminal: cloneJson(input.terminal),
    };
    this.backend.put(completed);
    return { status: 'completed', record: completed, diagnostics: [] };
  }

  private recordFromInput(input: ReservePendingRemoteSegmentInput): PendingRemoteSegmentRecord {
    return clonePendingRemoteSegmentRecord({
      ...input,
      schemaVersion: 1,
      recordKind: 'pendingRemoteSegment',
      namespaceKey: this.namespaceKey,
      documentScopeKey: this.documentScopeKey,
      syncIdentity: pendingRemoteSegmentIdentityForOperationContext(input.operationContext),
      state: 'pending',
      updatedAt: input.createdAt,
    });
  }
}

export function pendingRemoteSegmentIdentityForOperationContext(
  operationContext: VersionOperationContext,
): PendingRemoteSegmentSyncIdentity {
  const collaboration = operationContext.collaboration;
  if (!collaboration) {
    throw new Error('Pending remote segment operation context must include collaboration.');
  }
  return {
    schemaVersion: 1,
    sourceKind: collaboration.sourceKind,
    originKind: collaboration.originKind,
    ...(collaboration.stableOriginId === undefined
      ? {}
      : { stableOriginId: collaboration.stableOriginId }),
    ...(collaboration.providerId === undefined ? {} : { providerId: collaboration.providerId }),
    ...(collaboration.roomId === undefined ? {} : { roomId: collaboration.roomId }),
    ...(collaboration.epoch === undefined ? {} : { epoch: collaboration.epoch }),
    ...(collaboration.updateId === undefined ? {} : { updateId: collaboration.updateId }),
    ...(collaboration.sequence === undefined ? {} : { sequence: collaboration.sequence }),
    payloadHash: collaboration.payloadHash,
  };
}

export async function pendingRemoteSegmentKeyMaterialForOperationContext(
  operationContext: VersionOperationContext,
): Promise<PendingRemoteSegmentKeyMaterial> {
  const syncIdentity = pendingRemoteSegmentIdentityForOperationContext(operationContext);
  const digest = await objectDigestFor(
    'mog.version.pending-remote-segment.identity.v1',
    syncIdentity,
  );
  return {
    syncIdentity,
    idempotencyKey: `pending-remote:sha256:${digest.digest}`,
    pendingRemoteSegmentId: `pending-remote-segment:sha256:${digest.digest}`,
  };
}

export async function idempotencyKeyForPendingRemoteSegment(
  operationContext: VersionOperationContext,
): Promise<PendingRemoteSegmentIdempotencyKey> {
  return (await pendingRemoteSegmentKeyMaterialForOperationContext(operationContext))
    .idempotencyKey;
}

export async function pendingRemoteSegmentIdForOperationContext(
  operationContext: VersionOperationContext,
): Promise<PendingRemoteSegmentId> {
  return (await pendingRemoteSegmentKeyMaterialForOperationContext(operationContext))
    .pendingRemoteSegmentId;
}

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
    'mutationSegmentDigest' | 'semanticChangeSetDigest'
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

export function clonePendingRemoteSegmentRecord(
  record: PendingRemoteSegmentRecord,
): PendingRemoteSegmentRecord;
export function clonePendingRemoteSegmentRecord(record: undefined): undefined;
export function clonePendingRemoteSegmentRecord(
  record: PendingRemoteSegmentRecord | undefined,
): PendingRemoteSegmentRecord | undefined;
export function clonePendingRemoteSegmentRecord(
  record: PendingRemoteSegmentRecord | undefined,
): PendingRemoteSegmentRecord | undefined {
  return record === undefined ? undefined : cloneJson(record);
}

export function pendingRemoteSegmentsEquivalent(
  left: PendingRemoteSegmentRecord,
  right: PendingRemoteSegmentRecord,
): boolean {
  return (
    canonicalJsonStringify(pendingRemoteSegmentReservationIdentity(left)) ===
    canonicalJsonStringify(pendingRemoteSegmentReservationIdentity(right))
  );
}

export function pendingRemoteSegmentTerminalsEqual(
  left: PendingRemoteSegmentTerminal,
  right: PendingRemoteSegmentTerminal,
): boolean {
  return canonicalJsonStringify(left) === canonicalJsonStringify(right);
}

export function pendingRemoteSegmentStorageKey(
  namespace: VersionGraphNamespace,
  idempotencyKey: PendingRemoteSegmentIdempotencyKey,
): string {
  return memoryKey(namespace, idempotencyKey);
}

export function hasPendingRemoteSegmentStoreProvider(
  value: unknown,
): value is PendingRemoteSegmentStoreProvider {
  return isRecord(value) && typeof value.openPendingRemoteSegmentStore === 'function';
}

export function isPendingRemoteSegmentRecord(value: unknown): value is PendingRemoteSegmentRecord {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  if (value.recordKind !== 'pendingRemoteSegment') return false;
  if (
    typeof value.pendingRemoteSegmentId !== 'string' ||
    !/^pending-remote-segment:sha256:[0-9a-f]{64}$/.test(value.pendingRemoteSegmentId)
  ) {
    return false;
  }
  if (
    typeof value.idempotencyKey !== 'string' ||
    !/^pending-remote:sha256:[0-9a-f]{64}$/.test(value.idempotencyKey)
  ) {
    return false;
  }
  if (typeof value.namespaceKey !== 'string' || typeof value.documentScopeKey !== 'string') {
    return false;
  }
  if (value.state !== 'pending' && value.state !== 'promoted' && value.state !== 'dropped') {
    return false;
  }
  if (typeof value.createdAt !== 'string' || typeof value.updatedAt !== 'string') return false;
  if (!isPendingRemoteSyncIdentity(value.syncIdentity)) return false;
  if (!isPendingRemoteOperationContext(value.operationContext)) return false;
  if (!isObjectDigest(value.mutationSegmentDigest)) return false;
  if (
    value.semanticChangeSetDigest !== undefined &&
    !isObjectDigest(value.semanticChangeSetDigest)
  ) {
    return false;
  }
  if (value.state === 'pending') return value.terminal === undefined;
  if (!isPendingRemoteTerminal(value.terminal)) return false;
  if (value.terminal.status !== value.state) return false;
  return true;
}

function pendingRemoteSegmentReservationIdentity(record: PendingRemoteSegmentRecord) {
  return {
    schemaVersion: record.schemaVersion,
    recordKind: record.recordKind,
    pendingRemoteSegmentId: record.pendingRemoteSegmentId,
    idempotencyKey: record.idempotencyKey,
    namespaceKey: record.namespaceKey,
    documentScopeKey: record.documentScopeKey,
    syncIdentity: record.syncIdentity,
    operationContext: stableOperationContextIdentity(record.operationContext),
    mutationSegmentDigest: record.mutationSegmentDigest,
    semanticChangeSetDigest: record.semanticChangeSetDigest,
  };
}

function stableOperationContextIdentity(context: PendingRemoteSegmentOperationContext) {
  return {
    operationId: context.operationId,
    kind: context.kind,
    author: context.author,
    workbookId: context.workbookId,
    sheetIds: context.sheetIds,
    domainIds: context.domainIds,
    groupId: context.groupId,
    capturePolicy: context.capturePolicy,
    writeAdmissionMode: context.writeAdmissionMode,
    rolloutStage: context.rolloutStage,
    capabilityGate: context.capabilityGate,
    clientRequestId: context.clientRequestId,
    collaboration: context.collaboration,
  };
}

function memoryKey(
  namespace: VersionGraphNamespace,
  idempotencyKey: PendingRemoteSegmentIdempotencyKey,
): string {
  return `${versionGraphNamespaceKey(namespace)}\u0000pendingRemote\u0000${idempotencyKey}`;
}

function memoryKeyFromRecord(record: PendingRemoteSegmentRecord): string {
  return `${record.namespaceKey}\u0000pendingRemote\u0000${record.idempotencyKey}`;
}

function conflictReserve(
  record: PendingRemoteSegmentRecord,
  message: string,
): Extract<PendingRemoteSegmentReserveResult, { status: 'conflict' }> {
  return {
    status: 'conflict',
    record,
    diagnostics: [diagnostic('VERSION_PENDING_REMOTE_CONFLICT', message, 'none')],
  };
}

function conflictComplete(
  record: PendingRemoteSegmentRecord,
  message: string,
): {
  readonly status: 'conflict';
  readonly record: PendingRemoteSegmentRecord;
  readonly diagnostics: readonly PendingRemoteSegmentStoreDiagnostic[];
} {
  return {
    status: 'conflict',
    record,
    diagnostics: [diagnostic('VERSION_PENDING_REMOTE_CONFLICT', message, 'none')],
  };
}

function failedReserve(
  message: string,
): Extract<PendingRemoteSegmentReserveResult, { status: 'failed' }> {
  return {
    status: 'failed',
    record: null,
    diagnostics: [diagnostic('VERSION_INVALID_OPTIONS', message, 'none')],
  };
}

function missingRead(message: string): PendingRemoteSegmentReadResult {
  return {
    status: 'missing',
    record: null,
    diagnostics: [diagnostic('VERSION_PENDING_REMOTE_NOT_FOUND', message, 'repair')],
  };
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

function isPendingRemoteSyncIdentity(value: unknown): value is PendingRemoteSegmentSyncIdentity {
  if (!isRecord(value) || value.schemaVersion !== 1) return false;
  return (
    typeof value.sourceKind === 'string' &&
    typeof value.originKind === 'string' &&
    optionalString(value.stableOriginId) &&
    optionalString(value.providerId) &&
    optionalString(value.roomId) &&
    optionalString(value.epoch) &&
    optionalString(value.updateId) &&
    optionalString(value.sequence) &&
    typeof value.payloadHash === 'string'
  );
}

function isPendingRemoteOperationContext(
  value: unknown,
): value is PendingRemoteSegmentOperationContext {
  if (!isRecord(value) || !isRecord(value.collaboration)) return false;
  return (
    typeof value.operationId === 'string' &&
    typeof value.kind === 'string' &&
    isRecord(value.author) &&
    typeof value.createdAt === 'string' &&
    Array.isArray(value.domainIds) &&
    typeof value.capturePolicy === 'string' &&
    typeof value.writeAdmissionMode === 'string' &&
    typeof value.collaboration.sourceKind === 'string' &&
    typeof value.collaboration.originKind === 'string' &&
    typeof value.collaboration.payloadHash === 'string'
  );
}

function isPendingRemoteTerminal(value: unknown): value is PendingRemoteSegmentTerminal {
  if (!isRecord(value)) return false;
  if (value.status === 'promoted') {
    return (
      optionalString(value.commitId) &&
      (value.promotionDigest === undefined || isObjectDigest(value.promotionDigest))
    );
  }
  if (value.status === 'dropped') {
    return (
      typeof value.reason === 'string' &&
      (value.diagnosticDigest === undefined || isObjectDigest(value.diagnosticDigest))
    );
  }
  return false;
}

function optionalString(value: unknown): boolean {
  return value === undefined || typeof value === 'string';
}

function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonical JSON number must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJsonStringify).join(',')}]`;
  if (!isRecord(value)) throw new Error('value must be canonical JSON');
  return `{${Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(value[key])}`)
    .join(',')}}`;
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
