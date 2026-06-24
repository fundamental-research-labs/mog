import { InMemoryAppliedSyncUpdateIdentityStore } from './applied-sync-update-identity-store';
import {
  createActiveCheckoutMaterializationMemoryStore,
  type ActiveCheckoutMaterializationStore,
} from './active-checkout-materialization-store';
import { InMemoryMergeApplyIntentStore } from './merge-apply-intent-store';
import type { VersionGraphNamespace } from './object-store';
import { InMemoryPendingRemoteSegmentStore } from './pending-remote-segment-store';
import { InMemoryAgentProposalMetadataStore } from './proposals/proposal-store';
import { InMemoryWorkbookVersionReviewRecordStore } from './review-service';
import { InMemorySyncBatchStatusStore } from './sync-batch-status-store';
import { openInMemoryGraph } from './provider-in-memory-graph';
import type { InMemoryVersionStoreProviderState } from './provider-in-memory-types';

type InMemoryGraphOpener = (namespace: VersionGraphNamespace) => Promise<unknown>;

export async function openInMemoryMergeApplyIntentStore(
  state: InMemoryVersionStoreProviderState,
  namespace: VersionGraphNamespace,
  openGraph: InMemoryGraphOpener = (graphNamespace) => openInMemoryGraph(state, graphNamespace),
): Promise<InMemoryMergeApplyIntentStore> {
  await openGraph(namespace);
  return new InMemoryMergeApplyIntentStore({
    namespace,
    documentScope: state.documentScope,
    backend: state.backend.mergeApplyIntentBackend,
  });
}

export async function openInMemoryPendingRemoteSegmentStore(
  state: InMemoryVersionStoreProviderState,
  namespace: VersionGraphNamespace,
  openGraph: InMemoryGraphOpener = (graphNamespace) => openInMemoryGraph(state, graphNamespace),
): Promise<InMemoryPendingRemoteSegmentStore> {
  await openGraph(namespace);
  return new InMemoryPendingRemoteSegmentStore({
    namespace,
    documentScope: state.documentScope,
    backend: state.backend.pendingRemoteSegmentBackend,
  });
}

export async function openInMemoryAppliedSyncUpdateIdentityStore(
  state: InMemoryVersionStoreProviderState,
): Promise<InMemoryAppliedSyncUpdateIdentityStore> {
  return new InMemoryAppliedSyncUpdateIdentityStore({
    documentScope: state.documentScope,
    backend: state.backend.appliedSyncUpdateIdentityBackend,
  });
}

export async function openInMemorySyncBatchStatusStore(
  state: InMemoryVersionStoreProviderState,
): Promise<InMemorySyncBatchStatusStore> {
  return new InMemorySyncBatchStatusStore({
    documentScope: state.documentScope,
    backend: state.backend.syncBatchStatusBackend,
  });
}

export async function openInMemoryWorkbookVersionReviewRecordStore(
  state: InMemoryVersionStoreProviderState,
): Promise<InMemoryWorkbookVersionReviewRecordStore> {
  return new InMemoryWorkbookVersionReviewRecordStore({
    documentScope: state.documentScope,
    backend: state.backend.reviewRecordBackend,
  });
}

export async function openInMemoryAgentProposalMetadataStore(
  state: InMemoryVersionStoreProviderState,
): Promise<InMemoryAgentProposalMetadataStore> {
  return new InMemoryAgentProposalMetadataStore({
    documentScope: state.documentScope,
    backend: state.backend.proposalMetadataBackend,
  });
}

export async function openInMemoryActiveCheckoutMaterializationStore(
  state: InMemoryVersionStoreProviderState,
): Promise<ActiveCheckoutMaterializationStore> {
  return createActiveCheckoutMaterializationMemoryStore(
    state.backend.activeCheckoutMaterializationBackend,
    state.documentScope,
  );
}
