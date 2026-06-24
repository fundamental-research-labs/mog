import type { VersionDiagnostic } from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import {
  checkoutAdmissionBlockForDirtyStatus,
  checkoutLeaseFromDirtyStatus,
  checkoutLeaseMatchesDirtyStatus,
  staleWorkspaceHeadBlock,
} from './version-checkout-admission-blocks';
import {
  getAttachedCheckoutAdmissionReadService,
  getAttachedVersionRuntimeServices,
} from './version-checkout-admission-services';
import { readSyncBatchStatusAdmissionBlock } from './version-checkout-admission-sync-batch';
import type {
  VersionCheckoutAdmissionBlock,
  VersionCheckoutAdmissionLease,
  VersionCheckoutAdmissionState,
} from './version-checkout-admission-types';
import {
  getAttachedVersionSurfaceStatusService,
  readCheckoutSessionCurrentStatus,
  readVersionSurfaceCheckoutSession,
  readVersionSurfaceDirtyStatus,
} from '../surface-status/version-surface-status-service';

export type {
  VersionCheckoutAdmissionBlock,
  VersionCheckoutAdmissionLease,
  VersionCheckoutAdmissionState,
} from './version-checkout-admission-types';

export async function readVersionCheckoutAdmissionState(
  ctx: DocumentContext,
): Promise<VersionCheckoutAdmissionState> {
  const services = getAttachedVersionRuntimeServices(ctx);
  const surfaceStatusService = getAttachedVersionSurfaceStatusService(services);
  if (!surfaceStatusService) return { block: null, lease: null };

  const surfaceDiagnostics: VersionDiagnostic[] = [];
  const dirtyStatus = await readVersionSurfaceDirtyStatus(surfaceStatusService, surfaceDiagnostics);
  const syncBatchBlock = await readSyncBatchStatusAdmissionBlock(services);
  const dirtyBlock = checkoutAdmissionBlockForDirtyStatus(dirtyStatus);
  if (syncBatchBlock) return { block: syncBatchBlock, lease: null };
  if (dirtyBlock) return { block: dirtyBlock, lease: null };

  const activeCheckoutSession = await readVersionSurfaceCheckoutSession(
    surfaceStatusService,
    surfaceDiagnostics,
  );
  if (!activeCheckoutSession)
    return { block: null, lease: checkoutLeaseFromDirtyStatus(dirtyStatus) };

  const readService = getAttachedCheckoutAdmissionReadService(services);
  const current = await readCheckoutSessionCurrentStatus({
    session: activeCheckoutSession,
    ...(readService?.readRef ? { readRef: readService.readRef } : {}),
    diagnostics: surfaceDiagnostics,
  });

  return current.stale
    ? { block: staleWorkspaceHeadBlock(current), lease: null }
    : { block: null, lease: checkoutLeaseFromDirtyStatus(dirtyStatus) };
}

export async function readVersionCheckoutAdmissionBlock(
  ctx: DocumentContext,
): Promise<VersionCheckoutAdmissionBlock | null> {
  return (await readVersionCheckoutAdmissionState(ctx)).block;
}

export async function revalidateVersionCheckoutAdmissionLease(
  ctx: DocumentContext,
  lease: VersionCheckoutAdmissionLease | null,
): Promise<VersionCheckoutAdmissionBlock | null> {
  if (!lease) return null;
  const services = getAttachedVersionRuntimeServices(ctx);
  const surfaceStatusService = getAttachedVersionSurfaceStatusService(services);
  if (!surfaceStatusService) return { reason: 'checkoutPreflightStale' };

  const diagnostics: VersionDiagnostic[] = [];
  const dirtyStatus = await readVersionSurfaceDirtyStatus(surfaceStatusService, diagnostics);
  const syncBatchBlock = await readSyncBatchStatusAdmissionBlock(services);
  const dirtyBlock = checkoutAdmissionBlockForDirtyStatus(dirtyStatus, {
    ignoreCheckoutInProgress: true,
  });
  if (syncBatchBlock) return syncBatchBlock;
  if (dirtyBlock) return dirtyBlock;
  return checkoutLeaseMatchesDirtyStatus(lease, dirtyStatus)
    ? null
    : { reason: 'checkoutPreflightStale' };
}
