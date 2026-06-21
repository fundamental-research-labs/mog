import type {
  CheckoutVersionResult,
  PageCursor,
  Paged,
  VersionApplyMergeResult,
  VersionDiagnostic,
  VersionMergeResult,
  VersionRef,
  VersionRefListResult,
  VersionRefMutationResult,
  VersionRefReadResult,
  VersionResult,
  VersionCheckoutResult,
  VersionSemanticDiffPage,
  VersionStoreDiagnostic,
  WorkbookCommitRef,
  WorkbookCommitSummary,
  WorkbookDiffPage,
  VersionCommitPage,
  VersionDegradedHeadResult,
  VersionHead,
} from '@mog-sdk/contracts/api';

type VersionResultOperation =
  | 'getHead'
  | 'listCommits'
  | 'commit'
  | 'createBranch'
  | 'deleteBranch'
  | 'deleteRef'
  | 'fastForwardBranch'
  | 'getRef'
  | 'listRefs'
  | 'checkout'
  | 'diff'
  | 'merge'
  | 'applyMerge'
  | 'readRef'
  | 'updateBranch';

type VersionPageLike<T> = {
  readonly status: 'success' | 'degraded';
  readonly items: readonly T[];
  readonly nextPageToken?: string;
  readonly diagnostics?: readonly VersionStoreDiagnostic[];
};

export function versionResultFromHead(
  result: WorkbookCommitRef | VersionDegradedHeadResult,
): VersionResult<VersionHead> {
  if (isDegradedHead(result)) {
    return versionFailureFromStoreDiagnostics('getHead', result.diagnostics);
  }
  return { ok: true, value: result };
}

export function versionResultFromCommitPage(
  result: VersionCommitPage,
  limit: number,
): VersionResult<Paged<WorkbookCommitSummary>> {
  return versionResultFromPage('listCommits', result, limit);
}

export function versionResultFromRefList(
  result: VersionRefListResult,
  limit: number,
): VersionResult<Paged<VersionRef>> {
  if (result.status === 'degraded') {
    return versionFailureFromStoreDiagnostics('listRefs', result.diagnostics);
  }
  return {
    ok: true,
    value: {
      items: result.items,
      limit,
    },
  };
}

export function versionResultFromRefMutation(
  operation: Extract<
    VersionResultOperation,
    'createBranch' | 'deleteBranch' | 'deleteRef' | 'fastForwardBranch' | 'updateBranch'
  >,
  result: VersionRefMutationResult,
): VersionResult<VersionRef> {
  if (result.status === 'degraded') {
    return versionFailureFromStoreDiagnostics(operation, result.diagnostics);
  }
  return { ok: true, value: result.ref };
}

export function versionResultFromRefRead(
  operation: Extract<VersionResultOperation, 'getRef' | 'readRef'>,
  result: VersionRefReadResult,
): VersionResult<VersionRefReadResult> {
  if (result.status === 'degraded') {
    return versionFailureFromStoreDiagnostics(operation, result.diagnostics);
  }
  return { ok: true, value: result };
}

export function versionResultFromCheckout(
  result: VersionCheckoutResult,
): VersionResult<CheckoutVersionResult> {
  if (result.status === 'degraded') {
    return versionFailureFromStoreDiagnostics('checkout', result.diagnostics);
  }
  return { ok: true, value: result };
}

export function versionResultFromMerge(
  result: VersionMergeResult,
): VersionResult<VersionMergeResult> {
  if (result.status === 'blocked') {
    return versionFailureFromOperationDiagnostics('merge', result.diagnostics);
  }
  return { ok: true, value: result };
}

export function versionResultFromApplyMerge(
  result: VersionApplyMergeResult,
): VersionResult<VersionApplyMergeResult> {
  if (result.status === 'blocked') {
    return versionFailureFromOperationDiagnostics('applyMerge', result.diagnostics);
  }
  return { ok: true, value: result };
}

export function versionResultFromDiffPage(
  result: WorkbookDiffPage,
  limit: number,
): VersionResult<VersionSemanticDiffPage> {
  if (result.status === 'degraded') {
    return versionFailureFromStoreDiagnostics('diff', result.diagnostics);
  }

  return {
    ok: true,
    value: {
      items: result.items,
      ...(result.nextPageToken ? { nextCursor: result.nextPageToken as PageCursor } : {}),
      limit,
      readRevision: result.readRevision,
      order: result.order,
    },
  };
}

function versionResultFromPage<T>(
  operation: VersionResultOperation,
  result: VersionPageLike<T>,
  limit: number,
): VersionResult<Paged<T>> {
  if (result.status === 'degraded') {
    return versionFailureFromStoreDiagnostics(operation, result.diagnostics ?? []);
  }

  return {
    ok: true,
    value: {
      items: result.items,
      ...(result.nextPageToken ? { nextCursor: result.nextPageToken as PageCursor } : {}),
      limit,
    },
  };
}

export function versionFailureFromStoreDiagnostics<T>(
  operation: VersionResultOperation,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${operation}`,
      diagnostics: diagnostics.map(toVersionDiagnostic),
    },
  };
}

function versionFailureFromOperationDiagnostics<T>(
  operation: Extract<VersionResultOperation, 'merge' | 'applyMerge'>,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionResult<T> {
  return versionFailureFromStoreDiagnostics(operation, diagnostics);
}

function toVersionDiagnostic(diagnostic: VersionStoreDiagnostic): VersionDiagnostic {
  const severity = diagnostic.severity === 'fatal' ? 'error' : diagnostic.severity;
  const operation = payloadOperation(diagnostic);
  return {
    code: diagnostic.issueCode,
    severity,
    message: diagnostic.safeMessage,
    owner: 'version-store',
    data: {
      ...(operation ? { operation } : {}),
      recoverability: diagnostic.recoverability,
      messageTemplateId: diagnostic.messageTemplateId,
      redacted: diagnostic.redacted,
      ...(diagnostic.payload ? { payload: diagnostic.payload } : {}),
      ...(diagnostic.mutationGuarantee
        ? { mutationGuarantee: diagnostic.mutationGuarantee }
        : {}),
    },
  };
}

function payloadOperation(diagnostic: VersionStoreDiagnostic): string | undefined {
  return typeof diagnostic.payload?.operation === 'string'
    ? diagnostic.payload.operation
    : undefined;
}

function isDegradedHead(
  result: WorkbookCommitRef | VersionDegradedHeadResult,
): result is VersionDegradedHeadResult {
  return 'status' in result && result.status === 'degraded';
}
