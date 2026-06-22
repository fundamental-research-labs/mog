import type { AdmittedSyncApplyContext } from '../bridges/compute/sync-apply-admission';
import {
  appliedSyncUpdateIdentityKeyMaterialForOperationContext,
  hasAppliedSyncUpdateIdentityStoreProvider,
  type AppliedSyncUpdateIdentityKey,
  type AppliedSyncUpdateIdentityOperationContext,
  type AppliedSyncUpdateIdentityStore,
  type AppliedSyncUpdateIdentityStoreDiagnostic,
  type AppliedSyncUpdateIdentityTerminal,
} from './version-store/applied-sync-update-identity-store';

export type { AppliedSyncUpdateIdentityStore };

export type AppliedSyncUpdateIdentityAppliedTerminalMetadata = Omit<
  Extract<AppliedSyncUpdateIdentityTerminal, { readonly status: 'applied' }>,
  'status'
>;

export type AppliedSyncUpdateIdentityReservation = {
  readonly store: AppliedSyncUpdateIdentityStore;
  readonly identityKey: AppliedSyncUpdateIdentityKey;
  readonly operationContext: AppliedSyncUpdateIdentityOperationContext;
  readonly payloadHash: string;
};

type AppliedSyncUpdateIdentityDuplicateDecision = {
  readonly status:
    | 'duplicate'
    | 'conflict'
    | 'failed'
    | 'failedAfterMutation'
    | 'missing'
    | 'notDuplicate'
    | 'terminalRejected';
};

type AppliedSyncUpdateIdentityReserveDecision = {
  readonly status:
    | 'reserved'
    | 'duplicate'
    | 'conflict'
    | 'failed'
    | 'failedAfterMutation'
    | 'terminalRejected';
};

export type AppliedSyncUpdateIdentityPreApplyRejectionReason =
  | 'duplicate-update-id'
  | 'applied-sync-update-identity-conflict'
  | 'applied-sync-update-identity-failed-after-mutation'
  | 'applied-sync-update-identity-terminal-rejected'
  | 'applied-sync-update-identity-read-failed'
  | 'applied-sync-update-identity-reservation-failed';

export type AppliedSyncUpdateIdentityPreApplyDecision =
  | {
      readonly status: 'apply';
      readonly reservation: AppliedSyncUpdateIdentityReservation | null;
    }
  | { readonly status: 'duplicate' }
  | {
      readonly status: 'rejected';
      readonly reason: AppliedSyncUpdateIdentityPreApplyRejectionReason;
    };

export async function openAppliedSyncUpdateIdentityStoreFromProvider(
  provider: unknown,
): Promise<AppliedSyncUpdateIdentityStore | undefined> {
  if (!hasAppliedSyncUpdateIdentityStoreProvider(provider)) return undefined;
  return provider.openAppliedSyncUpdateIdentityStore();
}

export async function prepareAppliedSyncUpdateIdentityBeforeApply(options: {
  readonly store: AppliedSyncUpdateIdentityStore | undefined;
  readonly admittedContext: AdmittedSyncApplyContext;
  readonly inboundUpdateAlreadySeen: boolean;
}): Promise<AppliedSyncUpdateIdentityPreApplyDecision> {
  const reservation = await appliedSyncUpdateIdentityReservationForAdmittedContext(
    options.store,
    options.admittedContext,
  );

  if (options.inboundUpdateAlreadySeen) {
    if (!reservation) return { status: 'rejected', reason: 'duplicate-update-id' };
    const loggedDuplicate = await readAppliedSyncUpdateIdentityDuplicate(reservation);
    switch (loggedDuplicate.status) {
      case 'duplicate':
        return { status: 'duplicate' };
      case 'conflict':
        return { status: 'rejected', reason: 'applied-sync-update-identity-conflict' };
      case 'failed':
        return { status: 'rejected', reason: 'applied-sync-update-identity-read-failed' };
      case 'failedAfterMutation':
        return {
          status: 'rejected',
          reason: 'applied-sync-update-identity-failed-after-mutation',
        };
      case 'terminalRejected':
        return {
          status: 'rejected',
          reason: 'applied-sync-update-identity-terminal-rejected',
        };
      case 'missing':
      case 'notDuplicate':
        return { status: 'rejected', reason: 'duplicate-update-id' };
    }
  }

  if (!reservation) return { status: 'apply', reservation: null };

  const reserved = await reserveAppliedSyncUpdateIdentity(reservation);
  switch (reserved.status) {
    case 'reserved':
      return { status: 'apply', reservation };
    case 'duplicate':
      return { status: 'duplicate' };
    case 'conflict':
      return { status: 'rejected', reason: 'applied-sync-update-identity-conflict' };
    case 'failed':
      return { status: 'rejected', reason: 'applied-sync-update-identity-reservation-failed' };
    case 'failedAfterMutation':
      return {
        status: 'rejected',
        reason: 'applied-sync-update-identity-failed-after-mutation',
      };
    case 'terminalRejected':
      return {
        status: 'rejected',
        reason: 'applied-sync-update-identity-terminal-rejected',
      };
  }
}

