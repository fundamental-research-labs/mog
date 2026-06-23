export type VersionSyncSourceKind =
  | 'providerReplay'
  | 'providerLiveInbound'
  | 'providerMixedInbound'
  | 'collaborationHydration'
  | 'collaborationLiveRemote'
  | 'collaborationMixedRemote'
  | 'importHydration'
  | 'systemRepair'
  | 'legacyRawUnknown';

export type VersionSyncOriginKind = 'provider' | 'room' | 'import' | 'system' | 'legacyRaw';
export type VersionSyncTrustStatus = 'verified' | 'trustedLocalSystem' | 'unverified' | 'legacyRaw';
export type VersionSyncAuthorState =
  | 'singleRemote'
  | 'mixedRemote'
  | 'unknown'
  | 'agent'
  | 'system';
export type VersionSyncCommitGrouping =
  | 'none'
  | 'pendingRemote'
  | 'excludedLifecycle'
  | 'blockedMissingRedactionKey'
  | 'blockedBatchFailure'
  | 'blockedMixedRemote'
  | 'blockedUnknownRemote'
  | 'blockedUnverified';
export type VersionSyncBatchStatusState =
  | 'pending'
  | 'complete'
  | 'failedAfterMutation'
  | 'dropped'
  | 'rejected';

export interface VersionSyncOperationContext {
  readonly sourceKind: VersionSyncSourceKind;
  readonly originKind: VersionSyncOriginKind;
  readonly stableOriginId?: string;
  readonly providerId?: string;
  readonly providerKind?: string;
  readonly authorityRef?: string;
  readonly roomId?: string;
  readonly epoch?: string;
  readonly updateId?: string;
  readonly sequence?: string;
  readonly payloadHash: string;
  readonly provenancePayloadHash?: string;
  readonly trustStatus: VersionSyncTrustStatus;
  readonly authorState: VersionSyncAuthorState;
  readonly remoteSessionId?: string;
  readonly correlationId?: string;
  readonly causationIds?: readonly string[];
  readonly replay: boolean;
  readonly system: boolean;
  readonly commitGrouping: VersionSyncCommitGrouping;
  readonly batchId?: string;
  readonly subUpdateIndex?: number;
  readonly subUpdateCount?: number;
  readonly batchStatusId?: string;
  readonly batchStatusState?: VersionSyncBatchStatusState;
  readonly validationDiagnosticCount: number;
  readonly exclusionReason?: string;
  readonly exclusionSubreason?: string;
}
