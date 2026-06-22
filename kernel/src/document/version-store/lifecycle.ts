import type { DomainSupportManifest } from '@mog-sdk/contracts/versioning';

import type {
  VersionMergeCommitCapture,
  VersionNormalCommitCapture,
  WorkbookVersionCommitService,
} from './commit-service';
import type { DomainSupportManifestValidationOptions } from './domain-support-manifest-validator';
import type { CheckoutSnapshotMaterializer } from './checkout-apply';
import type { PendingRemotePromotionService } from './pending-remote-promotion-service';
import type { VersionProviderWriteActivityTracker } from './provider-write-activity';
import type { WorkbookVersionReviewService } from './review-service';
import {
  createSemanticMutationCapture,
  type SemanticMutationCaptureServices,
} from './semantic-mutation-capture';
import type { VersionSemanticStateReaderPort } from './semantic-state-reader';
import type { SnapshotRootByteSyncPort } from './snapshot-root-capture';
import {
  namespaceForDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphRegistryReadResult,
  versionStoreDiagnostic,
  type VersionStoreDiagnostic,
  type VersionStoreProvider,
} from './provider';
import {
  createDefaultVersionStoreProviderRegistry,
  selectVersionStoreProvider,
  type VersionStoreProviderKind,
} from './provider-registry';
import { versionGraphNamespaceKey, type VersionGraphNamespace } from './object-store';
import {
  normalizeVersionDocumentScope,
  namespaceForRegistry,
  type VersionDocumentScope,
  type VersionGraphRegistry,
} from './registry';

type MaybePromise<T> = T | Promise<T>;

export type VersionLiveCollaborationState = 'absent' | 'disabled' | 'idle' | 'active' | 'unknown';

export type VersionLiveCollaborationStatus = {
  readonly state: VersionLiveCollaborationState;
  readonly statusRevision: string;
  readonly roomId?: string;
  readonly sidecarStatus?: string;
  readonly activeParticipantCount?: number;
  readonly remoteProviderAttached?: boolean;
  readonly inFlightRemoteUpdateCount?: number;
  readonly syncApplyRemoteQueueDepth?: number;
};

export type VersionLiveCollaborationStatusReader =
  () => MaybePromise<VersionLiveCollaborationStatus>;

export type ResolvedWorkbookVersioningConfig = {
  readonly provider?: VersionStoreProvider;
  readonly writeService?: Pick<
    WorkbookVersionCommitService,
    'readHead' | 'readRef' | 'listCommits' | 'commit' | 'mergeCommit'
  >;
  readonly captureNormalCommit?: VersionNormalCommitCapture;
  readonly captureMergeCommit?: VersionMergeCommitCapture;
  readonly semanticMutationCapture?: SemanticMutationCaptureServices;
  readonly semanticStateReader?: VersionSemanticStateReaderPort;
  readonly pendingRemotePromotionService?: Pick<
    PendingRemotePromotionService,
    'promotePendingRemoteSegments'
  >;
  readonly reviewService?: WorkbookVersionReviewService;
  readonly providerWriteActivityTracker?: VersionProviderWriteActivityTracker;
  readonly snapshotRootByteSyncPort?: SnapshotRootByteSyncPort;
  readonly checkoutSnapshotMaterializer?: CheckoutSnapshotMaterializer;
  readonly readLiveCollaborationStatus?: VersionLiveCollaborationStatusReader;
  readonly domainSupportManifest?: DomainSupportManifest | null;
  readonly readDomainSupportManifest?: () => MaybePromise<DomainSupportManifest | null | undefined>;
  readonly domainSupportManifestOptions?: DomainSupportManifestValidationOptions;
  readonly requireDomainSupportManifest?: boolean;
};

