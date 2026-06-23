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
  VersionResult,
  VersionSymbolicRefReadResult,
  VersionUpdateBranchOptions,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
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
  listWorkbookVersionRefs,
  readWorkbookVersionRef,
  updateWorkbookVersionBranch,
} from './version-refs';
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

  if (name !== VERSION_HEAD_REF && name !== VERSION_MAIN_REF) {
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
  return versionResultFromRefMutation(
    'deleteRef',
    await deleteWorkbookVersionRef(ctx, options),
  );
}
