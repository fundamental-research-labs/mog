import type {
  CheckoutVersionResult,
  PageCursor,
  Paged,
  VersionCapability,
  VersionApplyMergeResult,
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
import {
  VERSION_CAPABILITY_KEYS,
  type VersionMergePublicOperation,
} from './version/merge/version-merge-capability';
import {
  projectVersionHistoryDiagnosticsForAccess,
  projectVersionStoreDiagnosticsForPublicResult,
} from './version/history-diagnostics/version-history-diagnostic-projection';

type VersionResultOperation =
  | 'getCurrent'
  | 'getHead'
  | 'listCommits'
  | 'commitCurrent'
  | 'commit'
  | 'appendReviewDecision'
  | 'createBranchFromCurrent'
  | 'createBranch'
  | 'createReview'
  | 'deleteBranch'
  | 'deleteRef'
  | 'fastForwardBranch'
  | 'getReview'
  | 'getReviewDiff'
  | 'getRef'
  | 'listReviews'
  | 'listBranches'
  | 'listRefs'
  | 'checkout'
  | 'checkoutBranch'
  | 'checkoutCommit'
  | 'diff'
  | 'diffCurrent'
  | 'diffBranch'
  | 'merge'
  | 'previewMerge'
  | 'getMergeReview'
  | 'revert'
  | 'promotePendingRemote'
  | 'getMergeConflictDetail'
  | 'putMergeResolutionPayload'
  | 'saveMergeResolutions'
  | 'applyMerge'
  | 'acceptProposal'
  | 'commitProposalWorkspace'
  | 'createProposal'
  | 'disposeProposalWorkspace'
  | 'failProposal'
  | 'getProposal'
  | 'getProposalWorkspace'
  | 'listProposals'
  | 'markProposalVerified'
  | 'openProposalReview'
  | 'readRef'
  | 'rejectProposal'
  | 'startProposalWorkspace'
  | 'supersedeProposal'
  | 'updateReviewStatus'
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
  operation: Extract<VersionResultOperation, 'listRefs' | 'listBranches'> = 'listRefs',
): VersionResult<Paged<VersionRef>> {
  if (result.status === 'degraded') {
    return versionFailureFromStoreDiagnostics(operation, result.diagnostics);
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
    | 'createBranch'
    | 'createBranchFromCurrent'
    | 'deleteBranch'
    | 'deleteRef'
    | 'fastForwardBranch'
    | 'updateBranch'
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
  operation: Extract<
    VersionResultOperation,
    'checkout' | 'checkoutBranch' | 'checkoutCommit'
  > = 'checkout',
): VersionResult<CheckoutVersionResult> {
  if (result.status === 'degraded') {
    return versionFailureFromStoreDiagnostics(operation, result.diagnostics);
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
  operation: Extract<VersionResultOperation, 'diff' | 'diffCurrent' | 'diffBranch'> = 'diff',
): VersionResult<VersionSemanticDiffPage> {
  if (result.status === 'degraded') {
    return versionFailureFromStoreDiagnostics(operation, result.diagnostics);
  }

  return {
    ok: true,
    value: {
      items: result.items,
      ...(result.nextPageToken ? { nextCursor: result.nextPageToken as PageCursor } : {}),
      limit,
      readRevision: result.readRevision,
      order: result.order,
      ...(result.resourceLimits ? { resourceLimits: result.resourceLimits } : {}),
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
  const hostDenied = diagnostics.find(isHostCapabilityDeniedDiagnostic);
  const deniedCapability = hostDenied ? payloadVersionCapability(hostDenied) : undefined;
  if (hostDenied && deniedCapability) {
    const retryable = hostDenied.payload?.reason === 'hostCapabilityApprovalRequired';
    return {
      ok: false,
      error: {
        code: 'version_capability_unavailable',
        capability: deniedCapability,
        dependency: 'hostCapability',
        reason: retryable
          ? 'Version history capability requires approval for this caller.'
          : 'Version history capability is denied for this caller.',
        retryable,
        diagnostics: projectVersionHistoryDiagnosticsForAccess(
          projectVersionStoreDiagnosticsForPublicResult(diagnostics),
          {
            kind: 'capability-denied',
            capability: deniedCapability,
            deniedCapabilities: [deniedCapability],
            dependency: 'hostCapability',
            retryable,
          },
        ),
      },
    };
  }

  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: publicVersionTargetForOperation(operation),
      diagnostics: projectVersionStoreDiagnosticsForPublicResult(diagnostics),
    },
  };
}

function publicVersionTargetForOperation(operation: VersionResultOperation): string {
  if (DIRECT_VERSION_OPERATIONS.has(operation)) return `workbook.version.${operation}`;
  if (REVIEW_ADVANCED_OPERATIONS.has(operation)) {
    return `workbook.version.reviews.advanced.${operation}`;
  }
  if (MERGE_ARTIFACT_ADVANCED_OPERATIONS.has(operation)) {
    return `workbook.version.artifacts.advanced.${operation}`;
  }
  if (PROPOSAL_ADVANCED_OPERATIONS.has(operation)) {
    return `workbook.version.proposals.advanced.${operation}`;
  }
  return `workbook.version.${operation}`;
}

const DIRECT_VERSION_OPERATIONS = new Set<VersionResultOperation>([
  'getHead',
  'listCommits',
  'commit',
  'checkout',
  'merge',
  'applyMerge',
  'revert',
  'promotePendingRemote',
  'diff',
  'readRef',
  'getRef',
  'listRefs',
  'createBranch',
  'fastForwardBranch',
  'updateBranch',
  'deleteBranch',
  'deleteRef',
]);

const REVIEW_ADVANCED_OPERATIONS = new Set<VersionResultOperation>([
  'appendReviewDecision',
  'createReview',
  'getReview',
  'getReviewDiff',
  'listReviews',
  'updateReviewStatus',
]);

const MERGE_ARTIFACT_ADVANCED_OPERATIONS = new Set<VersionResultOperation>([
  'getMergeConflictDetail',
  'putMergeResolutionPayload',
  'saveMergeResolutions',
]);

const PROPOSAL_ADVANCED_OPERATIONS = new Set<VersionResultOperation>([
  'acceptProposal',
  'commitProposalWorkspace',
  'createProposal',
  'disposeProposalWorkspace',
  'failProposal',
  'getProposal',
  'getProposalWorkspace',
  'listProposals',
  'markProposalVerified',
  'openProposalReview',
  'rejectProposal',
  'startProposalWorkspace',
  'supersedeProposal',
]);

function versionFailureFromOperationDiagnostics<T>(
  operation: VersionMergePublicOperation,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionResult<T> {
  const capabilityDisabled = diagnostics.find(
    (diagnostic) => diagnostic.issueCode === 'VERSION_MERGE_CAPABILITY_DISABLED',
  );
  if (capabilityDisabled) {
    return {
      ok: false,
      error: {
        code: 'version_capability_unavailable',
        capability: capabilityForMergeOperation(operation),
        dependency: capabilityDependency(capabilityDisabled),
        reason: capabilityDisabled.safeMessage,
        retryable: false,
      },
    };
  }
  return versionFailureFromStoreDiagnostics(operation, diagnostics);
}

export function versionResultFromMergeEndpointDiagnostics<T>(
  operation: VersionMergePublicOperation,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionResult<T> {
  return versionFailureFromOperationDiagnostics(operation, diagnostics);
}

function capabilityDependency(
  diagnostic: VersionStoreDiagnostic,
): 'featureGate' | 'hostCapability' {
  const reason = diagnostic.payload?.reason;
  return reason === 'hostCapabilityDenied' || reason === 'hostCapabilityApprovalRequired'
    ? 'hostCapability'
    : 'featureGate';
}

function capabilityForMergeOperation(operation: VersionMergePublicOperation): VersionCapability {
  switch (operation) {
    case 'previewMerge':
    case 'getMergeReview':
    case 'merge':
    case 'getMergeConflictDetail':
      return 'version:mergePreview';
    case 'applyMerge':
    case 'saveMergeResolutions':
    case 'putMergeResolutionPayload':
      return 'version:mergeApply';
  }
}

const VERSION_CAPABILITY_SET = new Set<string>(VERSION_CAPABILITY_KEYS);

function isHostCapabilityDeniedDiagnostic(diagnostic: VersionStoreDiagnostic): boolean {
  const reason = diagnostic.payload?.reason;
  return (
    diagnostic.issueCode === 'VERSION_CAPABILITY_DISABLED' &&
    (reason === 'hostCapabilityDenied' || reason === 'hostCapabilityApprovalRequired') &&
    Boolean(payloadVersionCapability(diagnostic))
  );
}

function payloadVersionCapability(
  diagnostic: VersionStoreDiagnostic,
): VersionCapability | undefined {
  const capability = diagnostic.payload?.capability;
  return typeof capability === 'string' && VERSION_CAPABILITY_SET.has(capability)
    ? (capability as VersionCapability)
    : undefined;
}

function isDegradedHead(
  result: WorkbookCommitRef | VersionDegradedHeadResult,
): result is VersionDegradedHeadResult {
  return 'status' in result && result.status === 'degraded';
}
