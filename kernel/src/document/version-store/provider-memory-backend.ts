import {
  createInMemoryVersionGraphStore,
  createInMemoryVersionGraphStoreFromSnapshot,
  type InMemoryVersionGraphStore,
  type InMemoryVersionGraphStoreSnapshot,
} from './graph-store';
import {
  normalizeVersionGraphNamespace,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
} from './object-store';
import {
  cloneVersionGraphRegistry,
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
  type VersionGraphRegistry,
} from './registry';
import {
  MergeApplyIntentMemoryBackend,
  type MergeApplyIntentMemoryBackendSnapshot,
} from './merge-apply-intent-store';
import {
  PendingRemoteSegmentMemoryBackend,
  type PendingRemoteSegmentMemoryBackendSnapshot,
} from './pending-remote-segment-store';
import {
  AppliedSyncUpdateIdentityMemoryBackend,
  type AppliedSyncUpdateIdentityMemoryBackendSnapshot,
} from './applied-sync-update-identity-store';

export type InMemoryVersionProviderDurability = 'ephemeral' | 'snapshot-test-double';

export type InMemoryVersionRegistryRecord =
  | { readonly kind: 'valid'; readonly registry: VersionGraphRegistry }
  | { readonly kind: 'corrupt'; readonly safeReason: string }
  | { readonly kind: 'unsupported'; readonly safeReason: string };

export type InMemoryVersionDocumentProviderBackendSnapshot = {
  readonly registries: readonly (readonly [VersionDocumentScope, InMemoryVersionRegistryRecord])[];
  readonly graphs: readonly InMemoryVersionGraphStoreSnapshot[];
  readonly mergeApplyIntents: MergeApplyIntentMemoryBackendSnapshot;
  readonly pendingRemoteSegments?: PendingRemoteSegmentMemoryBackendSnapshot;
  readonly appliedSyncUpdateIdentities?: AppliedSyncUpdateIdentityMemoryBackendSnapshot;
};

export class InMemoryVersionDocumentProviderBackend {
  private readonly registries = new Map<string, InMemoryVersionRegistryRecord>();
  private readonly graphStores = new Map<string, InMemoryVersionGraphStore>();
  readonly mergeApplyIntentBackend: MergeApplyIntentMemoryBackend;
  readonly pendingRemoteSegmentBackend: PendingRemoteSegmentMemoryBackend;
  readonly appliedSyncUpdateIdentityBackend: AppliedSyncUpdateIdentityMemoryBackend;

  constructor(
    options: {
      readonly mergeApplyIntentBackend?: MergeApplyIntentMemoryBackend;
      readonly pendingRemoteSegmentBackend?: PendingRemoteSegmentMemoryBackend;
      readonly appliedSyncUpdateIdentityBackend?: AppliedSyncUpdateIdentityMemoryBackend;
    } = {},
  ) {
    this.mergeApplyIntentBackend =
      options.mergeApplyIntentBackend ?? new MergeApplyIntentMemoryBackend();
    this.pendingRemoteSegmentBackend =
      options.pendingRemoteSegmentBackend ?? new PendingRemoteSegmentMemoryBackend();
    this.appliedSyncUpdateIdentityBackend =
      options.appliedSyncUpdateIdentityBackend ?? new AppliedSyncUpdateIdentityMemoryBackend();
  }

  readRegistryRecord(
    documentScope: VersionDocumentScope,
  ): InMemoryVersionRegistryRecord | undefined {
    const record = this.registries.get(versionDocumentScopeKey(documentScope));
    return record === undefined ? undefined : cloneRegistryRecord(record);
  }

  getRegistry(documentScope: VersionDocumentScope): VersionGraphRegistry | undefined {
    const record = this.readRegistryRecord(documentScope);
    return record?.kind === 'valid' ? cloneVersionGraphRegistry(record.registry) : undefined;
  }

  setRegistry(documentScope: VersionDocumentScope, registry: VersionGraphRegistry): void {
    this.registries.set(versionDocumentScopeKey(documentScope), {
      kind: 'valid',
      registry: cloneVersionGraphRegistry(registry),
    });
  }

