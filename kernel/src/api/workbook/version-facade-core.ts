import type {
  CheckoutVersionResult,
  Paged,
  VersionBranchNameInput,
  VersionCheckoutOptions,
  VersionCheckoutTarget,
  VersionCommitish,
  VersionCommitCurrentOptions,
  VersionCommitOptions,
  VersionCurrentCheckout,
  VersionDiffBranchOptions,
  VersionDiffBranchOverviewOptions,
  VersionDiffGroupDetailOptions,
  VersionDiffOptions,
  VersionDiffOverview,
  VersionDiffOverviewOptions,
  VersionDiffPorcelainTarget,
  VersionGetHeadOptions,
  VersionHead,
  VersionListCommitsOptions,
  VersionMainRefName,
  VersionRefName,
  VersionRefNameInput,
  VersionRefSelector,
  VersionResult,
  VersionSemanticDiffPage,
  VersionStoreDiagnostic,
  VersionWorkingTreeDiffOptions,
  VersionWorkingTreeDiffPage,
  WorkbookCommitSummary,
  WorkbookCommitIdInput,
  WorkbookVersionStatus,
} from '@mog-sdk/contracts/api';
import { VERSION_DIFF_DEFAULT_PAGE_LIMIT } from '@mog-sdk/contracts/versioning';

import type { DocumentContext } from '../../context';
import { checkoutWorkbookVersion, type VersionCheckoutTransactionGuard } from './version-checkout';
import { publicDiagnostic as commitPublicDiagnostic } from './version/commit/version-commit-diagnostics';
import {
  type ActiveCheckoutWriteRefName,
  detachedImplicitCheckoutWriteDiagnostic,
  expectedHeadFromActiveCheckout,
  readActiveCheckoutWriteContext,
  recordActiveCheckoutBranchCommit,
} from './version/active-checkout-write-context';
import { commitWorkbookVersion } from './version/commit/version-commit';
import {
  providerErrorDiagnostic as diffProviderErrorDiagnostic,
  semanticDiffUnavailableDiagnostic,
} from './version/diff/version-diff-diagnostics';
import {
  diffWorkbookVersion,
  diffWorkbookVersionGroupDetail,
  diffWorkbookVersionOverview,
} from './version/diff/version-diff';
import { providerErrorDiagnostic as listCommitsProviderErrorDiagnostic } from './version/list-commits/version-list-commits-diagnostics';
import { readActiveCheckoutHead } from './version/status/version-active-checkout-head';
import { readWorkbookVersionFacadeGate } from './version-facade-gate';
import { listWorkbookVersionCommits } from './version/list-commits/version-list-commits';
import {
  VERSION_HEAD_REF,
  VERSION_MAIN_REF,
  degradedHead,
  mapHeadResult,
  mapLegacyHeadResult,
  providerErrorDiagnostic,
  serviceUnavailableDiagnostic,
} from './version-public-read-mappers';
import {
  versionFailureFromStoreDiagnostics,
  versionResultFromCheckout,
  versionResultFromDiffOverview,
  versionResultFromDiffPage,
  versionResultFromWorkingTreeDiffPage,
  versionResultFromHead,
} from './version-result';
import {
  getAttachedVersionReadService,
  getAttachedVersionServices,
} from './version-service-attachments';
import { getWorkbookVersionStatus } from './version/status/version-status';
import { getWorkbookVersionSurfaceStatus } from './version/surface-status/version-surface-status';
import type { WorkbookVersionWorkingTreeDiffPage } from '../../document/version-store/working-tree-diff-service';

export function getWorkbookVersionFacadeStatus(ctx: DocumentContext): WorkbookVersionStatus {
  return getWorkbookVersionStatus(ctx);
}

export function getWorkbookVersionFacadeSurfaceStatus(
  ctx: DocumentContext,
  status: WorkbookVersionStatus,
) {
  return getWorkbookVersionSurfaceStatus(ctx, status);
}

