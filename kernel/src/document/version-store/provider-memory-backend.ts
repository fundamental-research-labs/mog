import {
  createInMemoryVersionGraphStore,
  createInMemoryVersionGraphStoreFromSnapshot,
  type InMemoryVersionGraphStore,
  type InMemoryVersionGraphStoreSnapshot,
} from './graph';
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
import {
  SyncBatchStatusMemoryBackend,
  type SyncBatchStatusMemoryBackendSnapshot,
} from './sync-batch-status-store';
import {
  WorkbookVersionReviewRecordMemoryBackend,
  type WorkbookVersionReviewRecordMemoryBackendSnapshot,
} from './review-service';
import {
  AgentProposalMetadataMemoryBackend,
  type AgentProposalMetadataMemoryBackendSnapshot,
} from './proposals/proposal-store';
import {
  ActiveCheckoutMaterializationMemoryBackend,
  type ActiveCheckoutMaterializationMemoryBackendSnapshot,
} from './active-checkout-materialization-store';

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
  readonly syncBatchStatuses?: SyncBatchStatusMemoryBackendSnapshot;
  readonly reviewRecords?: WorkbookVersionReviewRecordMemoryBackendSnapshot;
  readonly proposalMetadataRecords?: AgentProposalMetadataMemoryBackendSnapshot;
  readonly activeCheckoutMaterializations?: ActiveCheckoutMaterializationMemoryBackendSnapshot;
};

export class InMemoryVersionDocumentProviderBackend {
  private readonly registries = new Map<string, InMemoryVersionRegistryRecord>();
  private readonly graphStores = new Map<string, InMemoryVersionGraphStore>();
  readonly mergeApplyIntentBackend: MergeApplyIntentMemoryBackend;
  readonly pendingRemoteSegmentBackend: PendingRemoteSegmentMemoryBackend;
  readonly appliedSyncUpdateIdentityBackend: AppliedSyncUpdateIdentityMemoryBackend;
  readonly syncBatchStatusBackend: SyncBatchStatusMemoryBackend;
  readonly reviewRecordBackend: WorkbookVersionReviewRecordMemoryBackend;
  readonly proposalMetadataBackend: AgentProposalMetadataMemoryBackend;
  readonly activeCheckoutMaterializationBackend: ActiveCheckoutMaterializationMemoryBackend;

  constructor(
    options: {
      readonly mergeApplyIntentBackend?: MergeApplyIntentMemoryBackend;
      readonly pendingRemoteSegmentBackend?: PendingRemoteSegmentMemoryBackend;
      readonly appliedSyncUpdateIdentityBackend?: AppliedSyncUpdateIdentityMemoryBackend;
      readonly syncBatchStatusBackend?: SyncBatchStatusMemoryBackend;
      readonly reviewRecordBackend?: WorkbookVersionReviewRecordMemoryBackend;
      readonly proposalMetadataBackend?: AgentProposalMetadataMemoryBackend;
      readonly activeCheckoutMaterializationBackend?: ActiveCheckoutMaterializationMemoryBackend;
    } = {},
  ) {
    this.mergeApplyIntentBackend =
      options.mergeApplyIntentBackend ?? new MergeApplyIntentMemoryBackend();
    this.pendingRemoteSegmentBackend =
      options.pendingRemoteSegmentBackend ?? new PendingRemoteSegmentMemoryBackend();
    this.appliedSyncUpdateIdentityBackend =
      options.appliedSyncUpdateIdentityBackend ?? new AppliedSyncUpdateIdentityMemoryBackend();
    this.syncBatchStatusBackend =
      options.syncBatchStatusBackend ?? new SyncBatchStatusMemoryBackend();
    this.reviewRecordBackend =
      options.reviewRecordBackend ?? new WorkbookVersionReviewRecordMemoryBackend();
    this.proposalMetadataBackend =
      options.proposalMetadataBackend ?? new AgentProposalMetadataMemoryBackend();
    this.activeCheckoutMaterializationBackend =
      options.activeCheckoutMaterializationBackend ??
      new ActiveCheckoutMaterializationMemoryBackend();
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
      syncBatchStatuses: this.syncBatchStatusBackend.exportSnapshot(),
      reviewRecords: this.reviewRecordBackend.exportSnapshot(),
      proposalMetadataRecords: this.proposalMetadataBackend.exportSnapshot(),
      activeCheckoutMaterializations: this.activeCheckoutMaterializationBackend.exportSnapshot(),
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
      syncBatchStatusBackend: SyncBatchStatusMemoryBackend.fromSnapshot(
        snapshot.syncBatchStatuses ?? { records: [] },
      ),
      reviewRecordBackend: WorkbookVersionReviewRecordMemoryBackend.fromSnapshot(
        snapshot.reviewRecords ?? { rows: [] },
      ),
      proposalMetadataBackend: AgentProposalMetadataMemoryBackend.fromSnapshot(
        snapshot.proposalMetadataRecords ?? { rows: [] },
      ),
      activeCheckoutMaterializationBackend: ActiveCheckoutMaterializationMemoryBackend.fromSnapshot(
        snapshot.activeCheckoutMaterializations ?? [],
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
