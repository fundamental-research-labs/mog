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
  VersionMainRefName,
  VersionRefName,
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
import { publicDiagnostic } from './version/commit/version-commit-diagnostics';
import { diffWorkbookVersion } from './version/diff/version-diff';
import { readActiveCheckoutHead } from './version/status/version-active-checkout-head';
import { readWorkbookVersionFacadeGate } from './version-facade-gate';
import { listWorkbookVersionCommits } from './version/list-commits/version-list-commits';
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
import { getWorkbookVersionStatus } from './version/status/version-status';
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
  const commitOptions = await commitOptionsForActiveCheckout(ctx, options);
  if (!commitOptions.ok) {
    return versionFailureFromStoreDiagnostics('commit', commitOptions.diagnostics);
  }
  const result = await commitWorkbookVersion(ctx, commitOptions.options);
  if (result.ok && commitOptions.activeCheckoutRefName) {
    recordActiveCheckoutBranchCommit(ctx, commitOptions.activeCheckoutRefName, result.value.id);
  }
  return result;
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

async function commitOptionsForActiveCheckout(
  ctx: DocumentContext,
  options: VersionCommitOptions,
): Promise<
  | {
      readonly ok: true;
      readonly options: VersionCommitOptions;
      readonly activeCheckoutRefName?: VersionMainRefName | VersionRefName;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  if (hasExplicitTargetRef(options)) return { ok: true, options };

  const surface = await getWorkbookVersionFacadeSurfaceStatus(
    ctx,
    getWorkbookVersionFacadeStatus(ctx),
  );
  const current = surface.current;
  if (!current.checkedOutCommitId) return { ok: true, options };
  if (current.stale) {
    return {
      ok: false,
      diagnostics: [staleImplicitCheckoutCommitDiagnostic()],
    };
  }
  if (!current.branchName || current.detached) return { ok: true, options };

  const targetRef = refNameFromBranchName(current.branchName);
  return {
    ok: true,
    activeCheckoutRefName: targetRef,
    options: {
      ...options,
      targetRef,
    },
  };
}

function hasExplicitTargetRef(options: VersionCommitOptions): boolean {
  return Object.prototype.hasOwnProperty.call(options, 'targetRef');
}

function refNameFromBranchName(branchName: string): VersionMainRefName | VersionRefName {
  return branchName === 'main' ? 'refs/heads/main' : (`refs/heads/${branchName}` as VersionRefName);
}

function staleImplicitCheckoutCommitDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_CHECKOUT_STALE_WORKSPACE_HEAD',
    'Version write is blocked because the active checkout session is stale relative to its branch head.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload: {
        operation: 'commitGraphWrite',
        reason: 'staleCheckoutSession',
      },
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

function recordActiveCheckoutBranchCommit(
  ctx: DocumentContext,
  refName: VersionMainRefName | VersionRefName,
  commitId: string,
): void {
  const recorder = readSurfaceStatusRecorder(ctx);
  recorder?.recordActiveCheckoutBranchCommit?.({ commitId, refName });
}

function readSurfaceStatusRecorder(ctx: DocumentContext): {
  readonly recordActiveCheckoutBranchCommit?: (input: {
    readonly commitId: string;
    readonly refName: string;
  }) => void;
} | null {
  const runtime = ctx as {
    readonly versioning?: unknown;
    readonly versionStore?: unknown;
    readonly version?: unknown;
  };
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return null;
  for (const candidate of [
    services.surfaceStatusService,
    services.versionSurfaceStatusService,
    services.statusService,
    services.dirtyStatusService,
    services,
  ]) {
    if (!isRecord(candidate)) continue;
    const method = candidate.recordActiveCheckoutBranchCommit;
    if (typeof method !== 'function') continue;
    return {
      recordActiveCheckoutBranchCommit: (input) => {
        Reflect.apply(method, candidate, [input]);
      },
    };
  }
  return null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
