import type { VersionDiagnostic } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import {
  getAttachedVersionSurfaceStatusService,
  readCheckoutSessionCurrentStatus,
  readVersionSurfaceCheckoutSession,
  readVersionSurfaceDirtyStatus,
} from './version-surface-status-service';

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;
type PendingProviderWriteNumberPayload = {
  pendingRemoteSegmentCount?: number;
  remoteSyncApplyActiveCount?: number;
  pendingRemotePromotionActiveCount?: number;
  pendingRemotePromotionQueuedCount?: number;
};
type LiveCollaborationPayload = {
  collaborationState?: string;
  roomId?: string;
  sidecarStatus?: string;
  activeParticipantCount?: number;
  remoteProviderAttached?: boolean;
  inFlightRemoteUpdateCount?: number;
  syncApplyRemoteQueueDepth?: number;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

export type VersionCheckoutAdmissionBlock =
  | {
      readonly reason: 'dirtyWorkingState';
    }
  | {
      readonly reason: 'pendingProviderWrites';
      readonly pendingRemoteSegmentCount?: number;
      readonly remoteSyncApplyActiveCount?: number;
      readonly pendingRemotePromotionActiveCount?: number;
      readonly pendingRemotePromotionQueuedCount?: number;
    }
  | {
      readonly reason: 'pendingRecalc';
    }
  | ({
      readonly reason: 'liveCollaborationActive';
    } & LiveCollaborationPayload)
  | {
      readonly reason: 'checkoutAlreadyInProgress' | 'checkoutPreflightUnsafe';
    }
  | {
      readonly reason: 'staleWorkspaceHead';
      readonly staleReason: 'refMoved' | 'activeSessionBehind' | 'unknown';
      readonly branchName?: string;
      readonly checkedOutCommitId?: string;
      readonly refHeadAtMaterialization?: string;
      readonly currentRefHeadId?: string;
    };

export async function readVersionCheckoutAdmissionBlock(
  ctx: DocumentContext,
): Promise<VersionCheckoutAdmissionBlock | null> {
  const services = getAttachedVersionRuntimeServices(ctx);
  const surfaceStatusService = getAttachedVersionSurfaceStatusService(services);
  if (!surfaceStatusService) return null;

  const surfaceDiagnostics: VersionDiagnostic[] = [];
  const dirtyStatus = await readVersionSurfaceDirtyStatus(
    surfaceStatusService,
    surfaceDiagnostics,
  );
  const dirtyBlock = checkoutAdmissionBlockForDirtyStatus(dirtyStatus);
  if (dirtyBlock) return dirtyBlock;

  const activeCheckoutSession = await readVersionSurfaceCheckoutSession(
    surfaceStatusService,
    surfaceDiagnostics,
  );
  if (!activeCheckoutSession) return null;

  const readService = getAttachedCheckoutAdmissionReadService(services);
  const current = await readCheckoutSessionCurrentStatus({
    session: activeCheckoutSession,
    ...(readService?.readRef ? { readRef: readService.readRef } : {}),
    diagnostics: surfaceDiagnostics,
  });

  if (!current.stale) return null;
  return {
    reason: 'staleWorkspaceHead',
    staleReason: current.staleReason ?? 'unknown',
    ...(current.branchName ? { branchName: current.branchName } : {}),
    ...(current.checkedOutCommitId ? { checkedOutCommitId: current.checkedOutCommitId } : {}),
    ...(current.refHeadAtMaterialization
      ? { refHeadAtMaterialization: current.refHeadAtMaterialization }
      : {}),
    ...(current.currentRefHeadId ? { currentRefHeadId: current.currentRefHeadId } : {}),
  };
}

function checkoutAdmissionBlockForDirtyStatus(
  dirty: Awaited<ReturnType<typeof readVersionSurfaceDirtyStatus>>,
): VersionCheckoutAdmissionBlock | null {
  if (dirty.hasUncommittedLocalChanges) return { reason: 'dirtyWorkingState' };
  if (dirty.pendingProviderWrites) {
    return {
      reason: 'pendingProviderWrites',
      ...pendingProviderWritePayload(dirty.unsafeReasons),
    };
  }
  if (dirty.pendingRecalc) return { reason: 'pendingRecalc' };
  if (unsafeReasonCode(dirty, 'version.surfaceStatus.checkoutInProgress')) {
    return { reason: 'checkoutAlreadyInProgress' };
  }
  if (
    unsafeReasonCode(dirty, 'version.surfaceStatus.liveCollaborationActive') ||
    unsafeReasonCode(dirty, 'version.surfaceStatus.liveCollaborationUnknown')
  ) {
    return {
      reason: 'liveCollaborationActive',
      ...liveCollaborationPayload(dirty.unsafeReasons),
    };
  }
  if (!dirty.checkoutSafe) return { reason: 'checkoutPreflightUnsafe' };
  return null;
}

function getAttachedVersionRuntimeServices(ctx: DocumentContext): unknown {
  const runtime = ctx as MaybeVersionRuntimeContext;
  return runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
}

type AttachedCheckoutAdmissionReadService = {
  readRef?: (name: string) => MaybePromise<unknown>;
};

function getAttachedCheckoutAdmissionReadService(
  services: unknown,
): AttachedCheckoutAdmissionReadService | null {
  if (!isRecord(services)) return null;
  for (const candidate of [
    services.readService,
    services.writeService,
    services.commitService,
    services.versionReadService,
    services.publicService,
    services,
  ]) {
    const readService = toCheckoutAdmissionReadService(candidate);
    if (readService) return readService;
  }
  return null;
}

function toCheckoutAdmissionReadService(
  value: unknown,
): AttachedCheckoutAdmissionReadService | null {
  const readRef = bindMethod(value, 'readRef');
  return readRef ? { readRef: (name) => readRef(name) } : null;
}

function unsafeReasonCode(
  dirty: Awaited<ReturnType<typeof readVersionSurfaceDirtyStatus>>,
  code: string,
): boolean {
  return dirty.unsafeReasons.some((reason) => reason.code === code);
}

function pendingProviderWritePayload(
  unsafeReasons: readonly VersionDiagnostic[],
): Pick<
  Extract<VersionCheckoutAdmissionBlock, { reason: 'pendingProviderWrites' }>,
  'pendingRemoteSegmentCount'
  | 'remoteSyncApplyActiveCount'
  | 'pendingRemotePromotionActiveCount'
  | 'pendingRemotePromotionQueuedCount'
> {
  const payload: PendingProviderWriteNumberPayload = {};
  for (const reason of unsafeReasons) {
    if (reason.code !== 'version.surfaceStatus.pendingProviderWrites') continue;
    assignNumberPayload(payload, 'pendingRemoteSegmentCount', reason.data);
    assignNumberPayload(payload, 'remoteSyncApplyActiveCount', reason.data);
    assignNumberPayload(payload, 'pendingRemotePromotionActiveCount', reason.data);
    assignNumberPayload(payload, 'pendingRemotePromotionQueuedCount', reason.data);
  }
  return payload;
}

function liveCollaborationPayload(
  unsafeReasons: readonly VersionDiagnostic[],
): LiveCollaborationPayload {
  const payload: LiveCollaborationPayload = {};
  for (const reason of unsafeReasons) {
    if (
      reason.code !== 'version.surfaceStatus.liveCollaborationActive' &&
      reason.code !== 'version.surfaceStatus.liveCollaborationUnknown'
    ) {
      continue;
    }
    assignStringPayload(payload, 'collaborationState', reason.data);
    assignStringPayload(payload, 'roomId', reason.data);
    assignStringPayload(payload, 'sidecarStatus', reason.data);
    assignNumberPayload(payload, 'activeParticipantCount', reason.data);
    assignBooleanPayload(payload, 'remoteProviderAttached', reason.data);
    assignNumberPayload(payload, 'inFlightRemoteUpdateCount', reason.data);
    assignNumberPayload(payload, 'syncApplyRemoteQueueDepth', reason.data);
  }
  return payload;
}

function assignNumberPayload(
  payload: PendingProviderWriteNumberPayload | LiveCollaborationPayload,
  key: keyof PendingProviderWriteNumberPayload | keyof LiveCollaborationPayload,
  data: VersionDiagnostic['data'],
): void {
  const value = data?.[key];
  if (typeof value === 'number') {
    (payload as Record<string, number>)[key] = value;
  }
}

function assignStringPayload(
  payload: LiveCollaborationPayload,
  key: keyof LiveCollaborationPayload,
  data: VersionDiagnostic['data'],
): void {
  const value = data?.[key];
  if (typeof value === 'string') {
    (payload as Record<string, string>)[key] = value;
  }
}

function assignBooleanPayload(
  payload: LiveCollaborationPayload,
  key: keyof LiveCollaborationPayload,
  data: VersionDiagnostic['data'],
): void {
  const value = data?.[key];
  if (typeof value === 'boolean') {
    (payload as Record<string, boolean>)[key] = value;
  }
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
