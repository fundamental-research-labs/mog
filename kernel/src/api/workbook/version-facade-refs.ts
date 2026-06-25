import type {
  Paged,
  VersionBranchName,
  VersionBranchRefReadResult,
  VersionCreateBranchOptions,
  VersionDeleteRefOptions,
  VersionFastForwardBranchOptions,
  VersionListRefsOptions,
  VersionMainRefName,
  VersionRef,
  VersionRefName,
  VersionRefReadResult,
  VersionRefSelector,
  VersionRecordRevision,
  VersionResult,
  VersionSymbolicRefReadResult,
  VersionUpdateBranchOptions,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { readActiveCheckoutHead } from './version/status/version-active-checkout-head';
import { readWorkbookVersionFacadeGate } from './version-facade-gate';
import {
  VERSION_HEAD_REF,
  VERSION_MAIN_REF,
  degradedRef,
  mapRefResult,
  providerErrorDiagnostic,
  serviceUnavailableDiagnostic,
} from './version-public-read-mappers';
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

export async function createWorkbookVersionFacadeBranch(
  ctx: DocumentContext,
  options: VersionCreateBranchOptions,
): Promise<VersionResult<VersionRef>> {
  return versionResultFromRefMutation(
    'createBranch',
    await createWorkbookVersionBranch(ctx, options),
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
