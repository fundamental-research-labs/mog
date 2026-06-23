import type {
  AgentProposalSummary,
  VersionDiagnostic,
  VersionSurfaceStatus,
  WorkbookVersionReviewRecordSummary,
} from '@mog-sdk/contracts/api';

type VersionPanelDiagnostic = {
  readonly code: string;
  readonly severity: VersionDiagnostic['severity'];
  readonly message: string;
};

type CapabilityState =
  VersionSurfaceStatus['capabilities'][keyof VersionSurfaceStatus['capabilities']];

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
};

export interface ReviewProposalSurfaceProps {
  readonly surface?: VersionSurfaceStatus;
  readonly reviews: readonly WorkbookVersionReviewRecordSummary[];
  readonly proposals: readonly AgentProposalSummary[];
  readonly reviewDiagnostic?: VersionPanelDiagnostic;
  readonly proposalDiagnostic?: VersionPanelDiagnostic;
}

export function ReviewProposalSurface({
  surface,
  reviews,
  proposals,
  reviewDiagnostic,
  proposalDiagnostic,
}: ReviewProposalSurfaceProps): React.JSX.Element | null {
  const reviewState = surface?.capabilities['version:reviewRead'];
  const proposalState = surface?.capabilities['version:proposal'];
  const diffState = surface?.capabilities['version:diff'];
  const hasUnavailableState =
    (reviewState && !reviewState.enabled) || (proposalState && !proposalState.enabled);
  const hasContent = Boolean(
    surface ||
      reviews.length > 0 ||
      proposals.length > 0 ||
      reviewDiagnostic ||
      proposalDiagnostic,
  );

  if (!hasUnavailableState && !hasContent) return null;

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
        {reviews.map((review) => (
          <ReviewSummaryRow
            key={review.id}
            review={review}
          />
        ))}
        {proposals.map((proposal) => (
          <ProposalSummaryRow
            key={proposal.id}
            proposal={proposal}
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
}: {
  readonly review: WorkbookVersionReviewRecordSummary;
}): React.JSX.Element {
  const target = reviewTargetEvidence(review);
  return (
    <SummaryRow
      title={review.title ?? review.id}
      detail={`${review.status} · r${review.revision}`}
      evidence={target.label}
      testId="version-review-record-row"
      ariaLabel={`Review ${review.title ?? review.id} ${review.status}`}
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
      }}
    />
  );
}

function ProposalSummaryRow({
  proposal,
}: {
  readonly proposal: AgentProposalSummary;
}): React.JSX.Element {
  const target = proposalTargetEvidence(proposal);
  return (
    <SummaryRow
      title={proposal.title}
      detail={`${proposal.status} · ${displayRefName(proposal.targetRef)} · r${proposal.revision}`}
      evidence={target}
      testId="version-proposal-record-row"
      ariaLabel={`Proposal ${proposal.title} ${proposal.status}`}
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
      }}
    />
  );
}

function SummaryRow({
  title,
  detail,
  evidence,
  testId,
  ariaLabel,
  data,
}: {
  readonly title: string;
  readonly detail: string;
  readonly evidence?: string;
  readonly testId: string;
  readonly ariaLabel: string;
  readonly data: SummaryRowDataAttributes;
}): React.JSX.Element {
  return (
    <div
      className="min-w-0 border border-ss-border rounded-sm bg-ss-surface px-2 py-1.5"
      aria-label={ariaLabel}
      data-testid={testId}
      data-record-kind={data.recordKind}
      data-record-id={data.recordId}
      data-status={data.status}
      data-revision={data.revision}
      data-review-id={data.reviewId}
      data-review-status={data.reviewStatus}
      data-review-revision={data.reviewRevision}
      data-review-subject={data.reviewSubject}
      data-proposal-id={data.proposalId}
      data-proposal-status={data.proposalStatus}
      data-proposal-revision={data.proposalRevision}
      data-target-ref={data.targetRef}
      data-base-commit-id={data.baseCommitId}
      data-head-commit-id={data.headCommitId}
      data-target-head-id={data.targetHeadId}
      data-proposal-commit-id={data.proposalCommitId}
    >
      <div className="truncate text-body-sm font-medium text-ss-text">{title}</div>
      <div className="mt-0.5 truncate text-[11px] text-ss-text-secondary">{detail}</div>
      {evidence ? (
        <div className="mt-0.5 truncate font-mono text-[11px] text-ss-text-secondary">
          {evidence}
        </div>
      ) : null}
    </div>
  );
}

function reviewTargetEvidence(review: WorkbookVersionReviewRecordSummary): {
  readonly label: string;
  readonly baseCommitId?: string;
  readonly headCommitId?: string;
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

function subjectBaseCommitId(review: WorkbookVersionReviewRecordSummary): string | undefined {
  if (review.subject.kind === 'commitRange' || review.subject.kind === 'proposal') {
    return review.subject.baseCommitId;
  }
  return undefined;
}

function subjectHeadCommitId(review: WorkbookVersionReviewRecordSummary): string | undefined {
  if (review.subject.kind === 'commitRange' || review.subject.kind === 'proposal') {
    return review.subject.headCommitId;
  }
  return undefined;
}

function firstDiagnosticMessage(diagnostics: readonly VersionDiagnostic[]): string | undefined {
  return diagnostics[0]?.message;
}

function shortCommitId(id: string): string {
  return id.startsWith('commit:sha256:')
    ? id.slice('commit:sha256:'.length, 'commit:sha256:'.length + 12)
    : id;
}

function displayRefName(refName: string): string {
  return refName.startsWith('refs/heads/') ? refName.slice('refs/heads/'.length) : refName;
}