export async function getWorkbookVersionFacadeCurrent(
  ctx: DocumentContext,
): Promise<VersionResult<VersionCurrentCheckout>> {
  const gateDiagnostics = readWorkbookVersionFacadeGate(ctx, 'getCurrent', 'version:read');
  if (gateDiagnostics) return versionFailureFromStoreDiagnostics('getCurrent', gateDiagnostics);
  const surface = await getWorkbookVersionSurfaceStatus(ctx, getWorkbookVersionStatus(ctx));
  return { ok: true, value: currentCheckoutFromSurface(surface) };
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
  operation: 'commit' | 'commitCurrent' = 'commit',
): Promise<VersionResult<WorkbookCommitSummary>> {
  const commitOptions = await commitOptionsForActiveCheckout(ctx, options);
  if (!commitOptions.ok) {
    return versionFailureFromStoreDiagnostics(operation, commitOptions.diagnostics);
  }
  const result = await commitWorkbookVersion(ctx, commitOptions.options);
  if (result.ok && commitOptions.activeCheckoutRefName) {
    recordActiveCheckoutBranchCommit(ctx, commitOptions.activeCheckoutRefName, result.value.id);
  }
  return result;
}

export async function commitCurrentWorkbookVersionFacade(
  ctx: DocumentContext,
  options: VersionCommitCurrentOptions = {},
): Promise<VersionResult<WorkbookCommitSummary>> {
  const invalidAdvancedKeys = advancedCommitKeys(options);
  if (invalidAdvancedKeys.length > 0) {
    return versionFailureFromStoreDiagnostics(
      'commitCurrent',
      invalidAdvancedKeys.map((option) =>
        porcelainInvalidOptionDiagnostic('commitCurrent', option),
      ),
    );
  }
  return commitWorkbookVersionFacade(ctx, options, 'commitCurrent');
}

export async function checkoutWorkbookVersionFacade(
  ctx: DocumentContext,
  target: VersionCheckoutTarget,
  options: VersionCheckoutOptions = {},
  checkoutTransactionGuard?: VersionCheckoutTransactionGuard,
  operation: 'checkout' | 'checkoutBranch' | 'checkoutCommit' = 'checkout',
): Promise<VersionResult<CheckoutVersionResult>> {
  return versionResultFromCheckout(
    await checkoutWorkbookVersion(ctx, target, options, checkoutTransactionGuard),
    operation,
  );
}

export async function checkoutBranchWorkbookVersionFacade(
  ctx: DocumentContext,
  name: VersionBranchNameInput,
  options: VersionCheckoutOptions = {},
  checkoutTransactionGuard?: VersionCheckoutTransactionGuard,
): Promise<VersionResult<CheckoutVersionResult>> {
  return checkoutWorkbookVersionFacade(
    ctx,
    { kind: 'ref', name: branchRefName(name) },
    options,
    checkoutTransactionGuard,
    'checkoutBranch',
  );
}

export async function checkoutCommitWorkbookVersionFacade(
  ctx: DocumentContext,
  commit: WorkbookCommitIdInput,
  options: VersionCheckoutOptions = {},
  checkoutTransactionGuard?: VersionCheckoutTransactionGuard,
): Promise<VersionResult<CheckoutVersionResult>> {
  return checkoutWorkbookVersionFacade(
    ctx,
    { kind: 'commit', id: commit as never },
    options,
    checkoutTransactionGuard,
    'checkoutCommit',
  );
}

export async function diffWorkbookVersionFacade(
  ctx: DocumentContext,
  base: VersionCommitish,
  target: VersionCommitish,
  options: VersionDiffOptions = {},
  operation: 'diff' | 'diffCurrent' | 'diffBranch' = 'diff',
): Promise<VersionResult<VersionSemanticDiffPage>> {
  const gateDiagnostics = readWorkbookVersionFacadeGate(ctx, 'diff', 'version:diff');
  if (gateDiagnostics) return versionFailureFromStoreDiagnostics(operation, gateDiagnostics);
  const activeCheckoutSelectors = await diffCommitishForActiveCheckout(ctx, base, target);
  if (!activeCheckoutSelectors.ok) {
    return versionFailureFromStoreDiagnostics(operation, activeCheckoutSelectors.diagnostics);
  }
  return versionResultFromDiffPage(
    await diffWorkbookVersion(
      ctx,
      activeCheckoutSelectors.base,
      activeCheckoutSelectors.target,
      options,
    ),
    options.pageSize ?? VERSION_DIFF_DEFAULT_PAGE_LIMIT,
    operation,
  );
}