async function appliedSyncUpdateIdentityReservationForAdmittedContext(
  store: AppliedSyncUpdateIdentityStore | undefined,
  admittedContext: AdmittedSyncApplyContext,
): Promise<AppliedSyncUpdateIdentityReservation | null> {
  if (!store) return null;
  if (admittedContext.operationContext.collaboration?.commitGrouping !== 'pendingRemote') {
    return null;
  }

  try {
    const { identityKey } = await appliedSyncUpdateIdentityKeyMaterialForOperationContext(
      admittedContext.operationContext,
    );
    return {
      store,
      identityKey,
      operationContext:
        admittedContext.operationContext as AppliedSyncUpdateIdentityOperationContext,
      payloadHash: admittedContext.payloadHash,
    };
  } catch {
    return null;
  }
}

async function readAppliedSyncUpdateIdentityDuplicate(
  reservation: AppliedSyncUpdateIdentityReservation,
): Promise<AppliedSyncUpdateIdentityDuplicateDecision> {
  const read = await reservation.store.readByIdentityKey(reservation.identityKey);
  if (read.status === 'failed') return { status: 'failed' };
  if (read.status === 'missing') return { status: 'missing' };
  if (read.record.payloadHash !== reservation.payloadHash) return { status: 'conflict' };
  if (read.record.state === 'applied') return { status: 'duplicate' };
  if (read.record.state === 'failedAfterMutation') return { status: 'failedAfterMutation' };
  if (read.record.state === 'rejected' || read.record.state === 'gapWaiting') {
    return { status: 'terminalRejected' };
  }
  return { status: 'notDuplicate' };
}

async function reserveAppliedSyncUpdateIdentity(
  reservation: AppliedSyncUpdateIdentityReservation,
): Promise<AppliedSyncUpdateIdentityReserveDecision> {
  const reserved = await reservation.store.reserveIdentity({
    identityKey: reservation.identityKey,
    operationContext: reservation.operationContext,
    createdAt: new Date().toISOString(),
  });

  switch (reserved.status) {
    case 'reserved':
      return { status: 'reserved' };
    case 'existing':
      switch (reserved.record.state) {
        case 'failedAfterMutation':
          return { status: 'failedAfterMutation' };
        case 'rejected':
        case 'gapWaiting':
          return { status: 'terminalRejected' };
        case 'reserved':
        case 'retryable':
          return { status: 'reserved' };
        case 'applied':
          return { status: 'duplicate' };
      }
      return { status: 'failed' };
    case 'duplicate':
      return { status: 'duplicate' };
    case 'conflict':
      return { status: 'conflict' };
    case 'failed':
      return { status: 'failed' };
  }
}

export async function completeAppliedSyncUpdateIdentity(
  reservation: AppliedSyncUpdateIdentityReservation,
  terminalMetadata: AppliedSyncUpdateIdentityAppliedTerminalMetadata = {},
): Promise<void> {
  await completeAppliedSyncUpdateIdentityTerminal(reservation, {
    status: 'applied',
    ...(terminalMetadata.pendingRemoteSegmentId
      ? { pendingRemoteSegmentId: terminalMetadata.pendingRemoteSegmentId }
      : {}),
    ...(terminalMetadata.mutationSegmentDigest
      ? { mutationSegmentDigest: terminalMetadata.mutationSegmentDigest }
      : {}),
  });
}

export async function completeAppliedSyncUpdateIdentityFailedAfterMutation(
  reservation: AppliedSyncUpdateIdentityReservation,
): Promise<void> {
  await completeAppliedSyncUpdateIdentityTerminal(reservation, {
    status: 'failedAfterMutation',
    reason: 'sync-apply-failed-after-identity-reservation',
  });
}

async function completeAppliedSyncUpdateIdentityTerminal(
  reservation: AppliedSyncUpdateIdentityReservation,
  terminal: AppliedSyncUpdateIdentityTerminal,
): Promise<void> {
  const completed = await reservation.store.completeIdentity({
    identityKey: reservation.identityKey,
    payloadHash: reservation.payloadHash,
    completedAt: new Date().toISOString(),
    terminal,
  });

  if (completed.status !== 'completed') {
    throw new Error(
      `RustDocument.applyProviderUpdate: applied sync update identity completion failed (${completed.status})${formatDiagnostics(
        completed.diagnostics,
      )}`,
    );
  }
}

function formatDiagnostics(
  diagnostics: readonly AppliedSyncUpdateIdentityStoreDiagnostic[],
): string {
  if (diagnostics.length === 0) return '';
  return `: ${diagnostics.map((diagnostic) => diagnostic.message).join('; ')}`;
}
