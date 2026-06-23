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
  const hasUnavailableState =
    (reviewState && !reviewState.enabled) || (proposalState && !proposalState.enabled);
  const hasContent =
    reviews.length > 0 || proposals.length > 0 || reviewDiagnostic || proposalDiagnostic;

  if (!hasUnavailableState && !hasContent) return null;

  return (
    <section
      className="border border-ss-border rounded-sm px-3 py-2 bg-ss-surface-secondary"
      aria-label="Review and proposal status"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="text-body-sm font-medium text-ss-text">Proposal review</span>
        <span className="text-[11px] leading-none uppercase text-ss-text-tertiary">
          {reviewState?.enabled || proposalState?.enabled ? 'Active' : 'Unavailable'}
        </span>
      </div>

      <div className="mt-2 flex flex-col gap-2">
        <CapabilityMessage label="Reviews" state={reviewState} diagnostic={reviewDiagnostic} />
        <CapabilityMessage label="Proposals" state={proposalState} diagnostic={proposalDiagnostic} />
        {reviews.map((review) => (
          <SummaryRow
            key={review.id}
            title={review.title ?? review.id}
            detail={`${review.status} · r${review.revision}`}
          />
        ))}
        {proposals.map((proposal) => (
          <SummaryRow
            key={proposal.id}
            title={proposal.title}
            detail={`${proposal.status} · ${displayRefName(proposal.targetRef)}`}
          />
        ))}
      </div>
    </section>
  );
}

function CapabilityMessage({
  label,
  state,
  diagnostic,
}: {
  readonly label: string;
  readonly state?: VersionSurfaceStatus['capabilities'][keyof VersionSurfaceStatus['capabilities']];
  readonly diagnostic?: VersionPanelDiagnostic;
}): React.JSX.Element | null {
  const message = diagnostic?.message ?? (!state?.enabled ? state?.reason : undefined);
  if (!message) return null;

  return (
    <div className="text-body-sm text-ss-text-secondary">
      <span className="font-medium text-ss-text">{label}:</span> {message}
    </div>
  );
}

function SummaryRow({
  title,
  detail,
}: {
  readonly title: string;
  readonly detail: string;
}): React.JSX.Element {
  return (
    <div className="min-w-0 border border-ss-border rounded-sm bg-ss-surface px-2 py-1.5">
      <div className="truncate text-body-sm font-medium text-ss-text">{title}</div>
      <div className="mt-0.5 truncate text-[11px] text-ss-text-secondary">{detail}</div>
    </div>
  );
}

function displayRefName(refName: string): string {
  return refName.startsWith('refs/heads/') ? refName.slice('refs/heads/'.length) : refName;
}
