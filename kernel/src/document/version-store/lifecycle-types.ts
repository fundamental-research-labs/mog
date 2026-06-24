import type {
  DomainSupportManifest,
  VersionHistoryRootPolicy,
} from '@mog-sdk/contracts/versioning';

import type { CheckoutSnapshotMaterializer } from './checkout-apply';
import type {
  VersionMergeCommitCapture,
  VersionNormalCommitCapture,
  WorkbookVersionCommitService,
} from './commit-service';
import type { DomainSupportManifestValidationOptions } from './domain-support-manifest-validator';
import type { PendingRemotePromotionService } from './pending-remote-promotion-service';
import type {
  VersionGraphInitializeInput,
  VersionStoreDiagnostic,
  VersionStoreProvider,
} from './provider';
import type { VersionStoreProviderKind } from './provider-registry';
import type { VersionProviderWriteActivityTracker } from './provider-write-activity';
import type { WorkbookVersionRevertService } from './revert-service';
import type { WorkbookVersionReviewService } from './review-service';
import type { SemanticMutationCaptureServices } from './semantic-mutation-capture';
import type { VersionSemanticStateReaderPort } from './semantic-state-reader';
import type { SnapshotRootByteSyncPort } from './snapshot-root-capture';
import type { VersionHistoryRootKind } from './version-history-root-policy';
import type { XlsxVersionExistingGraphImportInput } from './xlsx-import-root';

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
  readonly revertService?: Pick<WorkbookVersionRevertService, 'revert'>;
  readonly reviewService?: WorkbookVersionReviewService;
  readonly providerWriteActivityTracker?: VersionProviderWriteActivityTracker;
  readonly snapshotRootByteSyncPort?: SnapshotRootByteSyncPort;
  readonly checkoutSnapshotMaterializer?: CheckoutSnapshotMaterializer;
  readonly readLiveCollaborationStatus?: VersionLiveCollaborationStatusReader;
  readonly ensureProviderInitialized?: () => MaybePromise<readonly VersionStoreDiagnostic[]>;
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
   * Controls whether missing-root initialization blocks provider selection.
   * The default is `blocking`, which preserves the historical contract for
   * API callers that expect `workbook()` to return with a durable root graph.
   * Browser imports can opt into `deferred` so first paint is not gated on
   * capturing the XLSX import root. Provider reads remain degraded until a
   * later capture path records the missing root graph.
   */
  readonly initializeTiming?: 'blocking' | 'deferred';
  /**
   * Optional root graph initializer for documents whose selected durable store
   * has no visible version graph yet. Hosts must provide this explicitly so
   * IndexedDB never becomes an implicit default.
   */
  readonly initialize?: VersionStoreLifecycleRootInitializer;
};

export type VersionStoreLifecycleRootInitializer = {
  readonly graphId: string;
  readonly requireDurablePersistence?: boolean;
  readonly historyRootKind?: VersionHistoryRootKind;
  readonly historyRootPolicy?: VersionHistoryRootPolicy;
} & (
  | {
      readonly rootWrite: VersionGraphInitializeInput['rootWrite'];
      readonly buildRootWrite?: never;
    }
  | {
      readonly rootWrite?: never;
      readonly buildRootWrite: () => MaybePromise<VersionGraphInitializeInput['rootWrite']>;
    }
);

export type DocumentWorkbookVersioningLifecycleConfig = ResolvedWorkbookVersioningConfig & {
  /**
   * Explicit document-scoped provider selection. Used by DocumentHandle.workbook()
   * because resolving and initializing durable providers is asynchronous; the
   * lower-level WorkbookConfig path still accepts an already-created provider.
   */
  readonly providerSelection?: VersionStoreLifecycleProviderSelection;
  readonly xlsxImportRootExistingGraph?: Omit<XlsxVersionExistingGraphImportInput, 'graph'>;
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
