import type { DocumentContext } from '../../../../context';
import {
  isVersionProviderWriteActivityTracker,
  type VersionProviderWriteActivitySnapshot,
} from '../../../../document/version-store/provider-write-activity';
import { diagnostic } from './provider-writes-status';
import type {
  MaybeVersionRuntimeContext,
  ProviderWriteActivityProjection,
  PublicDiagnosticData,
  VersionPendingProviderWritesStatus,
} from './provider-writes-types';
import { isRecord, isSafeCount, SAFE_STATUS_REVISION_RE } from './provider-writes-utils';

export function readAttachedProviderWriteActivity(
  ctx: DocumentContext,
): ProviderWriteActivityProjection {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return { status: 'absent' };
  const pendingRemotePromotionService = isRecord(services.pendingRemotePromotionService)
    ? services.pendingRemotePromotionService
    : null;
  for (const candidate of [
    services.providerWriteActivityTracker,
    services.versionProviderWriteActivityTracker,
    services.providerWriteActivity,
    services.versionProviderWriteActivity,
    pendingRemotePromotionService?.providerWriteActivityTracker,
    services,
  ]) {
    if (!isVersionProviderWriteActivityTracker(candidate)) continue;
    try {
      return projectProviderWriteActivitySnapshot(candidate.readActivity());
    } catch {
      return failedProviderWriteActivityRead();
    }
  }
  return { status: 'absent' };
}

export function hasProviderWriteActivity(activity: VersionProviderWriteActivitySnapshot): boolean {
  return (
    activity.remoteSyncApplyActiveCount > 0 ||
    activity.pendingRemotePromotionActiveCount > 0 ||
    activity.pendingRemotePromotionQueuedCount > 0
  );
}

export function activeProviderWriteActivityStatus(
  activity: VersionProviderWriteActivitySnapshot,
): VersionPendingProviderWritesStatus {
  const reason = diagnostic(
    'version.surfaceStatus.pendingProviderWrites',
    'warning',
    'Version provider writes are in flight; checkout is unsafe until they settle.',
    {
      remoteSyncApplyActiveCount: activity.remoteSyncApplyActiveCount,
      pendingRemotePromotionActiveCount: activity.pendingRemotePromotionActiveCount,
      pendingRemotePromotionQueuedCount: activity.pendingRemotePromotionQueuedCount,
    },
  );
  return {
    pendingProviderWrites: true,
    statusRevision: `providerActivity:${activity.statusRevision}`,
    unsafeReasons: [reason],
    diagnostics: [reason],
  };
}

export function failedProviderWriteActivityStatus(
  data: PublicDiagnosticData,
): VersionPendingProviderWritesStatus {
  const reason = diagnostic(
    'version.surfaceStatus.pendingProviderWritesReadFailed',
    'warning',
    'Version provider write activity could not be proven settled. Checkout is disabled conservatively until provider writes can be proven settled.',
    data,
  );
  return {
    pendingProviderWrites: true,
    statusRevision: 'providerActivity:unknown',
    unsafeReasons: [reason],
    diagnostics: [reason],
  };
}

function failedProviderWriteActivityRead(): ProviderWriteActivityProjection {
  return {
    status: 'failed',
    data: {
      redacted: true,
      providerPayload: 'activityReadFailed',
    },
  };
}

function projectProviderWriteActivitySnapshot(value: unknown): ProviderWriteActivityProjection {
  if (!isRecord(value)) {
    return malformedProviderWriteActivitySnapshot('notObject');
  }
  if (
    !isSafeCount(value.remoteSyncApplyActiveCount) ||
    !isSafeCount(value.pendingRemotePromotionActiveCount) ||
    !isSafeCount(value.pendingRemotePromotionQueuedCount)
  ) {
    return malformedProviderWriteActivitySnapshot('invalidCounts');
  }
  if (
    typeof value.statusRevision !== 'string' ||
    !SAFE_STATUS_REVISION_RE.test(value.statusRevision)
  ) {
    return malformedProviderWriteActivitySnapshot('invalidStatusRevision');
  }
  return {
    status: 'ok',
    activity: {
      remoteSyncApplyActiveCount: value.remoteSyncApplyActiveCount,
      pendingRemotePromotionActiveCount: value.pendingRemotePromotionActiveCount,
      pendingRemotePromotionQueuedCount: value.pendingRemotePromotionQueuedCount,
      statusRevision: value.statusRevision,
    },
  };
}

function malformedProviderWriteActivitySnapshot(reason: string): ProviderWriteActivityProjection {
  return {
    status: 'failed',
    data: {
      redacted: true,
      providerPayload: 'activitySnapshot',
      payloadIssue: reason,
    },
  };
}
