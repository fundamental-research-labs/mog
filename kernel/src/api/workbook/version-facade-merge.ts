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
  WorkbookCommitRef,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { applyMergeWorkbookVersion } from './version-apply-merge';
import { mergeWorkbookVersion } from './version-merge';
import {
  type ActiveCheckoutWriteRefName,
  detachedImplicitCheckoutWriteDiagnostic,
  expectedHeadFromActiveCheckout,
  readActiveCheckoutWriteContext,
  recordActiveCheckoutBranchCommit,
} from './version/active-checkout-write-context';
import {
  invalidApplyMergeOptionDiagnostic,
} from './version/apply-merge/version-apply-merge-results';
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
  const applyMergeInput = await applyMergeInputForActiveCheckout(ctx, input, options);
  if (!applyMergeInput.ok) {
    return versionFailureFromStoreDiagnostics('applyMerge', applyMergeInput.diagnostics);
  }
  const result = await applyMergeWorkbookVersion(
    ctx,
    applyMergeInput.input,
    applyMergeInput.options,
  );
  const publicResult = versionResultFromApplyMerge(result);
  const commitRef = applyMergeResultCommitRef(result);
  if (
    publicResult.ok &&
    applyMergeInput.activeCheckoutRefName &&
    commitRef?.refName === applyMergeInput.activeCheckoutRefName
  ) {
    recordActiveCheckoutBranchCommit(
      ctx,
      applyMergeInput.activeCheckoutRefName,
      commitRef.id,
    );
  }
  return publicResult;
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
    revertInput.activeCheckoutRefName &&
    result.value.commitRef &&
    result.value.commitRef.refName === revertInput.activeCheckoutRefName
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

async function applyMergeInputForActiveCheckout(
  ctx: DocumentContext,
  input: VersionApplyMergeInput,
  options: VersionApplyMergeOptions,
): Promise<
  | {
      readonly ok: true;
      readonly input: VersionApplyMergeInput;
      readonly options: VersionApplyMergeOptions;
      readonly activeCheckoutRefName?: ActiveCheckoutWriteRefName;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  if (options.mode === 'preview') return { ok: true, input, options };

  const activeCheckout = await readActiveCheckoutWriteContext(ctx, 'applyMergeGraphWrite');
  if (activeCheckout.status === 'blocked' || activeCheckout.status === 'stale') {
    return { ok: false, diagnostics: activeCheckout.diagnostics };
  }
  if (hasExplicitTargetRef(options)) return { ok: true, input, options };
  if (activeCheckout.status === 'detached') {
    return {
      ok: false,
      diagnostics: [detachedImplicitCheckoutWriteDiagnostic('applyMergeGraphWrite')],
    };
  }
  if (activeCheckout.status !== 'attached') return { ok: true, input, options };

  if (!isMergeCommitApplyInput(input) || input.ours !== activeCheckout.commitId) {
    return {
      ok: false,
      diagnostics: [
        invalidApplyMergeOptionDiagnostic(
          'ours',
          'applyMerge ours must match the active checkout branch head when targetRef is omitted.',
        ),
      ],
    };
  }

  return {
    ok: true,
    input,
    options: {
      ...options,
      targetRef: activeCheckout.refName,
      ...(options.expectedTargetHead
        ? {}
        : { expectedTargetHead: expectedHeadFromActiveCheckout(activeCheckout) }),
    },
    activeCheckoutRefName: activeCheckout.refName,
  };
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
  const activeCheckout = await readActiveCheckoutWriteContext(ctx, 'revertGraphWrite');
  if (activeCheckout.status === 'blocked' || activeCheckout.status === 'stale') {
    return { ok: false, diagnostics: activeCheckout.diagnostics };
  }
  if (hasExplicitTargetRef(input)) return { ok: true, input };
  if (activeCheckout.status === 'detached') {
    return {
      ok: false,
      diagnostics: [detachedImplicitCheckoutWriteDiagnostic('revertGraphWrite')],
    };
  }
  if (activeCheckout.status !== 'attached') return { ok: true, input };

  return {
    ok: true,
    activeCheckoutRefName: activeCheckout.refName,
    input: {
      ...input,
      targetRef: activeCheckout.refName,
      ...(input.expectedTargetHead
        ? {}
        : { expectedTargetHead: expectedHeadFromActiveCheckout(activeCheckout) }),
    },
  };
}

function hasExplicitTargetRef(input: VersionRevertInput | VersionApplyMergeOptions): boolean {
  return Object.prototype.hasOwnProperty.call(input, 'targetRef');
}

function isMergeCommitApplyInput(
  input: VersionApplyMergeInput,
): input is Extract<VersionApplyMergeInput, { readonly base: unknown; readonly ours: unknown }> {
  return isRecord(input) && 'base' in input && 'ours' in input && 'theirs' in input;
}

function applyMergeResultCommitRef(result: VersionApplyMergeResult): WorkbookCommitRef | null {
  if (!('commitRef' in result)) return null;
  return result.commitRef;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
