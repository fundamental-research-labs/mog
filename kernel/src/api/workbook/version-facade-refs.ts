import type {
  Paged,
  VersionBranchName,
  VersionBranchNameInput,
  VersionBranchRefReadResult,
  VersionBranchSummary,
  VersionCreateBranchOptions,
  VersionCreateBranchFromCurrentOptions,
  VersionDegradedHeadResult,
  VersionDeleteRefOptions,
  VersionFastForwardBranchOptions,
  VersionListBranchesOptions,
  VersionListRefsOptions,
  VersionMainRefName,
  VersionRef,
  VersionRefName,
  VersionRefReadResult,
  VersionRefSelector,
  VersionRecordRevision,
  VersionResult,
  VersionStoreDiagnostic,
  VersionSymbolicRefReadResult,
  VersionUpdateBranchOptions,
  WorkbookCommitRef,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { readActiveCheckoutHead } from './version/status/version-active-checkout-head';
import { readWorkbookVersionFacadeGate } from './version-facade-gate';
import { validateVersionOperationGate } from './version-operation-gate';
import {
  VERSION_HEAD_REF,
  VERSION_MAIN_REF,
  degradedRef,
  mapHeadResult,
  mapLegacyHeadResult,
  mapRefResult,
  providerErrorDiagnostic,
  serviceUnavailableDiagnostic,
} from './version-public-read-mappers';
import { publicDiagnostic as commitPublicDiagnostic } from './version/commit/version-commit-diagnostics';
import {
  createWorkbookVersionBranch,
  deleteWorkbookVersionBranch,
  deleteWorkbookVersionRef,
  fastForwardWorkbookVersionBranch,
  getWorkbookVersionRef,
  hasAttachedVersionRefLifecycleService,
  listWorkbookVersionRefs,
  readWorkbookVersionRef,
  updateWorkbookVersionBranch,
} from './version/refs/version-refs';
import {
  versionFailureFromStoreDiagnostics,
  versionResultFromRefList,
  versionResultFromRefMutation,
  versionResultFromRefRead,
} from './version-result';
import { getAttachedVersionReadService } from './version-service-attachments';

const VERSION_LIST_REFS_DEFAULT_PAGE_SIZE = 50;

export function readWorkbookVersionFacadeRef(
  ctx: DocumentContext,
  name: 'HEAD',
): Promise<VersionResult<VersionSymbolicRefReadResult>>;
export function readWorkbookVersionFacadeRef(
  ctx: DocumentContext,
  name: VersionMainRefName | VersionRefName | VersionBranchName,
): Promise<VersionResult<VersionBranchRefReadResult>>;
export function readWorkbookVersionFacadeRef(
  ctx: DocumentContext,
  name: VersionRefSelector | VersionBranchName,
): Promise<VersionResult<VersionRefReadResult>>;
export async function readWorkbookVersionFacadeRef(
  ctx: DocumentContext,
  name: VersionRefSelector | VersionBranchName,
): Promise<VersionResult<VersionRefReadResult>> {
  const gateDiagnostics = readWorkbookVersionFacadeGate(ctx, 'readRef', 'version:read');
  if (gateDiagnostics) return versionFailureFromStoreDiagnostics('readRef', gateDiagnostics);

  if (name === VERSION_HEAD_REF) {
    const activeCheckoutHead = await readActiveCheckoutSymbolicHead(ctx, 'readRef');
    if (activeCheckoutHead) return versionResultFromRefRead('readRef', activeCheckoutHead);
  }

  if (
    name !== VERSION_HEAD_REF &&
    (name !== VERSION_MAIN_REF || hasAttachedVersionRefLifecycleService(ctx))
  ) {
    return versionResultFromRefRead('readRef', await readWorkbookVersionRef(ctx, name));
  }

  const publicReadName = name as VersionRefSelector;
  const readService = getAttachedVersionReadService(ctx);
  if (!readService?.readRef) {
    return versionResultFromRefRead(
      'readRef',
      degradedRef(null, [serviceUnavailableDiagnostic('readRef', { refName: publicReadName })]),
    );
  }

  try {
    return versionResultFromRefRead(
      'readRef',
      mapRefResult(await readService.readRef(publicReadName), publicReadName),
    );
  } catch {
    return versionResultFromRefRead(
      'readRef',
      degradedRef(null, [providerErrorDiagnostic('readRef', { refName: publicReadName })]),
    );
  }
}

export function getWorkbookVersionFacadeRef(
  ctx: DocumentContext,
  name: 'HEAD',
): Promise<VersionResult<VersionSymbolicRefReadResult>>;
export function getWorkbookVersionFacadeRef(
  ctx: DocumentContext,
  name: VersionMainRefName | VersionRefName | VersionBranchName,
): Promise<VersionResult<VersionBranchRefReadResult>>;
export function getWorkbookVersionFacadeRef(
  ctx: DocumentContext,
  name: VersionRefSelector | VersionBranchName,
): Promise<VersionResult<VersionRefReadResult>>;
export async function getWorkbookVersionFacadeRef(
  ctx: DocumentContext,
  name: VersionRefSelector | VersionBranchName,
): Promise<VersionResult<VersionRefReadResult>> {
  const gateDiagnostics = readWorkbookVersionFacadeGate(ctx, 'getRef', 'version:read');
  if (gateDiagnostics) return versionFailureFromStoreDiagnostics('getRef', gateDiagnostics);
  if (name === VERSION_HEAD_REF) {
    const activeCheckoutHead = await readActiveCheckoutSymbolicHead(ctx, 'getRef');
    if (activeCheckoutHead) return versionResultFromRefRead('getRef', activeCheckoutHead);
  }
  return versionResultFromRefRead('getRef', await getWorkbookVersionRef(ctx, name));
}

export async function listWorkbookVersionFacadeRefs(
  ctx: DocumentContext,
  options: VersionListRefsOptions = {},
): Promise<VersionResult<Paged<VersionRef>>> {
  const gateDiagnostics = readWorkbookVersionFacadeGate(ctx, 'listRefs', 'version:read');
  if (gateDiagnostics) return versionFailureFromStoreDiagnostics('listRefs', gateDiagnostics);
  return versionResultFromRefList(
    await listWorkbookVersionRefs(ctx, options),
    VERSION_LIST_REFS_DEFAULT_PAGE_SIZE,
  );
}

export async function listWorkbookVersionFacadeBranches(
  ctx: DocumentContext,
  options: VersionListBranchesOptions = {},
): Promise<VersionResult<Paged<VersionBranchSummary>>> {
  const gateDiagnostics = readWorkbookVersionFacadeGate(ctx, 'listBranches', 'version:read');
  if (gateDiagnostics) return versionFailureFromStoreDiagnostics('listBranches', gateDiagnostics);
  const result = await listWorkbookVersionRefs(ctx, options);
  if (result.status === 'degraded') {
    return versionFailureFromStoreDiagnostics('listBranches', result.diagnostics);
  }
  return {
    ok: true,
    value: {
      items: result.items.map(branchSummaryFromRef),
      limit: VERSION_LIST_REFS_DEFAULT_PAGE_SIZE,
    },
  };
}

export async function createWorkbookVersionFacadeBranch(
  ctx: DocumentContext,
  options: VersionCreateBranchOptions,
): Promise<VersionResult<VersionRef>> {
  return versionResultFromRefMutation(
    'createBranch',
    await createWorkbookVersionBranch(ctx, options),
  );
}

export async function createWorkbookVersionFacadeBranchFromCurrent(
  ctx: DocumentContext,
  name: VersionBranchNameInput,
  options: VersionCreateBranchFromCurrentOptions = {},
): Promise<VersionResult<VersionRef>> {
  const gateDiagnostics = readWorkbookVersionFacadeGate(ctx, 'createBranchFromCurrent', 'version:read');
  if (gateDiagnostics) {
    return versionFailureFromStoreDiagnostics('createBranchFromCurrent', gateDiagnostics);
  }
  const branchGateDiagnostics = validateVersionOperationGate(
    ctx,
    'createBranchFromCurrent',
    'version:branch',
    { mutates: true },
  );
  if (branchGateDiagnostics.length > 0) {
    return versionFailureFromStoreDiagnostics('createBranchFromCurrent', branchGateDiagnostics);
  }
  const head = await readCurrentBranchTarget(ctx);
  if (!head.ok) {
    return versionFailureFromStoreDiagnostics('createBranchFromCurrent', head.diagnostics);
  }
  return versionResultFromRefMutation(
    'createBranchFromCurrent',
    await createWorkbookVersionBranch(ctx, {
      name,
      targetCommitId: head.commitId,
      ...(options.baseCommitId ? { baseCommitId: options.baseCommitId as never } : {}),
      ...(options.expectedAbsent ? { expectedAbsent: true } : {}),
    }),
  );
}

export async function fastForwardWorkbookVersionFacadeBranch(
  ctx: DocumentContext,
  options: VersionFastForwardBranchOptions,
): Promise<VersionResult<VersionRef>> {
  return versionResultFromRefMutation(
    'fastForwardBranch',
    await fastForwardWorkbookVersionBranch(ctx, options),
  );
}

export async function updateWorkbookVersionFacadeBranch(
  ctx: DocumentContext,
  options: VersionUpdateBranchOptions,
): Promise<VersionResult<VersionRef>> {
  return versionResultFromRefMutation(
    'updateBranch',
    await updateWorkbookVersionBranch(ctx, options),
  );
}

export async function deleteWorkbookVersionFacadeBranch(
  ctx: DocumentContext,
  options: VersionDeleteRefOptions,
): Promise<VersionResult<VersionRef>> {
  return versionResultFromRefMutation(
    'deleteBranch',
    await deleteWorkbookVersionBranch(ctx, options),
  );
}

export async function deleteWorkbookVersionFacadeRef(
  ctx: DocumentContext,
  options: VersionDeleteRefOptions,
): Promise<VersionResult<VersionRef>> {
  return versionResultFromRefMutation('deleteRef', await deleteWorkbookVersionRef(ctx, options));
}

async function readActiveCheckoutSymbolicHead(
  ctx: DocumentContext,
  operation: 'getRef' | 'readRef',
): Promise<VersionSymbolicRefReadResult | null> {
  const active = await readActiveCheckoutHead(ctx);
  if (active.status === 'absent') return null;

  if (active.status === 'degraded') {
    return {
      status: 'degraded',
      ref: symbolicHeadRefFromActiveResult(active.result.ref),
      diagnostics: active.result.diagnostics,
    };
  }

  if (active.session.detached) {
    return {
      status: 'degraded',
      ref: null,
      diagnostics: [
        providerErrorDiagnostic(operation, {
          refName: VERSION_HEAD_REF,
          reason: 'detached-active-checkout',
        }),
      ],
    };
  }

  if (!active.head.refName || !active.head.refRevision) {
    return {
      status: 'degraded',
      ref: null,
      diagnostics: [
        providerErrorDiagnostic(operation, {
          refName: VERSION_HEAD_REF,
          reason: 'active-checkout-head-missing-ref',
        }),
      ],
    };
  }

  return {
    status: 'success',
    ref: {
      name: VERSION_HEAD_REF,
      target: active.head.refName,
      revision: active.head.refRevision,
    },
    diagnostics: [],
  };
}

function symbolicHeadRefFromActiveResult(value: unknown): VersionSymbolicRefReadResult['ref'] {
  if (!isRecord(value)) return null;
  const revision = value.revision;
  if (!isVersionRecordRevision(revision)) return null;

  if (value.name === VERSION_HEAD_REF && isPublicRefName(value.target)) {
    return { name: VERSION_HEAD_REF, target: value.target, revision };
  }
  if (isPublicRefName(value.name)) {
    return { name: VERSION_HEAD_REF, target: value.name, revision };
  }
  return null;
}

function isPublicRefName(value: unknown): value is VersionMainRefName | VersionRefName {
  return typeof value === 'string' && value.startsWith('refs/heads/');
}

function isVersionRecordRevision(value: unknown): value is VersionRecordRevision {
  return isRecord(value) && typeof value.kind === 'string' && typeof value.value === 'string';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function branchSummaryFromRef(ref: VersionRef): VersionBranchSummary {
  return {
    name: branchNameFromRefName(ref.name),
    refName: ref.name,
    commitId: ref.commitId,
    revision: ref.revision,
    ...(ref.updatedAt ? { updatedAt: ref.updatedAt } : {}),
  };
}

function branchNameFromRefName(refName: VersionMainRefName | VersionRefName): VersionBranchName {
  return (refName === VERSION_MAIN_REF ? 'main' : refName.slice('refs/heads/'.length)) as VersionBranchName;
}

async function readCurrentBranchTarget(
  ctx: DocumentContext,
): Promise<
  | { readonly ok: true; readonly commitId: VersionRef['commitId'] }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  const activeCheckoutHead = await readActiveCheckoutHead(ctx);
  if (activeCheckoutHead.status === 'resolved') {
    return { ok: true, commitId: activeCheckoutHead.head.id };
  }
  if (activeCheckoutHead.status === 'degraded') {
    return { ok: false, diagnostics: activeCheckoutHead.result.diagnostics };
  }

  const readService = getAttachedVersionReadService(ctx);
  if (!readService) {
    return {
      ok: false,
      diagnostics: [currentHeadUnavailableDiagnostic('readServiceUnavailable')],
    };
  }

  try {
    const head = readService.readHead
      ? mapHeadResult(await readService.readHead())
      : readService.getHead
        ? mapLegacyHeadResult(await readService.getHead())
        : null;
    if (!head) {
      return { ok: false, diagnostics: [currentHeadUnavailableDiagnostic('readHeadUnavailable')] };
    }
    if (isDegradedHead(head)) {
      return { ok: false, diagnostics: head.diagnostics };
    }
    return { ok: true, commitId: head.id };
  } catch {
    return { ok: false, diagnostics: [currentHeadUnavailableDiagnostic('providerError')] };
  }
}

function isDegradedHead(
  value: WorkbookCommitRef | VersionDegradedHeadResult,
): value is VersionDegradedHeadResult {
  return 'status' in value && value.status === 'degraded';
}

function currentHeadUnavailableDiagnostic(reason: string) {
  return commitPublicDiagnostic(
    'VERSION_GRAPH_UNINITIALIZED',
    'No current version head is available for createBranchFromCurrent.',
    {
      severity: 'error',
      recoverability: 'unsupported',
      payload: { operation: 'createBranchFromCurrent', reason },
      mutationGuarantee: 'no-write-attempted',
    },
  );
}
