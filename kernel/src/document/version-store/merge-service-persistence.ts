import type {
  VersionMergeInput,
  VersionMergeOptions,
  VersionMergeResult,
  VersionStoreDiagnostic as PublicVersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import {
  computeEmptyResolutionSetDigest,
  computeMergeApplyResultDigest,
  computeResolvedAttemptDigest,
  hasMergeApplyIntentStoreProvider,
  idempotencyKeyForResolvedAttempt,
  intentIdForResolvedAttemptDigest,
  mergeResultIdForResolvedAttemptDigest,
  type MergeApplyIntentApplyKind,
  type MergeApplyIntentStoreDiagnostic,
} from './merge-apply-intent-store';
import {
  createMergePreviewArtifactRecord,
  mergeResultIdForPreviewDigest,
} from './merge-attempt-artifacts';
import type { VersionGraphStore, VersionStoreProvider } from './provider';
import type { VersionGraphNamespace } from './object-store';

type MergeDiagnostic = PublicVersionStoreDiagnostic;

export async function persistMergeAttemptIfRequested(input: {
  readonly provider: VersionStoreProvider;
  readonly graph: VersionGraphStore;
  readonly namespace: VersionGraphNamespace;
  readonly result: VersionMergeResult;
  readonly options: VersionMergeOptions;
}): Promise<VersionMergeResult> {
  const { provider, graph, namespace, result, options } = input;
  if (options.persistReviewRecord !== true) return result;
  if (result.status === 'blocked') return result;
  const resultInput = mergeInputFromResult(result);
  if (!resultInput) return result;
  if (!options.targetRef || !options.expectedTargetHead) {
    return blocked(resultInput, [
      diagnostic(
        'VERSION_INVALID_OPTIONS',
        'Persisted merge attempts require targetRef and expectedTargetHead.',
        { payload: { option: 'persistReviewRecord' } },
      ),
    ]);
  }
  const requiresApplyIntent = result.status === 'fastForward' || result.status === 'alreadyMerged';
  const intentProvider = hasMergeApplyIntentStoreProvider(provider) ? provider : null;
  if (requiresApplyIntent && !intentProvider) {
    return blocked(result, [
      diagnostic(
        'VERSION_STORE_UNAVAILABLE',
        'No merge apply intent store is attached for persisted merge attempts.',
        { recoverability: 'unsupported' },
      ),
    ]);
  }

  const previewArtifact = await createMergePreviewArtifactRecord(namespace, {
    status: result.status,
    base: result.base,
    ours: result.ours,
    theirs: result.theirs,
    changes: result.changes,
    conflicts: result.conflicts,
  });
  const persistedPreview = await graph.putObjects([previewArtifact]);
  if (persistedPreview.status !== 'success') {
    return blocked(resultInput, graphDiagnostics(persistedPreview.diagnostics));
  }

  if (result.status !== 'fastForward' && result.status !== 'alreadyMerged') {
    return {
      ...result,
      previewArtifactDigest: previewArtifact.digest,
      resultDigest: previewArtifact.digest,
      attemptPersistence: 'persisted',
      attemptKind: 'reviewOnly',
      resultId: mergeResultIdForPreviewDigest(previewArtifact.digest),
      targetRef: options.targetRef,
      expectedTargetHead: options.expectedTargetHead,
    };
  }

  const resultDigest = await computeMergeApplyResultDigest({
    status: result.status,
    base: result.base,
    ours: result.ours,
    theirs: result.theirs,
    targetRef: options.targetRef,
    expectedTargetHead: options.expectedTargetHead,
  });
  const resolutionSetDigest = await computeEmptyResolutionSetDigest();
  const resolvedAttemptDigest = await computeResolvedAttemptDigest({
    resultDigest,
    resolutionSetDigest,
    targetRef: options.targetRef,
    expectedTargetHead: options.expectedTargetHead,
  });
  if (!intentProvider) return result;
  const begin = await (
    await intentProvider.openMergeApplyIntentStore(namespace)
  ).beginIntent({
    intentId: intentIdForResolvedAttemptDigest(resolvedAttemptDigest),
    idempotencyKey: idempotencyKeyForResolvedAttempt({
      resolvedAttemptDigest,
      targetRef: options.targetRef,
      expectedTargetHead: options.expectedTargetHead,
    }),
    applyKind: applyKindForMergeStatus(result.status),
    base: result.base,
    ours: result.ours,
    theirs: result.theirs,
    targetRef: options.targetRef,
    expectedTargetHead: options.expectedTargetHead,
    resultDigest,
    resolutionSetDigest,
    resolvedAttemptDigest,
    createdAt: new Date().toISOString(),
  });
  if (begin.status === 'failed' || begin.status === 'conflict') {
    return blocked(result, intentStoreDiagnostics(begin.diagnostics));
  }

  return {
    ...result,
    previewArtifactDigest: previewArtifact.digest,
    resultDigest,
    attemptPersistence: 'persisted',
    attemptKind: 'applyable',
    resultId: mergeResultIdForResolvedAttemptDigest(resolvedAttemptDigest),
    targetRef: options.targetRef,
    expectedTargetHead: options.expectedTargetHead,
  };
}

function applyKindForMergeStatus(
  status: Extract<VersionMergeResult['status'], 'fastForward' | 'alreadyMerged'>,
): MergeApplyIntentApplyKind {
  return status === 'alreadyMerged' ? 'alreadyMerged' : 'fastForward';
}

function blocked(
  input: VersionMergeInput,
  diagnostics: readonly MergeDiagnostic[],
): VersionMergeResult {
  return {
    status: 'blocked',
    base: input.base,
    ours: input.ours,
    theirs: input.theirs,
    changes: [],
    conflicts: [],
    diagnostics,
    mutationGuarantee: 'preview-only',
  };
}

function mergeInputFromResult(result: VersionMergeResult): VersionMergeInput | null {
  return result.base && result.ours && result.theirs
    ? { base: result.base, ours: result.ours, theirs: result.theirs }
    : null;
}

function graphDiagnostics(diagnostics: readonly unknown[]): readonly MergeDiagnostic[] {
  return diagnostics.map((item) => {
    if (!isRecord(item)) {
      return diagnostic('VERSION_PROVIDER_ERROR', 'Version graph object write failed.', {
        severity: 'fatal',
        recoverability: 'retry',
      });
    }
    const issueCode = typeof item.code === 'string' ? item.code : 'VERSION_PROVIDER_ERROR';
    const severity = item.severity;
    return diagnostic(
      issueCode,
      typeof item.message === 'string' ? item.message : 'Version graph object write failed.',
      {
        severity: severity === 'corruption' ? 'error' : 'error',
        recoverability: recoverabilityForIssue(issueCode),
      },
    );
  });
}

function intentStoreDiagnostics(
  diagnostics: readonly MergeApplyIntentStoreDiagnostic[],
): readonly MergeDiagnostic[] {
  return diagnostics.map((item) =>
    diagnostic(item.code, item.message, {
      recoverability: item.recoverability,
      ...(item.details ? { payload: item.details } : {}),
    }),
  );
}

function diagnostic(
  issueCode: string,
  safeMessage: string,
  options: {
    readonly severity?: MergeDiagnostic['severity'];
    readonly recoverability?: MergeDiagnostic['recoverability'];
    readonly payload?: Readonly<Record<string, string | number | boolean | null>>;
  } = {},
): MergeDiagnostic {
  return {
    issueCode,
    severity: options.severity ?? (issueCode === 'VERSION_PROVIDER_ERROR' ? 'fatal' : 'error'),
    recoverability: options.recoverability ?? recoverabilityForIssue(issueCode),
    messageTemplateId: `version.merge.${issueCode}` as MergeDiagnostic['messageTemplateId'],
    safeMessage,
    ...(options.payload ? { payload: { operation: 'merge', ...options.payload } } : {}),
    redacted: true,
  };
}

function recoverabilityForIssue(issueCode: string): MergeDiagnostic['recoverability'] {
  switch (issueCode) {
    case 'VERSION_PROVIDER_ERROR':
    case 'VERSION_REF_CONFLICT':
    case 'VERSION_STALE_PAGE_CURSOR':
      return 'retry';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_INVALID_COMMIT_PAYLOAD':
    case 'VERSION_MISSING_DEPENDENCY':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_MISSING_PARENT':
    case 'VERSION_OBJECT_STORE_FAILURE':
      return 'repair';
    case 'VERSION_GRAPH_UNINITIALIZED':
    case 'VERSION_MERGE_UNSUPPORTED_ANCESTRY':
    case 'VERSION_MERGE_UNSUPPORTED_DOMAIN':
    case 'VERSION_PERMISSION_DENIED':
    case 'VERSION_REDACTION_VIOLATION':
    case 'VERSION_STORE_UNAVAILABLE':
    case 'VERSION_UNMATERIALIZABLE_COMMIT':
    case 'VERSION_UNSUPPORTED_SCHEMA':
      return 'unsupported';
    default:
      return 'none';
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
