import type {
  VersionApplyMergeInput,
  VersionApplyMergeOptions,
  VersionApplyMergeResult,
  VersionCheckoutResult,
  VersionCommitExpectedHead,
  VersionStoreDiagnostic,
  WorkbookCommitId,
  WorkbookCommitRef,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import {
  checkoutWriteFenceUnavailableDiagnostic,
  type VersionCheckoutTransactionGuard,
} from '../../version-checkout';
import {
  type ActiveCheckoutWriteContext,
  type ActiveCheckoutWriteRefName,
  detachedImplicitCheckoutWriteDiagnostic,
  readActiveCheckoutWriteContext,
} from '../active-checkout/active-checkout-write-context';
import {
  invalidPayloadDiagnostic as checkoutInvalidPayloadDiagnostic,
  providerErrorDiagnostic as checkoutProviderErrorDiagnostic,
  serviceUnavailableDiagnostic as checkoutServiceUnavailableDiagnostic,
} from '../checkout/version-checkout-diagnostic-factories';
import { mapCheckoutResult } from '../checkout/version-checkout-result-mapping';
import { getAttachedCheckoutMaterializationService } from '../checkout/version-checkout-service';
import { invalidApplyMergeOptionDiagnostic } from './version-apply-merge-results';

export type ActiveCheckoutMergeMaterializationPreparation =
  | { readonly ok: true; readonly enabled: false }
  | { readonly ok: true; readonly enabled: true; readonly targetRef: ActiveCheckoutWriteRefName }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export type ActiveCheckoutMergeMaterializationResult =
  | { readonly ok: true; readonly diagnostics: readonly VersionStoreDiagnostic[] }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export async function prepareActiveCheckoutMergeMaterialization(
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
  const service = getAttachedCheckoutMaterializationService(ctx);
  if (!service?.checkout) {
    return {
      ok: false,
      diagnostics: [
        checkoutServiceUnavailableDiagnostic({
          operation: 'applyMerge.materializeActiveCheckout',
          targetKind: 'ref',
          refName: options.targetRef,
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

  const diagnostics = activeCheckoutMaterializationProofDiagnostics(input, options, activeCheckout);
  if (diagnostics.length > 0) return { ok: false, diagnostics };

  const transaction = transactionGuard.beginCheckoutTransaction();
  if (!transaction.ok) return { ok: false, diagnostics: transaction.diagnostics };
  transactionGuard.endCheckoutTransaction(transaction.token);

  return { ok: true, enabled: true, targetRef: activeCheckout.refName };
}

export async function materializeAppliedMergeTargetRef(
  ctx: DocumentContext,
  targetRef: ActiveCheckoutWriteRefName,
  expectedCommitId: WorkbookCommitId,
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
      const diagnostics = materializedCheckoutProofDiagnostics(result, targetRef, expectedCommitId);
      if (diagnostics.length > 0) return { ok: false, diagnostics };
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

export function isMergeCommitApplyInput(
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

export function applyMergeResultCommitRef(
  result: VersionApplyMergeResult,
): WorkbookCommitRef | null {
  if (!('commitRef' in result)) return null;
  return result.commitRef;
}

export function shouldClearPersistedActiveCheckoutMaterializationAfterApplyMerge(
  result: VersionApplyMergeResult,
): boolean {
  return result.status === 'blocked' && result.mutationGuarantee === 'unknown-after-crash';
}

export function shouldMaterializeActiveCheckoutAfterApplyMerge(
  result: VersionApplyMergeResult,
): boolean {
  return (
    result.status === 'applied' ||
    result.status === 'fastForwarded' ||
    result.status === 'alreadyApplied' ||
    result.status === 'alreadyMerged'
  );
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

function isAppliedCheckoutSuccess(
  result: VersionCheckoutResult,
): result is VersionCheckoutResult & {
  readonly status: 'success';
  readonly materialization: 'applied';
} {
  return result.status === 'success' && result.materialization === 'applied';
}

function materializedCheckoutProofDiagnostics(
  result: Extract<VersionCheckoutResult, { readonly status: 'success' }>,
  targetRef: ActiveCheckoutWriteRefName,
  expectedCommitId: WorkbookCommitId,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  const payload = {
    operation: 'applyMerge.materializeActiveCheckout',
    targetKind: 'ref',
    refName: targetRef,
    expectedCommitId,
  };
  if (result.plan.commitId !== expectedCommitId) {
    diagnostics.push(
      checkoutInvalidPayloadDiagnostic({
        ...payload,
        reason: 'materializedCommitMismatch',
        materializedCommitId: result.plan.commitId,
      }),
    );
  }
  const target = result.plan.target;
  if (
    target.kind !== 'ref' ||
    target.refName !== targetRef ||
    target.commitId !== expectedCommitId
  ) {
    const targetPayload: Record<string, string | number | boolean | null> = {
      materializedCommitId: target.commitId,
    };
    if (target.kind !== 'commit') {
      targetPayload.materializedRefName = target.refName;
    }
    diagnostics.push(
      checkoutInvalidPayloadDiagnostic({
        ...payload,
        reason: 'materializedTargetMismatch',
        materializedTargetKind: target.kind,
        ...targetPayload,
      }),
    );
  }
  return diagnostics;
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
