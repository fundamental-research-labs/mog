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
  VersionCheckoutResult,
  VersionResult,
  VersionRevertInput,
  VersionRevertOptions,
  VersionRevertResult,
  VersionSaveMergeResolutionsRequest,
  VersionSaveMergeResolutionsResult,
  VersionStoreDiagnostic,
  WorkbookCommitRef,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { applyMergeWorkbookVersion } from './version-apply-merge';
import {
  checkoutWriteFenceUnavailableDiagnostic,
  type VersionCheckoutTransactionGuard,
} from './version-checkout';
import { mergeWorkbookVersion } from './version-merge';
import {
  type ActiveCheckoutWriteContext,
  type ActiveCheckoutWriteRefName,
  detachedImplicitCheckoutWriteDiagnostic,
  expectedHeadFromActiveCheckout,
  readActiveCheckoutWriteContext,
  recordActiveCheckoutBranchCommit,
  recordActiveCheckoutBranchRefMove,
} from './version/active-checkout-write-context';
import {
  invalidApplyMergeOptionDiagnostic,
} from './version/apply-merge/version-apply-merge-results';
import {
  providerErrorDiagnostic as checkoutProviderErrorDiagnostic,
  serviceUnavailableDiagnostic as checkoutServiceUnavailableDiagnostic,
} from './version/checkout/version-checkout-diagnostic-factories';
import { mapCheckoutResult } from './version/checkout/version-checkout-result-mapping';
import { getAttachedCheckoutMaterializationService } from './version/checkout/version-checkout-service';
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
  if (materialization.enabled && commitRef?.id) {
    const materialized = await materializeAppliedMergeTargetRef(
      ctx,
      materialization.targetRef,
      transactionGuard,
    );
    if (!materialized.ok) {
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

function isMergeCommitApplyInput(
  input: VersionApplyMergeInput,
): input is VersionApplyMergeInput & {
  readonly base: WorkbookCommitId;
  readonly ours: WorkbookCommitId;
  readonly theirs: WorkbookCommitId;
} {
  if (!isRecord(input)) return false;
  const record = input as Readonly<Record<string, unknown>>;
  return (
    typeof record.base === 'string' &&
    typeof record.ours === 'string' &&
    typeof record.theirs === 'string'
  );
}

function applyMergeResultCommitRef(result: VersionApplyMergeResult): WorkbookCommitRef | null {
  if (!('commitRef' in result)) return null;
  return result.commitRef;
}

type ActiveCheckoutMergeMaterializationPreparation =
  | { readonly ok: true; readonly enabled: false }
  | { readonly ok: true; readonly enabled: true; readonly targetRef: ActiveCheckoutWriteRefName }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

type ActiveCheckoutMergeMaterializationResult =
  | { readonly ok: true; readonly diagnostics: readonly VersionStoreDiagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

async function prepareActiveCheckoutMergeMaterialization(
  ctx: DocumentContext,
  input: VersionApplyMergeInput,
  options: VersionApplyMergeOptions,
  transactionGuard: VersionCheckoutTransactionGuard | undefined,
): Promise<ActiveCheckoutMergeMaterializationPreparation> {
  if (!options.materializeActiveCheckout) return { ok: true, enabled: false };
  if (options.mode === 'preview') {
    return {
      ok: false,
      diagnostics: [
        invalidApplyMergeOptionDiagnostic(
          'materializeActiveCheckout',
          'materializeActiveCheckout is valid only in apply mode.',
        ),
      ],
    };
  }
  if (!options.targetRef || !options.expectedTargetHead) {
    return {
      ok: false,
      diagnostics: [
        invalidApplyMergeOptionDiagnostic(
          'materializeActiveCheckout',
          'materializeActiveCheckout requires targetRef and expectedTargetHead.',
        ),
      ],
    };
  }
  if (!transactionGuard) {
    return {
      ok: false,
      diagnostics: [
        checkoutWriteFenceUnavailableDiagnostic({
          operation: 'applyMerge.materializeActiveCheckout',
          reason: 'checkoutTransactionGuardUnavailable',
        }),
      ],
    };
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
  if (activeCheckout.status !== 'attached') {
    return {
      ok: false,
      diagnostics: [
        invalidApplyMergeOptionDiagnostic(
          'materializeActiveCheckout',
          'materializeActiveCheckout requires an attached active checkout session.',
        ),
      ],
    };
  }

  const diagnostics = activeCheckoutMaterializationProofDiagnostics(
    input,
    options,
    activeCheckout,
  );
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const transaction = transactionGuard.beginCheckoutTransaction();
  if (!transaction.ok) return { ok: false, diagnostics: transaction.diagnostics };
  transactionGuard.endCheckoutTransaction(transaction.token);

  return { ok: true, enabled: true, targetRef: activeCheckout.refName };
}

function activeCheckoutMaterializationProofDiagnostics(
  input: VersionApplyMergeInput,
  options: VersionApplyMergeOptions,
  activeCheckout: Extract<ActiveCheckoutWriteContext, { readonly status: 'attached' }>,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (options.targetRef !== activeCheckout.refName) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        'materializeActiveCheckout',
        'materializeActiveCheckout targetRef must match the active checkout branch.',
      ),
    );
  }
  if (options.expectedTargetHead?.commitId !== activeCheckout.commitId) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        'materializeActiveCheckout',
        'materializeActiveCheckout expectedTargetHead must match the active checkout head.',
      ),
    );
  }
  if (
    options.expectedTargetHead &&
    !versionRecordRevisionsEqual(options.expectedTargetHead.revision, activeCheckout.refRevision)
  ) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        'materializeActiveCheckout',
        'materializeActiveCheckout expectedTargetHead revision must match the active checkout ref revision.',
      ),
    );
  }
  if (isMergeCommitApplyInput(input) && input.ours !== activeCheckout.commitId) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        'ours',
        'applyMerge ours must match the active checkout head for materializeActiveCheckout.',
      ),
    );
  }
  return diagnostics;
}

