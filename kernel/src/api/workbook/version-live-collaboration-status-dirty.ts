import type { VersionDiagnostic } from '@mog-sdk/contracts/api';

import { REDACTED_LIVE_COLLABORATION_ID } from './version-live-collaboration-status-constants';
import {
  dedupeDiagnostics,
  diagnostic,
  unsafeProviderLifecycleMessage,
  unsafeProviderLifecycleState,
} from './version-live-collaboration-status-diagnostics';
import type {
  VersionLiveCollaborationDirtyStatus,
  VersionLiveCollaborationPublicStatus,
  VersionLiveCollaborationStatus,
} from './version-live-collaboration-status-types';

export function liveCollaborationDirtyStatus(
  status: VersionLiveCollaborationStatus,
): VersionLiveCollaborationDirtyStatus {
  const liveCollaboration = toPublicLiveCollaborationStatus(status);
  const unsafeReasons = liveCollaborationUnsafeReasons(status);
  return {
    liveCollaboration,
    statusRevision: status.statusRevision,
    unsafeReasons,
    diagnostics: dedupeDiagnostics([...unsafeReasons, ...(status.diagnostics ?? [])]),
  };
}

function liveCollaborationUnsafeReasons(
  status: VersionLiveCollaborationStatus,
): readonly VersionDiagnostic[] {
  if (status.state === 'active') {
    return [
      diagnostic(
        'version.surfaceStatus.liveCollaborationActive',
        'warning',
        'Live collaboration is active; checkout is unsafe until the stream is fully closed.',
        status,
      ),
    ];
  }
  if (status.state === 'unknown') {
    return [
      diagnostic(
        'version.surfaceStatus.liveCollaborationUnknown',
        'warning',
        'Live collaboration state could not be proven idle; checkout is disabled conservatively.',
        status,
      ),
    ];
  }
  const unsafeProviderState = unsafeProviderLifecycleState(status);
  if (unsafeProviderState) {
    return [
      diagnostic(
        'version.surfaceStatus.liveCollaborationUnknown',
        'warning',
        unsafeProviderLifecycleMessage(unsafeProviderState),
        status,
      ),
    ];
  }
  return [];
}

function toPublicLiveCollaborationStatus(
  status: VersionLiveCollaborationStatus,
): VersionLiveCollaborationPublicStatus {
  return {
    state: status.state,
    statusRevision: status.statusRevision,
    ...(status.roomId ? { roomId: REDACTED_LIVE_COLLABORATION_ID } : {}),
    ...(status.sidecarStatus ? { sidecarStatus: status.sidecarStatus } : {}),
    ...(typeof status.activeParticipantCount === 'number'
      ? { activeParticipantCount: status.activeParticipantCount }
      : {}),
    ...(typeof status.remoteProviderAttached === 'boolean'
      ? { remoteProviderAttached: status.remoteProviderAttached }
      : {}),
    ...(typeof status.inFlightRemoteUpdateCount === 'number'
      ? { inFlightRemoteUpdateCount: status.inFlightRemoteUpdateCount }
      : {}),
    ...(typeof status.syncApplyRemoteQueueDepth === 'number'
      ? { syncApplyRemoteQueueDepth: status.syncApplyRemoteQueueDepth }
      : {}),
  };
}