export async function diffOverviewWorkbookVersionFacade(
  ctx: DocumentContext,
  base: VersionCommitish,
  target: VersionCommitish,
  options: VersionDiffOverviewOptions = {},
  operation: 'diffOverview' | 'diffCurrentOverview' | 'diffBranchOverview' = 'diffOverview',
): Promise<VersionResult<VersionDiffOverview>> {
  const gateDiagnostics = readWorkbookVersionFacadeGate(ctx, 'diff', 'version:diff');
  if (gateDiagnostics) return versionFailureFromStoreDiagnostics(operation, gateDiagnostics);
  const activeCheckoutSelectors = await diffCommitishForActiveCheckout(ctx, base, target);
  if (!activeCheckoutSelectors.ok) {
    return versionFailureFromStoreDiagnostics(operation, activeCheckoutSelectors.diagnostics);
  }
  return versionResultFromDiffOverview(
    await diffWorkbookVersionOverview(
      ctx,
      activeCheckoutSelectors.base,
      activeCheckoutSelectors.target,
      options,
    ),
    operation,
  );
}

export async function diffGroupDetailWorkbookVersionFacade(
  ctx: DocumentContext,
  base: VersionCommitish,
  target: VersionCommitish,
  options: VersionDiffGroupDetailOptions,
): Promise<VersionResult<VersionSemanticDiffPage>> {
  const gateDiagnostics = readWorkbookVersionFacadeGate(ctx, 'diff', 'version:diff');
  if (gateDiagnostics)
    return versionFailureFromStoreDiagnostics('diffGroupDetail', gateDiagnostics);
  const activeCheckoutSelectors = await diffCommitishForActiveCheckout(ctx, base, target);
  if (!activeCheckoutSelectors.ok) {
    return versionFailureFromStoreDiagnostics(
      'diffGroupDetail',
      activeCheckoutSelectors.diagnostics,
    );
  }
  return versionResultFromDiffPage(
    await diffWorkbookVersionGroupDetail(
      ctx,
      activeCheckoutSelectors.base,
      activeCheckoutSelectors.target,
      options,
    ),
    options.pageSize ?? VERSION_DIFF_DEFAULT_PAGE_LIMIT,
    'diffGroupDetail',
  );
}

export async function diffCurrentWorkbookVersionFacade(
  ctx: DocumentContext,
  target: VersionDiffPorcelainTarget = 'main',
  options: VersionDiffOptions = {},
): Promise<VersionResult<VersionSemanticDiffPage>> {
  return diffWorkbookVersionFacade(
    ctx,
    commitishFromPorcelainTarget(target),
    { kind: 'ref', name: VERSION_HEAD_REF },
    options,
    'diffCurrent',
  );
}

export async function diffCurrentOverviewWorkbookVersionFacade(
  ctx: DocumentContext,
  target: VersionDiffPorcelainTarget = 'main',
  options: VersionDiffOverviewOptions = {},
): Promise<VersionResult<VersionDiffOverview>> {
  return diffOverviewWorkbookVersionFacade(
    ctx,
    commitishFromPorcelainTarget(target),
    { kind: 'ref', name: VERSION_HEAD_REF },
    options,
    'diffCurrentOverview',
  );
}

export async function diffBranchWorkbookVersionFacade(
  ctx: DocumentContext,
  branch: VersionBranchNameInput,
  options: VersionDiffBranchOptions = {},
): Promise<VersionResult<VersionSemanticDiffPage>> {
  const { against = 'main', ...diffOptions } = options;
  return diffWorkbookVersionFacade(
    ctx,
    commitishFromPorcelainTarget(against),
    { kind: 'ref', name: branchRefName(branch) },
    diffOptions,
    'diffBranch',
  );
}

