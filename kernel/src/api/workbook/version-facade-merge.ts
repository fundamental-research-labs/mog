import type {
  VersionApplyMergeInput,
  VersionApplyMergeOptions,
  VersionApplyMergeResult,
  VersionCommitExpectedHead,
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
import { type VersionCheckoutTransactionGuard } from './version-checkout';
import { mergeWorkbookVersion } from './version-merge';
import {
  type ActiveCheckoutWriteRefName,
  detachedImplicitCheckoutWriteDiagnostic,
  expectedHeadFromActiveCheckout,
  readActiveCheckoutWriteContext,
  recordActiveCheckoutBranchCommit,
  recordActiveCheckoutBranchRefMove,
} from './version/active-checkout-write-context';
import {
  applyMergeResultCommitRef,
  isMergeCommitApplyInput,
  materializeAppliedMergeTargetRef,
  prepareActiveCheckoutMergeMaterialization,
  shouldClearPersistedActiveCheckoutMaterializationAfterApplyMerge,
  shouldMaterializeActiveCheckoutAfterApplyMerge,
} from './version/apply-merge/version-apply-merge-active-checkout-materialization';
import {
  clearPersistedActiveCheckoutMaterialization,
  writePersistedActiveCheckoutMaterialization,
} from './version/active-checkout/version-active-checkout-persistence';
import { invalidApplyMergeOptionDiagnostic } from './version/apply-merge/version-apply-merge-results';
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
  transactionGuard?: VersionCheckoutTransactionGuard,
): Promise<VersionResult<VersionApplyMergeResult>> {
  const applyMergeInput = await applyMergeInputForActiveCheckout(ctx, input, options);
  if (!applyMergeInput.ok) {
    return versionFailureFromStoreDiagnostics('applyMerge', applyMergeInput.diagnostics);
  }
  const materialization = await prepareActiveCheckoutMergeMaterialization(
    ctx,
    applyMergeInput.input,
    applyMergeInput.options,
    transactionGuard,
  );
  if (!materialization.ok) {
    return versionFailureFromStoreDiagnostics('applyMerge', materialization.diagnostics);
  }

  const result = await applyMergeWorkbookVersion(
    ctx,
    applyMergeInput.input,
    applyMergeInput.options,
  );
  let materializedActiveCheckout = false;
  const commitRef = applyMergeResultCommitRef(result);
  if (
    materialization.enabled &&
    shouldClearPersistedActiveCheckoutMaterializationAfterApplyMerge(result)
  ) {
    await clearPersistedActiveCheckoutMaterialization(ctx);
  }
  if (
    materialization.enabled &&
    commitRef?.id &&
    shouldMaterializeActiveCheckoutAfterApplyMerge(result)
  ) {
    const materialized = await materializeAppliedMergeTargetRef(
      ctx,
      materialization.targetRef,
      commitRef.id,
      transactionGuard,
    );
    if (!materialized.ok) {
      await clearPersistedActiveCheckoutMaterialization(ctx);
      if (commitRef.refName && isMergeCommitApplyInput(applyMergeInput.input)) {
        recordActiveCheckoutBranchRefMove(
          ctx,
          commitRef.refName,
          applyMergeInput.input.ours,
          commitRef.id,
        );
      }
      return versionFailureFromStoreDiagnostics('applyMerge', materialized.diagnostics);
    }
    materializedActiveCheckout = true;
    await writePersistedActiveCheckoutMaterialization(ctx, {
      checkedOutCommitId: commitRef.id,
      branchName: branchNameFromRefName(materialization.targetRef),
      refHeadAtMaterialization: commitRef.id,
      detached: false,
    });
  }
  const publicResult = versionResultFromApplyMerge(result);
  if (
    publicResult.ok &&
    !materializedActiveCheckout &&
    commitRef?.refName &&
    isMergeCommitApplyInput(applyMergeInput.input)
  ) {
    recordActiveCheckoutBranchRefMove(
      ctx,
      commitRef.refName,
      applyMergeInput.input.ours,
      commitRef.id,
    );
  }
  return publicResult;
}

function branchNameFromRefName(refName: string): string {
  return refName.startsWith('refs/heads/') ? refName.slice('refs/heads/'.length) : refName;
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
  if (hasExplicitTargetRef(options)) {
    return { ok: true, input, options };
  }

  const activeCheckout = await readActiveCheckoutWriteContext(ctx, 'applyMergeGraphWrite');
  if (activeCheckout.status === 'blocked' || activeCheckout.status === 'stale') {
    return { ok: false, diagnostics: activeCheckout.diagnostics };
  }
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
  if (hasExplicitTargetRef(input)) return { ok: true, input };

  const activeCheckout = await readActiveCheckoutWriteContext(ctx, 'revertGraphWrite');
  if (activeCheckout.status === 'blocked' || activeCheckout.status === 'stale') {
    return { ok: false, diagnostics: activeCheckout.diagnostics };
  }
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
