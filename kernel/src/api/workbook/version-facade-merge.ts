import type {
  VersionApplyMergeInput,
  VersionApplyMergeOptions,
  VersionApplyMergeResult,
  VersionGetMergeConflictDetailRequest,
  VersionMergeConflictDetailResult,
  VersionMergeInput,
  VersionMergeOptions,
  VersionMergeResult,
  VersionPromotePendingRemoteOptions,
  VersionPromotePendingRemoteResult,
  VersionPutMergeResolutionPayloadRequest,
  VersionPutMergeResolutionPayloadResult,
  VersionResult,
  VersionRevertInput,
  VersionRevertOptions,
  VersionRevertResult,
  VersionSaveMergeResolutionsRequest,
  VersionSaveMergeResolutionsResult,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { applyMergeWorkbookVersion } from './version-apply-merge';
import { mergeWorkbookVersion } from './version-merge';
import {
  type ActiveCheckoutWriteRefName,
  readActiveCheckoutWriteContext,
  recordActiveCheckoutBranchCommit,
} from './version/active-checkout-write-context';
import {
  getMergeConflictDetailWorkbookVersion,
  putMergeResolutionPayloadWorkbookVersion,
  saveMergeResolutionsWorkbookVersion,
} from './version/merge-review/version-merge-review-endpoints';
import { promotePendingRemoteWorkbookVersion } from './version/pending/remote';
import { revertWorkbookVersion } from './version/revert/version-revert';
import {
  versionFailureFromStoreDiagnostics,
  versionResultFromApplyMerge,
  versionResultFromMerge,
} from './version-result';

export async function mergeWorkbookVersionFacade(
  ctx: DocumentContext,
  input: VersionMergeInput,
  options: VersionMergeOptions = {},
): Promise<VersionResult<VersionMergeResult>> {
  return versionResultFromMerge(await mergeWorkbookVersion(ctx, input, options));
}

export async function applyMergeWorkbookVersionFacade(
  ctx: DocumentContext,
  input: VersionApplyMergeInput,
  options: VersionApplyMergeOptions = {},
): Promise<VersionResult<VersionApplyMergeResult>> {
  return versionResultFromApplyMerge(await applyMergeWorkbookVersion(ctx, input, options));
}

export async function revertWorkbookVersionFacade(
  ctx: DocumentContext,
  input: VersionRevertInput,
  options: VersionRevertOptions = {},
): Promise<VersionResult<VersionRevertResult>> {
  const revertInput = await revertInputForActiveCheckout(ctx, input);
  if (!revertInput.ok) {
    return versionFailureFromStoreDiagnostics('revert', revertInput.diagnostics);
  }
  const result = await revertWorkbookVersion(ctx, revertInput.input, options);
  if (
    result.ok &&
    result.value.status === 'applied' &&
    result.value.commitRef &&
    revertInput.activeCheckoutRefName
  ) {
    recordActiveCheckoutBranchCommit(
      ctx,
      revertInput.activeCheckoutRefName,
      result.value.commitRef.id,
    );
  }
  return result;
}

export async function promotePendingRemoteWorkbookVersionFacade(
  ctx: DocumentContext,
  options: VersionPromotePendingRemoteOptions = {},
): Promise<VersionResult<VersionPromotePendingRemoteResult>> {
  return promotePendingRemoteWorkbookVersion(ctx, options);
}

export async function saveMergeResolutionsWorkbookVersionFacade(
  ctx: DocumentContext,
  input: VersionSaveMergeResolutionsRequest,
): Promise<VersionResult<VersionSaveMergeResolutionsResult>> {
  return saveMergeResolutionsWorkbookVersion(ctx, input);
}

export async function getMergeConflictDetailWorkbookVersionFacade(
  ctx: DocumentContext,
  input: VersionGetMergeConflictDetailRequest,
): Promise<VersionResult<VersionMergeConflictDetailResult>> {
  return getMergeConflictDetailWorkbookVersion(ctx, input);
}

export async function putMergeResolutionPayloadWorkbookVersionFacade(
  ctx: DocumentContext,
  input: VersionPutMergeResolutionPayloadRequest,
): Promise<VersionResult<VersionPutMergeResolutionPayloadResult>> {
  return putMergeResolutionPayloadWorkbookVersion(ctx, input);
}

async function revertInputForActiveCheckout(
  ctx: DocumentContext,
  input: VersionRevertInput,
): Promise<
  | {
      readonly ok: true;
      readonly input: VersionRevertInput;
      readonly activeCheckoutRefName?: ActiveCheckoutWriteRefName;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  if (hasExplicitTargetRef(input)) return { ok: true, input };

  const activeCheckout = await readActiveCheckoutWriteContext(ctx, 'revertGraphWrite');
  if (activeCheckout.status === 'stale') {
    return { ok: false, diagnostics: activeCheckout.diagnostics };
  }
  if (activeCheckout.status !== 'attached') return { ok: true, input };

  return {
    ok: true,
    activeCheckoutRefName: activeCheckout.refName,
    input: {
      ...input,
      targetRef: activeCheckout.refName,
    },
  };
}

function hasExplicitTargetRef(input: VersionRevertInput): boolean {
  return Object.prototype.hasOwnProperty.call(input, 'targetRef');
}
