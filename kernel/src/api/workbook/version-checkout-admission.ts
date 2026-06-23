import type { VersionDiagnostic } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import {
  hasPendingRemoteSegmentStoreProvider,
  type PendingRemoteSegmentRecord,
} from '../../document/version-store/pending-remote-segment-store';
import type { VersionStoreProvider } from '../../document/version-store/provider';
import { namespaceForRegistry } from '../../document/version-store/registry';
import {
  hasSyncBatchStatusStoreProvider,
  syncBatchStatusKeyMaterialForOperationContext,
  type SyncBatchStatusId,
  type SyncBatchStatusState,
  type SyncBatchStatusStore,
  type SyncBatchStatusTerminal,
} from '../../document/version-store/sync-batch-status-store';
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
  syncBatchStatusPendingCount?: number;
  syncBatchStatusBlockedCount?: number;
  syncBatchStatusTerminalCount?: number;
  syncBatchStatusFailedAfterMutationCount?: number;
  syncBatchStatusDroppedCount?: number;
  syncBatchStatusRejectedCount?: number;
  syncBatchStatusReadFailedCount?: number;
};
type PendingProviderWriteStringPayload = {
  syncBatchStatusFirstState?: string;
  syncBatchStatusFirstReason?: string;
  syncBatchStatusFirstSegmentId?: string;
  syncBatchStatusFirstBatchStatusId?: string;
};
type PendingProviderWritePayload = PendingProviderWriteNumberPayload &
  PendingProviderWriteStringPayload;
type SyncBatchStatusPayload = Pick<
  PendingProviderWritePayload,
  | 'pendingRemoteSegmentCount'
  | 'syncBatchStatusPendingCount'
  | 'syncBatchStatusBlockedCount'
  | 'syncBatchStatusTerminalCount'
  | 'syncBatchStatusFailedAfterMutationCount'
  | 'syncBatchStatusDroppedCount'
  | 'syncBatchStatusRejectedCount'
  | 'syncBatchStatusReadFailedCount'
  | 'syncBatchStatusFirstState'
  | 'syncBatchStatusFirstReason'
  | 'syncBatchStatusFirstSegmentId'
  | 'syncBatchStatusFirstBatchStatusId'
>;
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
      readonly syncBatchStatusPendingCount?: number;
      readonly syncBatchStatusBlockedCount?: number;
      readonly syncBatchStatusTerminalCount?: number;
      readonly syncBatchStatusFailedAfterMutationCount?: number;
      readonly syncBatchStatusDroppedCount?: number;
      readonly syncBatchStatusRejectedCount?: number;
      readonly syncBatchStatusReadFailedCount?: number;
      readonly syncBatchStatusFirstState?: string;
      readonly syncBatchStatusFirstReason?: string;
      readonly syncBatchStatusFirstSegmentId?: string;
      readonly syncBatchStatusFirstBatchStatusId?: string;
    }
  | ({
      readonly reason: 'syncBatchStatusBlocked';
    } & SyncBatchStatusPayload)
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
  const dirtyStatus = await readVersionSurfaceDirtyStatus(surfaceStatusService, surfaceDiagnostics);
  const syncBatchBlock = await readSyncBatchStatusAdmissionBlock(services);
  const dirtyBlock = checkoutAdmissionBlockForDirtyStatus(dirtyStatus);
  if (syncBatchBlock) return syncBatchBlock;
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
  return providerCheckoutAdmissionReadService(getAttachedVersionStoreProvider(services));
}

function toCheckoutAdmissionReadService(
  value: unknown,
): AttachedCheckoutAdmissionReadService | null {
  const readRef = bindMethod(value, 'readRef');
  return readRef ? { readRef: (name) => readRef(name) } : null;
}

