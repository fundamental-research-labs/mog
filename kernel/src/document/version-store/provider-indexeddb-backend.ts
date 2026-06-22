import {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  createInMemoryVersionGraphStore,
  type InMemoryVersionGraphStore,
  type InMemoryVersionGraphStoreSnapshot,
  type CommitVersionGraphInput,
  type FastForwardVersionGraphInput,
  type MergeVersionGraphInput,
  type VersionGraphClosureReadResult,
  type VersionGraphCommitPageResult,
  type VersionGraphListCommitsOptions,
  type VersionGraphReadHeadResult,
  type VersionGraphReadRefResult,
  type VersionGraphRef,
  type VersionGraphRefSelector,
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
  type VersionStoreDiagnostic,
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
  type VersionObjectPutBatchResult,
  type VersionObjectRecord,
} from './object-store';
import type { ReadWorkbookCommitResult } from './commit-store';
import {
  parseWorkbookCommitId,
  type VersionDependencyRef,
  type WorkbookCommitId,
} from './object-digest';
import { REGISTRIES_STORE, openVersionStoreIndexedDb } from './provider-indexeddb-schema';
import { REF_NAME_STORAGE_PREFIX } from './ref-name';
import {
  RefCasConflictError,
  cloneJson,
  decodeRegistryEnvelope,
  errorMessage,
  failedGraphWrite,
  failedStoreResult,
  graphDiagnostic,
  idbRequest,
  idbTransactionDone,
  initializeSuccess,
  liveMainFromSnapshot,
  mapGraphDiagnostics,
  normalizeVersionAccessContext,
  persistObjectRecords,
  persistGraphSnapshot,
  readOnlyCapabilities,
  registryEnvelope,
  registryRecordResult,
  rootCommitFromSnapshot,
  versionGraphRefFromLiveRef,
  versionStoreDiagnostic,
  type RegistryRecordRead,
  type StoredRegistryEnvelope,
} from './provider-indexeddb-internal';
import {
  createIndexedDbGraphBranchLifecycle,
  type IndexedDbGraphBranchLifecycle,
} from './provider-indexeddb-branch-lifecycle';
import { graphLoadDiagnostic, loadGraphSnapshot } from './provider-indexeddb-reload';
import { IndexedDbMergeApplyIntentStore } from './provider-indexeddb-merge-intents';
import { IndexedDbPendingRemoteSegmentStore } from './provider-indexeddb-pending-remote-segments';
import { IndexedDbAppliedSyncUpdateIdentityStore } from './provider-indexeddb-applied-sync-updates';
import { IndexedDbSyncBatchStatusStore } from './provider-indexeddb-sync-batch-statuses';

export const INDEXEDDB_VERSION_STORE_PROVIDER_KIND = 'indexeddb' as const;

export const INDEXEDDB_VERSION_STORE_CAPABILITIES: VersionStoreCapabilities =
  cloneVersionStoreCapabilities({
    durableGraphRegistry: true,
    durableObjects: true,
    atomicObjectBatch: true,
    casRefs: true,
    casGraphRegistry: true,
    multiProcessCasGraphRegistry: false,
    multiProcessCasRefs: false,
    readOnlyHistory: false,
    integrityScan: false,
    corruptionQuarantine: false,
    reads: {
      graphRegistry: true,
      objects: true,
      refs: true,
      commits: true,
      snapshots: false,
      integrityReports: false,
    },
    writes: {
      initializeGraph: true,
      putObjects: true,
      updateRefs: true,
      updateSymbolicRefs: true,
      commitGraphWrite: true,
      repairIndexes: false,
      quarantineCorruptRecords: false,
    },
  });

export type IndexedDbVersionStoreProviderOptions = {
  readonly documentScope: VersionDocumentScope;
  readonly accessContext?: VersionAccessContext;
  readonly readOnly?: boolean;
};

export class IndexedDbVersionStoreProvider implements VersionStoreProvider {
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
    const persisted = await this.persistInitializedGraphSnapshot(snapshot, this.documentScope);
    if (persisted.status !== 'success') {
      return persisted;
    }

