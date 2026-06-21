import type {
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeResultId,
  VersionRefName,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { ObjectDigest, WorkbookCommitId as StoreWorkbookCommitId } from './object-digest';
import { objectDigestFromWorkbookCommitId } from './object-digest';
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

export type MergeApplyIntentApplyKind = 'fastForward' | 'alreadyMerged' | 'mergeCommit';
export type MergeApplyIntentState = 'staging' | 'casCommitted' | 'finalized' | 'aborted';
export type MergeApplyIntentTerminalStatus =
  | 'applied'
  | 'fastForwarded'
  | 'alreadyApplied'
  | 'alreadyMerged'
  | 'staleTargetHead';

export type MergeApplyIntentId = `merge-apply-intent:sha256:${string}`;
export type MergeApplyIntentIdempotencyKey = `merge-apply:${string}`;

export type MergeApplyRefCasProof = {
  readonly schemaVersion: 1;
  readonly applyKind: MergeApplyIntentApplyKind;
  readonly commitMetadataDigest: ObjectDigest;
  readonly refUpdateMetadataDigest: ObjectDigest;
  readonly refLogEventDigest: ObjectDigest;
};

export type MergeApplyRefCasProofLookup = {
  readonly applyKind: MergeApplyIntentApplyKind;
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly headBefore: WorkbookCommitId;
  readonly headAfter: WorkbookCommitId;
};

export type MergeApplyIntentRecord = {
  readonly schemaVersion: 1;
  readonly recordKind: 'mergeApplyIntent';
  readonly intentId: MergeApplyIntentId;
  readonly idempotencyKey: MergeApplyIntentIdempotencyKey;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly applyKind: MergeApplyIntentApplyKind;
  readonly base: WorkbookCommitId;
  readonly ours: WorkbookCommitId;
  readonly theirs: WorkbookCommitId;
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly resultDigest: ObjectDigest;
  readonly resolutionSetDigest: ObjectDigest;
  readonly resolvedAttemptDigest: ObjectDigest;
  readonly state: MergeApplyIntentState;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly terminal?: {
    readonly status: MergeApplyIntentTerminalStatus;
    readonly headBefore: WorkbookCommitId;
    readonly headAfter?: WorkbookCommitId;
    readonly commitId?: WorkbookCommitId;
    readonly refCasProof?: MergeApplyRefCasProof;
  };
};

export type BeginMergeApplyIntentInput = Omit<
  MergeApplyIntentRecord,
  | 'schemaVersion'
  | 'recordKind'
  | 'namespaceKey'
  | 'documentScopeKey'
  | 'state'
  | 'updatedAt'
  | 'terminal'
>;

export type CompleteMergeApplyIntentInput = {
  readonly intentId: MergeApplyIntentId;
  readonly resolvedAttemptDigest: ObjectDigest;
  readonly terminal: NonNullable<MergeApplyIntentRecord['terminal']>;
  readonly completedAt: string;
};

export type MergeApplyIntentStoreDiagnostic = {
  readonly code:
    | 'VERSION_INVALID_OPTIONS'
    | 'VERSION_INTENT_CONFLICT'
    | 'VERSION_INTENT_NOT_FOUND'
    | 'VERSION_PROVIDER_FAILED';
  readonly message: string;
  readonly recoverability: 'retry' | 'repair' | 'none';
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
};

export type MergeApplyIntentReadResult =
  | { readonly status: 'found'; readonly record: MergeApplyIntentRecord; readonly diagnostics: readonly [] }
  | { readonly status: 'missing'; readonly record: null; readonly diagnostics: readonly MergeApplyIntentStoreDiagnostic[] }
  | { readonly status: 'failed'; readonly record: null; readonly diagnostics: readonly MergeApplyIntentStoreDiagnostic[] };

export type MergeApplyIntentBeginResult =
  | { readonly status: 'created' | 'existing'; readonly record: MergeApplyIntentRecord; readonly diagnostics: readonly [] }
  | { readonly status: 'conflict'; readonly record: MergeApplyIntentRecord; readonly diagnostics: readonly MergeApplyIntentStoreDiagnostic[] }
  | { readonly status: 'failed'; readonly record: null; readonly diagnostics: readonly MergeApplyIntentStoreDiagnostic[] };

export type MergeApplyIntentCompleteResult =
  | { readonly status: 'completed'; readonly record: MergeApplyIntentRecord; readonly diagnostics: readonly [] }
  | { readonly status: 'missing' | 'conflict' | 'failed'; readonly record: MergeApplyIntentRecord | null; readonly diagnostics: readonly MergeApplyIntentStoreDiagnostic[] };

export type MergeApplyRefCasProofReadResult =
  | { readonly status: 'found'; readonly proof: MergeApplyRefCasProof; readonly diagnostics: readonly [] }
  | { readonly status: 'missing' | 'failed'; readonly proof: null; readonly diagnostics: readonly MergeApplyIntentStoreDiagnostic[] };

export interface MergeApplyIntentStore {
  readonly namespace: VersionGraphNamespace;
  beginIntent(input: BeginMergeApplyIntentInput): Promise<MergeApplyIntentBeginResult>;
  readByIntentId(intentId: MergeApplyIntentId): Promise<MergeApplyIntentReadResult>;
  readByIdempotencyKey(idempotencyKey: MergeApplyIntentIdempotencyKey): Promise<MergeApplyIntentReadResult>;
  readRefCasProof(input: MergeApplyRefCasProofLookup): Promise<MergeApplyRefCasProofReadResult>;
  completeIntent(input: CompleteMergeApplyIntentInput): Promise<MergeApplyIntentCompleteResult>;
}

export type MergeApplyIntentStoreProvider = {
  openMergeApplyIntentStore(namespace: VersionGraphNamespace): Promise<MergeApplyIntentStore>;
};

export type MergeApplyIntentMemoryBackendSnapshot = {
  readonly records: readonly MergeApplyIntentRecord[];
  readonly refCasProofs?: readonly {
    readonly key: string;
    readonly proof: MergeApplyRefCasProof;
  }[];
};

export class MergeApplyIntentMemoryBackend {
  private readonly recordsByKey = new Map<string, MergeApplyIntentRecord>();
  private readonly refCasProofsByKey = new Map<string, MergeApplyRefCasProof>();

  get(namespace: VersionGraphNamespace, idempotencyKey: MergeApplyIntentIdempotencyKey): MergeApplyIntentRecord | undefined {
    return cloneIntent(this.recordsByKey.get(memoryKey(namespace, idempotencyKey)));
  }

  findByIntentId(namespace: VersionGraphNamespace, intentId: MergeApplyIntentId): MergeApplyIntentRecord | undefined {
    const namespaceKey = versionGraphNamespaceKey(namespace);
    for (const record of this.recordsByKey.values()) {
      if (record.namespaceKey === namespaceKey && record.intentId === intentId) return cloneIntent(record);
    }
    return undefined;
  }

  put(record: MergeApplyIntentRecord): void {
    this.recordsByKey.set(memoryKeyFromRecord(record), cloneIntent(record));
  }

  getRefCasProof(namespace: VersionGraphNamespace, input: MergeApplyRefCasProofLookup): MergeApplyRefCasProof | undefined {
    return cloneJson(this.refCasProofsByKey.get(mergeApplyRefCasProofStorageKey(namespace, input)));
  }

  putRefCasProof(namespace: VersionGraphNamespace, input: MergeApplyRefCasProofLookup, proof: MergeApplyRefCasProof): void {
    this.refCasProofsByKey.set(mergeApplyRefCasProofStorageKey(namespace, input), cloneJson(proof));
  }

  exportSnapshot(): MergeApplyIntentMemoryBackendSnapshot {
    return {
      records: [...this.recordsByKey.values()].map((record) => cloneIntent(record)),
      refCasProofs: [...this.refCasProofsByKey.entries()].map(([key, proof]) => ({
        key,
        proof: cloneJson(proof),
      })),
    };
  }

  static fromSnapshot(snapshot: MergeApplyIntentMemoryBackendSnapshot): MergeApplyIntentMemoryBackend {
    const backend = new MergeApplyIntentMemoryBackend();
    for (const record of snapshot.records) backend.put(record);
    for (const item of snapshot.refCasProofs ?? []) {
      backend.refCasProofsByKey.set(item.key, cloneJson(item.proof));
    }
    return backend;
  }
}

export class InMemoryMergeApplyIntentStore implements MergeApplyIntentStore {
  readonly namespace: VersionGraphNamespace;

  private readonly backend: MergeApplyIntentMemoryBackend;
  private readonly documentScopeKey: string;
  private readonly namespaceKey: string;

  constructor(options: {
    readonly namespace: VersionGraphNamespace;
    readonly documentScope: VersionDocumentScope;
    readonly backend: MergeApplyIntentMemoryBackend;
  }) {
    this.namespace = normalizeVersionGraphNamespace(options.namespace);
    this.namespaceKey = versionGraphNamespaceKey(this.namespace);
    this.documentScopeKey = versionDocumentScopeKey(normalizeVersionDocumentScope(options.documentScope));
    this.backend = options.backend;
  }

  async beginIntent(input: BeginMergeApplyIntentInput): Promise<MergeApplyIntentBeginResult> {
    const record = this.recordFromInput(input);
    const existing = this.backend.get(this.namespace, input.idempotencyKey);
    if (existing) {
      return intentsEquivalent(existing, record)
        ? { status: 'existing', record: existing, diagnostics: [] }
        : {
            status: 'conflict',
            record: existing,
            diagnostics: [diagnostic('VERSION_INTENT_CONFLICT', 'Merge apply idempotency key is already bound to a different intent.', 'none')],
          };
    }
    this.backend.put(record);
    return { status: 'created', record, diagnostics: [] };
  }

  async readByIntentId(intentId: MergeApplyIntentId): Promise<MergeApplyIntentReadResult> {
    const record = this.backend.findByIntentId(this.namespace, intentId);
    return record
      ? { status: 'found', record, diagnostics: [] }
      : missingRead('Merge apply intent was not found by intent id.');
  }

  async readByIdempotencyKey(idempotencyKey: MergeApplyIntentIdempotencyKey): Promise<MergeApplyIntentReadResult> {
    const record = this.backend.get(this.namespace, idempotencyKey);
    return record
      ? { status: 'found', record, diagnostics: [] }
      : missingRead('Merge apply intent was not found by idempotency key.');
  }

  async readRefCasProof(input: MergeApplyRefCasProofLookup): Promise<MergeApplyRefCasProofReadResult> {
    const proof = this.backend.getRefCasProof(this.namespace, input);
    return proof
      ? { status: 'found', proof, diagnostics: [] }
      : missingProofRead('Merge apply ref CAS proof was not found.');
  }

  async completeIntent(input: CompleteMergeApplyIntentInput): Promise<MergeApplyIntentCompleteResult> {
    const existing = this.backend.findByIntentId(this.namespace, input.intentId);
    if (!existing) {
      return { status: 'missing', record: null, diagnostics: [diagnostic('VERSION_INTENT_NOT_FOUND', 'Merge apply intent was not found.', 'repair')] };
    }
    if (!objectDigestsEqual(existing.resolvedAttemptDigest, input.resolvedAttemptDigest)) {
      return {
        status: 'conflict',
        record: existing,
        diagnostics: [diagnostic('VERSION_INTENT_CONFLICT', 'Merge apply completion did not match the stored resolved attempt digest.', 'none')],
      };
    }
    if (existing.terminal) {
      return mergeApplyIntentTerminalsEqual(existing.terminal, input.terminal)
        ? { status: 'completed', record: existing, diagnostics: [] }
        : {
            status: 'conflict',
            record: existing,
            diagnostics: [diagnostic('VERSION_INTENT_CONFLICT', 'Merge apply intent is already finalized with a different terminal result.', 'none')],
          };
    }
    const completed: MergeApplyIntentRecord = {
      ...existing,
      state: 'finalized',
      updatedAt: input.completedAt,
      terminal: cloneJson(input.terminal),
    };
    this.backend.put(completed);
    return { status: 'completed', record: completed, diagnostics: [] };
  }

  private recordFromInput(input: BeginMergeApplyIntentInput): MergeApplyIntentRecord {
    return cloneIntent({
      ...input,
      schemaVersion: 1,
      recordKind: 'mergeApplyIntent',
      namespaceKey: this.namespaceKey,
      documentScopeKey: this.documentScopeKey,
      state: 'staging',
      updatedAt: input.createdAt,
    });
  }
}

export async function computeMergeApplyResultDigest(input: {
  readonly status: 'clean' | 'conflicted' | 'fastForward' | 'alreadyMerged';
  readonly base: WorkbookCommitId;
  readonly ours: WorkbookCommitId;
  readonly theirs: WorkbookCommitId;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead?: VersionCommitExpectedHead;
}): Promise<ObjectDigest> {
  return objectDigestFor('mog.version.merge.result.v1', input);
}

export async function computeEmptyResolutionSetDigest(): Promise<ObjectDigest> {
  return objectDigestFor('mog.version.merge.empty-resolution-set.v1', {
    schemaVersion: 1,
    resolutions: [],
  });
}

export async function computeResolvedAttemptDigest(input: {
  readonly resultDigest: ObjectDigest;
  readonly resolutionSetDigest: ObjectDigest;
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead: VersionCommitExpectedHead;
}): Promise<ObjectDigest> {
  return objectDigestFor('mog.version.merge.resolved-attempt.v1', input);
}

export function intentIdForResolvedAttemptDigest(digest: ObjectDigest): MergeApplyIntentId {
  return `merge-apply-intent:sha256:${digest.digest}`;
}

export function mergeResultIdForResolvedAttemptDigest(digest: ObjectDigest): VersionMergeResultId {
  return `merge-result:${digest.digest}` as VersionMergeResultId;
}

export function intentIdForMergeResultId(resultId: VersionMergeResultId): MergeApplyIntentId | null {
  const digest = resultId.slice('merge-result:'.length);
  return /^[0-9a-f]{64}$/.test(digest) ? `merge-apply-intent:sha256:${digest}` : null;
}

export function idempotencyKeyForResolvedAttempt(input: {
  readonly resolvedAttemptDigest: ObjectDigest;
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead: VersionCommitExpectedHead;
}): MergeApplyIntentIdempotencyKey {
  return `merge-apply:${canonicalJsonStringify(input)}` as MergeApplyIntentIdempotencyKey;
}

export function cloneIntent(record: MergeApplyIntentRecord): MergeApplyIntentRecord;
export function cloneIntent(record: undefined): undefined;
export function cloneIntent(record: MergeApplyIntentRecord | undefined): MergeApplyIntentRecord | undefined;
export function cloneIntent(record: MergeApplyIntentRecord | undefined): MergeApplyIntentRecord | undefined {
  return record === undefined ? undefined : cloneJson(record);
}

export function intentsEquivalent(left: MergeApplyIntentRecord, right: MergeApplyIntentRecord): boolean {
  return canonicalJsonStringify(intentIdentity(left)) === canonicalJsonStringify(intentIdentity(right));
}

function intentIdentity(record: MergeApplyIntentRecord) {
  return {
    schemaVersion: record.schemaVersion,
    recordKind: record.recordKind,
    intentId: record.intentId,
    idempotencyKey: record.idempotencyKey,
    namespaceKey: record.namespaceKey,
    documentScopeKey: record.documentScopeKey,
    applyKind: record.applyKind,
    base: record.base,
    ours: record.ours,
    theirs: record.theirs,
    targetRef: record.targetRef,
    expectedTargetHead: record.expectedTargetHead,
    resultDigest: record.resultDigest,
    resolutionSetDigest: record.resolutionSetDigest,
    resolvedAttemptDigest: record.resolvedAttemptDigest,
  };
}

export function objectDigestsEqual(left: ObjectDigest, right: ObjectDigest): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

export function mergeApplyIntentTerminalsEqual(
  left: NonNullable<MergeApplyIntentRecord['terminal']>,
  right: NonNullable<MergeApplyIntentRecord['terminal']>,
): boolean {
  return (
    left.status === right.status &&
    left.headBefore === right.headBefore &&
    left.headAfter === right.headAfter &&
    left.commitId === right.commitId &&
    canonicalJsonStringify(left.refCasProof ?? null) === canonicalJsonStringify(right.refCasProof ?? null)
  );
}

export async function computeMergeApplyRefCasProof(
  input: MergeApplyRefCasProofLookup,
): Promise<MergeApplyRefCasProof> {
  const commitMetadataDigest = objectDigestFromWorkbookCommitId(
    input.headAfter as StoreWorkbookCommitId,
  );
  const refUpdateMetadataDigest = await objectDigestFor('mog.version.merge.ref-update-metadata.v1', {
    schemaVersion: 1,
    applyKind: input.applyKind,
    targetRef: input.targetRef,
    headBefore: input.headBefore,
    headAfter: input.headAfter,
  });
  const refLogEventDigest = await objectDigestFor('mog.version.merge.ref-log-event.v1', {
    schemaVersion: 1,
    applyKind: input.applyKind,
    commitMetadataDigest,
    refUpdateMetadataDigest,
  });
  return {
    schemaVersion: 1,
    applyKind: input.applyKind,
    commitMetadataDigest,
    refUpdateMetadataDigest,
    refLogEventDigest,
  };
}

export function mergeApplyRefCasProofStorageKey(
  namespace: VersionGraphNamespace,
  input: MergeApplyRefCasProofLookup,
): string {
  return `${versionGraphNamespaceKey(namespace)}\u0000mergeRefCasProof\u0000${canonicalJsonStringify(input)}`;
}

export function mergeApplyIntentStorageKey(
  namespace: VersionGraphNamespace,
  idempotencyKey: MergeApplyIntentIdempotencyKey,
): string {
  return memoryKey(namespace, idempotencyKey);
}

export function hasMergeApplyIntentStoreProvider(value: unknown): value is MergeApplyIntentStoreProvider {
  return isRecord(value) && typeof value.openMergeApplyIntentStore === 'function';
}

export function isMergeApplyIntentRecord(value: unknown): value is MergeApplyIntentRecord {
  return isRecord(value) && value.schemaVersion === 1 && value.recordKind === 'mergeApplyIntent';
}

export async function objectDigestFor(domain: string, value: unknown): Promise<ObjectDigest> {
  const input = new TextEncoder().encode(`${domain}\n${canonicalJsonStringify(value)}`);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', input);
  return { algorithm: 'sha256', digest: bytesToHex(new Uint8Array(digest)) };
}

function memoryKey(namespace: VersionGraphNamespace, idempotencyKey: MergeApplyIntentIdempotencyKey): string {
  return `${versionGraphNamespaceKey(namespace)}\u0000mergeApply\u0000${idempotencyKey}`;
}

function memoryKeyFromRecord(record: MergeApplyIntentRecord): string {
  return `${record.namespaceKey}\u0000mergeApply\u0000${record.idempotencyKey}`;
}

function missingRead(message: string): MergeApplyIntentReadResult {
  return {
    status: 'missing',
    record: null,
    diagnostics: [diagnostic('VERSION_INTENT_NOT_FOUND', message, 'repair')],
  };
}

function missingProofRead(message: string): MergeApplyRefCasProofReadResult {
  return {
    status: 'missing',
    proof: null,
    diagnostics: [diagnostic('VERSION_INTENT_NOT_FOUND', message, 'repair')],
  };
}

function diagnostic(
  code: MergeApplyIntentStoreDiagnostic['code'],
  message: string,
  recoverability: MergeApplyIntentStoreDiagnostic['recoverability'],
): MergeApplyIntentStoreDiagnostic {
  return { code, message, recoverability };
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

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
}
