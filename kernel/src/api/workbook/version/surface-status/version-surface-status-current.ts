import type { VersionDiagnostic, VersionSurfaceStatus } from '@mog-sdk/contracts/api';

import {
  bindMethod,
  isRecord,
  normalizeBranchName,
  publicRefNameFromBranchName,
  surfaceDiagnostic,
  toCommitId,
} from './version-surface-status-utils';
import type {
  AttachedVersionSurfaceStatusService,
  VersionSurfaceCheckoutSession,
} from './version-surface-status-service-types';

export function getAttachedVersionSurfaceStatusService(
  services: unknown,
): AttachedVersionSurfaceStatusService | null {
  if (!isRecord(services)) return null;
  for (const candidate of [
    services.surfaceStatusService,
    services.versionSurfaceStatusService,
    services.statusService,
    services.dirtyStatusService,
    services,
  ]) {
    const service = toSurfaceStatusService(candidate);
    if (service) return service;
  }
  return null;
}

export async function readVersionSurfaceCheckoutSession(
  service: AttachedVersionSurfaceStatusService | null,
  diagnostics: VersionDiagnostic[],
): Promise<VersionSurfaceCheckoutSession | null> {
  if (!service?.readActiveCheckoutSession) return null;
  try {
    const session = projectCheckoutSession(await service.readActiveCheckoutSession());
    if (session !== undefined) return session;
    diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.checkoutSessionInvalid',
        'warning',
        'The attached VC-05 checkout-session status service returned an invalid payload.',
      ),
    );
  } catch {
    diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.checkoutSessionReadFailed',
        'warning',
        'The attached VC-05 checkout-session status service failed.',
      ),
    );
  }
  return null;
}

export async function restoreVersionSurfaceCheckoutSession(
  service: AttachedVersionSurfaceStatusService | null,
  session: VersionSurfaceCheckoutSession,
): Promise<VersionSurfaceCheckoutSession | null> {
  if (!service?.restoreActiveCheckoutMaterialization) return null;
  try {
    const restored = projectCheckoutSession(
      await service.restoreActiveCheckoutMaterialization(session),
    );
    return restored ?? null;
  } catch {
    return null;
  }
}

export async function readCheckoutSessionCurrentStatus(input: {
  readonly session: VersionSurfaceCheckoutSession;
  readonly readRef?: (name: string) => Promise<unknown> | unknown;
  readonly diagnostics: VersionDiagnostic[];
}): Promise<VersionSurfaceStatus['current']> {
  const base = {
    headCommitId: input.session.checkedOutCommitId,
    checkedOutCommitId: input.session.checkedOutCommitId,
    ...(input.session.branchName ? { branchName: input.session.branchName } : {}),
    ...(input.session.refHeadAtMaterialization
      ? { refHeadAtMaterialization: input.session.refHeadAtMaterialization }
      : {}),
    detached: input.session.detached,
  };

  if (input.session.detached) {
    return {
      ...base,
      stale: false,
    };
  }

  if (!input.session.branchName || !input.session.refHeadAtMaterialization) {
    input.diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.checkoutSessionInvalid',
        'warning',
        'The active checkout session is missing attached-ref materialization metadata.',
      ),
    );
    return { ...base, stale: true, staleReason: 'unknown' };
  }

  if (!input.readRef) {
    input.diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.currentRefHeadUnavailable',
        'warning',
        'No version read service is attached to compare the active checkout session with its current ref head.',
      ),
    );
    return { ...base, stale: true, staleReason: 'unknown' };
  }

  const publicRefName = publicRefNameFromBranchName(input.session.branchName);
  let currentRefHeadId: string | undefined;
  try {
    currentRefHeadId = projectRefCommitId(await input.readRef(publicRefName));
  } catch {
    input.diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.currentReadFailed',
        'warning',
        'The version read service failed while resolving the active checkout ref head.',
      ),
    );
  }

  if (!currentRefHeadId) {
    input.diagnostics.push(
      surfaceDiagnostic(
        'version.surfaceStatus.currentReadFailed',
        'warning',
        'The version read service could not provide the active checkout ref head.',
      ),
    );
    return { ...base, stale: true, staleReason: 'unknown' };
  }

  const staleReason =
    currentRefHeadId !== input.session.refHeadAtMaterialization
      ? 'refMoved'
      : input.session.checkedOutCommitId !== input.session.refHeadAtMaterialization
        ? 'activeSessionBehind'
        : undefined;

  return {
    ...base,
    currentRefHeadId,
    stale: staleReason !== undefined,
    ...(staleReason ? { staleReason } : {}),
  };
}

function toSurfaceStatusService(value: unknown): AttachedVersionSurfaceStatusService | null {
  const readDirtyStatus =
    bindMethod(value, 'readDirtyStatus') ?? bindMethod(value, 'getDirtyStatus');
  const readActiveCheckoutSession =
    bindMethod(value, 'readActiveCheckoutSession') ?? bindMethod(value, 'getActiveCheckoutSession');
  const restoreActiveCheckoutMaterialization = bindMethod(
    value,
    'restoreActiveCheckoutMaterialization',
  );
  if (!readDirtyStatus && !readActiveCheckoutSession && !restoreActiveCheckoutMaterialization) {
    return null;
  }
  return {
    ...(readDirtyStatus ? { readDirtyStatus: () => readDirtyStatus() } : {}),
    ...(readActiveCheckoutSession
      ? { readActiveCheckoutSession: () => readActiveCheckoutSession() }
      : {}),
    ...(restoreActiveCheckoutMaterialization
      ? {
          restoreActiveCheckoutMaterialization: (session: VersionSurfaceCheckoutSession) =>
            restoreActiveCheckoutMaterialization(session),
        }
      : {}),
  };
}

function projectCheckoutSession(value: unknown): VersionSurfaceCheckoutSession | null | undefined {
  if (value === null || value === undefined) return null;
  if (!isRecord(value)) return undefined;
  const checkedOutCommitId = toCommitId(value.checkedOutCommitId);
  if (!checkedOutCommitId || typeof value.detached !== 'boolean') return undefined;
  if (value.detached) {
    return Object.freeze({ checkedOutCommitId, detached: true });
  }

  const branchName = normalizeBranchName(value.branchName ?? value.refName);
  const refHeadAtMaterialization = toCommitId(value.refHeadAtMaterialization);
  if (!branchName || !refHeadAtMaterialization) return undefined;
  return Object.freeze({
    checkedOutCommitId,
    branchName,
    refHeadAtMaterialization,
    detached: false,
  });
}

function projectRefCommitId(value: unknown): string | undefined {
  if (!isRecord(value)) return undefined;
  if (value.status === 'success' && isRecord(value.ref)) return projectRefCommitId(value.ref);
  if ('ref' in value && value.ref !== null) return projectRefCommitId(value.ref);
  return toCommitId(value.commitId) ?? toCommitId(value.targetCommitId) ?? undefined;
}
