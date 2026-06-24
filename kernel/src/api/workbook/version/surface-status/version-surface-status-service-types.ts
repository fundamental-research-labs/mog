import type {
  VersionCapability,
  VersionCapabilityState,
  VersionDiagnostic,
  VersionSurfaceStatus,
} from '@mog-sdk/contracts/api';

import type { CheckoutSnapshotApplyInput } from '../../../../document/version-store/checkout-apply';
import type { HostCapabilityDecision } from '../merge/version-merge-capability';
import type { VersionLiveCollaborationDirtyStatus } from '../live-collaboration/version-live-collaboration-status';
import type { VersionPendingProviderWritesStatus } from '../pending/provider-writes';

export type MaybePromise<T> = T | Promise<T>;
export type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

export type SurfaceOnlyVersionCapability = 'version:refAdmin';
export type SurfaceVersionCapability = VersionCapability | SurfaceOnlyVersionCapability;
export type SurfaceCapabilityStates = Record<SurfaceVersionCapability, VersionCapabilityState>;
export type SurfaceHostCapabilityDecisions = Partial<
  Record<SurfaceVersionCapability, HostCapabilityDecision>
>;

export type RemotePromoteSurfaceCapabilityInput = {
  readonly editingEnabled: boolean;
  readonly provenanceAvailable: boolean;
  readonly remotePromoteAvailable: boolean;
  readonly hostCapabilityDecisions: SurfaceHostCapabilityDecisions;
  readonly diagnostics: VersionDiagnostic[];
};

export type WorkbookVersionSurfaceDirtyState = {
  readonly hasUncommittedLocalChanges: boolean;
  readonly calculationState: 'done' | 'calculating' | 'pending';
  readonly checkoutInProgress: boolean;
  readonly revision: number;
  readonly contextGeneration: number;
};

export type VersionSurfaceCheckoutSession = {
  readonly checkedOutCommitId: string;
  readonly branchName?: string;
  readonly refHeadAtMaterialization?: string;
  readonly detached: boolean;
};

export type VersionSurfaceBranchCommitMaterialization = {
  readonly commitId: string;
  readonly refName: string;
};

export type VersionSurfaceBranchRefMove = {
  readonly checkedOutCommitId: string;
  readonly refHeadCommitId: string;
  readonly refName: string;
};

export type VersionSurfaceActiveCheckoutStateChangeReason =
  | 'checkout-materialized'
  | 'branch-head-advanced'
  | 'branch-ref-moved';

export type VersionSurfaceActiveCheckoutStateChanged = {
  readonly activeCheckoutSession: VersionSurfaceCheckoutSession | null;
  readonly previousActiveCheckoutSession: VersionSurfaceCheckoutSession | null;
  readonly statusRevision: number;
  readonly reason: VersionSurfaceActiveCheckoutStateChangeReason;
};

export type WorkbookVersionSurfaceStatusService = {
  readDirtyStatus(): MaybePromise<VersionSurfaceStatus['dirty']>;
  readActiveCheckoutSession(): VersionSurfaceCheckoutSession | null;
  restoreActiveCheckoutMaterialization(
    input: VersionSurfaceCheckoutSession,
  ): VersionSurfaceCheckoutSession | null;
  recordCheckoutMaterialization(input: CheckoutSnapshotApplyInput): void;
  recordActiveCheckoutBranchCommit(input: VersionSurfaceBranchCommitMaterialization): void;
  recordActiveCheckoutBranchRefMove(input: VersionSurfaceBranchRefMove): void;
};

export type AttachedVersionSurfaceStatusService = {
  readDirtyStatus?: () => MaybePromise<unknown>;
  readActiveCheckoutSession?: () => MaybePromise<unknown>;
  restoreActiveCheckoutMaterialization?: (
    input: VersionSurfaceCheckoutSession,
  ) => MaybePromise<unknown>;
};

export type CreateWorkbookVersionSurfaceStatusServiceInput = {
  readonly readDirtyState: () => WorkbookVersionSurfaceDirtyState;
  readonly readPendingProviderWrites?: () => MaybePromise<VersionPendingProviderWritesStatus>;
  readonly readLiveCollaborationStatus?: () => MaybePromise<VersionLiveCollaborationDirtyStatus>;
  readonly notifyActiveCheckoutStateChanged?: (
    change: VersionSurfaceActiveCheckoutStateChanged,
  ) => void;
};
