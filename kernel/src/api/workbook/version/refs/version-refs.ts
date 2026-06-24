import type {
  VersionBranchName,
  VersionBranchRefReadResult,
  VersionCreateBranchOptions,
  VersionDeleteRefOptions,
  VersionFastForwardBranchOptions,
  VersionListRefsOptions,
  VersionMainRefName,
  VersionRefListResult,
  VersionRefMutationResult,
  VersionRefName,
  VersionRefReadResult,
  VersionRefSelector,
  VersionSymbolicRefReadResult,
  VersionUpdateBranchOptions,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import { validateVersionOperationGate } from '../../version-operation-gate';
import { getAttachedVersionRefLifecycleService } from './version-refs-adapter';
import {
  VERSION_HEAD_REF,
  VERSION_MAIN_REF,
  VERSION_REF_OPERATION_AUTHOR,
} from './version-refs-constants';
import { preflightActiveCheckoutBranchAdvance } from './version-refs-active-session-preflight';
import { deleteWorkbookVersionBranchRef } from './version-refs-delete';
import {
  degradedList,
  degradedMutation,
  degradedRef,
  invalidPayloadDiagnostic,
  protectedMainDiagnostic,
  providerErrorDiagnostic,
  providerExceptionDiagnostics,
  serviceUnavailableDiagnostic,
  writeUnavailableDiagnostic,
} from './version-refs-public-diagnostics';
import {
  mapBranchListResult,
  mapBranchMutationResult,
  mapBranchReadResult,
  mapSymbolicHeadResult,
} from './version-refs-results';
import {
  parsePublicBranchName,
  validateCreateBranchOptions,
  validateFastForwardOptions,
  validateRefListPrefix,
} from './version-refs-validation';

export function hasAttachedVersionRefLifecycleService(ctx: DocumentContext): boolean {
  return Boolean(getAttachedVersionRefLifecycleService(ctx));
}

export async function createWorkbookVersionBranch(
  ctx: DocumentContext,
  options: VersionCreateBranchOptions,
): Promise<VersionRefMutationResult> {
  const validated = validateCreateBranchOptions(options);
  if (!validated.ok) return degradedMutation(null, validated.diagnostics);

  if (validated.branchName === 'main') {
    return degradedMutation(null, [protectedMainDiagnostic('createBranch')]);
  }

  const operationGateDiagnostics = validateVersionOperationGate(
    ctx,
    'createBranch',
    'version:branch',
    { mutates: true },
  );
  if (operationGateDiagnostics.length > 0) {
    return degradedMutation(null, operationGateDiagnostics);
  }

  const service = getAttachedVersionRefLifecycleService(ctx);
  if (!service?.createBranch) {
    return degradedMutation(null, [writeUnavailableDiagnostic('createBranch')]);
  }

  try {
    return mapBranchMutationResult(
      await service.createBranch({
        name: validated.branchName,
        targetCommitId: validated.targetCommitId,
        expectedAbsent: true,
        ...(validated.baseCommitId ? { baseCommitId: validated.baseCommitId } : {}),
        createdBy: VERSION_REF_OPERATION_AUTHOR,
      }),
      'createBranch',
    );
  } catch (error) {
    return degradedMutation(null, providerExceptionDiagnostics(error, 'createBranch'));
  }
}

export async function listWorkbookVersionRefs(
  ctx: DocumentContext,
  options: VersionListRefsOptions = {},
): Promise<VersionRefListResult> {
  const prefix = validateRefListPrefix(options.prefix);
  if (!prefix.ok) return degradedList([], prefix.diagnostics);

  const service = getAttachedVersionRefLifecycleService(ctx);
  if (!service?.listBranches) {
    return degradedList([], [serviceUnavailableDiagnostic('listRefs')]);
  }

  try {
    const result = await service.listBranches(
      prefix.prefix === undefined ? {} : { prefix: prefix.prefix },
    );
    return mapBranchListResult(result, prefix);
  } catch {
    return degradedList([], [providerErrorDiagnostic('listRefs')]);
  }
}

export async function getWorkbookVersionRef(
  ctx: DocumentContext,
  name: 'HEAD',
): Promise<VersionSymbolicRefReadResult>;
export async function getWorkbookVersionRef(
  ctx: DocumentContext,
  name: VersionMainRefName | VersionRefName | VersionBranchName,
): Promise<VersionBranchRefReadResult>;
export async function getWorkbookVersionRef(
  ctx: DocumentContext,
  name: VersionRefSelector | VersionBranchName,
): Promise<VersionRefReadResult>;
export async function getWorkbookVersionRef(
  ctx: DocumentContext,
  name: VersionRefSelector | VersionBranchName,
): Promise<VersionRefReadResult> {
  if (name === VERSION_HEAD_REF) {
    return getSymbolicHead(ctx);
  }

  const parsed = parsePublicBranchName(name, 'getRef');
  if (!parsed.ok) return degradedRef(null, parsed.diagnostics);

  const service = getAttachedVersionRefLifecycleService(ctx);
  if (!service?.readBranch) {
    return degradedRef(null, [serviceUnavailableDiagnostic('getRef')]);
  }

  try {
    return mapBranchReadResult(await service.readBranch({ name: parsed.branchName }), 'getRef');
  } catch {
    return degradedRef(null, [providerErrorDiagnostic('getRef')]);
  }
}

export async function readWorkbookVersionRef(
  ctx: DocumentContext,
  name: 'HEAD',
): Promise<VersionSymbolicRefReadResult>;
export async function readWorkbookVersionRef(
  ctx: DocumentContext,
  name: VersionMainRefName | VersionRefName | VersionBranchName,
): Promise<VersionBranchRefReadResult>;
export async function readWorkbookVersionRef(
  ctx: DocumentContext,
  name: VersionRefSelector | VersionBranchName,
): Promise<VersionRefReadResult>;
export async function readWorkbookVersionRef(
  ctx: DocumentContext,
  name: VersionRefSelector | VersionBranchName,
): Promise<VersionRefReadResult> {
  return getWorkbookVersionRef(ctx, name);
}

export async function fastForwardWorkbookVersionBranch(
  ctx: DocumentContext,
  options: VersionFastForwardBranchOptions,
): Promise<VersionRefMutationResult> {
  return advanceWorkbookVersionBranch(ctx, options, 'fastForwardBranch');
}

async function advanceWorkbookVersionBranch(
  ctx: DocumentContext,
  options: VersionFastForwardBranchOptions,
  operation: 'fastForwardBranch' | 'updateBranch',
): Promise<VersionRefMutationResult> {
  const validated = validateFastForwardOptions(options, operation);
  if (!validated.ok) return degradedMutation(null, validated.diagnostics);

  if (validated.branchName === 'main') {
    return degradedMutation(null, [protectedMainDiagnostic(operation)]);
  }

  const operationGateDiagnostics = validateVersionOperationGate(ctx, operation, 'version:branch', {
    mutates: true,
  });
  if (operationGateDiagnostics.length > 0) {
    return degradedMutation(null, operationGateDiagnostics);
  }

  const service = getAttachedVersionRefLifecycleService(ctx);
  if (!service?.fastForwardBranch) {
    return degradedMutation(null, [writeUnavailableDiagnostic(operation)]);
  }

  const activeCheckoutDiagnostics = await preflightActiveCheckoutBranchAdvance(
    ctx,
    service,
    {
      branchName: validated.branchName,
      refName: validated.refName,
      expectedHead: validated.expectedHead,
    },
    operation,
  );
  if (activeCheckoutDiagnostics.length > 0) {
    return degradedMutation(null, activeCheckoutDiagnostics);
  }

  try {
    return mapBranchMutationResult(
      await service.fastForwardBranch({
        name: validated.branchName,
        nextCommitId: validated.nextCommitId,
        expectedOldCommitId: validated.expectedHead,
        expectedRefVersion: validated.expectedRefVersion,
        updatedBy: VERSION_REF_OPERATION_AUTHOR,
      }),
      operation,
    );
  } catch (error) {
    return degradedMutation(null, providerExceptionDiagnostics(error, operation));
  }
}

export async function updateWorkbookVersionBranch(
  ctx: DocumentContext,
  options: VersionUpdateBranchOptions,
): Promise<VersionRefMutationResult> {
  return advanceWorkbookVersionBranch(ctx, options, 'updateBranch');
}

export async function deleteWorkbookVersionBranch(
  ctx: DocumentContext,
  options: VersionDeleteRefOptions,
): Promise<VersionRefMutationResult> {
  const operationGateDiagnostics = validateVersionOperationGate(
    ctx,
    'deleteBranch',
    'version:branch',
    { mutates: true },
  );
  if (operationGateDiagnostics.length > 0) {
    return degradedMutation(null, operationGateDiagnostics);
  }

  return deleteWorkbookVersionBranchRef({
    ctx,
    options,
    operation: 'deleteBranch',
    author: VERSION_REF_OPERATION_AUTHOR,
  });
}

export async function deleteWorkbookVersionRef(
  ctx: DocumentContext,
  options: VersionDeleteRefOptions,
): Promise<VersionRefMutationResult> {
  const operationGateDiagnostics = validateVersionOperationGate(
    ctx,
    'deleteRef',
    'version:branch',
    { mutates: true },
  );
  if (operationGateDiagnostics.length > 0) {
    return degradedMutation(null, operationGateDiagnostics);
  }

  return deleteWorkbookVersionBranchRef({
    ctx,
    options,
    operation: 'deleteRef',
    author: VERSION_REF_OPERATION_AUTHOR,
  });
}

async function getSymbolicHead(ctx: DocumentContext): Promise<VersionSymbolicRefReadResult> {
  const service = getAttachedVersionRefLifecycleService(ctx);
  if (!service?.getHead && !service?.readBranch) {
    return degradedRef(null, [
      serviceUnavailableDiagnostic('readRef'),
    ]) as VersionSymbolicRefReadResult;
  }
  if (service.getHead) {
    try {
      const result = await service.getHead();
      const mapped = mapSymbolicHeadResult(result);
      if (mapped) return mapped;
      return degradedRef(null, [
        invalidPayloadDiagnostic('readRef'),
      ]) as VersionSymbolicRefReadResult;
    } catch {
      return degradedRef(null, [
        providerErrorDiagnostic('readRef'),
      ]) as VersionSymbolicRefReadResult;
    }
  }
  try {
    const main = await service.readBranch?.({ name: 'main' });
    const ref = mapBranchReadResult(main, 'readRef');
    if (ref.status === 'success') {
      return {
        status: 'success',
        ref: { name: VERSION_HEAD_REF, target: VERSION_MAIN_REF, revision: ref.ref.revision },
        diagnostics: [],
      };
    }
    return degradedRef(null, ref.diagnostics) as VersionSymbolicRefReadResult;
  } catch {
    return degradedRef(null, [providerErrorDiagnostic('readRef')]) as VersionSymbolicRefReadResult;
  }
}
