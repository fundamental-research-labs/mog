import type {
  CheckoutVersionResult,
  Paged,
  VersionCheckoutOptions,
  VersionCheckoutTarget,
  VersionCommitish,
  VersionCommitOptions,
  VersionDiffOptions,
  VersionGetHeadOptions,
  VersionHead,
  VersionListCommitsOptions,
  VersionResult,
  VersionSemanticDiffPage,
  VersionStoreDiagnostic,
  WorkbookCommitSummary,
  WorkbookVersionStatus,
} from '@mog-sdk/contracts/api';
import { VERSION_DIFF_DEFAULT_PAGE_LIMIT } from '@mog-sdk/contracts/versioning';

import type { DocumentContext } from '../../context';
import {
  checkoutWorkbookVersion,
  type VersionCheckoutTransactionGuard,
} from './version-checkout';
import { commitWorkbookVersion } from './version/commit/version-commit';
import { diffWorkbookVersion } from './version/diff/version-diff';
import { readActiveCheckoutHead } from './version-active-checkout-head';
import { readWorkbookVersionFacadeGate } from './version-facade-gate';
import { listWorkbookVersionCommits } from './version-list-commits';
import {
  degradedHead,
  mapHeadResult,
  mapLegacyHeadResult,
  providerErrorDiagnostic,
  serviceUnavailableDiagnostic,
} from './version-public-read-mappers';
import {
  versionFailureFromStoreDiagnostics,
  versionResultFromCheckout,
  versionResultFromDiffPage,
  versionResultFromHead,
} from './version-result';
import { getAttachedVersionReadService } from './version-service-attachments';
import { getWorkbookVersionStatus } from './version-status';
import { getWorkbookVersionSurfaceStatus } from './version/surface-status/version-surface-status';

export function getWorkbookVersionFacadeStatus(
  ctx: DocumentContext,
): WorkbookVersionStatus {
  return getWorkbookVersionStatus(ctx);
}

export function getWorkbookVersionFacadeSurfaceStatus(
  ctx: DocumentContext,
  status: WorkbookVersionStatus,
) {
  return getWorkbookVersionSurfaceStatus(ctx, status);
}

export async function getWorkbookVersionFacadeHead(
  ctx: DocumentContext,
  _options: VersionGetHeadOptions = {},
): Promise<VersionResult<VersionHead>> {
  const gateDiagnostics = readWorkbookVersionFacadeGate(ctx, 'getHead', 'version:read');
  if (gateDiagnostics) return versionFailureFromStoreDiagnostics('getHead', gateDiagnostics);

  const activeCheckoutHead = await readActiveCheckoutHead(ctx);
  if (activeCheckoutHead.status === 'resolved') {
    return versionResultFromHead(activeCheckoutHead.head);
  }
  if (activeCheckoutHead.status === 'degraded') {
    return versionResultFromHead(activeCheckoutHead.result);
  }

  const failHead = (diagnostics: readonly VersionStoreDiagnostic[]) =>
    versionResultFromHead(degradedHead(diagnostics));
  const readService = getAttachedVersionReadService(ctx);
  if (!readService) return failHead([serviceUnavailableDiagnostic('getHead')]);

  try {
    if (readService.readHead) {
      return versionResultFromHead(mapHeadResult(await readService.readHead()));
    }
    if (readService.getHead) {
      return versionResultFromHead(mapLegacyHeadResult(await readService.getHead()));
    }
  } catch {
    return failHead([providerErrorDiagnostic('getHead')]);
  }
  return failHead([serviceUnavailableDiagnostic('getHead')]);
}

export async function listWorkbookVersionFacadeCommits(
  ctx: DocumentContext,
  options: VersionListCommitsOptions = {},
): Promise<VersionResult<Paged<WorkbookCommitSummary>>> {
  const gateDiagnostics = readWorkbookVersionFacadeGate(ctx, 'listCommits', 'version:read');
  if (gateDiagnostics) return versionFailureFromStoreDiagnostics('listCommits', gateDiagnostics);
  return listWorkbookVersionCommits(ctx, options);
}

export async function commitWorkbookVersionFacade(
  ctx: DocumentContext,
  options: VersionCommitOptions = {},
): Promise<VersionResult<WorkbookCommitSummary>> {
  return commitWorkbookVersion(ctx, options);
}

export async function checkoutWorkbookVersionFacade(
  ctx: DocumentContext,
  target: VersionCheckoutTarget,
  options: VersionCheckoutOptions = {},
  checkoutTransactionGuard?: VersionCheckoutTransactionGuard,
): Promise<VersionResult<CheckoutVersionResult>> {
  return versionResultFromCheckout(
    await checkoutWorkbookVersion(ctx, target, options, checkoutTransactionGuard),
  );
}

export async function diffWorkbookVersionFacade(
  ctx: DocumentContext,
  base: VersionCommitish,
  target: VersionCommitish,
  options: VersionDiffOptions = {},
): Promise<VersionResult<VersionSemanticDiffPage>> {
  const gateDiagnostics = readWorkbookVersionFacadeGate(ctx, 'diff', 'version:diff');
  if (gateDiagnostics) return versionFailureFromStoreDiagnostics('diff', gateDiagnostics);
  return versionResultFromDiffPage(
    await diffWorkbookVersion(ctx, base, target, options),
    options.pageSize ?? VERSION_DIFF_DEFAULT_PAGE_LIMIT,
  );
}