async function materializeAppliedMergeTargetRef(
  ctx: DocumentContext,
  targetRef: ActiveCheckoutWriteRefName,
  transactionGuard: VersionCheckoutTransactionGuard | undefined,
): Promise<ActiveCheckoutMergeMaterializationResult> {
  if (!transactionGuard) {
    return {
      ok: false,
      diagnostics: [
        checkoutWriteFenceUnavailableDiagnostic({
          operation: 'applyMerge.materializeActiveCheckout',
          reason: 'checkoutTransactionGuardUnavailable',
        }),
      ],
    };
  }

  const service = getAttachedCheckoutMaterializationService(ctx);
  const serviceRefName = checkoutServiceRefNameForTargetRef(targetRef);
  if (!service?.checkout) {
    return {
      ok: false,
      diagnostics: [
        checkoutServiceUnavailableDiagnostic({
          operation: 'applyMerge.materializeActiveCheckout',
          targetKind: 'ref',
          refName: targetRef,
        }),
      ],
    };
  }

  const transaction = transactionGuard.beginCheckoutTransaction();
  if (!transaction.ok) return { ok: false, diagnostics: transaction.diagnostics };
  try {
    const result = mapCheckoutResult(
      await service.checkout({ target: 'ref', refName: serviceRefName }),
      {
        operation: 'applyMerge.materializeActiveCheckout',
        targetKind: 'ref',
        refName: targetRef,
      },
    );
    if (isAppliedCheckoutSuccess(result)) {
      return { ok: true, diagnostics: result.diagnostics };
    }
    return { ok: false, diagnostics: result.diagnostics };
  } catch {
    return {
      ok: false,
      diagnostics: [
        checkoutProviderErrorDiagnostic({
          operation: 'applyMerge.materializeActiveCheckout',
          targetKind: 'ref',
          refName: targetRef,
        }),
      ],
    };
  } finally {
    transactionGuard.endCheckoutTransaction(transaction.token);
  }
}

function isAppliedCheckoutSuccess(
  result: VersionCheckoutResult,
): result is VersionCheckoutResult & {
  readonly status: 'success';
  readonly materialization: 'applied';
} {
  return result.status === 'success' && result.materialization === 'applied';
}

function versionRecordRevisionsEqual(
  left: VersionCommitExpectedHead['revision'],
  right: VersionCommitExpectedHead['revision'],
): boolean {
  return left.kind === right.kind && left.value === right.value;
}

function checkoutServiceRefNameForTargetRef(refName: ActiveCheckoutWriteRefName): string {
  return refName.startsWith('refs/heads/') ? refName.slice('refs/heads/'.length) : refName;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
