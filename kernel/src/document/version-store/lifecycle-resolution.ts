import {
  createDefaultVersionStoreProviderRegistry,
  selectVersionStoreProvider,
} from './provider-registry';
import { normalizeVersionDocumentScope } from './registry';
import {
  domainSupportManifestLifecycleFields,
  resolveSemanticMutationCapture,
} from './lifecycle-config';
import {
  createLifecycleFailureReadService,
  diagnosticsForProviderScopeMismatch,
} from './lifecycle-failure-service';
import { initializeSelectedProviderWhenAbsent } from './lifecycle-provider-initialization';
import type {
  DocumentWorkbookVersioningLifecycleConfig,
  ResolvedDocumentWorkbookVersioningLifecycle,
} from './lifecycle-types';

export async function resolveDocumentWorkbookVersioningLifecycle(input: {
  readonly documentId: string;
  readonly versioning?: DocumentWorkbookVersioningLifecycleConfig;
}): Promise<ResolvedDocumentWorkbookVersioningLifecycle> {
  const config = input.versioning;
  if (!config) return { diagnostics: [] };
  if (config.provider || !config.providerSelection) {
    if (config.provider) {
      const mismatchDiagnostics = diagnosticsForProviderScopeMismatch(
        input.documentId,
        config.provider,
      );
      if (mismatchDiagnostics.length > 0) {
        return {
          versioning: {
            writeService: createLifecycleFailureReadService(mismatchDiagnostics),
            ...domainSupportManifestLifecycleFields(config),
          },
          diagnostics: mismatchDiagnostics,
        };
      }
    }
    return { versioning: resolveSemanticMutationCapture(config), diagnostics: [] };
  }

  const providerSelection = config.providerSelection;
  const documentScope = normalizeVersionDocumentScope({
    ...(providerSelection.workspaceId === undefined
      ? {}
      : { workspaceId: providerSelection.workspaceId }),
    documentId: input.documentId,
    ...(providerSelection.principalScope === undefined
      ? {}
      : { principalScope: providerSelection.principalScope }),
  });
  const provider = selectVersionStoreProvider(
    {
      kind: providerSelection.kind,
      documentScope,
      readOnly: providerSelection.readOnly,
      requireDurablePersistence: providerSelection.requireDurablePersistence,
    },
    createDefaultVersionStoreProviderRegistry(),
  );

  const initializationInput = {
    documentScope,
    provider,
    initialize: providerSelection.initialize,
    xlsxImportRootExistingGraph: config.xlsxImportRootExistingGraph,
    requireDurablePersistence: providerSelection.requireDurablePersistence,
  };
  const ensureProviderInitialized =
    providerSelection.initializeTiming === 'deferred' && providerSelection.initialize
      ? () => initializeSelectedProviderWhenAbsent(initializationInput)
      : undefined;
  const diagnostics = ensureProviderInitialized
    ? []
    : await initializeSelectedProviderWhenAbsent(initializationInput);
  const initializationFailureReadService =
    diagnostics.length > 0 ? createLifecycleFailureReadService(diagnostics) : undefined;

  return {
    versioning: resolveSemanticMutationCapture({
      provider,
      captureNormalCommit: config.captureNormalCommit,
      captureMergeCommit: config.captureMergeCommit,
      semanticMutationCapture: config.semanticMutationCapture,
      semanticStateReader: config.semanticStateReader,
      pendingRemotePromotionService: config.pendingRemotePromotionService,
      revertService: config.revertService,
      reviewService: config.reviewService,
      providerWriteActivityTracker: config.providerWriteActivityTracker,
      snapshotRootByteSyncPort: config.snapshotRootByteSyncPort,
      writeService: initializationFailureReadService ?? config.writeService,
      checkoutSnapshotMaterializer: config.checkoutSnapshotMaterializer,
      readLiveCollaborationStatus: config.readLiveCollaborationStatus,
      ensureProviderInitialized,
      ...domainSupportManifestLifecycleFields(config),
    }),
    diagnostics,
  };
}
