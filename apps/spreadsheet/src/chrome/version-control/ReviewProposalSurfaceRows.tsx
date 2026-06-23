import type {
  AgentProposalSummary,
  WorkbookVersionReviewRecordSummary,
} from '@mog-sdk/contracts/api';

import { ProposalAcceptControl } from './ReviewProposalSurfaceActions';
import { AccessProjectionDiagnosticBlock } from './ReviewProposalSurfaceDiagnostics';
import {
  accessDiagnosticData,
  accessDiagnosticDomId,
  accessDiffBlockedReason,
  displayRefName,
  shouldDescribeAccessDiagnostic,
} from './review-proposal-formatting';
import { proposalTargetEvidence, reviewTargetEvidence } from './review-proposal-targets';
import type {
  CapabilityState,
  ReviewProposalAcceptTarget,
  ReviewProposalAccessProjectionDiagnostic,
  ReviewProposalDiffTarget,
  SummaryRowDataAttributes,
} from './review-proposal-types';

export function ReviewSummaryRow({
  review,
  diffEnabled,
  diffDisabledReason,
  diffDisabledReasonId,
  onOpenDiff,
  accessDiagnostic,
}: {
  readonly review: WorkbookVersionReviewRecordSummary;
  readonly diffEnabled: boolean;
  readonly diffDisabledReason?: string;
  readonly diffDisabledReasonId?: string;
  readonly onOpenDiff?: (target: ReviewProposalDiffTarget) => void;
  readonly accessDiagnostic?: ReviewProposalAccessProjectionDiagnostic;
}): React.JSX.Element {
  const target = reviewTargetEvidence(review);
  const accessDiagnosticId = shouldDescribeAccessDiagnostic(accessDiagnostic)
    ? accessDiagnosticDomId('review', review.id)
    : undefined;
  const accessDiagnosticMessageId = accessDiagnosticId
    ? `${accessDiagnosticId}-message`
    : undefined;
  const accessBlockedReason = accessDiffBlockedReason('review', accessDiagnostic);
  const activationEnabled = diffEnabled && !accessBlockedReason;
  const activation =
    onOpenDiff && target.baseCommitId && target.headCommitId
      ? {
          target: {
            recordKind: 'review' as const,
            recordId: review.id,
            baseCommitId: target.baseCommitId,
            targetCommitId: target.headCommitId,
          },
          enabled: activationEnabled,
          disabledReason: accessBlockedReason ?? diffDisabledReason,
          disabledReasonId: accessBlockedReason ? accessDiagnosticMessageId : diffDisabledReasonId,
          describedById: accessDiagnosticMessageId,
          onOpenDiff,
        }
      : undefined;

  return (
    <SummaryRow
      title={review.title ?? review.id}
      detail={`${review.status} · r${review.revision}`}
      evidence={target.label}
      testId="version-review-record-row"
      ariaLabel={`Review ${review.title ?? review.id} ${review.status}`}
      activation={activation}
      accessDiagnostic={accessDiagnostic}
      accessDiagnosticId={accessDiagnosticId}
      accessDiagnosticMessageId={accessDiagnosticMessageId}
      data={{
        recordKind: 'review',
        recordId: review.id,
        status: review.status,
        revision: String(review.revision),
        reviewId: review.id,
        reviewStatus: review.status,
        reviewRevision: String(review.revision),
        reviewSubject: review.subject.kind,
        baseCommitId: target.baseCommitId,
        headCommitId: target.headCommitId,
        ...accessDiagnosticData(accessDiagnostic),
      }}
    />
  );
}

export function ProposalSummaryRow({
  proposal,
  diffEnabled,
  diffDisabledReason,
  diffDisabledReasonId,
  onOpenDiff,
  acceptState,
  onAcceptProposal,
  proposalSurfaceAvailable,
  accessDiagnostic,
}: {
  readonly proposal: AgentProposalSummary;
  readonly diffEnabled: boolean;
  readonly diffDisabledReason?: string;
  readonly diffDisabledReasonId?: string;
  readonly onOpenDiff?: (target: ReviewProposalDiffTarget) => void;
  readonly acceptState?: CapabilityState;
  readonly onAcceptProposal?: (target: ReviewProposalAcceptTarget) => void;
  readonly proposalSurfaceAvailable: boolean;
  readonly accessDiagnostic?: ReviewProposalAccessProjectionDiagnostic;
}): React.JSX.Element {
  const target = proposalTargetEvidence(proposal);
  const accessDiagnosticId = shouldDescribeAccessDiagnostic(accessDiagnostic)
    ? accessDiagnosticDomId('proposal', proposal.id)
    : undefined;
  const accessDiagnosticMessageId = accessDiagnosticId
    ? `${accessDiagnosticId}-message`
    : undefined;
  const accessBlockedReason = accessDiffBlockedReason('proposal', accessDiagnostic);
  const activationEnabled = diffEnabled && !accessBlockedReason;
  const activation =
    onOpenDiff && proposal.proposalCommitId
      ? {
          target: {
            recordKind: 'proposal' as const,
            recordId: proposal.id,
            baseCommitId: proposal.baseCommitId,
            targetCommitId: proposal.proposalCommitId,
          },
          enabled: activationEnabled,
          disabledReason: accessBlockedReason ?? diffDisabledReason,
          disabledReasonId: accessBlockedReason ? accessDiagnosticMessageId : diffDisabledReasonId,
          describedById: accessDiagnosticMessageId,
          onOpenDiff,
        }
      : undefined;

  return (
    <div className="flex flex-col gap-1" data-testid="version-proposal-record-group">
      <SummaryRow
        title={proposal.title}
        detail={`${proposal.status} · ${displayRefName(proposal.targetRef)} · r${proposal.revision}`}
        evidence={target}
        testId="version-proposal-record-row"
        ariaLabel={`Proposal ${proposal.title} ${proposal.status}`}
        activation={activation}
        accessDiagnostic={accessDiagnostic}
        accessDiagnosticId={accessDiagnosticId}
        accessDiagnosticMessageId={accessDiagnosticMessageId}
        data={{
          recordKind: 'proposal',
          recordId: proposal.id,
          status: proposal.status,
          revision: String(proposal.revision),
          proposalId: proposal.id,
          proposalStatus: proposal.status,
          proposalRevision: String(proposal.revision),
          targetRef: proposal.targetRef,
          baseCommitId: proposal.baseCommitId,
          targetHeadId: proposal.targetHeadIdAtCreation,
          proposalCommitId: proposal.proposalCommitId,
          ...accessDiagnosticData(accessDiagnostic),
        }}
      />
      <ProposalAcceptControl
        proposal={proposal}
        acceptState={acceptState}
        onAcceptProposal={onAcceptProposal}
        proposalSurfaceAvailable={proposalSurfaceAvailable}
        accessDiagnostic={accessDiagnostic}
      />
    </div>
  );
}

