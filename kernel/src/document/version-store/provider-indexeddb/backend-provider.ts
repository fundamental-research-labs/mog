import {
  cloneVersionStoreCapabilities,
  type VersionAccessContext,
  type VersionDocumentIntegrityScanOptions,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
  type VersionGraphRegistryReadResult,
  type VersionGraphStore,
  type VersionIntegrityReport,
  type VersionStoreCapabilities,
  type VersionStoreCloseReason,
  type VersionStoreFailure,
  type VersionStoreLifecycleState,
  type VersionStoreOperation,
  type VersionStoreProvider,
  VersionStoreProviderError,
} from '../provider';
import {
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
  type VersionDocumentScope,
} from '../registry';
import type { VersionGraphNamespace } from '../object-store';
import { openVersionStoreIndexedDb } from '../provider-indexeddb-schema';
import {
  normalizeVersionAccessContext,
  readOnlyCapabilities,
  registryRecordResult,
  versionStoreDiagnostic,
  type RegistryRecordRead,
} from './internal';
import { IndexedDbMergeApplyIntentStore } from '../provider-indexeddb-merge-intents';
import { IndexedDbPendingRemoteSegmentStore } from '../provider-indexeddb-pending-remote-segments';
import { IndexedDbAppliedSyncUpdateIdentityStore } from '../provider-indexeddb-applied-sync-updates';
import { IndexedDbSyncBatchStatusStore } from '../provider-indexeddb-sync-batch-statuses';
import { IndexedDbWorkbookVersionReviewRecordStore } from '../provider-indexeddb-review-records';
import { IndexedDbAgentProposalMetadataStore } from '../provider-indexeddb-proposals';
import { IndexedDbActiveCheckoutMaterializationStore } from '../provider-indexeddb-active-checkouts';
import {
  indexedDbBackendLifecycleUnavailableDiagnostic,
  indexedDbBackendLifecycleUnavailableFailure,
  indexedDbBackendReadOnlyFailure,
} from './backend-diagnostics';
import { initializeIndexedDbBackendGraph } from './backend-initialize';
import { openIndexedDbBackendGraph } from './backend-open-graph';
import { readIndexedDbBackendRegistryRecord } from './backend-registry';
import { INDEXEDDB_VERSION_STORE_CAPABILITIES } from './backend-capabilities';
import {
  INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
  type IndexedDbVersionStoreProviderOptions,
} from './backend-types';

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
    return initializeIndexedDbBackendGraph({
      input,
      capabilities: this.capabilities,
      documentScope: this.documentScope,
      scopeKey: this.scopeKey,
      writeFailure: this.writeUnavailableFailure('initializeGraph'),
      getDb: () => this.getDb(),
      readRegistryRecord: () => this.readRegistryRecord(),
      openGraph: (namespace) => this.openGraph(namespace),
    });
  }

  async openGraph(
    namespaceInput: VersionGraphNamespace,
    accessContext: VersionAccessContext = this.accessContext,
  ): Promise<VersionGraphStore> {
    this.assertAvailable('openGraph');
    return openIndexedDbBackendGraph({
      namespaceInput,
      accessContext,
      documentScope: this.documentScope,
      getDb: () => this.getDb(),
      readRegistryRecord: () => this.readRegistryRecord(),
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

  async openActiveCheckoutMaterializationStore(): Promise<IndexedDbActiveCheckoutMaterializationStore> {
    return new IndexedDbActiveCheckoutMaterializationStore({
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
