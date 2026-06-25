import type {
  JsonValue,
  ObjectDigest,
  PageCursor,
  Paged,
  RedactionPolicy,
  RedactionSummary,
  VersionAuthor,
  VersionDiagnostic,
  VersionResult,
  VerificationSummary,
} from './version-shared';
import type { VersionSemanticDiffPage, VersionDiffValue, WorkbookCommitId } from './version';

export type WorkbookVersionReviewStatus =
  | 'open'
  | 'approved'
  | 'changes_requested'
  | 'rejected'
  | 'applied'
  | 'superseded'
  | 'stale';

export type WorkbookVersionReviewSubject =
  | { readonly kind: 'commit'; readonly commitId: WorkbookCommitId }
  | {
      readonly kind: 'commitRange';
      readonly baseCommitId: WorkbookCommitId;
      readonly headCommitId: WorkbookCommitId;
    }
  | {
      readonly kind: 'proposal';
      readonly proposalId: string;
      readonly baseCommitId: WorkbookCommitId;
      readonly headCommitId: WorkbookCommitId;
    }
  | { readonly kind: 'merge'; readonly mergePreviewId: string }
  | {
      readonly kind: 'conflict';
      readonly mergePreviewId: string;
      readonly conflictId: string;
    };

export type WorkbookVersionReviewDecisionTarget =
  | {
      readonly kind: 'semanticChange';
      readonly changeSetDigest: ObjectDigest;
      readonly changeId: string;
      readonly entityKind: string;
      readonly entityId: string;
      readonly propertyPath: readonly string[];
      readonly derived: boolean;
    }
  | {
      readonly kind: 'conflict';
      readonly mergePreviewId: string;
      readonly conflictId: string;
      readonly entityKind: string;
      readonly entityId: string;
      readonly propertyPath: readonly string[];
    }
  | {
      readonly kind: 'proposal';
      readonly proposalId: string;
    };

export type WorkbookVersionReviewDecisionKind =
  | 'approve'
  | 'request_change'
  | 'comment'
  | 'mark_resolved';

export interface WorkbookVersionReviewDecision {
  readonly id: string;
  readonly target: WorkbookVersionReviewDecisionTarget;
  readonly decision: WorkbookVersionReviewDecisionKind;
  readonly reviewer: VersionAuthor;
  readonly body?: string;
  readonly createdAt: string;
  readonly supersedesDecisionId?: string;
  readonly metadata?: JsonValue;
}

export type WorkbookVersionReviewDecisionDraft = Omit<
  WorkbookVersionReviewDecision,
  'id' | 'createdAt'
>;

export interface WorkbookVersionReviewApprovalTarget {
  readonly targetKey: string;
  readonly target: WorkbookVersionReviewDecisionTarget;
}

export interface WorkbookVersionReviewApprovalEvidence {
  readonly schemaVersion: 1;
  readonly changeSetDigest: ObjectDigest;
  readonly baseCommitId: WorkbookCommitId;
  readonly headCommitId: WorkbookCommitId;
  readonly requiredTargets: readonly WorkbookVersionReviewApprovalTarget[];
  readonly approvedBy: VersionAuthor;
  readonly approvedAt: string;
  readonly reviewRevision: number;
}

export interface WorkbookVersionReviewRecordSummary {
  readonly id: string;
  readonly documentId: string;
  readonly subject: WorkbookVersionReviewSubject;
  readonly status: WorkbookVersionReviewStatus;
  readonly title?: string;
  readonly baseCommitId?: WorkbookCommitId;
  readonly headCommitId?: WorkbookCommitId;
  readonly proposalId?: string;
  readonly revision: number;
  readonly createdBy: VersionAuthor;
  readonly updatedAt: string;
}

export interface WorkbookVersionReviewRecord extends WorkbookVersionReviewRecordSummary {
  readonly schemaVersion: 1;
  readonly createdAt: string;
  readonly decisions: readonly WorkbookVersionReviewDecision[];
  readonly approval?: WorkbookVersionReviewApprovalEvidence;
  readonly verification?: VerificationSummary;
  readonly redaction: RedactionSummary;
  readonly diagnostics: readonly VersionDiagnostic[];
}

