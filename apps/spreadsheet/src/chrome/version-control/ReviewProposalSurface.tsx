import type {
  AgentProposalSummary,
  VersionDiagnostic,
  VersionSurfaceStatus,
  WorkbookCommitId,
  WorkbookVersionReviewRecordSummary,
} from '@mog-sdk/contracts/api';

type VersionPanelDiagnostic = {
  readonly code: string;
  readonly severity: VersionDiagnostic['severity'];
  readonly message: string;
};

type CapabilityState =
  VersionSurfaceStatus['capabilities'][keyof VersionSurfaceStatus['capabilities']];

export type ReviewProposalAccessProjectionState = 'visible' | 'partial' | 'denied';

export type ReviewProposalAccessProjectionDiagnostic = {
  readonly state: ReviewProposalAccessProjectionState;
  readonly message: string;
  readonly code?: string;
  readonly severity?: VersionDiagnostic['severity'];
  readonly reason?: string;
  readonly hiddenChangeCount?: number;
  readonly redactedChangeCount?: number;
  readonly omittedDomainCount?: number;
  readonly domains?: readonly string[];
};

export type ReviewProposalAccessProjectionDiagnostics = {
  readonly reviews?: Readonly<Record<string, ReviewProposalAccessProjectionDiagnostic>>;
  readonly proposals?: Readonly<Record<string, ReviewProposalAccessProjectionDiagnostic>>;
};

export type ReviewProposalAcceptTarget = {
  readonly proposalId: AgentProposalSummary['id'];
  readonly expectedRevision: number;
  readonly expectedTargetHeadId: WorkbookCommitId;
  readonly proposalCommitId: WorkbookCommitId;
  readonly targetRef: AgentProposalSummary['targetRef'];
};

type SummaryRowDataAttributes = {
  readonly recordKind: 'review' | 'proposal';
  readonly recordId: string;
  readonly status: string;
  readonly revision: string;
  readonly reviewId?: string;
  readonly reviewStatus?: string;
  readonly reviewRevision?: string;
  readonly reviewSubject?: string;
  readonly proposalId?: string;
  readonly proposalStatus?: string;
  readonly proposalRevision?: string;
  readonly targetRef?: string;
  readonly baseCommitId?: string;
  readonly headCommitId?: string;
  readonly targetHeadId?: string;
  readonly proposalCommitId?: string;
  readonly accessProjection?: ReviewProposalAccessProjectionState;
  readonly accessDiagnosticCode?: string;
  readonly accessDiagnosticSeverity?: VersionDiagnostic['severity'];
  readonly hiddenChangeCount?: string;
  readonly redactedChangeCount?: string;
  readonly omittedDomainCount?: string;
};

export type ReviewProposalDiffTarget = {
  readonly recordKind: 'review' | 'proposal';
  readonly recordId: string;
  readonly baseCommitId: WorkbookCommitId;
  readonly targetCommitId: WorkbookCommitId;
};

export interface ReviewProposalSurfaceProps {
  readonly surface?: VersionSurfaceStatus;
  readonly reviews: readonly WorkbookVersionReviewRecordSummary[];
  readonly proposals: readonly AgentProposalSummary[];
  readonly reviewDiagnostic?: VersionPanelDiagnostic;
  readonly proposalDiagnostic?: VersionPanelDiagnostic;
  readonly diffEnabled?: boolean;
  readonly diffDisabledReason?: string;
  readonly onOpenDiff?: (target: ReviewProposalDiffTarget) => void;
  readonly accessDiagnostics?: ReviewProposalAccessProjectionDiagnostics;
  readonly onAcceptProposal?: (target: ReviewProposalAcceptTarget) => void;
}