function SummaryRow({
  title,
  detail,
  evidence,
  testId,
  ariaLabel,
  activation,
  accessDiagnostic,
  accessDiagnosticId,
  accessDiagnosticMessageId,
  data,
}: {
  readonly title: string;
  readonly detail: string;
  readonly evidence?: string;
  readonly testId: string;
  readonly ariaLabel: string;
  readonly activation?: {
    readonly target: ReviewProposalDiffTarget;
    readonly enabled: boolean;
    readonly disabledReason?: string;
    readonly disabledReasonId?: string;
    readonly describedById?: string;
    readonly onOpenDiff: (target: ReviewProposalDiffTarget) => void;
  };
  readonly accessDiagnostic?: ReviewProposalAccessProjectionDiagnostic;
  readonly accessDiagnosticId?: string;
  readonly accessDiagnosticMessageId?: string;
  readonly data: SummaryRowDataAttributes;
}): React.JSX.Element {
  const rowDataAttributes = {
    'data-testid': testId,
    'data-record-kind': data.recordKind,
    'data-record-id': data.recordId,
    'data-status': data.status,
    'data-revision': data.revision,
    'data-review-id': data.reviewId,
    'data-review-status': data.reviewStatus,
    'data-review-revision': data.reviewRevision,
    'data-review-subject': data.reviewSubject,
    'data-proposal-id': data.proposalId,
    'data-proposal-status': data.proposalStatus,
    'data-proposal-revision': data.proposalRevision,
    'data-target-ref': data.targetRef,
    'data-base-commit-id': data.baseCommitId,
    'data-head-commit-id': data.headCommitId,
    'data-target-head-id': data.targetHeadId,
    'data-proposal-commit-id': data.proposalCommitId,
    'data-access-projection': data.accessProjection,
    'data-access-diagnostic-code': data.accessDiagnosticCode,
    'data-access-diagnostic-severity': data.accessDiagnosticSeverity,
    'data-hidden-change-count': data.hiddenChangeCount,
    'data-redacted-change-count': data.redactedChangeCount,
    'data-omitted-domain-count': data.omittedDomainCount,
    'data-actionable': activation ? String(activation.enabled) : 'false',
    'data-diff-base-commit-id': activation?.target.baseCommitId,
    'data-diff-target-commit-id': activation?.target.targetCommitId,
  };
  const rowClassName =
    'min-w-0 w-full border border-ss-border rounded-sm bg-ss-surface px-2 py-1.5';
  const content = (
    <>
      <div className="truncate text-body-sm font-medium text-ss-text">{title}</div>
      <div className="mt-0.5 truncate text-[11px] text-ss-text-secondary">{detail}</div>
      {evidence ? (
        <div className="mt-0.5 truncate font-mono text-[11px] text-ss-text-secondary">
          {evidence}
        </div>
      ) : null}
      <AccessProjectionDiagnosticBlock
        kind={data.recordKind}
        diagnostic={accessDiagnostic}
        diagnosticId={accessDiagnosticId}
        messageId={accessDiagnosticMessageId}
      />
    </>
  );

  if (!activation) {
    return (
      <div className={rowClassName} aria-label={ariaLabel} {...rowDataAttributes}>
        {content}
      </div>
    );
  }

  const disabled = !activation.enabled;

  return (
    <button
      type="button"
      className={`${rowClassName} text-left transition-colors hover:bg-ss-surface-hover focus:outline-none focus:ring-1 focus:ring-ss-primary ${
        disabled ? 'opacity-60 hover:bg-ss-surface' : ''
      }`}
      aria-label={`Open ${data.recordKind} diff for ${title} ${data.status}`}
      aria-disabled={disabled}
      aria-describedby={
        activation.describedById ?? (disabled ? activation.disabledReasonId : undefined)
      }
      title={disabled ? activation.disabledReason : undefined}
      onClick={() => {
        if (!activation.enabled) return;
        activation.onOpenDiff(activation.target);
      }}
      {...rowDataAttributes}
    >
      {content}
    </button>
  );
}
