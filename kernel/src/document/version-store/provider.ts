import {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  createInMemoryVersionGraphStore,
  type InitializeVersionGraphInput,
  type InMemoryVersionGraphStore,
  type VersionGraphCommitRef,
  type VersionGraphRef,
  type VersionGraphStoreDiagnostic,
  type VersionGraphStoreDiagnosticCode,
  type VersionGraphSymbolicRef,
} from './graph-store';
import type { WorkbookCommitId } from './object-digest';
import { normalizeVersionGraphNamespace, versionGraphNamespaceKey, type VersionGraphNamespace } from './object-store';
import type { VersionGraphStore } from './provider-graph-store';
import { InMemoryVersionDocumentProviderBackend, type InMemoryVersionProviderDurability } from './provider-memory-backend';
import { InMemoryMergeApplyIntentStore } from './merge-apply-intent-store';
import { InMemoryPendingRemoteSegmentStore } from './pending-remote-segment-store';
import { InMemoryAppliedSyncUpdateIdentityStore } from './applied-sync-update-identity-store';
import { InMemorySyncBatchStatusStore } from './sync-batch-status-store';
import { InMemoryWorkbookVersionReviewRecordStore } from './review-service';
import { cloneVersionGraphRegistry, createVersionGraphRegistry, namespaceForDocumentScope, namespaceForRegistry, normalizeVersionDocumentScope, normalizeVersionStoreString, type VersionDocumentScope, type VersionGraphRegistry, type VersionRecordRevision } from './registry';

export {
  VERSION_GRAPH_REGISTRY_CHECKSUM_DOMAIN,
  VERSION_GRAPH_REGISTRY_SCHEMA_VERSION,
  createVersionGraphRegistry,
  namespaceForDocumentScope,
  normalizeVersionDocumentScope,
  versionDocumentScopeKey,
} from './registry';
export type { VersionDocumentScope, VersionGraphRegistry, VersionRecordRevision } from './registry';
export { InMemoryVersionDocumentProviderBackend, type InMemoryVersionDocumentProviderBackendSnapshot } from './provider-memory-backend';
export type { VersionGraphStore } from './provider-graph-store';

export type VersionAccessContext = {
  readonly principalScope?: string;
  readonly capabilityIds?: readonly string[];
  readonly diagnosticsAllowed?: boolean;
};

export type VersionStoreCapabilities = {
  readonly durableGraphRegistry: boolean;
  readonly durableObjects: boolean;
  readonly atomicObjectBatch: boolean;
  readonly casRefs: boolean;
  readonly casGraphRegistry: boolean;
  readonly multiProcessCasGraphRegistry: boolean;
  readonly multiProcessCasRefs: boolean;
  readonly readOnlyHistory: boolean;
  readonly integrityScan: boolean;
  readonly corruptionQuarantine: boolean;
  readonly reads: {
    readonly graphRegistry: boolean;
    readonly objects: boolean;
    readonly refs: boolean;
    readonly commits: boolean;
    readonly snapshots: boolean;
    readonly integrityReports: boolean;
  };
  readonly writes: {
    readonly initializeGraph: boolean;
    readonly putObjects: boolean;
    readonly updateRefs: boolean;
    readonly updateSymbolicRefs: boolean;
    readonly commitGraphWrite: boolean;
    readonly repairIndexes: boolean;
    readonly quarantineCorruptRecords: boolean;
  };
};

export type VersionStoreCloseReason = 'workbook-close' | 'dispose' | 'error' | 'test-teardown';
export type VersionStoreLifecycleState =
  | 'open'
  | 'closing'
  | 'close-failed'
  | 'closed'
  | 'disposing'
  | 'dispose-failed'
  | 'disposed';

export type VersionStoreOperation =
  | 'readGraphRegistry'
  | 'initializeGraph'
  | 'openGraph'
  | 'commitGraphWrite'
  | 'scanDocumentIntegrity'
  | 'close'
  | 'dispose';

export type VersionStoreMutationGuarantee =
  | 'ref-not-mutated'
  | 'registry-not-visible'
  | 'no-write-attempted'
  | 'unknown-after-crash';