function providerCheckoutAdmissionReadService(
  provider: VersionStoreProvider | null,
): AttachedCheckoutAdmissionReadService | null {
  if (!provider) return null;
  return {
    readRef: async (name) => {
      const registry = await provider.readGraphRegistry();
      if (registry.status !== 'ok') return null;
      const graph = await provider.openGraph(
        namespaceForRegistry(registry.registry),
        provider.accessContext,
      );
      return graph.readRef(name);
    },
  };
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
  | 'pendingRemoteSegmentCount'
  | 'remoteSyncApplyActiveCount'
  | 'pendingRemotePromotionActiveCount'
  | 'pendingRemotePromotionQueuedCount'
  | 'syncBatchStatusPendingCount'
  | 'syncBatchStatusBlockedCount'
  | 'syncBatchStatusTerminalCount'
  | 'syncBatchStatusFailedAfterMutationCount'
  | 'syncBatchStatusDroppedCount'
  | 'syncBatchStatusRejectedCount'
  | 'syncBatchStatusReadFailedCount'
  | 'syncBatchStatusFirstState'
  | 'syncBatchStatusFirstReason'
  | 'syncBatchStatusFirstSegmentId'
  | 'syncBatchStatusFirstBatchStatusId'
> {
  const payload: PendingProviderWritePayload = {};
  for (const reason of unsafeReasons) {
    if (reason.code !== 'version.surfaceStatus.pendingProviderWrites') continue;
    assignNumberPayload(payload, 'pendingRemoteSegmentCount', reason.data);
    assignNumberPayload(payload, 'remoteSyncApplyActiveCount', reason.data);
    assignNumberPayload(payload, 'pendingRemotePromotionActiveCount', reason.data);
    assignNumberPayload(payload, 'pendingRemotePromotionQueuedCount', reason.data);
    assignNumberPayload(payload, 'syncBatchStatusPendingCount', reason.data);
    assignNumberPayload(payload, 'syncBatchStatusBlockedCount', reason.data);
    assignNumberPayload(payload, 'syncBatchStatusTerminalCount', reason.data);
    assignNumberPayload(payload, 'syncBatchStatusFailedAfterMutationCount', reason.data);
    assignNumberPayload(payload, 'syncBatchStatusDroppedCount', reason.data);
    assignNumberPayload(payload, 'syncBatchStatusRejectedCount', reason.data);
    assignNumberPayload(payload, 'syncBatchStatusReadFailedCount', reason.data);
    assignStringPayload(payload, 'syncBatchStatusFirstState', reason.data);
    assignStringPayload(payload, 'syncBatchStatusFirstReason', reason.data);
    assignStringPayload(payload, 'syncBatchStatusFirstSegmentId', reason.data);
    assignStringPayload(payload, 'syncBatchStatusFirstBatchStatusId', reason.data);
  }
  return payload;
}

async function readSyncBatchStatusAdmissionBlock(
  services: unknown,
): Promise<Extract<VersionCheckoutAdmissionBlock, { reason: 'syncBatchStatusBlocked' }> | null> {
  const provider = getAttachedVersionStoreProvider(services);
  if (
    !provider ||
    !hasPendingRemoteSegmentStoreProvider(provider) ||
    !hasSyncBatchStatusStoreProvider(provider)
  ) {
    return null;
  }

  try {
    const registry = await provider.readGraphRegistry();
    if (registry.status !== 'ok') return null;

    const pendingStore = await provider.openPendingRemoteSegmentStore(
      namespaceForRegistry(registry.registry),
    );
    const listed = await pendingStore.listByState('pending');
    if (listed.status !== 'success' || listed.records.length === 0) return null;

    const syncBatchStatusStore = await provider.openSyncBatchStatusStore();
    const payload = await syncBatchStatusPayloadForPendingSegments(
      listed.records,
      syncBatchStatusStore,
    );
    return hasSyncBatchStatusBlockers(payload)
      ? { reason: 'syncBatchStatusBlocked', ...payload }
      : null;
  } catch {
    return null;
  }
}

async function syncBatchStatusPayloadForPendingSegments(
  records: readonly PendingRemoteSegmentRecord[],
  store: SyncBatchStatusStore,
): Promise<PendingProviderWritePayload> {
  const payload: PendingProviderWritePayload = {
    pendingRemoteSegmentCount: records.length,
  };
  for (const record of records) {
    const batchStatusId = await batchStatusIdForPendingRemoteSegment(record);
    if (!batchStatusId) continue;

    let read: Awaited<ReturnType<SyncBatchStatusStore['readByBatchStatusId']>>;
    try {
      read = await store.readByBatchStatusId(batchStatusId);
    } catch {
      incrementPendingProviderPayload(payload, 'syncBatchStatusReadFailedCount');
      assignFirstSyncBatchStatus(payload, {
        state: 'readFailed',
        segmentId: record.pendingRemoteSegmentId,
        batchStatusId,
      });
      continue;
    }

    if (read.status === 'missing') continue;
    if (read.status === 'failed') {
      incrementPendingProviderPayload(payload, 'syncBatchStatusReadFailedCount');
      assignFirstSyncBatchStatus(payload, {
        state: 'readFailed',
        segmentId: record.pendingRemoteSegmentId,
        batchStatusId,
      });
      continue;
    }

    const state = read.record.state;
    if (state === 'pending') {
      incrementPendingProviderPayload(payload, 'syncBatchStatusPendingCount');
      assignFirstSyncBatchStatus(payload, {
        state,
        segmentId: record.pendingRemoteSegmentId,
        batchStatusId,
      });
      continue;
    }

    if (isBlockedSyncBatchTerminal(state)) {
      incrementPendingProviderPayload(payload, 'syncBatchStatusTerminalCount');
      switch (state) {
        case 'failedAfterMutation':
          incrementPendingProviderPayload(payload, 'syncBatchStatusFailedAfterMutationCount');
          break;
        case 'dropped':
          incrementPendingProviderPayload(payload, 'syncBatchStatusDroppedCount');
          break;
        case 'rejected':
          incrementPendingProviderPayload(payload, 'syncBatchStatusRejectedCount');
          break;
      }
      assignFirstSyncBatchStatus(payload, {
        state,
        reason: terminalReason(read.record.terminal),
        segmentId: record.pendingRemoteSegmentId,
        batchStatusId,
      });
    }
  }

  if (payload.syncBatchStatusPendingCount !== undefined) {
    payload.syncBatchStatusBlockedCount =
      (payload.syncBatchStatusBlockedCount ?? 0) + payload.syncBatchStatusPendingCount;
  }
  if (payload.syncBatchStatusTerminalCount !== undefined) {
    payload.syncBatchStatusBlockedCount =
      (payload.syncBatchStatusBlockedCount ?? 0) + payload.syncBatchStatusTerminalCount;
  }
  if (payload.syncBatchStatusReadFailedCount !== undefined) {
    payload.syncBatchStatusBlockedCount =
      (payload.syncBatchStatusBlockedCount ?? 0) + payload.syncBatchStatusReadFailedCount;
  }
  return payload;
}

async function batchStatusIdForPendingRemoteSegment(
  record: PendingRemoteSegmentRecord,
): Promise<SyncBatchStatusId | null> {
  const direct = record.operationContext.collaboration.batchStatusId;
  if (isSyncBatchStatusId(direct)) return direct;
  try {
    return (await syncBatchStatusKeyMaterialForOperationContext(record.operationContext))
      .batchStatusId;
  } catch {
    return null;
  }
}

function getAttachedVersionStoreProvider(services: unknown): VersionStoreProvider | null {
  if (!isRecord(services)) return null;
  for (const candidate of [services.provider, services.storageProvider, services]) {
    if (isVersionStoreProvider(candidate)) return candidate;
  }
  return null;
}

function isVersionStoreProvider(value: unknown): value is VersionStoreProvider {
  return (
    isRecord(value) &&
    typeof value.readGraphRegistry === 'function' &&
    typeof value.openGraph === 'function'
  );
}

function isBlockedSyncBatchTerminal(
  state: SyncBatchStatusState,
): state is 'failedAfterMutation' | 'dropped' | 'rejected' {
  return state === 'failedAfterMutation' || state === 'dropped' || state === 'rejected';
}

function terminalReason(terminal: SyncBatchStatusTerminal | undefined): string | undefined {
  return terminal && 'reason' in terminal ? terminal.reason : undefined;
}

function hasSyncBatchStatusBlockers(payload: PendingProviderWritePayload): boolean {
  return (
    (payload.syncBatchStatusPendingCount ?? 0) > 0 ||
    (payload.syncBatchStatusTerminalCount ?? 0) > 0 ||
    (payload.syncBatchStatusReadFailedCount ?? 0) > 0
  );
}

function incrementPendingProviderPayload(
  payload: PendingProviderWriteNumberPayload,
  key: keyof PendingProviderWriteNumberPayload,
): void {
  payload[key] = (payload[key] ?? 0) + 1;
}

function assignFirstSyncBatchStatus(
  payload: PendingProviderWritePayload,
  input: {
    readonly state: string;
    readonly reason?: string;
    readonly segmentId: string;
    readonly batchStatusId: string;
  },
): void {
  payload.syncBatchStatusFirstState ??= input.state;
  payload.syncBatchStatusFirstSegmentId ??= input.segmentId;
  payload.syncBatchStatusFirstBatchStatusId ??= input.batchStatusId;
  if (input.reason !== undefined) payload.syncBatchStatusFirstReason ??= input.reason;
}

function isSyncBatchStatusId(value: unknown): value is SyncBatchStatusId {
  return typeof value === 'string' && /^sync-batch-status:sha256:[0-9a-f]{64}$/.test(value);
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
  payload: LiveCollaborationPayload | PendingProviderWriteStringPayload,
  key: keyof LiveCollaborationPayload | keyof PendingProviderWriteStringPayload,
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
