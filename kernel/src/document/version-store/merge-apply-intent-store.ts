import type {
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeResultId,
  VersionRefName,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { ObjectDigest } from './object-digest';
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

export interface MergeApplyIntentStore {
  readonly namespace: VersionGraphNamespace;
  beginIntent(input: BeginMergeApplyIntentInput): Promise<MergeApplyIntentBeginResult>;
  readByIntentId(intentId: MergeApplyIntentId): Promise<MergeApplyIntentReadResult>;
  readByIdempotencyKey(idempotencyKey: MergeApplyIntentIdempotencyKey): Promise<MergeApplyIntentReadResult>;
  completeIntent(input: CompleteMergeApplyIntentInput): Promise<MergeApplyIntentCompleteResult>;
}

export type MergeApplyIntentStoreProvider = {
  openMergeApplyIntentStore(namespace: VersionGraphNamespace): Promise<MergeApplyIntentStore>;
};

export type MergeApplyIntentMemoryBackendSnapshot = {
  readonly records: readonly MergeApplyIntentRecord[];
};

export class MergeApplyIntentMemoryBackend {
  private readonly recordsByKey = new Map<string, MergeApplyIntentRecord>();

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

  exportSnapshot(): MergeApplyIntentMemoryBackendSnapshot {
    return { records: [...this.recordsByKey.values()].map((record) => cloneIntent(record)) };
  }

  static fromSnapshot(snapshot: MergeApplyIntentMemoryBackendSnapshot): MergeApplyIntentMemoryBackend {
    const backend = new MergeApplyIntentMemoryBackend();
    for (const record of snapshot.records) backend.put(record);
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
