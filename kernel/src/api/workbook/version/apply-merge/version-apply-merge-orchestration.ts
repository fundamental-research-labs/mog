import type {
  VersionApplyMergeResult,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeChange,
  VersionMergeInput,
  VersionRefName,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import {
  applyMergeServiceUnavailableDiagnostic,
  blockedApplyMergeResult,
  providerErrorDiagnostic,
  resolutionMismatchDiagnostic,
  resultFromTargetRefCasFailure,
} from './version-apply-merge-results';
import {
  validateApplyMergeTargetRefCasProof,
  type ApplyMergeTargetRefCasValidationResult,
} from './target-ref/version-apply-merge-target-ref';
import {
  isApplyMergeWriteSuccessResult,
  isNonFastForwardWriteResult,
  mapApplyMergeWriteResult,
} from './write-result/version-apply-merge-write-result';
import type { NormalizedApplyMergeOptions } from './version-apply-merge-validation';
import { materializableMergePlanDiagnostics } from '../merge/version-merge-materializer-support';

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

type AttachedVersionApplyMergeService = {
  readonly mergeCommit?: (input: VersionApplyMergeWriteInput) => MaybePromise<unknown>;
  readonly fastForwardMerge?: (input: VersionApplyMergeFastForwardInput) => MaybePromise<unknown>;
};

type VersionApplyMergeWriteInput = {
  readonly base: WorkbookCommitId;
  readonly ours: WorkbookCommitId;
  readonly theirs: WorkbookCommitId;
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly changes: readonly VersionMergeChange[];
  readonly resolutionCount: number;
};

type VersionApplyMergeFastForwardInput = Omit<
  VersionApplyMergeWriteInput,
  'changes' | 'resolutionCount'
>;

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

type ApplyMergePlan = {
  readonly base: WorkbookCommitId;
  readonly ours: WorkbookCommitId;
  readonly theirs: WorkbookCommitId;
  readonly changes: readonly VersionMergeChange[];
  readonly resolutionCount: number;
};

export async function finalizeApplyMergePlan(
  ctx: DocumentContext,
  options: NormalizedApplyMergeOptions,
  plan: ApplyMergePlan,
): Promise<VersionApplyMergeResult> {
  const supportDiagnostics = materializableMergePlanDiagnostics(
    { changes: plan.changes },
    'applyMerge',
  );
  if (supportDiagnostics.length > 0) {
    return blockedApplyMergeResult(plan.base, plan.ours, plan.theirs, supportDiagnostics);
  }

  if (options.mode === 'preview') {
    return {
      status: 'planned',
      base: plan.base,
      ours: plan.ours,
      theirs: plan.theirs,
      changes: plan.changes,
      conflicts: [],
      diagnostics: [],
      resolutionCount: plan.resolutionCount,
      mutationGuarantee: 'preview-only',
    };
  }

  if (options.expectedTargetHead.commitId !== plan.ours) {
    return blockedApplyMergeResult(plan.base, plan.ours, plan.theirs, [
      resolutionMismatchDiagnostic('applyMerge expectedTargetHead must match the ours commit.'),
    ]);
  }

  const cas = await validateApplyModeTargetRefCasProof(ctx, options);
  if (!cas.ok) return resultFromTargetRefCasFailure(plan.base, plan.ours, plan.theirs, cas);

  const service = getAttachedVersionApplyMergeService(ctx);
  if (!service?.mergeCommit) {
    return blockedApplyMergeResult(plan.base, plan.ours, plan.theirs, [
      applyMergeServiceUnavailableDiagnostic(),
    ]);
  }

  try {
    const result = await service.mergeCommit({
      ...plan,
      targetRef: options.targetRef,
      expectedTargetHead: options.expectedTargetHead,
    });
    return mapApplyMergeWriteResult(result, plan, 'merge-commit-created');
  } catch {
    return blockedApplyMergeResult(plan.base, plan.ours, plan.theirs, [providerErrorDiagnostic()]);
  }
}

export async function tryApplyFastForwardMerge(
  ctx: DocumentContext,
  input: VersionMergeInput,
  options: Extract<NormalizedApplyMergeOptions, { readonly mode: 'apply' }>,
): Promise<
  | { readonly kind: 'applied'; readonly result: VersionApplyMergeResult }
  | { readonly kind: 'blocked'; readonly result: VersionApplyMergeResult }
  | { readonly kind: 'not-fast-forward' }
> {
  if (options.expectedTargetHead.commitId !== input.ours) {
    return {
      kind: 'blocked',
      result: blockedApplyMergeResult(input.base, input.ours, input.theirs, [
        resolutionMismatchDiagnostic('applyMerge expectedTargetHead must match the ours commit.'),
      ]),
    };
  }

  const cas = await validateApplyModeTargetRefCasProof(ctx, options);
  if (!cas.ok) {
    return {
      kind: 'blocked',
      result: resultFromTargetRefCasFailure(input.base, input.ours, input.theirs, cas),
    };
  }

  const service = getAttachedVersionApplyMergeService(ctx);
  if (!service?.fastForwardMerge) return { kind: 'not-fast-forward' };

  try {
    const result = await service.fastForwardMerge({
      base: input.base,
      ours: input.ours,
      theirs: input.theirs,
      targetRef: options.targetRef,
      expectedTargetHead: options.expectedTargetHead,
    });
    if (isNonFastForwardWriteResult(result)) return { kind: 'not-fast-forward' };
    const mapped = mapApplyMergeWriteResult(
      result,
      {
        base: input.base,
        ours: input.ours,
        theirs: input.theirs,
        changes: [],
        resolutionCount: 0,
      },
      'ref-fast-forwarded',
    );
    return isApplyMergeWriteSuccessResult(mapped)
      ? { kind: 'applied', result: mapped }
      : { kind: 'blocked', result: mapped };
  } catch {
    return {
      kind: 'blocked',
      result: blockedApplyMergeResult(input.base, input.ours, input.theirs, [
        providerErrorDiagnostic(),
      ]),
    };
  }
}

export function validateApplyModeTargetRefCasProof(
  ctx: DocumentContext,
  options: Extract<NormalizedApplyMergeOptions, { readonly mode: 'apply' }>,
): Promise<ApplyMergeTargetRefCasValidationResult> {
  return validateApplyMergeTargetRefCasProof(ctx, {
    targetRef: options.targetRef,
    expectedTargetHead: options.expectedTargetHead,
  });
}

function getAttachedVersionApplyMergeService(
  ctx: DocumentContext,
): AttachedVersionApplyMergeService | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return null;

  for (const candidate of [
    services.applyMergeService,
    services.versionApplyMergeService,
    services.writeService,
    services.commitService,
    services.publicService,
  ]) {
    const service = toApplyMergeService(candidate);
    if (service) return service;
  }

  return null;
}

function toApplyMergeService(value: unknown): AttachedVersionApplyMergeService | null {
  const mergeCommit =
    bindMethod(value, 'mergeCommit') ??
    bindMethod(value, 'applyMerge') ??
    bindMethod(value, 'applyMergeVersion') ??
    bindMethod(value, 'applyMergeCommit');
  const fastForwardMerge =
    bindMethod(value, 'fastForwardMerge') ??
    bindMethod(value, 'fastForwardApplyMerge') ??
    bindMethod(value, 'applyMergeFastForward');
  if (!mergeCommit && !fastForwardMerge) return null;
  return {
    ...(mergeCommit ? { mergeCommit: (input) => mergeCommit(input) } : {}),
    ...(fastForwardMerge ? { fastForwardMerge: (input) => fastForwardMerge(input) } : {}),
  };
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