export interface VersionListReviewsInput {
  readonly subjectKind?: WorkbookVersionReviewSubject['kind'];
  readonly proposalId?: string;
  readonly commitId?: WorkbookCommitId;
  readonly mergePreviewId?: string;
  readonly conflictId?: string;
  readonly status?: WorkbookVersionReviewStatus;
  readonly cursor?: PageCursor;
  readonly limit?: number;
}

export interface VersionGetReviewInput {
  readonly reviewId: string;
}

export interface VersionCreateReviewInput {
  readonly clientRequestId: string;
  readonly subject: WorkbookVersionReviewSubject;
  readonly title?: string;
  readonly createdBy: VersionAuthor;
  readonly baseCommitId?: WorkbookCommitId;
  readonly headCommitId?: WorkbookCommitId;
  readonly redactionPolicy: RedactionPolicy;
}

export interface VersionAppendReviewDecisionInput {
  readonly reviewId: string;
  readonly expectedRevision: number;
  readonly clientRequestId: string;
  readonly decision: WorkbookVersionReviewDecisionDraft;
}

export interface VersionUpdateReviewStatusInput {
  readonly reviewId: string;
  readonly expectedRevision: number;
  readonly clientRequestId: string;
  readonly status: WorkbookVersionReviewStatus;
  readonly actor: VersionAuthor;
  readonly reason?: string;
}

export interface VersionGetReviewDiffInput {
  readonly reviewId?: string;
  readonly baseCommitId?: WorkbookCommitId;
  readonly headCommitId?: WorkbookCommitId;
  readonly cursor?: PageCursor;
  readonly limit?: number;
  readonly includeDerivedImpact?: boolean;
}

export interface WorkbookVersionReviewDiffEntity {
  readonly kind: string;
  readonly workbookId: string;
  readonly sheetId?: string;
  readonly id?: string;
  readonly displayRef?: string;
  readonly displayRefResolvedAt?: string;
  readonly displayRefStale?: boolean;
}

export type WorkbookVersionReviewDiffChangeKind =
  | 'create'
  | 'update'
  | 'delete'
  | 'move'
  | 'reorder';

export interface WorkbookVersionReviewDiffChange {
  readonly target: WorkbookVersionReviewDecisionTarget;
  readonly owner: string;
  readonly entity: WorkbookVersionReviewDiffEntity;
  readonly propertyPath: readonly string[];
  readonly kind: WorkbookVersionReviewDiffChangeKind;
  readonly before: VersionDiffValue;
  readonly after: VersionDiffValue;
  readonly derived: boolean;
  readonly diagnostics: readonly VersionDiagnostic[];
}

export interface WorkbookVersionReviewDiffPage {
  readonly schemaVersion: 1;
  readonly source: 'semantic-diff';
  readonly baseCommitId: WorkbookCommitId;
  readonly headCommitId: WorkbookCommitId;
  readonly changeSetDigest: ObjectDigest;
  readonly reviewId?: string;
  readonly changes: readonly WorkbookVersionReviewDiffChange[];
  readonly derivedImpact?: readonly WorkbookVersionReviewDiffChange[];
  readonly summary: {
    readonly totalChanges?: number;
    readonly authoredChanges: number;
    readonly derivedChanges: number;
    readonly redactedChanges: number;
  };
  readonly nextCursor?: PageCursor;
  readonly limit: number;
  readonly diagnostics: readonly VersionDiagnostic[];
  readonly upstreamDiff?: VersionSemanticDiffPage;
}

export interface WorkbookVersionReviewApi {
  listReviews(
    input?: VersionListReviewsInput,
  ): Promise<VersionResult<Paged<WorkbookVersionReviewRecordSummary>>>;
  getReview(input: VersionGetReviewInput): Promise<VersionResult<WorkbookVersionReviewRecord>>;
  createReview(
    input: VersionCreateReviewInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>>;
  appendReviewDecision(
    input: VersionAppendReviewDecisionInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>>;
  updateReviewStatus(
    input: VersionUpdateReviewStatusInput,
  ): Promise<VersionResult<WorkbookVersionReviewRecord>>;
  getReviewDiff(
    input: VersionGetReviewDiffInput,
  ): Promise<VersionResult<WorkbookVersionReviewDiffPage>>;
}