export async function diffBranchOverviewWorkbookVersionFacade(
  ctx: DocumentContext,
  branch: VersionBranchNameInput,
  options: VersionDiffBranchOverviewOptions = {},
): Promise<VersionResult<VersionDiffOverview>> {
  const { against = 'main', ...diffOptions } = options;
  return diffOverviewWorkbookVersionFacade(
    ctx,
    commitishFromPorcelainTarget(against),
    { kind: 'ref', name: branchRefName(branch) },
    diffOptions,
    'diffBranchOverview',
  );
}

export async function diffWorkingTreeWorkbookVersionFacade(
  ctx: DocumentContext,
  options: VersionWorkingTreeDiffOptions = {},
): Promise<VersionResult<VersionWorkingTreeDiffPage>> {
  const gateDiagnostics = readWorkbookVersionFacadeGate(ctx, 'diffWorkingTree', 'version:diff');
  if (gateDiagnostics) {
    return versionFailureFromStoreDiagnostics('diffWorkingTree', gateDiagnostics);
  }

  const service = getAttachedVersionWorkingTreeDiffService(ctx);
  if (!service) {
    return versionFailureFromStoreDiagnostics('diffWorkingTree', [
      semanticDiffUnavailableDiagnostic(),
    ]);
  }

  try {
    return versionResultFromWorkingTreeDiffPage(
      await service.diffWorkingTree(options),
      options.pageSize ?? VERSION_DIFF_DEFAULT_PAGE_LIMIT,
    );
  } catch {
    return versionFailureFromStoreDiagnostics('diffWorkingTree', [diffProviderErrorDiagnostic()]);
  }
}

function currentCheckoutFromSurface(
  surface: Awaited<ReturnType<typeof getWorkbookVersionSurfaceStatus>>,
): VersionCurrentCheckout {
  const current = surface.current;
  const refName = refNameFromBranchName(current.branchName);
  const status: VersionCurrentCheckout['status'] = current.stale
    ? 'stale'
    : current.detached
      ? 'detached'
      : current.branchName
        ? 'attached'
        : 'absent';
  const blockedReasons = [
    ...surface.storage.diagnostics,
    ...surface.dirty.unsafeReasons,
    ...surface.dirty.diagnostics,
    ...surface.diagnostics,
  ];
  return {
    schemaVersion: 1,
    status,
    ...(current.branchName ? { branchName: current.branchName } : {}),
    ...(refName ? { refName } : {}),
    ...(current.headCommitId ? { commitId: current.headCommitId as never } : {}),
    ...(current.checkedOutCommitId
      ? { checkedOutCommitId: current.checkedOutCommitId as never }
      : {}),
    ...(current.refHeadAtMaterialization
      ? { refHeadAtMaterialization: current.refHeadAtMaterialization as never }
      : {}),
    ...(current.currentRefHeadId ? { currentRefHeadId: current.currentRefHeadId as never } : {}),
    detached: current.detached,
    stale: current.stale,
    ...(current.staleReason ? { staleReason: current.staleReason } : {}),
    dirty: surface.dirty,
    capabilities: surface.capabilities,
    safeActions: {
      canCommit:
        capabilityEnabled(surface, 'version:commit') &&
        !current.stale &&
        !current.detached &&
        surface.dirty.commitEligibleChanges,
      canCreateBranch:
        capabilityEnabled(surface, 'version:branch') && Boolean(current.headCommitId),
      canCheckout:
        capabilityEnabled(surface, 'version:checkout') &&
        surface.dirty.checkoutSafe &&
        !surface.dirty.pendingProviderWrites,
      canDiff: capabilityEnabled(surface, 'version:diff') && Boolean(current.headCommitId),
      canMerge:
        capabilityEnabled(surface, 'version:mergePreview') &&
        capabilityEnabled(surface, 'version:mergeApply'),
      blockedReasons,
    },
    diagnostics: blockedReasons,
  };
}