export function ReviewProposalSurface({
  surface,
  reviews,
  proposals,
  reviewDiagnostic,
  proposalDiagnostic,
  diffEnabled = true,
  diffDisabledReason,
  onOpenDiff,
  accessDiagnostics,
  onAcceptProposal,
}: ReviewProposalSurfaceProps): React.JSX.Element | null {
  const reviewState = surface?.capabilities['version:reviewRead'];
  const proposalState = surface?.capabilities['version:proposal'];
  const diffState = surface?.capabilities['version:diff'];
  const acceptState = surface?.capabilities['version:mergeApply'];
  const hasUnavailableState =
    (reviewState && !reviewState.enabled) ||
    (proposalState && !proposalState.enabled) ||
    (Boolean(onAcceptProposal) && acceptState && !acceptState.enabled);
  const hasAccessDiagnostics =
    Boolean(accessDiagnostics?.reviews && Object.keys(accessDiagnostics.reviews).length > 0) ||
    Boolean(accessDiagnostics?.proposals && Object.keys(accessDiagnostics.proposals).length > 0);
  const hasContent =
    Boolean(surface) ||
    reviews.length > 0 ||
    proposals.length > 0 ||
    Boolean(reviewDiagnostic) ||
    Boolean(proposalDiagnostic) ||
    hasAccessDiagnostics;

  if (!hasUnavailableState && !hasContent) return null;

  const diffDisabledReasonId =
    onOpenDiff && !diffEnabled && diffDisabledReason
      ? 'version-review-proposal-diff-disabled-reason'
      : undefined;

  return (
    <section
      className="border border-ss-border rounded-sm px-3 py-2 bg-ss-surface-secondary"
      aria-label="Review and proposal status"
      data-testid="version-review-proposal-surface"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-body-sm font-medium text-ss-text">Proposal review</span>
        <span
          className="text-[11px] leading-none uppercase text-ss-text-tertiary"
          data-testid="version-review-proposal-state"
        >
          {reviewState?.enabled || proposalState?.enabled ? 'Active' : 'Unavailable'}
        </span>
      </div>

      <div className="mt-2 flex flex-col gap-2">
        <CapabilityStatusRow
          kind="review"
          label="Reviews"
          capability="version:reviewRead"
          state={reviewState}
          diagnostic={reviewDiagnostic}
        />
        <CapabilityStatusRow
          kind="proposal"
          label="Proposals"
          capability="version:proposal"
          state={proposalState}
          diagnostic={proposalDiagnostic}
        />
        {surface ? <DiffPersistenceEvidence surface={surface} diffState={diffState} /> : null}
        {diffDisabledReasonId ? (
          <div
            id={diffDisabledReasonId}
            className="text-[11px] leading-snug text-ss-text-secondary"
            data-testid={diffDisabledReasonId}
          >
            {diffDisabledReason}
          </div>
        ) : null}
        {reviews.map((review) => (
          <ReviewSummaryRow
            key={review.id}
            review={review}
            diffEnabled={diffEnabled}
            diffDisabledReason={diffDisabledReason}
            diffDisabledReasonId={diffDisabledReasonId}
            onOpenDiff={onOpenDiff}
            accessDiagnostic={accessDiagnostics?.reviews?.[review.id]}
          />
        ))}
        {proposals.map((proposal) => (
          <ProposalSummaryRow
            key={proposal.id}
            proposal={proposal}
            diffEnabled={diffEnabled}
            diffDisabledReason={diffDisabledReason}
            diffDisabledReasonId={diffDisabledReasonId}
            onOpenDiff={onOpenDiff}
            acceptState={acceptState}
            onAcceptProposal={onAcceptProposal}
            accessDiagnostic={accessDiagnostics?.proposals?.[proposal.id]}
          />
        ))}
      </div>
    </section>
  );
}

function CapabilityStatusRow({
  kind,
  label,
  capability,
  state,
  diagnostic,
}: {
  readonly kind: 'review' | 'proposal';
  readonly label: string;
  readonly capability: 'version:reviewRead' | 'version:proposal';
  readonly state?: CapabilityState;
  readonly diagnostic?: VersionPanelDiagnostic;
}): React.JSX.Element | null {
  if (!state && !diagnostic) return null;

  const enabled = state?.enabled === true && !diagnostic;
  const message = diagnostic?.message ?? (!state?.enabled ? state?.reason : undefined);
  const stateLabel = enabled ? 'Available' : 'Unavailable';

  return (
    <div
      className="rounded-sm border border-ss-border bg-ss-surface px-2 py-1.5 text-body-sm"
      aria-label={`${label} status`}
      data-testid={`version-${kind}-status-row`}
      data-capability={capability}
      data-state={enabled ? 'available' : 'unavailable'}
      data-diagnostic-code={diagnostic?.code}
      data-diagnostic-severity={diagnostic?.severity}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-ss-text">{label}</span>
        <span className="text-[11px] uppercase text-ss-text-tertiary">{stateLabel}</span>
      </div>
      {message ? (
        <div
          className="mt-1 text-[11px] leading-snug text-ss-text-secondary"
          data-testid={`version-${kind}-unavailable-reason`}
        >
          {message}
        </div>
      ) : null}
    </div>
  );
}

