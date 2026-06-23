import {
  VERSION_GRAPH_MAIN_REF,
  createInMemoryVersionGraphStore,
  type VersionGraphWriteResult,
} from './graph-store';
import {
  cloneVersionStoreCapabilities,
  namespaceForDocumentScope,
  type VersionAccessContext,
  type VersionDocumentIntegrityScanOptions,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionGraphRegistry,
  type VersionGraphRegistryReadResult,
  type VersionIntegrityReport,
  type VersionStoreCapabilities,
  type VersionStoreCloseReason,
  type VersionStoreFailure,
  type VersionStoreLifecycleState,
  type VersionStoreOperation,
  type VersionGraphStore,
  type VersionStoreProvider,
  VersionStoreProviderError,
} from './provider';
import {
  createVersionGraphRegistry,
  namespaceForRegistry,
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from './registry';
import {
  normalizeVersionGraphNamespace,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
} from './object-store';
import { openVersionStoreIndexedDb } from './provider-indexeddb-schema';
import {
  failedStoreResult,
  initializeSuccess,
  mapGraphDiagnostics,
  normalizeVersionAccessContext,
  readOnlyCapabilities,
  registryRecordResult,
  versionStoreDiagnostic,
  type RegistryRecordRead,
} from './provider-indexeddb-internal';
import { graphLoadDiagnostic, loadGraphSnapshot } from './provider-indexeddb-reload';
import { IndexedDbMergeApplyIntentStore } from './provider-indexeddb-merge-intents';
import { IndexedDbPendingRemoteSegmentStore } from './provider-indexeddb-pending-remote-segments';
import { IndexedDbAppliedSyncUpdateIdentityStore } from './provider-indexeddb-applied-sync-updates';
import { IndexedDbSyncBatchStatusStore } from './provider-indexeddb-sync-batch-statuses';
import { IndexedDbWorkbookVersionReviewRecordStore } from './provider-indexeddb-review-records';
import { IndexedDbAgentProposalMetadataStore } from './provider-indexeddb-proposals';
import { IndexedDbVersionGraphStore } from './provider-indexeddb-backend-graph-store';
import {
  indexedDbBackendLifecycleUnavailableDiagnostic,
  indexedDbBackendLifecycleUnavailableFailure,
  indexedDbBackendReadOnlyFailure,
} from './provider-indexeddb-backend-diagnostics';
import {
  persistInitializedIndexedDbBackendGraphSnapshot,
  publishIndexedDbBackendRegistryVisibleLast,
  readIndexedDbBackendRegistryRecord,
} from './provider-indexeddb-backend-registry';
import { INDEXEDDB_VERSION_STORE_CAPABILITIES } from './provider-indexeddb-backend-capabilities';

export const INDEXEDDB_VERSION_STORE_PROVIDER_KIND = 'indexeddb' as const;

export { INDEXEDDB_VERSION_STORE_CAPABILITIES };

export type IndexedDbVersionStoreProviderOptions = {
  readonly documentScope: VersionDocumentScope;
  readonly accessContext?: VersionAccessContext;
  readonly readOnly?: boolean;
};

export class IndexedDbVersionStoreProvider implements VersionStoreProvider {
  readonly kind = INDEXEDDB_VERSION_STORE_PROVIDER_KIND;
  readonly documentScope: VersionDocumentScope;
  readonly accessContext: VersionAccessContext;
  readonly capabilities: VersionStoreCapabilities;

  private readonly readOnly: boolean;
  private db: IDBDatabase | null = null;
  private lifecycleState: VersionStoreLifecycleState = 'open';

  constructor(options: IndexedDbVersionStoreProviderOptions) {
    this.documentScope = normalizeVersionDocumentScope(options.documentScope);
    this.accessContext = normalizeVersionAccessContext(options.accessContext);
    this.readOnly = options.readOnly ?? false;
    this.capabilities = this.readOnly
      ? readOnlyCapabilities(INDEXEDDB_VERSION_STORE_CAPABILITIES)
      : cloneVersionStoreCapabilities(INDEXEDDB_VERSION_STORE_CAPABILITIES);
  }

  async readGraphRegistry(): Promise<VersionGraphRegistryReadResult> {
    this.assertAvailable('readGraphRegistry');

    const record = await this.readRegistryRecord();
    if (record.status === 'absent') {
      return {
        status: 'absent',
        registry: null,
        diagnostics: [
          versionStoreDiagnostic('VERSION_GRAPH_UNINITIALIZED', {
            operation: 'readGraphRegistry',
            documentScope: this.documentScope,
            safeMessage: 'Version graph registry has not been initialized for this document.',
          }),
        ],
      };
    }
    if (record.status === 'corrupt' || record.status === 'unsupported') {
      return registryRecordResult(record.status, 'readGraphRegistry', this.documentScope);
    }

    return {
      status: 'ok',
      registry: record.registry,
      diagnostics: [],
    };
  }

  async initializeGraph(input: VersionGraphInitializeInput): Promise<VersionGraphInitializeResult> {
    const writeFailure = this.writeUnavailableFailure('initializeGraph');
    if (writeFailure) return writeFailure;

    if (
      input.requireDurablePersistence &&
      (!this.capabilities.durableGraphRegistry || !this.capabilities.durableObjects)
    ) {
      return failedStoreResult(
        [
          versionStoreDiagnostic('VERSION_UNSUPPORTED_DURABLE_PERSISTENCE', {
            operation: 'initializeGraph',
            documentScope: this.documentScope,
            recoverability: 'unsupported',
            safeMessage:
              'This version store provider does not support durable graph registry and object persistence.',
          }),
        ],
        'no-write-attempted',
      );
    }

    if (input.expectedRegistryRevision !== null) {
      return failedStoreResult(
        [
          versionStoreDiagnostic('VERSION_GRAPH_CONFLICT', {
            operation: 'initializeGraph',
            documentScope: this.documentScope,
            recoverability: 'retry',
            safeMessage: 'Graph registry initialization expected an absent registry.',
          }),
        ],
        'no-write-attempted',
        true,
      );
    }

    let namespace: VersionGraphNamespace;
    try {
      namespace = namespaceForDocumentScope(this.documentScope, input.graphId);
    } catch {
      return failedStoreResult(
        [
          versionStoreDiagnostic('VERSION_WRONG_NAMESPACE', {
            operation: 'initializeGraph',
            documentScope: this.documentScope,
            safeMessage: 'Graph registry initialization requested an invalid graph namespace.',
          }),
        ],
        'no-write-attempted',
      );
    }

    const existingRegistry = await this.readRegistryRecord();
    if (existingRegistry.status === 'corrupt' || existingRegistry.status === 'unsupported') {
      return failedStoreResult(
        registryRecordResult(existingRegistry.status, 'initializeGraph', this.documentScope)
          .diagnostics,
        'no-write-attempted',
      );
    }

    const dryRun = createInMemoryVersionGraphStore({ namespace });
    const dryRunInitialized = await dryRun.initializeGraph(input.rootWrite);
    if (dryRunInitialized.status !== 'success') {
      return failedStoreResult(
        mapGraphDiagnostics(dryRunInitialized.diagnostics, 'initializeGraph'),
        'no-write-attempted',
      );
    }

    if (existingRegistry.status === 'valid') {
      return this.initializeAgainstExistingRegistry(
        existingRegistry.registry,
        namespace,
        dryRunInitialized,
      );
    }

    const snapshot = await dryRun.exportSnapshot();
    const persisted = await persistInitializedIndexedDbBackendGraphSnapshot({
      db: await this.getDb(),
      snapshot,
      documentScope: this.documentScope,
    });
    if (persisted.status !== 'success') {
      return persisted;
    }

    const registry = await createVersionGraphRegistry({
      documentScope: this.documentScope,
      graphId: namespace.graphId,
      rootCommitId: dryRunInitialized.commit.id,
      createdAt: dryRunInitialized.commit.payload.createdAt,
    });
    const published = await publishIndexedDbBackendRegistryVisibleLast({
      db: await this.getDb(),
      registry,
      scopeKey: this.scopeKey,
      documentScope: this.documentScope,
    });
    if (published.status === 'published') {
      return initializeSuccess(registry, dryRunInitialized.main);
    }
    if (published.status === 'same') {
      return this.initializeAgainstExistingRegistry(
        published.registry,
        namespace,
        dryRunInitialized,
      );
    }

    return published.failure;
  }

  async openGraph(
    namespaceInput: VersionGraphNamespace,
    accessContext: VersionAccessContext = this.accessContext,
  ): Promise<VersionGraphStore> {
    this.assertAvailable('openGraph');

    let namespace: VersionGraphNamespace;
    try {
      namespace = normalizeVersionGraphNamespace(namespaceInput);
    } catch {
      throw new VersionStoreProviderError(
        versionStoreDiagnostic('VERSION_WRONG_NAMESPACE', {
          operation: 'openGraph',
          documentScope: this.documentScope,
          safeMessage: 'Requested version graph namespace is invalid.',
        }),
      );
    }

    const registryRecord = await this.readRegistryRecord();
    if (registryRecord.status === 'absent') {
      throw new VersionStoreProviderError(
        versionStoreDiagnostic('VERSION_GRAPH_UNINITIALIZED', {
          operation: 'openGraph',
          documentScope: this.documentScope,
          namespace,
          safeMessage: 'Version graph registry has not been initialized for this document.',
        }),
      );
    }
    if (registryRecord.status === 'corrupt' || registryRecord.status === 'unsupported') {
      throw new VersionStoreProviderError(
        registryRecordResult(registryRecord.status, 'openGraph', this.documentScope).diagnostics[0],
      );
    }

    const expectedNamespace = namespaceForRegistry(registryRecord.registry);
    if (versionGraphNamespaceKey(namespace) !== versionGraphNamespaceKey(expectedNamespace)) {
      throw new VersionStoreProviderError(
        versionStoreDiagnostic('VERSION_WRONG_NAMESPACE', {
          operation: 'openGraph',
          documentScope: this.documentScope,
          namespace,
          safeMessage: 'Requested graph namespace does not match the visible graph registry.',
        }),
      );
    }

    try {
      await loadGraphSnapshot(await this.getDb(), namespace, this.documentScope);
    } catch (error) {
      throw new VersionStoreProviderError(
        mapGraphDiagnostics([graphLoadDiagnostic(error, namespace, 'readHead')], 'openGraph')[0],
      );
    }

    return new IndexedDbVersionGraphStore({
      namespace,
      documentScope: this.documentScope,
      accessContext: normalizeVersionAccessContext(accessContext),
      getDb: () => this.getDb(),
    });
  }

  async openMergeApplyIntentStore(
    namespace: VersionGraphNamespace,
  ): Promise<IndexedDbMergeApplyIntentStore> {
    await this.openGraph(namespace);
    return new IndexedDbMergeApplyIntentStore({
      namespace,
      documentScope: this.documentScope,
      getDb: () => this.getDb(),
    });
  }

  async openPendingRemoteSegmentStore(
    namespace: VersionGraphNamespace,
  ): Promise<IndexedDbPendingRemoteSegmentStore> {
    await this.openGraph(namespace);
    return new IndexedDbPendingRemoteSegmentStore({
      namespace,
      documentScope: this.documentScope,
      getDb: () => this.getDb(),
    });
  }

  async openAppliedSyncUpdateIdentityStore(): Promise<IndexedDbAppliedSyncUpdateIdentityStore> {
    return new IndexedDbAppliedSyncUpdateIdentityStore({
      documentScope: this.documentScope,
      getDb: () => this.getDb(),
    });
  }

  async openSyncBatchStatusStore(): Promise<IndexedDbSyncBatchStatusStore> {
    return new IndexedDbSyncBatchStatusStore({
      documentScope: this.documentScope,
      getDb: () => this.getDb(),
    });
  }

  async openWorkbookVersionReviewRecordStore(): Promise<IndexedDbWorkbookVersionReviewRecordStore> {
    return new IndexedDbWorkbookVersionReviewRecordStore({
      documentScope: this.documentScope,
      getDb: () => this.getDb(),
    });
  }

  async openAgentProposalMetadataStore(): Promise<IndexedDbAgentProposalMetadataStore> {
    return new IndexedDbAgentProposalMetadataStore({
      documentScope: this.documentScope,
      getDb: () => this.getDb(),
    });
  }

  async scanDocumentIntegrity(
    _options: VersionDocumentIntegrityScanOptions = {},
  ): Promise<VersionIntegrityReport> {
    this.assertAvailable('scanDocumentIntegrity');
    return {
      status: 'degraded',
      checkedAt: new Date().toISOString(),
      scanScope: 'document',
      diagnostics: [
        versionStoreDiagnostic('VERSION_STORE_UNAVAILABLE', {
          operation: 'scanDocumentIntegrity',
          documentScope: this.documentScope,
          recoverability: 'unsupported',
          safeMessage: 'Document integrity scans are not supported by this provider.',
        }),
      ],
    };
  }

  async close(_reason: VersionStoreCloseReason = 'workbook-close'): Promise<void> {
    if (this.lifecycleState === 'closed' || this.lifecycleState === 'disposed') return;
    if (this.lifecycleState === 'disposing') return;
    this.lifecycleState = 'closing';
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.lifecycleState = 'closed';
  }

  async dispose(reason: VersionStoreCloseReason = 'dispose'): Promise<void> {
    if (this.lifecycleState === 'disposed') return;
    if (this.lifecycleState === 'open') {
      await this.close(reason);
    }
    this.lifecycleState = 'disposing';
    if (this.db) {
      this.db.close();
      this.db = null;
    }
    this.lifecycleState = 'disposed';
  }

  private async initializeAgainstExistingRegistry(
    existingRegistry: VersionGraphRegistry,
    namespace: VersionGraphNamespace,
    initialized: Extract<VersionGraphWriteResult, { status: 'success' }>,
  ): Promise<VersionGraphInitializeResult> {
    if (
      existingRegistry.currentGraphId === namespace.graphId &&
      existingRegistry.rootCommitId === initialized.commit.id
    ) {
      const graph = await this.openGraph(namespace);
      const main = await graph.readRef(VERSION_GRAPH_MAIN_REF);
      if (main.status === 'success' && main.ref.name === VERSION_GRAPH_MAIN_REF) {
        return initializeSuccess(existingRegistry, main.ref);
      }

      return failedStoreResult(
        [
          versionStoreDiagnostic('VERSION_PROVIDER_FAILED', {
            operation: 'initializeGraph',
            documentScope: this.documentScope,
            namespace,
            recoverability: 'repair',
            safeMessage: 'Visible graph registry points at an unreadable graph.',
          }),
        ],
        'no-write-attempted',
      );
    }

    return failedStoreResult(
      [
        versionStoreDiagnostic('VERSION_GRAPH_CONFLICT', {
          operation: 'initializeGraph',
          documentScope: this.documentScope,
          namespace,
          commitId: existingRegistry.rootCommitId,
          recoverability: 'retry',
          safeMessage: 'A version graph registry already exists for this document.',
        }),
      ],
      'no-write-attempted',
      true,
    );
  }

  private async readRegistryRecord(): Promise<RegistryRecordRead> {
    return readIndexedDbBackendRegistryRecord({
      db: await this.getDb(),
      scopeKey: this.scopeKey,
      documentScope: this.documentScope,
    });
  }

  private assertAvailable(operation: VersionStoreOperation): void {
    if (this.lifecycleState === 'open') return;
    throw new VersionStoreProviderError(
      indexedDbBackendLifecycleUnavailableDiagnostic({
        operation,
        documentScope: this.documentScope,
        lifecycleState: this.lifecycleState,
      }),
    );
  }

  private writeUnavailableFailure(operation: VersionStoreOperation): VersionStoreFailure | null {
    if (this.lifecycleState !== 'open') {
      return indexedDbBackendLifecycleUnavailableFailure({
        operation,
        documentScope: this.documentScope,
        lifecycleState: this.lifecycleState,
      });
    }
    if (!this.capabilities.writes.initializeGraph) {
      return indexedDbBackendReadOnlyFailure({
        operation,
        documentScope: this.documentScope,
      });
    }
    return null;
  }

  private async getDb(): Promise<IDBDatabase> {
    if (this.db) return this.db;
    this.db = await openVersionStoreIndexedDb();
    return this.db;
  }

  private get scopeKey(): string {
    return versionDocumentScopeKey(this.documentScope);
  }
}

export function createIndexedDbVersionStoreProvider(
  options: IndexedDbVersionStoreProviderOptions,
): IndexedDbVersionStoreProvider {
  return new IndexedDbVersionStoreProvider(options);
}