export type VersionStoreDiagnosticCode =
  | VersionGraphStoreDiagnosticCode
  | 'VERSION_STORE_READ_ONLY'
  | 'VERSION_STORE_UNAVAILABLE'
  | 'VERSION_UNSUPPORTED_DURABLE_PERSISTENCE'
  | 'VERSION_UNSUPPORTED_REGISTRY'
  | 'VERSION_CORRUPT_REGISTRY'
  | 'VERSION_MISSING_CHANGE_SET'
  | 'VERSION_PROVIDER_FAILED';

export type VersionDiagnosticMessageId =
  | 'version.store.unavailable'
  | 'version.provider.failed'
  | 'version.store.read-only'
  | 'version.graph.uninitialized'
  | 'version.graph.conflict'
  | 'version.registry.unsupported'
  | 'version.registry.corrupt'
  | 'version.integrity.wrong-namespace'
  | 'version.integrity.missing-object'
  | 'version.integrity.missing-parent'
  | 'version.integrity.missing-change-set'
  | 'version.ref.conflict'
  | 'version.ref.dangling'
  | 'version.options.invalid'
  | 'version.page-cursor.stale'
  | 'version.unsupported';

export type VersionStoreDiagnostic = {
  readonly code: VersionStoreDiagnosticCode;
  readonly issueCode: VersionStoreDiagnosticCode;
  readonly severity: 'info' | 'warning' | 'error' | 'fatal';
  readonly recoverability: 'retry' | 'repair' | 'unsupported' | 'none';
  readonly messageTemplateId: VersionDiagnosticMessageId;
  readonly safeMessage: string;
  readonly message: string;
  readonly operation: VersionStoreOperation;
  readonly redacted: true;
  readonly documentScope?: VersionDocumentScope;
  readonly namespace?: VersionGraphNamespace;
  readonly refName?: string;
  readonly commitId?: WorkbookCommitId;
  readonly mutationGuarantee?: VersionStoreMutationGuarantee;
  readonly lifecycleState?: VersionStoreLifecycleState;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
  readonly sourceDiagnostics?: readonly VersionGraphStoreDiagnostic[];
};

export type VersionStoreFailure = {
  readonly status: 'failed';
  readonly diagnostics: readonly VersionStoreDiagnostic[];
  readonly mutationGuarantee: Extract<
    VersionStoreMutationGuarantee,
    'ref-not-mutated' | 'registry-not-visible' | 'no-write-attempted'
  >;
  readonly retryable: boolean;
};

export type VersionGraphRegistryReadResult =
  | {
      readonly status: 'ok';
      readonly registry: VersionGraphRegistry;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    }
  | {
      readonly status: 'absent';
      readonly registry: null;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    }
  | {
      readonly status: 'unsupported';
      readonly registry: null;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
      readonly mutationGuarantee: 'no-write-attempted';
    }
  | {
      readonly status: 'corrupt';
      readonly registry: null;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
      readonly mutationGuarantee: 'no-write-attempted';
    };

export type VersionGraphInitializeInput = {
  readonly expectedRegistryRevision: VersionRecordRevision | null;
  readonly graphId: string;
  readonly rootWrite: InitializeVersionGraphInput;
  readonly requireDurablePersistence?: boolean;
};

export type VersionGraphInitializeResult =
  | {
      readonly status: 'success';
      readonly registry: VersionGraphRegistry;
      readonly rootCommit: VersionGraphCommitRef;
      readonly initialHead: VersionGraphRef;
      readonly symbolicHead: VersionGraphSymbolicRef;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    }
  | VersionStoreFailure;

export type VersionDocumentIntegrityScanOptions = {
  readonly includeOrphanGraphs?: boolean;
  readonly quarantineCorruptRecords?: boolean;
};

export type VersionIntegrityReport = {
  readonly status: 'ok' | 'degraded' | 'corrupt';
  readonly checkedAt: string;
  readonly scanScope: 'document';
  readonly diagnostics: readonly VersionStoreDiagnostic[];
};

export interface VersionStoreProvider {
  readonly documentScope: VersionDocumentScope;
  readonly accessContext: VersionAccessContext;
  readonly capabilities: VersionStoreCapabilities;
  readGraphRegistry(): Promise<VersionGraphRegistryReadResult>;
  initializeGraph(input: VersionGraphInitializeInput): Promise<VersionGraphInitializeResult>;
  openGraph(
    namespace: VersionGraphNamespace,
    accessContext?: VersionAccessContext,
  ): Promise<VersionGraphStore>;
  scanDocumentIntegrity(
    options?: VersionDocumentIntegrityScanOptions,
  ): Promise<VersionIntegrityReport>;
  close(reason?: VersionStoreCloseReason): Promise<void>;
  dispose(reason?: VersionStoreCloseReason): Promise<void>;
}