function DiffPersistenceEvidence({
  surface,
  diffState,
}: {
  readonly surface: VersionSurfaceStatus;
  readonly diffState?: CapabilityState;
}): React.JSX.Element {
  const diffEnabled = diffState?.enabled === true;
  const storageLabel = `${surface.storage.backend} ${
    surface.storage.ready ? 'ready' : 'unavailable'
  }`;
  const storageReason = !surface.storage.ready
    ? firstDiagnosticMessage(surface.storage.diagnostics)
    : undefined;
  const diffReason = !diffEnabled ? diffState?.reason : undefined;

  return (
    <div
      className="rounded-sm border border-ss-border bg-ss-surface px-2 py-1.5 text-body-sm"
      aria-label="Diff persistence evidence"
      data-testid="version-review-diff-persistence-evidence"
      data-storage-backend={surface.storage.backend}
      data-storage-ready={String(surface.storage.ready)}
      data-diff-enabled={String(diffEnabled)}
      data-current-head-id={surface.current.headCommitId}
    >
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium text-ss-text">Diff persistence</span>
        <span className="text-[11px] uppercase text-ss-text-tertiary">
          {diffEnabled ? 'Diff enabled' : 'Diff unavailable'}
        </span>
      </div>
      <div className="mt-1 grid grid-cols-[64px_1fr] gap-x-2 gap-y-1 text-[11px]">
        <span className="text-ss-text-secondary">Storage</span>
        <span className="text-ss-text truncate">{storageLabel}</span>
        <span className="text-ss-text-secondary">Head</span>
        <span className="font-mono text-ss-text truncate">
          {surface.current.headCommitId
            ? shortCommitId(surface.current.headCommitId)
            : 'Unavailable'}
        </span>
      </div>
      {storageReason ? (
        <div
          className="mt-1 text-[11px] leading-snug text-ss-text-secondary"
          data-testid="version-review-diff-persistence-storage-reason"
        >
          {storageReason}
        </div>
      ) : null}
      {diffReason ? (
        <div
          className="mt-1 text-[11px] leading-snug text-ss-text-secondary"
          data-testid="version-diff-unavailable-reason"
        >
          {diffReason}
        </div>
      ) : null}
    </div>
  );
}

