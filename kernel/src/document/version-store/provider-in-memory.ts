import { InMemoryAppliedSyncUpdateIdentityStore } from './applied-sync-update-identity-store';
import {
  VERSION_GRAPH_MAIN_REF,
  createInMemoryVersionGraphStore,
  type InMemoryVersionGraphStore,
} from './graph-store';
import { InMemoryMergeApplyIntentStore } from './merge-apply-intent-store';
import {
  normalizeVersionGraphNamespace,
  versionGraphNamespaceKey,
  type VersionGraphNamespace,
} from './object-store';
import { InMemoryPendingRemoteSegmentStore } from './pending-remote-segment-store';
import { normalizeVersionAccessContext } from './provider-access-context';
import {
  cloneVersionStoreCapabilities,
  readOnlyCapabilities,
  unavailableCapabilities,
} from './provider-capabilities';
import { mapGraphDiagnostics, versionStoreDiagnostic } from './provider-diagnostics';
import { VersionStoreProviderError } from './provider-error';
import {
  IN_MEMORY_DURABLE_SNAPSHOT_VERSION_STORE_CAPABILITIES,
  IN_MEMORY_VERSION_STORE_CAPABILITIES,
} from './provider-in-memory-capabilities';
import {
  InMemoryVersionDocumentProviderBackend,
  type InMemoryVersionProviderDurability,
} from './provider-memory-backend';
import { failedStoreResult, initializeSuccess, registryRecordResult } from './provider-results';
import type {
  VersionAccessContext,
  VersionDocumentIntegrityScanOptions,
  VersionGraphInitializeInput,
  VersionGraphInitializeResult,
  VersionGraphRegistryReadResult,
  VersionIntegrityReport,
  VersionStoreCapabilities,
  VersionStoreCloseReason,
  VersionStoreDiagnostic,
  VersionStoreFailure,
  VersionStoreLifecycleState,
  VersionStoreOperation,
  VersionStoreProvider,
} from './provider-types';
import { InMemoryAgentProposalMetadataStore } from './proposal-store';
import {
  createVersionGraphRegistry,
  namespaceForDocumentScope,
  namespaceForRegistry,
  normalizeVersionDocumentScope,
  type VersionDocumentScope,
} from './registry';
import { InMemoryWorkbookVersionReviewRecordStore } from './review-service';
import { InMemorySyncBatchStatusStore } from './sync-batch-status-store';

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

  async openMergeApplyIntentStore(
    namespace: VersionGraphNamespace,
  ): Promise<InMemoryMergeApplyIntentStore> {
    await this.openGraph(namespace);
    return new InMemoryMergeApplyIntentStore({
      namespace,
      documentScope: this.documentScope,
      backend: this.backend.mergeApplyIntentBackend,
    });
  }

  async openPendingRemoteSegmentStore(
    namespace: VersionGraphNamespace,
  ): Promise<InMemoryPendingRemoteSegmentStore> {
    await this.openGraph(namespace);
    return new InMemoryPendingRemoteSegmentStore({
      namespace,
      documentScope: this.documentScope,
      backend: this.backend.pendingRemoteSegmentBackend,
    });
  }

  async openAppliedSyncUpdateIdentityStore(): Promise<InMemoryAppliedSyncUpdateIdentityStore> {
    return new InMemoryAppliedSyncUpdateIdentityStore({
      documentScope: this.documentScope,
      backend: this.backend.appliedSyncUpdateIdentityBackend,
    });
  }

  async openSyncBatchStatusStore(): Promise<InMemorySyncBatchStatusStore> {
    return new InMemorySyncBatchStatusStore({
      documentScope: this.documentScope,
      backend: this.backend.syncBatchStatusBackend,
    });
  }

  async openWorkbookVersionReviewRecordStore(): Promise<InMemoryWorkbookVersionReviewRecordStore> {
    return new InMemoryWorkbookVersionReviewRecordStore({
      documentScope: this.documentScope,
      backend: this.backend.reviewRecordBackend,
    });
  }

  async openAgentProposalMetadataStore(): Promise<InMemoryAgentProposalMetadataStore> {
    return new InMemoryAgentProposalMetadataStore({
      documentScope: this.documentScope,
      backend: this.backend.proposalMetadataBackend,
    });
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
