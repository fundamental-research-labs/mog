import type {
  AgentProposalSummary,
  VersionDiagnostic,
  VersionSurfaceStatus,
  WorkbookCommitId,
  WorkbookVersionReviewRecordSummary,
} from '@mog-sdk/contracts/api';

export type VersionPanelDiagnostic = {
  readonly code: string;
  readonly severity: VersionDiagnostic['severity'];
  readonly message: string;
};

export type CapabilityState =
  VersionSurfaceStatus['capabilities'][keyof VersionSurfaceStatus['capabilities']];

export type ReviewProposalAccessProjectionState =
  | 'visible'
  | 'partial'
  | 'denied'
  | 'stale'
  | 'unavailable';

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

export type SummaryRowDataAttributes = {
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
