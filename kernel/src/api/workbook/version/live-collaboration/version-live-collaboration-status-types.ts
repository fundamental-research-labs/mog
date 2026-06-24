import type { VersionDiagnostic, VersionSurfaceStatus } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';

export type MaybePromise<T> = T | Promise<T>;
export type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

export type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

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
  readonly diagnostics?: readonly VersionDiagnostic[];
};

export type VersionLiveCollaborationStatusReader =
  () => MaybePromise<VersionLiveCollaborationStatus>;

export type VersionLiveCollaborationStatusService = {
  readonly readLiveCollaborationStatus?: VersionLiveCollaborationStatusReader;
  readonly getLiveCollaborationStatus?: VersionLiveCollaborationStatusReader;
  readonly readStatus?: VersionLiveCollaborationStatusReader;
  readonly getStatus?: VersionLiveCollaborationStatusReader;
};

export type VersionLiveCollaborationDirtyStatus = {
  readonly liveCollaboration: NonNullable<VersionSurfaceStatus['dirty']['liveCollaboration']>;
  readonly statusRevision: string;
  readonly unsafeReasons: readonly VersionDiagnostic[];
  readonly diagnostics: readonly VersionDiagnostic[];
};

export type UnsafeProviderLifecycleState =
  | 'active'
  | 'disconnected'
  | 'unknown'
  | 'quarantined'
  | 'stale'
  | 'inFlightRemoteUpdates'
  | 'syncApplyQueue';

export type VersionLiveCollaborationStatusReaderInput = {
  readonly readState: () => {
    readonly state: VersionLiveCollaborationState;
    readonly roomId?: string;
    readonly sidecarStatus?: string;
    readonly activeParticipantCount?: number;
    readonly remoteProviderAttached?: boolean;
    readonly inFlightRemoteUpdateCount?: number;
    readonly syncApplyRemoteQueueDepth?: number;
    readonly statusRevision?: string;
  };
};

export type VersionLiveCollaborationPublicStatus = NonNullable<
  VersionSurfaceStatus['dirty']['liveCollaboration']
>;