function capabilityEnabled(
  surface: Awaited<ReturnType<typeof getWorkbookVersionSurfaceStatus>>,
  capability: keyof Awaited<ReturnType<typeof getWorkbookVersionSurfaceStatus>>['capabilities'],
): boolean {
  return surface.capabilities[capability]?.enabled === true;
}

function branchRefName(value: VersionBranchNameInput): VersionMainRefName | VersionRefName {
  const text = String(value);
  if (text.startsWith('refs/heads/')) return text as VersionMainRefName | VersionRefName;
  return text === 'main' ? VERSION_MAIN_REF : (`refs/heads/${text}` as VersionRefName);
}

function refNameFromBranchName(
  branchName: string | undefined,
): VersionMainRefName | VersionRefName | undefined {
  return branchName ? branchRefName(branchName) : undefined;
}

function commitishFromPorcelainTarget(target: VersionDiffPorcelainTarget): VersionCommitish {
  if (target === 'current') return { kind: 'ref', name: VERSION_HEAD_REF };
  if (typeof target === 'string') {
    return isCommitIdString(target)
      ? (target as never)
      : { kind: 'ref', name: branchRefName(target) };
  }
  if (target.kind === 'commit') return { kind: 'commit', id: target.id as never };
  if (target.kind === 'branch') return { kind: 'ref', name: branchRefName(target.name) };
  return { kind: 'ref', name: refSelectorName(target.name) };
}

function refSelectorName(value: VersionRefNameInput): VersionRefSelector {
  const text = String(value);
  return text === VERSION_HEAD_REF ? VERSION_HEAD_REF : branchRefName(text);
}

function isCommitIdString(value: string): boolean {
  return /^commit:sha256:[0-9a-f]{64}$/.test(value);
}

function advancedCommitKeys(options: VersionCommitCurrentOptions): readonly string[] {
  if (!options || typeof options !== 'object') return [];
  return ['targetRef', 'expectedHead'].filter((key) => Object.hasOwn(options, key));
}

type AttachedWorkingTreeDiffService = {
  diffWorkingTree(
    options?: VersionWorkingTreeDiffOptions,
  ): Promise<WorkbookVersionWorkingTreeDiffPage>;
};

function getAttachedVersionWorkingTreeDiffService(
  ctx: DocumentContext,
): AttachedWorkingTreeDiffService | null {
  const services = getAttachedVersionServices(ctx);
  if (!services) return null;
  const serviceRecord = services as Readonly<Record<string, unknown>>;
  for (const candidate of [
    serviceRecord.workingTreeDiffService,
    serviceRecord.versionWorkingTreeDiffService,
    serviceRecord.diffService,
    serviceRecord.versionDiffService,
    services,
  ]) {
    const service = toWorkingTreeDiffService(candidate);
    if (service) return service;
  }
  return null;
}

function toWorkingTreeDiffService(value: unknown): AttachedWorkingTreeDiffService | null {
  const diffWorkingTree = bindMethod(value, 'diffWorkingTree');
  if (!diffWorkingTree) return null;
  return {
    diffWorkingTree: (options) =>
      diffWorkingTree(options) as Promise<WorkbookVersionWorkingTreeDiffPage>,
  };
}

function bindMethod(
  value: unknown,
  name: string,
): ((...args: readonly unknown[]) => unknown | Promise<unknown>) | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as unknown | Promise<unknown>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function porcelainInvalidOptionDiagnostic(
  operation: string,
  option: string,
): VersionStoreDiagnostic {
  return commitPublicDiagnostic(
    'VERSION_INVALID_OPTIONS',
    `workbook.version.${operation} does not accept advanced commit option "${option}".`,
    {
      severity: 'error',
      recoverability: 'none',
      payload: { operation, option },
      mutationGuarantee: 'no-write-attempted',
    },
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