    const registry = await createVersionGraphRegistry({
      documentScope: this.documentScope,
      graphId: namespace.graphId,
      rootCommitId: dryRunInitialized.commit.id,
      createdAt: dryRunInitialized.commit.payload.createdAt,
    });
    const published = await this.publishRegistryVisibleLast(registry);
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

  async openMergeApplyIntentStore(namespace: VersionGraphNamespace): Promise<IndexedDbMergeApplyIntentStore> {
    await this.openGraph(namespace);
    return new IndexedDbMergeApplyIntentStore({
      namespace,
      documentScope: this.documentScope,
      getDb: () => this.getDb(),
    });
  }

  async openPendingRemoteSegmentStore(namespace: VersionGraphNamespace): Promise<IndexedDbPendingRemoteSegmentStore> {
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
    const db = await this.getDb();
    const value = await idbRequest<StoredRegistryEnvelope | undefined>(
      db.transaction(REGISTRIES_STORE, 'readonly').objectStore(REGISTRIES_STORE).get(this.scopeKey),
    );
    if (value === undefined) return { status: 'absent' };
    return decodeRegistryEnvelope(value, this.documentScope);
  }

  private async persistInitializedGraphSnapshot(
    snapshot: InMemoryVersionGraphStoreSnapshot,
    documentScope: VersionDocumentScope,
  ): Promise<Extract<VersionGraphInitializeResult, { status: 'success' }> | VersionStoreFailure> {
    try {
      await persistGraphSnapshot({
        db: await this.getDb(),
        snapshot,
        documentScope,
        mode: { kind: 'initialize' },
      });
      const main = liveMainFromSnapshot(snapshot);
      const rootCommit = rootCommitFromSnapshot(snapshot, main.targetCommitId);
      return initializeSuccess(
        await createVersionGraphRegistry({
          documentScope,
          graphId: snapshot.namespace.graphId,
          rootCommitId: rootCommit,
          createdAt: main.createdAt,
        }),
        versionGraphRefFromLiveRef(main),
      );
    } catch (error) {
      return failedStoreResult(
        [
          versionStoreDiagnostic('VERSION_PROVIDER_FAILED', {
            operation: 'initializeGraph',
            documentScope,
            namespace: snapshot.namespace,
            recoverability: 'retry',
            safeMessage: 'IndexedDB version graph bootstrap failed before registry publication.',
            details: { cause: errorMessage(error) },
          }),
        ],
        'registry-not-visible',
        true,
      );
    }
  }

  private async publishRegistryVisibleLast(
    registry: VersionGraphRegistry,
  ): Promise<
    | { readonly status: 'published' }
    | { readonly status: 'same'; readonly registry: VersionGraphRegistry }
    | { readonly status: 'failed'; readonly failure: VersionStoreFailure }
  > {
    const db = await this.getDb();
    const tx = db.transaction(REGISTRIES_STORE, 'readwrite');
    const store = tx.objectStore(REGISTRIES_STORE);
    const existing = await idbRequest<StoredRegistryEnvelope | undefined>(store.get(this.scopeKey));
    if (existing === undefined) {
      store.put(registryEnvelope(registry), this.scopeKey);
      await idbTransactionDone(tx);
      return { status: 'published' };
    }
    await idbTransactionDone(tx);

    const decoded = await decodeRegistryEnvelope(existing, this.documentScope);
    if (decoded.status === 'valid') {
      if (
        decoded.registry.currentGraphId === registry.currentGraphId &&
        decoded.registry.rootCommitId === registry.rootCommitId
      ) {
        return { status: 'same', registry: decoded.registry };
      }
      return {
        status: 'failed',
        failure: failedStoreResult(
          [
            versionStoreDiagnostic('VERSION_GRAPH_CONFLICT', {
              operation: 'initializeGraph',
              documentScope: this.documentScope,
              commitId: decoded.registry.rootCommitId,
              recoverability: 'retry',
              safeMessage: 'A version graph registry already exists for this document.',
            }),
          ],
          'registry-not-visible',
          true,
        ),
      };
    }

    return {
      status: 'failed',
      failure: failedStoreResult(
        registryRecordResult(decoded.status, 'initializeGraph', this.documentScope).diagnostics,
        'registry-not-visible',
      ),
    };
  }