export type VersionStoreLifecycleProviderSelection = {
  readonly kind: VersionStoreProviderKind | (string & {});
  readonly workspaceId?: string;
  readonly principalScope?: string;
  readonly readOnly?: boolean;
  readonly requireDurablePersistence?: boolean;
  /**
   * Optional root graph initializer for documents whose selected durable store
   * has no visible version graph yet. Hosts must provide this explicitly so
   * IndexedDB never becomes an implicit default.
   */
  readonly initialize?: {
    readonly graphId: string;
    readonly rootWrite: VersionGraphInitializeInput['rootWrite'];
    readonly requireDurablePersistence?: boolean;
  };
};

export type DocumentWorkbookVersioningLifecycleConfig = ResolvedWorkbookVersioningConfig & {
  /**
   * Explicit document-scoped provider selection. Used by DocumentHandle.workbook()
   * because resolving and initializing durable providers is asynchronous; the
   * lower-level WorkbookConfig path still accepts an already-created provider.
   */
  readonly providerSelection?: VersionStoreLifecycleProviderSelection;
};

export type ResolvedDocumentWorkbookVersioningLifecycle = {
  readonly versioning?: ResolvedWorkbookVersioningConfig;
  readonly diagnostics: readonly VersionStoreDiagnostic[];
};

export type VersionStoreLifecycleFailureReadService = {
  readHead(): Promise<{
    readonly status: 'degraded';
    readonly head: null;
    readonly diagnostics: readonly VersionStoreDiagnostic[];
  }>;
  readRef(): Promise<{
    readonly status: 'degraded';
    readonly ref: null;
    readonly diagnostics: readonly VersionStoreDiagnostic[];
  }>;
  listCommits(): Promise<{
    readonly status: 'failed';
    readonly diagnostics: readonly VersionStoreDiagnostic[];
  }>;
  commit(): Promise<{
    readonly status: 'failed';
    readonly diagnostics: readonly VersionStoreDiagnostic[];
    readonly mutationGuarantee: 'no-write-attempted';
    readonly retryable: false;
  }>;
  mergeCommit(): Promise<{
    readonly status: 'failed';
    readonly diagnostics: readonly VersionStoreDiagnostic[];
    readonly mutationGuarantee: 'no-write-attempted';
    readonly retryable: false;
  }>;
};

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

  const diagnostics = await initializeSelectedProviderWhenAbsent({
    documentScope,
    provider,
    initialize: providerSelection.initialize,
    requireDurablePersistence: providerSelection.requireDurablePersistence,
  });

  return {
    versioning: resolveSemanticMutationCapture({
      provider,
      captureNormalCommit: config.captureNormalCommit,
      captureMergeCommit: config.captureMergeCommit,
      semanticMutationCapture: config.semanticMutationCapture,
      semanticStateReader: config.semanticStateReader,
      pendingRemotePromotionService: config.pendingRemotePromotionService,
      reviewService: config.reviewService,
      providerWriteActivityTracker: config.providerWriteActivityTracker,
      snapshotRootByteSyncPort: config.snapshotRootByteSyncPort,
      writeService: config.writeService,
      checkoutSnapshotMaterializer: config.checkoutSnapshotMaterializer,
      readLiveCollaborationStatus: config.readLiveCollaborationStatus,
      ...domainSupportManifestLifecycleFields(config),
    }),
    diagnostics,
  };
}

function domainSupportManifestLifecycleFields(
  config: ResolvedWorkbookVersioningConfig,
): Pick<
  ResolvedWorkbookVersioningConfig,
  | 'domainSupportManifest'
  | 'readDomainSupportManifest'
  | 'domainSupportManifestOptions'
  | 'requireDomainSupportManifest'
> {
  return {
    ...(config.domainSupportManifest !== undefined
      ? { domainSupportManifest: config.domainSupportManifest }
      : {}),
    ...(config.readDomainSupportManifest
      ? { readDomainSupportManifest: config.readDomainSupportManifest }
      : {}),
    ...(config.domainSupportManifestOptions
      ? { domainSupportManifestOptions: config.domainSupportManifestOptions }
      : {}),
    ...(config.requireDomainSupportManifest !== undefined
      ? { requireDomainSupportManifest: config.requireDomainSupportManifest }
      : {}),
  };
}

