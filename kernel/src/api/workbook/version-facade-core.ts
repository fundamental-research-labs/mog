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
import { checkoutWorkbookVersion, type VersionCheckoutTransactionGuard } from './version-checkout';
import {
  type ActiveCheckoutWriteRefName,
  detachedImplicitCheckoutWriteDiagnostic,
  expectedHeadFromActiveCheckout,
  readActiveCheckoutWriteContext,
  recordActiveCheckoutBranchCommit,
} from './version/active-checkout-write-context';
import { commitWorkbookVersion } from './version/commit/version-commit';
import { providerErrorDiagnostic as diffProviderErrorDiagnostic } from './version/diff/version-diff-diagnostics';
import { diffWorkbookVersion } from './version/diff/version-diff';
import { providerErrorDiagnostic as listCommitsProviderErrorDiagnostic } from './version/list-commits/version-list-commits-diagnostics';
import { readActiveCheckoutHead } from './version/status/version-active-checkout-head';
import { readWorkbookVersionFacadeGate } from './version-facade-gate';
import { listWorkbookVersionCommits } from './version/list-commits/version-list-commits';
import {
  VERSION_HEAD_REF,
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

export function getWorkbookVersionFacadeStatus(ctx: DocumentContext): WorkbookVersionStatus {
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
  options: VersionListCommitsOptions | null = {},
): Promise<VersionResult<Paged<WorkbookCommitSummary>>> {
  const gateDiagnostics = readWorkbookVersionFacadeGate(ctx, 'listCommits', 'version:read');
  if (gateDiagnostics) return versionFailureFromStoreDiagnostics('listCommits', gateDiagnostics);
  if (options === null) {
    return listWorkbookVersionCommits(ctx, options as unknown as VersionListCommitsOptions);
  }
  const activeCheckoutOptions = await listCommitsOptionsForActiveCheckout(ctx, options);
  if (!activeCheckoutOptions.ok) {
    return versionFailureFromStoreDiagnostics('listCommits', activeCheckoutOptions.diagnostics);
  }
  return listWorkbookVersionCommits(ctx, activeCheckoutOptions.options);
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
  const activeCheckoutSelectors = await diffCommitishForActiveCheckout(ctx, base, target);
  if (!activeCheckoutSelectors.ok) {
    return versionFailureFromStoreDiagnostics('diff', activeCheckoutSelectors.diagnostics);
  }
  return versionResultFromDiffPage(
    await diffWorkbookVersion(
      ctx,
      activeCheckoutSelectors.base,
      activeCheckoutSelectors.target,
      options,
    ),
    options.pageSize ?? VERSION_DIFF_DEFAULT_PAGE_LIMIT,
  );
}

async function listCommitsOptionsForActiveCheckout(
  ctx: DocumentContext,
  options: VersionListCommitsOptions,
): Promise<
  | { readonly ok: true; readonly options: VersionListCommitsOptions }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  if (options.pageToken !== undefined || options.from !== undefined) {
    return { ok: true, options };
  }
  if (options.ref !== undefined && options.ref !== VERSION_HEAD_REF) {
    return { ok: true, options };
  }

  const activeCheckout = await readActiveCheckoutHead(ctx);
  if (activeCheckout.status === 'absent') return { ok: true, options };
  if (activeCheckout.status === 'degraded') {
    return { ok: false, diagnostics: activeCheckout.result.diagnostics };
  }
  if (activeCheckout.session.detached) {
    const { ref: _ref, ...rest } = options;
    return {
      ok: true,
      options: {
        ...rest,
        from: activeCheckout.head.id,
      },
    };
  }
  if (!activeCheckout.head.refName) {
    return {
      ok: false,
      diagnostics: [listCommitsProviderErrorDiagnostic()],
    };
  }

  return {
    ok: true,
    options: {
      ...options,
      ref: activeCheckout.head.refName,
    },
  };
}

async function diffCommitishForActiveCheckout(
  ctx: DocumentContext,
  base: VersionCommitish,
  target: VersionCommitish,
): Promise<
  | {
      readonly ok: true;
      readonly base: VersionCommitish;
      readonly target: VersionCommitish;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  if (!isSymbolicHeadCommitish(base) && !isSymbolicHeadCommitish(target)) {
    return { ok: true, base, target };
  }

  const activeCheckout = await readActiveCheckoutHead(ctx);
  if (activeCheckout.status === 'absent') return { ok: true, base, target };
  if (activeCheckout.status === 'degraded') {
    return { ok: false, diagnostics: activeCheckout.result.diagnostics };
  }

  const resolved = activeCheckout.session.detached
    ? ({ kind: 'commit', id: activeCheckout.head.id } as const)
    : activeCheckout.head.refName
      ? ({ kind: 'ref', name: activeCheckout.head.refName } as const)
      : null;
  if (!resolved) {
    return {
      ok: false,
      diagnostics: [
        diffProviderErrorDiagnostic({
          reason: 'active-checkout-head-missing-ref',
        }),
      ],
    };
  }

  return {
    ok: true,
    base: isSymbolicHeadCommitish(base) ? resolved : base,
    target: isSymbolicHeadCommitish(target) ? resolved : target,
  };
}

function isSymbolicHeadCommitish(value: VersionCommitish): boolean {
  return (
    typeof value === 'object' &&
    value !== null &&
    'kind' in value &&
    value.kind === 'ref' &&
    value.name === VERSION_HEAD_REF
  );
}

async function commitOptionsForActiveCheckout(
  ctx: DocumentContext,
  options: VersionCommitOptions,
): Promise<
  | {
      readonly ok: true;
      readonly options: VersionCommitOptions;
      readonly activeCheckoutRefName?: ActiveCheckoutWriteRefName;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  const activeCheckout = await readActiveCheckoutWriteContext(ctx, 'commitGraphWrite');
  if (activeCheckout.status === 'blocked' || activeCheckout.status === 'stale') {
    return { ok: false, diagnostics: activeCheckout.diagnostics };
  }
  if (hasExplicitTargetRef(options)) return { ok: true, options };
  if (activeCheckout.status === 'detached') {
    return {
      ok: false,
      diagnostics: [detachedImplicitCheckoutWriteDiagnostic('commitGraphWrite')],
    };
  }
  if (activeCheckout.status !== 'attached') return { ok: true, options };

  const targetRef = activeCheckout.refName;
  return {
    ok: true,
    activeCheckoutRefName: targetRef,
    options: {
      ...options,
      targetRef,
      ...(options.expectedHead
        ? {}
        : { expectedHead: expectedHeadFromActiveCheckout(activeCheckout) }),
    },
  };
}

function hasExplicitTargetRef(options: VersionCommitOptions): boolean {
  return Object.prototype.hasOwnProperty.call(options, 'targetRef');
}