export class VersionStoreProviderError extends Error {
  readonly diagnostic: VersionStoreDiagnostic;
  readonly diagnostics: readonly VersionStoreDiagnostic[];

  constructor(diagnostic: VersionStoreDiagnostic) {
    super(diagnostic.safeMessage);
    this.name = 'VersionStoreProviderError';
    this.diagnostic = diagnostic;
    this.diagnostics = Object.freeze([diagnostic]);
  }
}

export const IN_MEMORY_VERSION_STORE_CAPABILITIES: VersionStoreCapabilities = freezeCapabilities({
  durableGraphRegistry: false,
  durableObjects: false,
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

export const IN_MEMORY_DURABLE_SNAPSHOT_VERSION_STORE_CAPABILITIES: VersionStoreCapabilities =
  freezeCapabilities({
    ...IN_MEMORY_VERSION_STORE_CAPABILITIES,
    durableGraphRegistry: true,
    durableObjects: true,
  });

export type InMemoryVersionStoreProviderOptions = {
  readonly documentScope: VersionDocumentScope;
  readonly accessContext?: VersionAccessContext;
  readonly backend?: InMemoryVersionDocumentProviderBackend;
  readonly durability?: InMemoryVersionProviderDurability;
  readonly readOnly?: boolean;
  readonly unavailable?: boolean;
};

export class InMemoryVersionStoreProvider implements VersionStoreProvider {
  readonly documentScope: VersionDocumentScope;
  readonly accessContext: VersionAccessContext;
  readonly capabilities: VersionStoreCapabilities;

  private readonly backend: InMemoryVersionDocumentProviderBackend;
  private readonly mode: 'read-write' | 'read-only' | 'unavailable';
  private readonly baseCapabilities: VersionStoreCapabilities;
  private lifecycleState: VersionStoreLifecycleState = 'open';

  constructor(options: InMemoryVersionStoreProviderOptions) {
    this.documentScope = normalizeVersionDocumentScope(options.documentScope);
    this.accessContext = normalizeVersionAccessContext(options.accessContext);
    this.backend = options.backend ?? new InMemoryVersionDocumentProviderBackend();
    this.mode = options.unavailable ? 'unavailable' : options.readOnly ? 'read-only' : 'read-write';
    this.baseCapabilities =
      options.durability === 'snapshot-test-double'
        ? IN_MEMORY_DURABLE_SNAPSHOT_VERSION_STORE_CAPABILITIES
        : IN_MEMORY_VERSION_STORE_CAPABILITIES;
    this.capabilities =
      this.mode === 'unavailable'
        ? unavailableCapabilities(this.baseCapabilities)
        : this.mode === 'read-only'
          ? readOnlyCapabilities(this.baseCapabilities)
          : cloneVersionStoreCapabilities(this.baseCapabilities);
  }

  async readGraphRegistry(): Promise<VersionGraphRegistryReadResult> {
    this.assertAvailable('readGraphRegistry');

    const registryRecord = this.backend.readRegistryRecord(this.documentScope);
    if (!registryRecord) {
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
    if (registryRecord.kind !== 'valid') {
      return registryRecordResult(registryRecord.kind, 'readGraphRegistry', this.documentScope);
    }

    return {
      status: 'ok',
      registry: registryRecord.registry,
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

    const existingRegistryRecord = this.backend.readRegistryRecord(this.documentScope);
    if (
      existingRegistryRecord?.kind === 'corrupt' ||
      existingRegistryRecord?.kind === 'unsupported'
    ) {
      return failedStoreResult(
        registryRecordResult(existingRegistryRecord.kind, 'initializeGraph', this.documentScope)
          .diagnostics,
        'no-write-attempted',
      );
    }

    if (existingRegistryRecord?.kind === 'valid') {
      const existingRegistry = existingRegistryRecord.registry;
      const dryRun = createInMemoryVersionGraphStore({ namespace });
      const dryRunInitialized = await dryRun.initializeGraph(input.rootWrite);
      if (dryRunInitialized.status !== 'success') {
        return failedStoreResult(
          mapGraphDiagnostics(dryRunInitialized.diagnostics, 'initializeGraph'),
          'no-write-attempted',
        );
      }

      if (
        existingRegistry.currentGraphId === namespace.graphId &&
        existingRegistry.rootCommitId === dryRunInitialized.commit.id
      ) {
        const existingGraph = this.backend.getGraph(namespace);
        if (!existingGraph) {
          return failedStoreResult(
            [
              versionStoreDiagnostic('VERSION_STORE_UNAVAILABLE', {
                operation: 'initializeGraph',
                documentScope: this.documentScope,
                namespace,
                recoverability: 'retry',
                safeMessage: 'Visible graph registry could not be opened by this provider.',
              }),
            ],
            'no-write-attempted',
            true,
          );
        }

        const main = await existingGraph.readRef(VERSION_GRAPH_MAIN_REF);
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

    const graph = this.backend.getOrCreateGraph(namespace);
    const initialized = await graph.initializeGraph(input.rootWrite);

    if (initialized.status !== 'success') {
      const diagnostics = mapGraphDiagnostics(initialized.diagnostics, 'initializeGraph');
      const mutationGuarantee =
        initialized.mutationGuarantee === 'ref-not-mutated'
          ? 'registry-not-visible'
          : 'no-write-attempted';
      return failedStoreResult(diagnostics, mutationGuarantee);
    }

    const registry = await createVersionGraphRegistry({
      documentScope: this.documentScope,
      graphId: namespace.graphId,
      rootCommitId: initialized.commit.id,
      createdAt: initialized.commit.payload.createdAt,
    });
    this.backend.setRegistry(this.documentScope, registry);

    return initializeSuccess(registry, initialized.main);
  }

  async openGraph(
    namespaceInput: VersionGraphNamespace,
    _accessContext: VersionAccessContext = this.accessContext,
  ): Promise<InMemoryVersionGraphStore> {
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

    const registryRecord = this.backend.readRegistryRecord(this.documentScope);
    if (!registryRecord) {
      throw new VersionStoreProviderError(
        versionStoreDiagnostic('VERSION_GRAPH_UNINITIALIZED', {
          operation: 'openGraph',
          documentScope: this.documentScope,
          namespace,
          safeMessage: 'Version graph registry has not been initialized for this document.',
        }),
      );
    }
    if (registryRecord.kind !== 'valid') {
      throw new VersionStoreProviderError(
        registryRecordResult(registryRecord.kind, 'openGraph', this.documentScope).diagnostics[0],
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

    const graph = this.backend.getGraph(namespace);
    if (!graph) {
      throw new VersionStoreProviderError(
        versionStoreDiagnostic('VERSION_STORE_UNAVAILABLE', {
          operation: 'openGraph',
          documentScope: this.documentScope,
          namespace,
          recoverability: 'retry',
          safeMessage: 'Visible graph registry could not be opened by this provider.',
        }),
      );
    }

    return graph;
  }

  async openMergeApplyIntentStore(namespace: VersionGraphNamespace): Promise<InMemoryMergeApplyIntentStore> {
    await this.openGraph(namespace);
    return new InMemoryMergeApplyIntentStore({ namespace, documentScope: this.documentScope, backend: this.backend.mergeApplyIntentBackend });
  }

  async openPendingRemoteSegmentStore(namespace: VersionGraphNamespace): Promise<InMemoryPendingRemoteSegmentStore> {
    await this.openGraph(namespace);
    return new InMemoryPendingRemoteSegmentStore({ namespace, documentScope: this.documentScope, backend: this.backend.pendingRemoteSegmentBackend });
  }

  async openAppliedSyncUpdateIdentityStore(): Promise<InMemoryAppliedSyncUpdateIdentityStore> {
    return new InMemoryAppliedSyncUpdateIdentityStore({ documentScope: this.documentScope, backend: this.backend.appliedSyncUpdateIdentityBackend });
  }

  async openSyncBatchStatusStore(): Promise<InMemorySyncBatchStatusStore> {
    return new InMemorySyncBatchStatusStore({ documentScope: this.documentScope, backend: this.backend.syncBatchStatusBackend });
  }

  async openWorkbookVersionReviewRecordStore(): Promise<InMemoryWorkbookVersionReviewRecordStore> {
    return new InMemoryWorkbookVersionReviewRecordStore({ documentScope: this.documentScope, backend: this.backend.reviewRecordBackend });
  }

  async scanDocumentIntegrity(
    _options: VersionDocumentIntegrityScanOptions = {},
  ): Promise<VersionIntegrityReport> {
    this.assertAvailable('scanDocumentIntegrity');

    if (!this.capabilities.integrityScan || !this.capabilities.reads.integrityReports) {
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

    return {
      status: 'ok',
      checkedAt: new Date().toISOString(),
      scanScope: 'document',
      diagnostics: [],
    };
  }

  async close(_reason: VersionStoreCloseReason = 'workbook-close'): Promise<void> {
    if (this.lifecycleState === 'closed' || this.lifecycleState === 'disposed') return;
    if (this.lifecycleState === 'disposing') return;
    this.lifecycleState = 'closing';
    this.lifecycleState = 'closed';
  }

  async dispose(_reason: VersionStoreCloseReason = 'dispose'): Promise<void> {
    if (this.lifecycleState === 'disposed') return;
    if (this.lifecycleState === 'open') {
      await this.close('dispose');
    }
    this.lifecycleState = 'disposing';
    this.lifecycleState = 'disposed';
  }

  private assertAvailable(operation: VersionStoreOperation): void {
    if (this.lifecycleState !== 'open') {
      throw new VersionStoreProviderError(this.lifecycleUnavailableDiagnostic(operation));
    }
    if (this.mode !== 'unavailable') return;

    throw new VersionStoreProviderError(
      versionStoreDiagnostic('VERSION_STORE_UNAVAILABLE', {
        operation,
        documentScope: this.documentScope,
        recoverability: 'retry',
        safeMessage: 'Version store provider is unavailable.',
      }),
    );
  }

  private writeUnavailableFailure(operation: VersionStoreOperation): VersionStoreFailure | null {
    if (this.lifecycleState !== 'open') {
      return failedStoreResult(
        [this.lifecycleUnavailableDiagnostic(operation)],
        'no-write-attempted',
        true,
      );
    }

    if (this.mode === 'unavailable') {
      return failedStoreResult(
        [
          versionStoreDiagnostic('VERSION_STORE_UNAVAILABLE', {
            operation,
            documentScope: this.documentScope,
            recoverability: 'retry',
            safeMessage: 'Version store provider is unavailable.',
          }),
        ],
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
}

export function createInMemoryVersionStoreProvider(
  options: InMemoryVersionStoreProviderOptions,
): InMemoryVersionStoreProvider {
  return new InMemoryVersionStoreProvider(options);
}

export function cloneVersionStoreCapabilities(
  capabilities: VersionStoreCapabilities,
): VersionStoreCapabilities {
  return freezeCapabilities({
    ...capabilities,
    reads: { ...capabilities.reads },
    writes: { ...capabilities.writes },
  });
}

function readOnlyCapabilities(capabilities: VersionStoreCapabilities): VersionStoreCapabilities {
  return freezeCapabilities({
    ...capabilities,
    readOnlyHistory: true,
    writes: {
      initializeGraph: false,
      putObjects: false,
      updateRefs: false,
      updateSymbolicRefs: false,
      commitGraphWrite: false,
      repairIndexes: false,
      quarantineCorruptRecords: false,
    },
    corruptionQuarantine: false,
  });
}

function unavailableCapabilities(capabilities: VersionStoreCapabilities): VersionStoreCapabilities {
  return freezeCapabilities({
    ...capabilities,
    durableGraphRegistry: false,
    durableObjects: false,
    atomicObjectBatch: false,
    casRefs: false,
    casGraphRegistry: false,
    multiProcessCasGraphRegistry: false,
    multiProcessCasRefs: false,
    readOnlyHistory: true,
    integrityScan: false,
    corruptionQuarantine: false,
    reads: {
      graphRegistry: false,
      objects: false,
      refs: false,
      commits: false,
      snapshots: false,
      integrityReports: false,
    },
    writes: {
      initializeGraph: false,
      putObjects: false,
      updateRefs: false,
      updateSymbolicRefs: false,
      commitGraphWrite: false,
      repairIndexes: false,
      quarantineCorruptRecords: false,
    },
  });
}

function freezeCapabilities(capabilities: VersionStoreCapabilities): VersionStoreCapabilities {
  return Object.freeze({
    ...capabilities,
    reads: Object.freeze({ ...capabilities.reads }),
    writes: Object.freeze({ ...capabilities.writes }),
  });
}

function initializeSuccess(
  registry: VersionGraphRegistry,
  main: VersionGraphRef,
): Extract<VersionGraphInitializeResult, { status: 'success' }> {
  return {
    status: 'success',
    registry: cloneVersionGraphRegistry(registry),
    rootCommit: {
      id: registry.rootCommitId,
      refName: VERSION_GRAPH_MAIN_REF,
      resolvedFrom: VERSION_GRAPH_HEAD_REF,
      refRevision: main.revision,
    },
    initialHead: { ...main },
    symbolicHead: {
      name: VERSION_GRAPH_HEAD_REF,
      target: VERSION_GRAPH_MAIN_REF,
      revision: main.revision,
    },
    diagnostics: [],
  };
}

export function failedStoreResult(
  diagnostics: readonly VersionStoreDiagnostic[],
  mutationGuarantee: VersionStoreFailure['mutationGuarantee'],
  retryable = false,
): VersionStoreFailure {
  return {
    status: 'failed',
    diagnostics: Object.freeze([...diagnostics]),
    mutationGuarantee,
    retryable,
  };
}

export function mapGraphDiagnostics(
  diagnostics: readonly VersionGraphStoreDiagnostic[],
  operation: VersionStoreOperation,
): readonly VersionStoreDiagnostic[] {
  return diagnostics.map((item) =>
    versionStoreDiagnostic(item.code, {
      operation,
      namespace: item.namespace,
      refName: item.refName,
      commitId: item.commitId,
      safeMessage: item.message,
      sourceDiagnostics: [item],
      details: item.details,
    }),
  );
}

function registryRecordResult(
  kind: 'corrupt' | 'unsupported',
  operation: VersionStoreOperation,
  documentScope: VersionDocumentScope,
): Extract<VersionGraphRegistryReadResult, { status: 'corrupt' | 'unsupported' }> {
  const code = kind === 'corrupt' ? 'VERSION_CORRUPT_REGISTRY' : 'VERSION_UNSUPPORTED_REGISTRY';
  return {
    status: kind,
    registry: null,
    diagnostics: [
      versionStoreDiagnostic(code, {
        operation,
        documentScope,
        recoverability: kind === 'corrupt' ? 'repair' : 'unsupported',
        safeMessage:
          kind === 'corrupt'
            ? 'Version graph registry is corrupt and cannot be opened normally.'
            : 'Version graph registry schema is not supported by this provider.',
      }),
    ],
    mutationGuarantee: 'no-write-attempted',
  };
}

export function versionStoreDiagnostic(
  code: VersionStoreDiagnosticCode,
  options: {
    readonly operation: VersionStoreOperation;
    readonly documentScope?: VersionDocumentScope;
    readonly namespace?: VersionGraphNamespace;
    readonly refName?: string;
    readonly commitId?: WorkbookCommitId;
    readonly safeMessage: string;
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly mutationGuarantee?: VersionStoreMutationGuarantee;
    readonly lifecycleState?: VersionStoreLifecycleState;
    readonly details?: Readonly<Record<string, string | number | boolean | null>>;
    readonly sourceDiagnostics?: readonly VersionGraphStoreDiagnostic[];
  },
): VersionStoreDiagnostic {
  const messageTemplateId = messageTemplateIdForCode(code);
  const recoverability = options.recoverability ?? recoverabilityForCode(code);
  return Object.freeze({
    code,
    issueCode: code,
    severity: severityForCode(code),
    recoverability,
    messageTemplateId,
    safeMessage: options.safeMessage,
    message: options.safeMessage,
    operation: options.operation,
    redacted: true,
    ...(options.documentScope
      ? { documentScope: normalizeVersionDocumentScope(options.documentScope) }
      : {}),
    ...(options.namespace ? { namespace: normalizeVersionGraphNamespace(options.namespace) } : {}),
    ...(options.refName ? { refName: options.refName } : {}),
    ...(options.commitId ? { commitId: options.commitId } : {}),
    ...(options.mutationGuarantee ? { mutationGuarantee: options.mutationGuarantee } : {}),
    ...(options.lifecycleState ? { lifecycleState: options.lifecycleState } : {}),
    ...(options.details ? { details: options.details } : {}),
    ...(options.sourceDiagnostics ? { sourceDiagnostics: options.sourceDiagnostics } : {}),
  });
}

function messageTemplateIdForCode(code: VersionStoreDiagnosticCode): VersionDiagnosticMessageId {
  switch (code) {
    case 'VERSION_STORE_UNAVAILABLE':
      return 'version.store.unavailable';
    case 'VERSION_PROVIDER_FAILED':
      return 'version.provider.failed';
    case 'VERSION_STORE_READ_ONLY':
      return 'version.store.read-only';
    case 'VERSION_GRAPH_UNINITIALIZED':
      return 'version.graph.uninitialized';
    case 'VERSION_GRAPH_CONFLICT':
      return 'version.graph.conflict';
    case 'VERSION_UNSUPPORTED_REGISTRY':
      return 'version.registry.unsupported';
    case 'VERSION_CORRUPT_REGISTRY':
      return 'version.registry.corrupt';
    case 'VERSION_WRONG_NAMESPACE':
      return 'version.integrity.wrong-namespace';
    case 'VERSION_MISSING_OBJECT':
      return 'version.integrity.missing-object';
    case 'VERSION_MISSING_PARENT':
      return 'version.integrity.missing-parent';
    case 'VERSION_MISSING_CHANGE_SET':
    case 'VERSION_MISSING_DEPENDENCY':
      return 'version.integrity.missing-change-set';
    case 'VERSION_REF_CONFLICT':
      return 'version.ref.conflict';
    case 'VERSION_DANGLING_REF':
      return 'version.ref.dangling';
    case 'VERSION_INVALID_OPTIONS':
    case 'VERSION_INVALID_COMMIT_ID':
    case 'VERSION_INVALID_COMMIT_PAYLOAD':
    case 'VERSION_WRONG_DOCUMENT':
      return 'version.options.invalid';
    case 'VERSION_STALE_PAGE_CURSOR':
    case 'VERSION_UNSUPPORTED_PAGE_TOKEN':
      return 'version.page-cursor.stale';
    case 'VERSION_UNSUPPORTED_DURABLE_PERSISTENCE':
    case 'VERSION_UNSUPPORTED_PARENT_COMMIT':
      return 'version.unsupported';
    case 'VERSION_OBJECT_STORE_FAILURE':
      return 'version.provider.failed';
  }
}

function severityForCode(code: VersionStoreDiagnosticCode): VersionStoreDiagnostic['severity'] {
  if (code === 'VERSION_PROVIDER_FAILED' || code === 'VERSION_OBJECT_STORE_FAILURE') {
    return 'fatal';
  }
  return 'error';
}

function recoverabilityForCode(
  code: VersionStoreDiagnosticCode,
): VersionStoreDiagnostic['recoverability'] {
  switch (code) {
    case 'VERSION_STORE_UNAVAILABLE':
    case 'VERSION_GRAPH_CONFLICT':
    case 'VERSION_REF_CONFLICT':
    case 'VERSION_STALE_PAGE_CURSOR':
      return 'retry';
    case 'VERSION_UNSUPPORTED_DURABLE_PERSISTENCE':
    case 'VERSION_UNSUPPORTED_REGISTRY':
    case 'VERSION_UNSUPPORTED_PARENT_COMMIT':
    case 'VERSION_UNSUPPORTED_PAGE_TOKEN':
      return 'unsupported';
    case 'VERSION_CORRUPT_REGISTRY':
      return 'repair';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_MISSING_PARENT':
    case 'VERSION_MISSING_CHANGE_SET':
    case 'VERSION_OBJECT_STORE_FAILURE':
      return 'repair';
    default:
      return 'none';
  }
}

function normalizeVersionAccessContext(
  accessContext: VersionAccessContext | undefined,
): VersionAccessContext {
  if (accessContext === undefined) return Object.freeze({});
  return Object.freeze({
    ...(accessContext.principalScope === undefined
      ? {}
      : {
          principalScope: normalizeVersionStoreString(
            accessContext.principalScope,
            'accessContext.principalScope',
          ),
        }),
    ...(accessContext.capabilityIds === undefined
      ? {}
      : {
          capabilityIds: Object.freeze(
            [...accessContext.capabilityIds].map((capabilityId, index) =>
              normalizeVersionStoreString(capabilityId, `accessContext.capabilityIds[${index}]`),
            ),
          ),
        }),
    ...(accessContext.diagnosticsAllowed === undefined
      ? {}
      : { diagnosticsAllowed: Boolean(accessContext.diagnosticsAllowed) }),
  });
}
