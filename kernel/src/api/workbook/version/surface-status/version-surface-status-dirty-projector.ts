import type { VersionSurfaceStatus } from '@mog-sdk/contracts/api';

import { normalizeVersionSurfacePendingProviderWritesStatus } from './version-surface-status-service-provider-writes';
import { diagnosticArray, stringArray } from './version-surface-status-utils';

export function projectDirtyStatus(value: unknown): VersionSurfaceStatus['dirty'] | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Readonly<Record<string, unknown>>;
  if (record.source !== 'VC-05') return null;
  if (typeof record.statusRevision !== 'string' || record.statusRevision.length === 0) return null;
  if (
    typeof record.checkoutPreflightToken !== 'string' ||
    record.checkoutPreflightToken.length === 0
  ) {
    return null;
  }
  if (
    typeof record.hasUncommittedLocalChanges !== 'boolean' ||
    typeof record.commitEligibleChanges !== 'boolean' ||
    typeof record.pendingProviderWrites !== 'boolean' ||
    typeof record.pendingRecalc !== 'boolean' ||
    typeof record.checkoutSafe !== 'boolean'
  ) {
    return null;
  }
  const unsupportedDirtyDomains = stringArray(record.unsupportedDirtyDomains);
  const unsafeReasons = diagnosticArray(record.unsafeReasons);
  const diagnostics = diagnosticArray(record.diagnostics);
  if (!unsupportedDirtyDomains || !unsafeReasons || !diagnostics) return null;
  const liveCollaboration = projectLiveCollaboration(record.liveCollaboration);
  if (record.liveCollaboration !== undefined && !liveCollaboration) return null;
  const providerWrites = normalizeVersionSurfacePendingProviderWritesStatus({
    pendingProviderWrites: record.pendingProviderWrites,
    statusRevision: 'attachedDirtyStatus',
    unsafeReasons,
    diagnostics,
  });

  return {
    statusRevision: record.statusRevision,
    checkoutPreflightToken: record.checkoutPreflightToken,
    hasUncommittedLocalChanges: record.hasUncommittedLocalChanges,
    commitEligibleChanges: record.commitEligibleChanges,
    unsupportedDirtyDomains,
    pendingProviderWrites: providerWrites.pendingProviderWrites,
    pendingRecalc: record.pendingRecalc,
    ...(liveCollaboration ? { liveCollaboration } : {}),
    checkoutSafe: record.checkoutSafe && !providerWrites.pendingProviderWrites,
    unsafeReasons: providerWrites.unsafeReasons,
    source: 'VC-05',
    diagnostics: providerWrites.diagnostics,
  };
}

function projectLiveCollaboration(
  value: unknown,
): VersionSurfaceStatus['dirty']['liveCollaboration'] | null {
  if (value === undefined) return null;
  if (!value || typeof value !== 'object') return null;
  const record = value as Readonly<Record<string, unknown>>;
  if (
    record.state !== 'absent' &&
    record.state !== 'disabled' &&
    record.state !== 'idle' &&
    record.state !== 'active' &&
    record.state !== 'unknown'
  ) {
    return null;
  }
  if (typeof record.statusRevision !== 'string' || record.statusRevision.length === 0) return null;
  return {
    state: record.state,
    statusRevision: record.statusRevision,
    ...(typeof record.roomId === 'string' && record.roomId.length > 0
      ? { roomId: record.roomId }
      : {}),
    ...(typeof record.sidecarStatus === 'string' && record.sidecarStatus.length > 0
      ? { sidecarStatus: record.sidecarStatus }
      : {}),
    ...(typeof record.activeParticipantCount === 'number'
      ? { activeParticipantCount: record.activeParticipantCount }
      : {}),
    ...(typeof record.remoteProviderAttached === 'boolean'
      ? { remoteProviderAttached: record.remoteProviderAttached }
      : {}),
    ...(typeof record.inFlightRemoteUpdateCount === 'number'
      ? { inFlightRemoteUpdateCount: record.inFlightRemoteUpdateCount }
      : {}),
    ...(typeof record.syncApplyRemoteQueueDepth === 'number'
      ? { syncApplyRemoteQueueDepth: record.syncApplyRemoteQueueDepth }
      : {}),
  };
}