  putCorruptRegistryForTesting(documentScope: VersionDocumentScope, safeReason: string): void {
    this.registries.set(versionDocumentScopeKey(documentScope), {
      kind: 'corrupt',
      safeReason,
    });
  }

  putUnsupportedRegistryForTesting(documentScope: VersionDocumentScope, safeReason: string): void {
    this.registries.set(versionDocumentScopeKey(documentScope), {
      kind: 'unsupported',
      safeReason,
    });
  }

  getGraph(namespace: VersionGraphNamespace): InMemoryVersionGraphStore | undefined {
    return this.graphStores.get(versionGraphNamespaceKey(namespace));
  }

  getOrCreateGraph(namespace: VersionGraphNamespace): InMemoryVersionGraphStore {
    const normalized = normalizeVersionGraphNamespace(namespace);
    const key = versionGraphNamespaceKey(normalized);
    const existing = this.graphStores.get(key);
    if (existing) return existing;

    const graph = createInMemoryVersionGraphStore({ namespace: normalized });
    this.graphStores.set(key, graph);
    return graph;
  }

  async exportSnapshot(): Promise<InMemoryVersionDocumentProviderBackendSnapshot> {
    return Object.freeze({
      registries: Object.freeze(
        [...this.registries.entries()].map(([key, record]) =>
          Object.freeze([scopeFromRegistryKey(key), cloneRegistryRecord(record)] as const),
        ),
      ),
      graphs: Object.freeze(
        await Promise.all([...this.graphStores.values()].map((graph) => graph.exportSnapshot())),
      ),
      mergeApplyIntents: this.mergeApplyIntentBackend.exportSnapshot(),
      pendingRemoteSegments: this.pendingRemoteSegmentBackend.exportSnapshot(),
      appliedSyncUpdateIdentities: this.appliedSyncUpdateIdentityBackend.exportSnapshot(),
    });
  }

  static async fromSnapshot(
    snapshot: InMemoryVersionDocumentProviderBackendSnapshot,
  ): Promise<InMemoryVersionDocumentProviderBackend> {
    const backend = new InMemoryVersionDocumentProviderBackend({
      mergeApplyIntentBackend: MergeApplyIntentMemoryBackend.fromSnapshot(
        snapshot.mergeApplyIntents,
      ),
      pendingRemoteSegmentBackend: PendingRemoteSegmentMemoryBackend.fromSnapshot(
        snapshot.pendingRemoteSegments ?? { records: [] },
      ),
      appliedSyncUpdateIdentityBackend: AppliedSyncUpdateIdentityMemoryBackend.fromSnapshot(
        snapshot.appliedSyncUpdateIdentities ?? { records: [] },
      ),
    });
    for (const [scope, record] of snapshot.registries) {
      backend.registries.set(versionDocumentScopeKey(scope), cloneRegistryRecord(record));
    }
    for (const graph of snapshot.graphs) {
      const store = await createInMemoryVersionGraphStoreFromSnapshot(graph);
      backend.graphStores.set(versionGraphNamespaceKey(store.namespace), store);
    }
    return backend;
  }
}

function cloneRegistryRecord(record: InMemoryVersionRegistryRecord): InMemoryVersionRegistryRecord {
  if (record.kind === 'valid') {
    return Object.freeze({
      kind: 'valid',
      registry: cloneVersionGraphRegistry(record.registry),
    });
  }
  return Object.freeze({ ...record });
}

function scopeFromRegistryKey(key: string): VersionDocumentScope {
  const parsed = JSON.parse(key) as {
    readonly workspaceId: string | null;
    readonly documentId: string;
    readonly principalScope: string | null;
  };
  return normalizeVersionDocumentScope({
    ...(parsed.workspaceId === null ? {} : { workspaceId: parsed.workspaceId }),
    documentId: parsed.documentId,
    ...(parsed.principalScope === null ? {} : { principalScope: parsed.principalScope }),
  });
}