function ReviewSummaryRow({
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
  const accessDeniedReason =
    accessDiagnostic?.state === 'denied' ? accessDiagnostic.message : undefined;
  const activationEnabled = diffEnabled && !accessDeniedReason;
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
          disabledReason: accessDeniedReason ?? diffDisabledReason,
          disabledReasonId: accessDeniedReason ? accessDiagnosticId : diffDisabledReasonId,
          describedById: accessDiagnosticId,
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

function ProposalSummaryRow({
  proposal,
  diffEnabled,
  diffDisabledReason,
  diffDisabledReasonId,
  onOpenDiff,
  acceptState,
  onAcceptProposal,
  accessDiagnostic,
}: {
  readonly proposal: AgentProposalSummary;
  readonly diffEnabled: boolean;
  readonly diffDisabledReason?: string;
  readonly diffDisabledReasonId?: string;
  readonly onOpenDiff?: (target: ReviewProposalDiffTarget) => void;
  readonly acceptState?: CapabilityState;
  readonly onAcceptProposal?: (target: ReviewProposalAcceptTarget) => void;
  readonly accessDiagnostic?: ReviewProposalAccessProjectionDiagnostic;
}): React.JSX.Element {
  const target = proposalTargetEvidence(proposal);
  const accessDiagnosticId = shouldDescribeAccessDiagnostic(accessDiagnostic)
    ? accessDiagnosticDomId('proposal', proposal.id)
    : undefined;
  const accessDeniedReason =
    accessDiagnostic?.state === 'denied' ? accessDiagnostic.message : undefined;
  const activationEnabled = diffEnabled && !accessDeniedReason;
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
          disabledReason: accessDeniedReason ?? diffDisabledReason,
          disabledReasonId: accessDeniedReason ? accessDiagnosticId : diffDisabledReasonId,
          describedById: accessDiagnosticId,
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

function AccessProjectionDiagnosticBlock({
  kind,
  diagnostic,
  diagnosticId,
}: {
  readonly kind: 'review' | 'proposal';
  readonly diagnostic?: ReviewProposalAccessProjectionDiagnostic;
  readonly diagnosticId?: string;
}): React.JSX.Element | null {
  if (!diagnostic || diagnostic.state === 'visible') return null;

  const factText = accessProjectionFactText(diagnostic);

  return (
    <div
      id={diagnosticId}
      className="mt-1 rounded-sm border border-ss-border bg-ss-surface-secondary px-2 py-1 text-[11px] leading-snug text-ss-text-secondary"
      data-testid={`version-${kind}-record-access-diagnostic`}
      data-access-projection={diagnostic.state}
      data-diagnostic-code={diagnostic.code}
      data-diagnostic-severity={diagnostic.severity}
      data-redaction-reason={diagnostic.reason}
      data-hidden-change-count={countDataAttribute(diagnostic.hiddenChangeCount)}
      data-redacted-change-count={countDataAttribute(diagnostic.redactedChangeCount)}
      data-omitted-domain-count={countDataAttribute(diagnostic.omittedDomainCount)}
    >
      <div className="font-medium text-ss-text">{accessProjectionStateLabel(diagnostic.state)}</div>
      <div>{diagnostic.message}</div>
      {factText ? <div className="mt-0.5 text-ss-text-tertiary">{factText}</div> : null}
    </div>
  );
}

function ProposalAcceptControl({
  proposal,
  acceptState,
  onAcceptProposal,
  accessDiagnostic,
}: {
  readonly proposal: AgentProposalSummary;
  readonly acceptState?: CapabilityState;
  readonly onAcceptProposal?: (target: ReviewProposalAcceptTarget) => void;
  readonly accessDiagnostic?: ReviewProposalAccessProjectionDiagnostic;
}): React.JSX.Element | null {
  if (!onAcceptProposal) return null;

  const disabledReason = proposalAcceptDisabledReason(proposal, acceptState, accessDiagnostic);
  const disabled = Boolean(disabledReason);
  const reasonId = `version-proposal-${safeRecordDomId(proposal.id)}-accept-disabled-reason`;

  return (
    <div className="flex flex-col gap-1">
      <button
        type="button"
        className="self-start rounded-sm border border-ss-border bg-ss-surface px-2 py-1 text-[11px] font-medium text-ss-text transition-colors hover:bg-ss-surface-hover focus:outline-none focus:ring-1 focus:ring-ss-primary disabled:opacity-60 disabled:hover:bg-ss-surface"
        aria-label={`Accept proposal ${proposal.title}`}
        aria-describedby={disabled ? reasonId : undefined}
        disabled={disabled}
        title={disabledReason}
        data-testid="version-proposal-accept-control"
        data-capability="version:mergeApply"
        data-state={disabled ? 'unavailable' : 'available'}
        data-proposal-id={proposal.id}
        data-proposal-revision={proposal.revision}
        data-target-head-id={proposal.targetHeadIdAtCreation}
        data-proposal-commit-id={proposal.proposalCommitId}
        onClick={() => {
          if (disabled || !proposal.proposalCommitId) return;
          onAcceptProposal({
            proposalId: proposal.id,
            expectedRevision: proposal.revision,
            expectedTargetHeadId: proposal.targetHeadIdAtCreation,
            proposalCommitId: proposal.proposalCommitId,
            targetRef: proposal.targetRef,
          });
        }}
      >
        Accept
      </button>
      {disabledReason ? (
        <div
          id={reasonId}
          className="text-[11px] leading-snug text-ss-text-secondary"
          data-testid="version-proposal-accept-disabled-reason"
        >
          {disabledReason}
        </div>
      ) : null}
    </div>
  );
}

function reviewTargetEvidence(review: WorkbookVersionReviewRecordSummary): {
  readonly label: string;
  readonly baseCommitId?: WorkbookCommitId;
  readonly headCommitId?: WorkbookCommitId;
} {
  const baseCommitId = review.baseCommitId ?? subjectBaseCommitId(review);
  const headCommitId = review.headCommitId ?? subjectHeadCommitId(review);

  if (baseCommitId && headCommitId) {
    return {
      label: `Base ${shortCommitId(baseCommitId)} · Head ${shortCommitId(headCommitId)}`,
      baseCommitId,
      headCommitId,
    };
  }

  if (review.subject.kind === 'commit') {
    return {
      label: `Commit ${shortCommitId(review.subject.commitId)}`,
      headCommitId: review.subject.commitId,
    };
  }

  if (review.subject.kind === 'proposal') {
    return {
      label: `Proposal ${review.subject.proposalId}`,
      baseCommitId,
      headCommitId,
    };
  }

  if (review.subject.kind === 'merge') {
    return { label: `Merge preview ${review.subject.mergePreviewId}` };
  }

  if (review.subject.kind === 'conflict') {
    return {
      label: `Conflict ${review.subject.conflictId} · Merge preview ${review.subject.mergePreviewId}`,
    };
  }

  return { label: review.subject.kind };
}

function proposalTargetEvidence(proposal: AgentProposalSummary): string {
  const parts = [
    `Base ${shortCommitId(proposal.baseCommitId)}`,
    `Target ${shortCommitId(proposal.targetHeadIdAtCreation)}`,
  ];
  if (proposal.proposalCommitId) {
    parts.push(`Proposal ${shortCommitId(proposal.proposalCommitId)}`);
  }
  return parts.join(' · ');
}

function subjectBaseCommitId(
  review: WorkbookVersionReviewRecordSummary,
): WorkbookCommitId | undefined {
  if (review.subject.kind === 'commitRange' || review.subject.kind === 'proposal') {
    return review.subject.baseCommitId;
  }
  return undefined;
}

function subjectHeadCommitId(
  review: WorkbookVersionReviewRecordSummary,
): WorkbookCommitId | undefined {
  if (review.subject.kind === 'commitRange' || review.subject.kind === 'proposal') {
    return review.subject.headCommitId;
  }
  return undefined;
}

function firstDiagnosticMessage(diagnostics: readonly VersionDiagnostic[]): string | undefined {
  return diagnostics[0]?.message;
}

function accessDiagnosticData(
  diagnostic: ReviewProposalAccessProjectionDiagnostic | undefined,
): Pick<
  SummaryRowDataAttributes,
  | 'accessProjection'
  | 'accessDiagnosticCode'
  | 'accessDiagnosticSeverity'
  | 'hiddenChangeCount'
  | 'redactedChangeCount'
  | 'omittedDomainCount'
> {
  if (!diagnostic) return {};
  return {
    accessProjection: diagnostic.state,
    accessDiagnosticCode: diagnostic.code,
    accessDiagnosticSeverity: diagnostic.severity,
    hiddenChangeCount: countDataAttribute(diagnostic.hiddenChangeCount),
    redactedChangeCount: countDataAttribute(diagnostic.redactedChangeCount),
    omittedDomainCount: countDataAttribute(diagnostic.omittedDomainCount),
  };
}

function proposalAcceptDisabledReason(
  proposal: AgentProposalSummary,
  acceptState: CapabilityState | undefined,
  accessDiagnostic: ReviewProposalAccessProjectionDiagnostic | undefined,
): string | undefined {
  if (!acceptState?.enabled) return acceptState?.reason ?? 'Merge apply is unavailable.';
  if (accessDiagnostic && accessDiagnostic.state !== 'visible') return accessDiagnostic.message;
  if (!proposal.proposalCommitId) return 'Proposal commit is unavailable.';
  if (proposal.status !== 'ready_for_review') return `Proposal is ${proposal.status}.`;
  return undefined;
}

function accessProjectionStateLabel(state: ReviewProposalAccessProjectionState): string {
  if (state === 'denied') return 'Diff denied';
  if (state === 'partial') return 'Diff partially hidden';
  return 'Diff visible';
}

function accessProjectionFactText(
  diagnostic: ReviewProposalAccessProjectionDiagnostic,
): string | undefined {
  const facts = [
    countLabel('Hidden', diagnostic.hiddenChangeCount),
    countLabel('Redacted', diagnostic.redactedChangeCount),
    countLabel('Domains', diagnostic.omittedDomainCount),
  ].filter((fact): fact is string => Boolean(fact));
  if (diagnostic.domains && diagnostic.domains.length > 0) {
    facts.push(`Scope ${diagnostic.domains.join(', ')}`);
  }
  return facts.length > 0 ? facts.join(' · ') : undefined;
}

function shouldDescribeAccessDiagnostic(
  diagnostic: ReviewProposalAccessProjectionDiagnostic | undefined,
): boolean {
  return Boolean(diagnostic && diagnostic.state !== 'visible');
}

function countLabel(label: string, value: number | undefined): string | undefined {
  return value === undefined ? undefined : `${label} ${value}`;
}

function countDataAttribute(value: number | undefined): string | undefined {
  return value === undefined ? undefined : String(value);
}

function accessDiagnosticDomId(kind: 'review' | 'proposal', id: string): string {
  return `version-${kind}-${safeRecordDomId(id)}-access-diagnostic`;
}

function safeRecordDomId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_-]+/g, '-');
}

function shortCommitId(id: string): string {
  return id.startsWith('commit:sha256:')
    ? id.slice('commit:sha256:'.length, 'commit:sha256:'.length + 12)
    : id;
}

function displayRefName(refName: string): string {
  return refName.startsWith('refs/heads/') ? refName.slice('refs/heads/'.length) : refName;
}