  private assertAvailable(operation: VersionStoreOperation): void {
    if (this.lifecycleState === 'open') return;
    throw new VersionStoreProviderError(this.lifecycleUnavailableDiagnostic(operation));
  }

  private writeUnavailableFailure(operation: VersionStoreOperation): VersionStoreFailure | null {
    if (this.lifecycleState !== 'open') {
      return failedStoreResult(
        [this.lifecycleUnavailableDiagnostic(operation)],
        'no-write-attempted',
        true,
      );
    }
    if (!this.capabilities.writes.initializeGraph) {
      return failedStoreResult(
        [
          versionStoreDiagnostic('VERSION_STORE_READ_ONLY', {
            operation,
            documentScope: this.documentScope,
            safeMessage: 'Version store provider is opened read-only.',
          }),
        ],
        'no-write-attempted',
      );
    }
    return null;
  }

  private lifecycleUnavailableDiagnostic(operation: VersionStoreOperation): VersionStoreDiagnostic {
    return versionStoreDiagnostic('VERSION_STORE_UNAVAILABLE', {
      operation,
      documentScope: this.documentScope,
      recoverability: 'retry',
      lifecycleState: this.lifecycleState,
      safeMessage: 'Version store provider is closed or disposing.',
    });
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

class IndexedDbVersionGraphStore implements VersionGraphStore {
  readonly namespace: VersionGraphNamespace;

  private readonly documentScope: VersionDocumentScope;
  private readonly accessContext: VersionAccessContext;
  private readonly getDb: () => Promise<IDBDatabase>;
  private readonly branchLifecycle: IndexedDbGraphBranchLifecycle;

  constructor(options: {
    readonly namespace: VersionGraphNamespace;
    readonly documentScope: VersionDocumentScope;
    readonly accessContext: VersionAccessContext;
    readonly getDb: () => Promise<IDBDatabase>;
  }) {
    this.namespace = normalizeVersionGraphNamespace(options.namespace);
    this.documentScope = normalizeVersionDocumentScope(options.documentScope);
    this.accessContext = normalizeVersionAccessContext(options.accessContext);
    this.getDb = options.getDb;
    this.branchLifecycle = createIndexedDbGraphBranchLifecycle({
      namespace: this.namespace,
      documentScope: this.documentScope,
      getDb: this.getDb,
    });
  }

  async initializeGraph(
    input: VersionGraphInitializeInput['rootWrite'],
  ): Promise<VersionGraphWriteResult> {
    const graph = createInMemoryVersionGraphStore({ namespace: this.namespace });
    const initialized = await graph.initializeGraph(input);
    if (initialized.status !== 'success') return initialized;

    try {
      await persistGraphSnapshot({
        db: await this.getDb(),
        snapshot: await graph.exportSnapshot(),
        documentScope: this.documentScope,
        mode: { kind: 'initialize' },
      });
      return initialized;
    } catch (error) {
      return failedGraphWrite(
        [
          graphDiagnostic(
            'VERSION_OBJECT_STORE_FAILURE',
            'IndexedDB graph initialization failed.',
            {
              operation: 'initializeGraph',
              namespace: this.namespace,
              details: { cause: errorMessage(error) },
            },
          ),
        ],
        'no-write-attempted',
      );
    }
  }

  async commit(input: CommitVersionGraphInput): Promise<VersionGraphWriteResult> {
    return this.commitWithLoadedGraph('commit', input, (graph) => graph.commit(input));
  }

  async mergeCommit(input: MergeVersionGraphInput): Promise<VersionGraphWriteResult> {
    return this.commitWithLoadedGraph('mergeCommit', input, (graph) => graph.mergeCommit(input));
  }

  async fastForwardRef(input: FastForwardVersionGraphInput): Promise<VersionGraphWriteResult> {
    return this.commitWithLoadedGraph('fastForwardRef', input, (graph) =>
      graph.fastForwardRef(input),
    );
  }

  async putObjects(
    batch: readonly VersionObjectRecord<unknown>[],
  ): Promise<VersionObjectPutBatchResult> {
    let graph: InMemoryVersionGraphStore;
    try {
      graph = await this.loadGraph('putObjects');
    } catch (error) {
      return failedObjectBatch('IndexedDB graph could not be loaded while writing objects.', {
        cause: errorMessage(error),
      });
    }

    const putResult = await graph.putObjects(batch);
    if (putResult.status !== 'success') return putResult;

    try {
      await persistObjectRecords({
        db: await this.getDb(),
        namespace: this.namespace,
        documentScope: this.documentScope,
        records: putResult.records,
      });
      return putResult;
    } catch (error) {
      return failedObjectBatch('IndexedDB graph object batch could not be persisted.', {
        cause: errorMessage(error),
      });
    }
  }

  private async commitWithLoadedGraph(
    operation: 'commit' | 'mergeCommit' | 'fastForwardRef',
    input: CommitVersionGraphInput | MergeVersionGraphInput | FastForwardVersionGraphInput,
    write: (graph: InMemoryVersionGraphStore) => Promise<VersionGraphWriteResult>,
  ): Promise<VersionGraphWriteResult> {
    let graph: InMemoryVersionGraphStore;
    try {
      graph = await this.loadGraph(operation);
    } catch (error) {
      return failedGraphWrite(
        [graphLoadDiagnostic(error, this.namespace, operation)],
        'no-write-attempted',
      );
    }

    const result = await write(graph);
    if (result.status !== 'success') return result;
    const expectedRefVersion = input.expectedTargetRefVersion ?? input.expectedMainRefVersion;
    if (expectedRefVersion === undefined) {
      return failedGraphWrite(
        [
          graphDiagnostic(
            'VERSION_INVALID_OPTIONS',
            'IndexedDB graph commit is missing target ref CAS metadata.',
            {
              refName: result.ref.name,
              operation,
              namespace: this.namespace,
              details: { missingField: 'expectedTargetRefVersion' },
            },
          ),
        ],
        'no-write-attempted',
      );
    }

    try {
      await persistGraphSnapshot({
        db: await this.getDb(),
        snapshot: await graph.exportSnapshot(),
        documentScope: this.documentScope,
        mode: {
          kind: 'commit',
          targetRefName: storageRefNameFromGraphRefName(result.ref.name),
          expectedHeadCommitId: parseWorkbookCommitId(input.expectedHeadCommitId),
          expectedRefVersion,
          ...(operation === 'fastForwardRef'
            ? { refCasProof: { applyKind: 'fastForward' as const } }
            : operation === 'mergeCommit'
              ? { refCasProof: { applyKind: 'mergeCommit' as const } }
            : {}),
        },
      });
      return result;
    } catch (error) {
      if (error instanceof RefCasConflictError) {
        return failedGraphWrite(
          [
            graphDiagnostic(
              'VERSION_REF_CONFLICT',
              'Graph ref no longer matches expected head.',
              {
                refName: result.ref.name,
                commitId: error.actualHead,
                operation,
                namespace: this.namespace,
                details: {
                  expectedHead: error.expectedHead,
                  actualHead: error.actualHead,
                  expectedRefVersion: error.expectedRefVersion.value,
                  actualRefVersion: error.actualRefVersion.value,
                },
              },
            ),
          ],
          'no-write-attempted',
        );
      }
      return failedGraphWrite(
        [
          graphDiagnostic('VERSION_OBJECT_STORE_FAILURE', 'IndexedDB graph commit failed.', {
            operation,
            namespace: this.namespace,
            details: { cause: errorMessage(error) },
          }),
        ],
        'ref-not-mutated',
      );
    }
  }

  async readCommit(commitId: WorkbookCommitId | string): Promise<ReadWorkbookCommitResult> {
    let parsedCommitId: WorkbookCommitId;
    try {
      parsedCommitId = parseWorkbookCommitId(commitId);
    } catch {
      return {
        status: 'failed',
        diagnostics: [
          {
            code: 'VERSION_INVALID_COMMIT_ID',
            severity: 'error',
            message: 'Commit id must be commit:sha256:<64 hex>.',
          },
        ],
      };
    }

    try {
      return await (await this.loadGraph('readCommit')).readCommit(parsedCommitId);
    } catch (error) {
      return {
        status: 'failed',
        diagnostics: [
          {
            code: 'VERSION_OBJECT_STORE_FAILURE',
            severity: 'error',
            message: 'IndexedDB graph could not be loaded while reading commit.',
            commitId: parsedCommitId,
            details: { cause: errorMessage(error) },
          },
        ],
      };
    }
  }

  async getObjectRecord<TPayload>(
    ref: VersionDependencyRef,
  ): Promise<VersionObjectRecord<TPayload>> {
    return (await this.loadGraph('getObjectRecord')).getObjectRecord<TPayload>(ref);
  }

  async hasObject(ref: VersionDependencyRef): Promise<boolean> {
    return (await this.loadGraph('hasObject')).hasObject(ref);
  }

  async readHead(): Promise<VersionGraphReadHeadResult> {
    try {
      return await (await this.loadGraph('readHead')).readHead();
    } catch (error) {
      return {
        status: 'degraded',
        head: null,
        diagnostics: [graphLoadDiagnostic(error, this.namespace, 'readHead')],
      };
    }
  }

  async readRef(name: VersionGraphRefSelector | string): Promise<VersionGraphReadRefResult> {
    try {
      return await (await this.loadGraph('readRef')).readRef(name);
    } catch (error) {
      return {
        status: 'degraded',
        ref: null,
        diagnostics: [graphLoadDiagnostic(error, this.namespace, 'readRef')],
      };
    }
  }

  async createBranch(...args: Parameters<IndexedDbGraphBranchLifecycle['createBranch']>) { return this.branchLifecycle.createBranch(...args); }
  async readBranch(...args: Parameters<IndexedDbGraphBranchLifecycle['readBranch']>) { return this.branchLifecycle.readBranch(...args); }
  async listBranches(...args: Parameters<IndexedDbGraphBranchLifecycle['listBranches']>) { return this.branchLifecycle.listBranches(...args); }
  async fastForwardBranch(...args: Parameters<IndexedDbGraphBranchLifecycle['fastForwardBranch']>) { return this.branchLifecycle.fastForwardBranch(...args); }
  async getHead() { return this.branchLifecycle.getHead(); }

  async listCommits(
    options?: VersionGraphListCommitsOptions,
  ): Promise<VersionGraphCommitPageResult> {
    try {
      return await (await this.loadGraph('listCommits')).listCommits(options);
    } catch (error) {
      return {
        status: 'failed',
        diagnostics: [graphLoadDiagnostic(error, this.namespace, 'listCommits')],
      };
    }
  }

  async readCommitClosure(
    commitId: WorkbookCommitId | string,
  ): Promise<VersionGraphClosureReadResult> {
    try {
      return await (await this.loadGraph('readCommitClosure')).readCommitClosure(commitId);
    } catch (error) {
      return {
        status: 'failed',
        diagnostics: [graphLoadDiagnostic(error, this.namespace, 'readCommitClosure')],
      };
    }
  }

  private async loadGraph(operation: string): Promise<InMemoryVersionGraphStore> {
    void operation;
    return loadGraphSnapshot(await this.getDb(), this.namespace, this.documentScope);
  }
}

function storageRefNameFromGraphRefName(name: string): string {
  return name.startsWith(REF_NAME_STORAGE_PREFIX) ? name.slice(REF_NAME_STORAGE_PREFIX.length) : name;
}

function failedObjectBatch(
  message: string,
  details: Readonly<Record<string, string | number | boolean | null>>,
): VersionObjectPutBatchResult {
  return {
    status: 'failed',
    diagnostics: [
      {
        code: 'VERSION_STORE_UNAVAILABLE',
        severity: 'error',
        message,
        details,
      },
    ],
    mutationGuarantee: 'no-objects-written',
  };
}
