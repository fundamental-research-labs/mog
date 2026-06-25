import { cloneJson } from './merge-apply-intent-store-json';
import {
  mergeApplyIntentRecordStorageKey,
  mergeApplyIntentStorageKey,
  mergeApplyRefCasProofStorageKey,
} from './merge-apply-intent-store-keys';
import {
  cloneIntent,
  intentsEquivalent,
  mergeApplyIntentTerminalsEqual,
  objectDigestsEqual,
} from './merge-apply-intent-store-records';
import type {
  BeginMergeApplyIntentInput,
  CompleteMergeApplyIntentInput,
  MergeApplyIntentBeginResult,
  MergeApplyIntentCompleteResult,
  MergeApplyIntentId,
  MergeApplyIntentIdempotencyKey,
  MergeApplyIntentMemoryBackendSnapshot,
  MergeApplyIntentReadResult,
  MergeApplyIntentRecord,
  MergeApplyIntentStore,
  MergeApplyIntentStoreDiagnostic,
  MergeApplyRefCasProof,
  MergeApplyRefCasProofLookup,
  MergeApplyRefCasProofReadResult,
} from './merge-apply-intent-store-types';
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

export class MergeApplyIntentMemoryBackend {
  private readonly recordsByKey = new Map<string, MergeApplyIntentRecord>();
  private readonly refCasProofsByKey = new Map<string, MergeApplyRefCasProof>();

  get(
    namespace: VersionGraphNamespace,
    idempotencyKey: MergeApplyIntentIdempotencyKey,
  ): MergeApplyIntentRecord | undefined {
    return cloneIntent(
      this.recordsByKey.get(mergeApplyIntentStorageKey(namespace, idempotencyKey)),
    );
  }

  findByIntentId(
    namespace: VersionGraphNamespace,
    intentId: MergeApplyIntentId,
  ): MergeApplyIntentRecord | undefined {
    const namespaceKey = versionGraphNamespaceKey(namespace);
    for (const record of this.recordsByKey.values()) {
      if (record.namespaceKey === namespaceKey && record.intentId === intentId)
        return cloneIntent(record);
    }
    return undefined;
  }

  put(record: MergeApplyIntentRecord): void {
    this.recordsByKey.set(mergeApplyIntentRecordStorageKey(record), cloneIntent(record));
  }

  getRefCasProof(
    namespace: VersionGraphNamespace,
    input: MergeApplyRefCasProofLookup,
  ): MergeApplyRefCasProof | undefined {
    return cloneJson(this.refCasProofsByKey.get(mergeApplyRefCasProofStorageKey(namespace, input)));
  }

  putRefCasProof(
    namespace: VersionGraphNamespace,
    input: MergeApplyRefCasProofLookup,
    proof: MergeApplyRefCasProof,
  ): void {
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

  static fromSnapshot(
    snapshot: MergeApplyIntentMemoryBackendSnapshot,
  ): MergeApplyIntentMemoryBackend {
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
    this.documentScopeKey = versionDocumentScopeKey(
      normalizeVersionDocumentScope(options.documentScope),
    );
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
            diagnostics: [
              diagnostic(
                'VERSION_INTENT_CONFLICT',
                'Merge apply idempotency key is already bound to a different intent.',
                'none',
              ),
            ],
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

  async readByIdempotencyKey(
    idempotencyKey: MergeApplyIntentIdempotencyKey,
  ): Promise<MergeApplyIntentReadResult> {
    const record = this.backend.get(this.namespace, idempotencyKey);
    return record
      ? { status: 'found', record, diagnostics: [] }
      : missingRead('Merge apply intent was not found by idempotency key.');
  }

  async readRefCasProof(
    input: MergeApplyRefCasProofLookup,
  ): Promise<MergeApplyRefCasProofReadResult> {
    const proof = this.backend.getRefCasProof(this.namespace, input);
    return proof
      ? { status: 'found', proof, diagnostics: [] }
      : missingProofRead('Merge apply ref CAS proof was not found.');
  }

  async completeIntent(
    input: CompleteMergeApplyIntentInput,
  ): Promise<MergeApplyIntentCompleteResult> {
    const existing = this.backend.findByIntentId(this.namespace, input.intentId);
    if (!existing) {
      return {
        status: 'missing',
        record: null,
        diagnostics: [
          diagnostic('VERSION_INTENT_NOT_FOUND', 'Merge apply intent was not found.', 'repair'),
        ],
      };
    }
    if (!objectDigestsEqual(existing.resolvedAttemptDigest, input.resolvedAttemptDigest)) {
      return {
        status: 'conflict',
        record: existing,
        diagnostics: [
          diagnostic(
            'VERSION_INTENT_CONFLICT',
            'Merge apply completion did not match the stored resolved attempt digest.',
            'none',
          ),
        ],
      };
    }
    if (existing.terminal) {
      return mergeApplyIntentTerminalsEqual(existing.terminal, input.terminal)
        ? { status: 'completed', record: existing, diagnostics: [] }
        : {
            status: 'conflict',
            record: existing,
            diagnostics: [
              diagnostic(
                'VERSION_INTENT_CONFLICT',
                'Merge apply intent is already finalized with a different terminal result.',
                'none',
              ),
            ],
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
