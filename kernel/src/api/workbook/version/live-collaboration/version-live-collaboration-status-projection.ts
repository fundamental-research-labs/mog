import { REDACTED_LIVE_COLLABORATION_ID } from './version-live-collaboration-status-constants';
import {
  collectSensitiveStrings,
  diagnostic,
  optionalDiagnosticArray,
} from './version-live-collaboration-status-diagnostics';
import {
  isLiveCollaborationState,
  isRecord,
  optionalBoolean,
  optionalBooleanField,
  optionalNumber,
  optionalNumberField,
  optionalString,
  optionalStringField,
} from './version-live-collaboration-status-guards';
import type { VersionLiveCollaborationStatus } from './version-live-collaboration-status-types';

export function absentLiveCollaborationStatus(): VersionLiveCollaborationStatus {
  return {
    state: 'absent',
    statusRevision: 'liveCollaboration:absent',
  };
}

export function unknownLiveCollaborationStatus(message: string): VersionLiveCollaborationStatus {
  return {
    state: 'unknown',
    statusRevision: 'liveCollaboration:unknown',
    diagnostics: [
      diagnostic(
        'version.surfaceStatus.liveCollaborationUnknown',
        'warning',
        `${message} Checkout is disabled conservatively until live collaboration can be proven idle.`,
      ),
    ],
  };
}

export function projectLiveCollaborationStatus(
  value: unknown,
): VersionLiveCollaborationStatus | null {
  if (!isRecord(value)) return null;
  const state = value.state;
  if (!isLiveCollaborationState(state)) return null;
  if (typeof value.statusRevision !== 'string' || value.statusRevision.length === 0) return null;

  const roomId = optionalStringField(value, 'roomId');
  const sidecarStatus = optionalStringField(value, 'sidecarStatus');
  const activeParticipantCount = optionalNumberField(value, 'activeParticipantCount');
  const remoteProviderAttached = optionalBooleanField(value, 'remoteProviderAttached');
  const inFlightRemoteUpdateCount = optionalNumberField(value, 'inFlightRemoteUpdateCount');
  const syncApplyRemoteQueueDepth = optionalNumberField(value, 'syncApplyRemoteQueueDepth');
  if (
    roomId === null ||
    sidecarStatus === null ||
    activeParticipantCount === null ||
    remoteProviderAttached === null ||
    inFlightRemoteUpdateCount === null ||
    syncApplyRemoteQueueDepth === null
  ) {
    return null;
  }

  const redactedValues = collectSensitiveStrings(value, roomId ? [roomId] : []);
  const diagnostics = optionalDiagnosticArray(value.diagnostics, redactedValues);
  if (diagnostics === null) return null;

  const status: VersionLiveCollaborationStatus = {
    state,
    statusRevision: defaultStatusRevision({
      state,
      ...(roomId ? { roomId } : {}),
      ...(sidecarStatus ? { sidecarStatus } : {}),
      ...(activeParticipantCount === undefined ? {} : { activeParticipantCount }),
      ...(remoteProviderAttached === undefined ? {} : { remoteProviderAttached }),
      ...(inFlightRemoteUpdateCount === undefined ? {} : { inFlightRemoteUpdateCount }),
      ...(syncApplyRemoteQueueDepth === undefined ? {} : { syncApplyRemoteQueueDepth }),
    }),
    ...(roomId ? { roomId } : {}),
    ...(sidecarStatus ? { sidecarStatus } : {}),
    ...(activeParticipantCount === undefined ? {} : { activeParticipantCount }),
    ...(remoteProviderAttached === undefined ? {} : { remoteProviderAttached }),
    ...(inFlightRemoteUpdateCount === undefined ? {} : { inFlightRemoteUpdateCount }),
    ...(syncApplyRemoteQueueDepth === undefined ? {} : { syncApplyRemoteQueueDepth }),
  };
  return diagnostics ? { ...status, diagnostics } : status;
}

export function withDefaultStatusRevision(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return {
    ...value,
    statusRevision: optionalString(value.statusRevision) ?? defaultStatusRevision(value),
  };
}

function defaultStatusRevision(state: {
  readonly state?: unknown;
  readonly roomId?: unknown;
  readonly sidecarStatus?: unknown;
  readonly activeParticipantCount?: unknown;
  readonly remoteProviderAttached?: unknown;
  readonly inFlightRemoteUpdateCount?: unknown;
  readonly syncApplyRemoteQueueDepth?: unknown;
}): string {
  const collaborationState = isLiveCollaborationState(state.state) ? state.state : 'unknown';
  const sidecarStatus = optionalString(state.sidecarStatus);
  const activeParticipantCount = optionalNumber(state.activeParticipantCount);
  const remoteProviderAttached = optionalBoolean(state.remoteProviderAttached);
  const inFlightRemoteUpdateCount = optionalNumber(state.inFlightRemoteUpdateCount);
  const syncApplyRemoteQueueDepth = optionalNumber(state.syncApplyRemoteQueueDepth);
  return [
    'liveCollaboration',
    collaborationState,
    optionalString(state.roomId) ? `room:${REDACTED_LIVE_COLLABORATION_ID}` : null,
    sidecarStatus ? `sidecar:${sidecarStatus}` : null,
    activeParticipantCount === undefined ? null : `participants:${activeParticipantCount}`,
    remoteProviderAttached === undefined
      ? null
      : `provider:${remoteProviderAttached ? 'attached' : 'none'}`,
    inFlightRemoteUpdateCount === undefined ? null : `remoteUpdates:${inFlightRemoteUpdateCount}`,
    syncApplyRemoteQueueDepth === undefined ? null : `syncApplyQueue:${syncApplyRemoteQueueDepth}`,
  ]
    .filter((entry): entry is string => entry !== null)
    .join(':');
}
