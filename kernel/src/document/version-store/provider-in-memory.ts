import type { InMemoryAppliedSyncUpdateIdentityStore } from './applied-sync-update-identity-store';
import type { InMemoryVersionGraphStore } from './graph';
import type { InMemoryMergeApplyIntentStore } from './merge-apply-intent-store';
import type { VersionGraphNamespace } from './object-store';
import type { InMemoryPendingRemoteSegmentStore } from './pending-remote-segment-store';
import { openInMemoryGraph } from './provider-in-memory-graph';
import { scanInMemoryDocumentIntegrity } from './provider-in-memory-integrity';
import {
  closeInMemoryVersionStoreProvider,
  disposeInMemoryVersionStoreProvider,
} from './provider-in-memory-lifecycle';
import { readInMemoryGraphRegistry, initializeInMemoryGraph } from './provider-in-memory-registry';
import { createInMemoryVersionStoreProviderState } from './provider-in-memory-state';
import {
  openInMemoryAgentProposalMetadataStore,
  openInMemoryActiveCheckoutMaterializationStore,
  openInMemoryAppliedSyncUpdateIdentityStore,
  openInMemoryMergeApplyIntentStore,
  openInMemoryPendingRemoteSegmentStore,
  openInMemorySyncBatchStatusStore,
  openInMemoryWorkbookVersionReviewRecordStore,
} from './provider-in-memory-stores';
import type {
  InMemoryVersionStoreProviderOptions,
  InMemoryVersionStoreProviderState,
} from './provider-in-memory-types';
import type {
  VersionAccessContext,
  VersionDocumentIntegrityScanOptions,
  VersionGraphInitializeInput,
  VersionGraphInitializeResult,
  VersionGraphRegistryReadResult,
  VersionIntegrityReport,
  VersionStoreCapabilities,
  VersionStoreCloseReason,
  VersionStoreLifecycleState,
  VersionStoreProvider,
} from './provider-types';
import type { InMemoryAgentProposalMetadataStore } from './proposals/proposal-store';
import type { VersionDocumentScope } from './registry';
import type { InMemoryWorkbookVersionReviewRecordStore } from './review-service';
import type { InMemorySyncBatchStatusStore } from './sync-batch-status-store';
import type { ActiveCheckoutMaterializationStore } from './active-checkout-materialization-store';

export type { InMemoryVersionStoreProviderOptions } from './provider-in-memory-types';

export class InMemoryVersionStoreProvider implements VersionStoreProvider {
  readonly documentScope: VersionDocumentScope;
  readonly accessContext: VersionAccessContext;
  readonly capabilities: VersionStoreCapabilities;

  private readonly state: InMemoryVersionStoreProviderState;

  constructor(options: InMemoryVersionStoreProviderOptions) {
    this.state = createInMemoryVersionStoreProviderState(options);
    this.documentScope = this.state.documentScope;
    this.accessContext = this.state.accessContext;
    this.capabilities = this.state.capabilities;
  }

  get lifecycleState(): VersionStoreLifecycleState {
    return this.state.lifecycleState;
  }

  async readGraphRegistry(): Promise<VersionGraphRegistryReadResult> {
    return readInMemoryGraphRegistry(this.state);
  }

  async initializeGraph(input: VersionGraphInitializeInput): Promise<VersionGraphInitializeResult> {
    return initializeInMemoryGraph(this.state, input);
  }

  async openGraph(
    namespaceInput: VersionGraphNamespace,
    accessContext: VersionAccessContext = this.accessContext,
  ): Promise<InMemoryVersionGraphStore> {
    return openInMemoryGraph(this.state, namespaceInput, accessContext);
  }

  async openMergeApplyIntentStore(
    namespace: VersionGraphNamespace,
  ): Promise<InMemoryMergeApplyIntentStore> {
    return openInMemoryMergeApplyIntentStore(this.state, namespace, (graphNamespace) =>
      this.openGraph(graphNamespace),
    );
  }

  async openPendingRemoteSegmentStore(
    namespace: VersionGraphNamespace,
  ): Promise<InMemoryPendingRemoteSegmentStore> {
    return openInMemoryPendingRemoteSegmentStore(this.state, namespace, (graphNamespace) =>
      this.openGraph(graphNamespace),
    );
  }

  async openAppliedSyncUpdateIdentityStore(): Promise<InMemoryAppliedSyncUpdateIdentityStore> {
    return openInMemoryAppliedSyncUpdateIdentityStore(this.state);
  }

  async openSyncBatchStatusStore(): Promise<InMemorySyncBatchStatusStore> {
    return openInMemorySyncBatchStatusStore(this.state);
  }

  async openWorkbookVersionReviewRecordStore(): Promise<InMemoryWorkbookVersionReviewRecordStore> {
    return openInMemoryWorkbookVersionReviewRecordStore(this.state);
  }

  async openAgentProposalMetadataStore(): Promise<InMemoryAgentProposalMetadataStore> {
    return openInMemoryAgentProposalMetadataStore(this.state);
  }

  async openActiveCheckoutMaterializationStore(): Promise<ActiveCheckoutMaterializationStore> {
    return openInMemoryActiveCheckoutMaterializationStore(this.state);
  }

  async scanDocumentIntegrity(
    options: VersionDocumentIntegrityScanOptions = {},
  ): Promise<VersionIntegrityReport> {
    return scanInMemoryDocumentIntegrity(this.state, options);
  }

  async close(_reason: VersionStoreCloseReason = 'workbook-close'): Promise<void> {
    return closeInMemoryVersionStoreProvider(this.state, _reason);
  }

  async dispose(_reason: VersionStoreCloseReason = 'dispose'): Promise<void> {
    return disposeInMemoryVersionStoreProvider(this.state, _reason);
  }
}

export function createInMemoryVersionStoreProvider(
  options: InMemoryVersionStoreProviderOptions,
): InMemoryVersionStoreProvider {
  return new InMemoryVersionStoreProvider(options);
}
