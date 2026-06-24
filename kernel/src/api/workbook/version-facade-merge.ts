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
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { applyMergeWorkbookVersion } from './version-apply-merge';
import { mergeWorkbookVersion } from './version-merge';
import {
  getMergeConflictDetailWorkbookVersion,
  putMergeResolutionPayloadWorkbookVersion,
  saveMergeResolutionsWorkbookVersion,
} from './version/merge-review/version-merge-review-endpoints';
import { promotePendingRemoteWorkbookVersion } from './version/pending/remote';
import { revertWorkbookVersion } from './version/revert/version-revert';
import { versionResultFromApplyMerge, versionResultFromMerge } from './version-result';

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
  return revertWorkbookVersion(ctx, input, options);
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
