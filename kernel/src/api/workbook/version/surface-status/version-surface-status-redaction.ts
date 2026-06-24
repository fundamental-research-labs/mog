import type { VersionDiagnostic, VersionSurfaceStatus } from '@mog-sdk/contracts/api';

import type { SurfaceHostCapabilityDecisions } from './version-surface-status-service-types';
import { isSurfaceHostCapabilityDenied } from './version-surface-status-capabilities';

const REDACTED_STATUS_REVISION = 'redacted';
const REDACTED_CHECKOUT_PREFLIGHT_TOKEN = 'redacted';
const REDACTED_LIVE_COLLABORATION_ID = 'redacted';
const REDACTED_DIRTY_DIAGNOSTIC_MESSAGE =
  'Version dirty status details are redacted by host policy.';

export function shouldRedactVersionSurfaceCurrentStatus(
  hostCapabilityDecisions: SurfaceHostCapabilityDecisions,
): boolean {
  return isSurfaceHostCapabilityDenied(hostCapabilityDecisions, 'version:read');
}

export function shouldRedactVersionSurfaceDirtyStatus(
  hostCapabilityDecisions: SurfaceHostCapabilityDecisions,
): boolean {
  return isSurfaceHostCapabilityDenied(hostCapabilityDecisions, 'version:checkout');
}

export function redactedVersionSurfaceCurrentStatus(): VersionSurfaceStatus['current'] {
  return {
    detached: false,
    stale: true,
    staleReason: 'unknown',
  };
}

export function redactVersionSurfaceDirtyStatus(
  dirty: VersionSurfaceStatus['dirty'],
): VersionSurfaceStatus['dirty'] {
  return {
    ...dirty,
    statusRevision: REDACTED_STATUS_REVISION,
    checkoutPreflightToken: REDACTED_CHECKOUT_PREFLIGHT_TOKEN,
    unsafeReasons: dirty.unsafeReasons.map(redactDirtyDiagnostic),
    diagnostics: dirty.diagnostics.map(redactDirtyDiagnostic),
    ...(dirty.liveCollaboration
      ? { liveCollaboration: redactLiveCollaborationStatus(dirty.liveCollaboration) }
      : {}),
  };
}

function redactDirtyDiagnostic(diagnostic: VersionDiagnostic): VersionDiagnostic {
  return {
    ...diagnostic,
    message: REDACTED_DIRTY_DIAGNOSTIC_MESSAGE,
  };
}

function redactLiveCollaborationStatus(
  liveCollaboration: NonNullable<VersionSurfaceStatus['dirty']['liveCollaboration']>,
): NonNullable<VersionSurfaceStatus['dirty']['liveCollaboration']> {
  return {
    ...liveCollaboration,
    statusRevision: REDACTED_STATUS_REVISION,
    ...(liveCollaboration.roomId ? { roomId: REDACTED_LIVE_COLLABORATION_ID } : {}),
  };
}