function resolveSemanticMutationCapture(
  config: ResolvedWorkbookVersioningConfig,
): ResolvedWorkbookVersioningConfig {
  const semanticMutationCapture =
    config.semanticMutationCapture ??
    (!config.captureNormalCommit && config.provider && config.snapshotRootByteSyncPort
      ? createSemanticMutationCapture({ semanticStateReader: config.semanticStateReader })
      : undefined);
  return semanticMutationCapture === config.semanticMutationCapture
    ? config
    : { ...config, semanticMutationCapture };
}

export function createLifecycleFailureReadService(
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionStoreLifecycleFailureReadService {
  const frozenDiagnostics = Object.freeze([...diagnostics]);
  return {
    async readHead() {
      return { status: 'degraded', head: null, diagnostics: frozenDiagnostics };
    },
    async readRef() {
      return { status: 'degraded', ref: null, diagnostics: frozenDiagnostics };
    },
    async listCommits() {
      return { status: 'failed', diagnostics: frozenDiagnostics };
    },
    async commit() {
      return {
        status: 'failed',
        diagnostics: frozenDiagnostics,
        mutationGuarantee: 'no-write-attempted',
        retryable: false,
      };
    },
    async mergeCommit() {
      return {
        status: 'failed',
        diagnostics: frozenDiagnostics,
        mutationGuarantee: 'no-write-attempted',
        retryable: false,
      };
    },
  };
}

function diagnosticsForProviderScopeMismatch(
  documentId: string,
  provider: VersionStoreProvider,
): readonly VersionStoreDiagnostic[] {
  if (provider.documentScope.documentId === documentId) return [];
  return [
    versionStoreDiagnostic('VERSION_WRONG_NAMESPACE', {
      operation: 'openGraph',
      documentScope: { documentId },
      safeMessage: 'Selected version store provider does not match this document scope.',
      mutationGuarantee: 'no-write-attempted',
    }),
  ];
}

async function initializeSelectedProviderWhenAbsent(input: {
  readonly documentScope: VersionDocumentScope;
  readonly provider: VersionStoreProvider;
  readonly initialize?: VersionStoreLifecycleProviderSelection['initialize'];
  readonly requireDurablePersistence?: boolean;
}): Promise<readonly VersionStoreDiagnostic[]> {
  let registryRead: VersionGraphRegistryReadResult;
  try {
    registryRead = await input.provider.readGraphRegistry();
  } catch {
    return [];
  }

  if (registryRead.status === 'ok') {
    assertRegistryMatchesDocumentScope(input.documentScope, registryRead.registry);
    return [];
  }
  if (registryRead.status !== 'absent') return registryRead.diagnostics;
  if (!input.initialize) return [];

  const initialized = await input.provider.initializeGraph({
    expectedRegistryRevision: null,
    graphId: input.initialize.graphId,
    rootWrite: input.initialize.rootWrite,
    requireDurablePersistence:
      input.initialize.requireDurablePersistence ?? input.requireDurablePersistence,
  });
  if (initialized.status !== 'success') return initialized.diagnostics;

  assertRegistryMatchesDocumentScope(input.documentScope, initialized.registry);
  return [];
}

function assertRegistryMatchesDocumentScope(
  documentScope: VersionDocumentScope,
  registry: VersionGraphRegistry,
): VersionGraphNamespace {
  const expected = namespaceForDocumentScope(documentScope, registry.currentGraphId);
  const registryNamespace = namespaceForRegistry(registry);
  if (versionGraphNamespaceKey(expected) !== versionGraphNamespaceKey(registryNamespace)) {
    throw new Error('Version graph registry namespace does not match selected document scope.');
  }
  return expected;
}

export type { VersionNormalCommitCapture };
