import type {
  VersionBranchName,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionRecordRevision,
  VersionRefName,
  VersionStoreDiagnostic,
  WorkbookCommitId,
  WorkbookCommitRef,
} from './version';

export type VersionRevertTarget =
  | {
      readonly kind: 'commit';
      readonly commitId: WorkbookCommitId;
    }
  | {
      readonly kind: 'range';
      readonly baseCommitId: WorkbookCommitId;
      readonly headCommitId: WorkbookCommitId;
    }
  | {
      readonly kind: 'mergeCommit';
      readonly commitId: WorkbookCommitId;
      readonly mainlineParent: number;
    };

export interface VersionRevertDomainAdmission {
  readonly domain: string;
  readonly matrixRowId?: string;
  readonly reason?: string;
}

export interface VersionRevertHistoryGapAdmission {
  readonly gapId: string;
  readonly reason?: string;
}

export interface VersionRevertStaleHeadAdmission {
  readonly refName?: VersionMainRefName | VersionRefName;
  readonly expectedCommitId: WorkbookCommitId;
  readonly actualCommitId?: WorkbookCommitId;
}

export interface VersionRevertCasAdmission {
  readonly refName?: VersionMainRefName | VersionRefName;
  readonly expectedRevision?: VersionRecordRevision;
  readonly reason?: string;
}

export interface VersionRevertReviewInvalidationAdmission {
  readonly reviewId: string;
  readonly expectedRevision?: number;
  readonly reason?: string;
}

export interface VersionRevertPreflightAdmission {
  readonly unsupportedDomains?: readonly VersionRevertDomainAdmission[];
  readonly opaqueDomains?: readonly VersionRevertDomainAdmission[];
  readonly staleHead?: VersionRevertStaleHeadAdmission;
  readonly gaps?: readonly VersionRevertHistoryGapAdmission[];
  readonly cas?: VersionRevertCasAdmission;
  readonly reviewInvalidation?: readonly VersionRevertReviewInvalidationAdmission[];
}

export interface VersionRevertInput {
  readonly target: VersionRevertTarget;
  readonly targetRef?: VersionMainRefName | VersionRefName | VersionBranchName;
  readonly expectedTargetHead?: VersionCommitExpectedHead;
  readonly preflight?: VersionRevertPreflightAdmission;
  readonly clientRequestId?: string;
  readonly reason?: string;
}

export interface VersionRevertOptions {
  readonly dryRun?: boolean;
  readonly includeDiagnostics?: boolean;
}

export type VersionRevertMutationGuarantee =
  | 'no-write-attempted'
  | 'ref-not-mutated'
  | 'revert-commit-created'
  | 'unknown-after-crash';

export interface VersionRevertResult {
  readonly schemaVersion: 1;
  readonly status: 'planned' | 'applied' | 'rejected' | 'requires-review';
  readonly target: VersionRevertTarget;
  readonly commitRef?: WorkbookCommitRef;
  readonly reviewInvalidationIds?: readonly string[];
  readonly diagnostics: readonly VersionStoreDiagnostic[];
  readonly mutationGuarantee: VersionRevertMutationGuarantee;
}
