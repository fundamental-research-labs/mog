import type { VersionAuthor } from '@mog-sdk/contracts/versioning';
import type { WorkbookCommitAnnotationSummary } from '@mog-sdk/contracts/api';

import type { ObjectDigest, VersionDependencyRef, WorkbookCommitId } from '../object-digest';
import type { VersionObjectRecord, VersionObjectStoreDiagnostic } from '../object-store';

export type WorkbookCommitCompletenessDiagnostic = {
  readonly code: string;
  readonly severity: 'info' | 'warning' | 'error';
  readonly message: string;
  readonly path?: string;
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
};

export type WorkbookCommitPayload = {
  readonly schemaVersion: 1;
  readonly documentId: string;
  readonly parentCommitIds: readonly WorkbookCommitId[];
  readonly snapshotRootDigest: ObjectDigest;
  readonly semanticChangeSetDigest: ObjectDigest;
  readonly mutationSegmentDigests?: readonly ObjectDigest[];
  readonly author: VersionAuthor;
  readonly createdAt: string;
  readonly annotation?: WorkbookCommitAnnotationSummary;
  readonly completenessDiagnostics: readonly WorkbookCommitCompletenessDiagnostic[];
  readonly redactionSummaryDigest?: ObjectDigest;
  readonly verificationSummaryDigest?: ObjectDigest;
  readonly resolvedMergeAttemptDigest?: ObjectDigest;
};

export type WorkbookCommit = {
  readonly id: WorkbookCommitId;
  readonly record: VersionObjectRecord<WorkbookCommitPayload>;
  readonly payload: WorkbookCommitPayload;
};

export type WorkbookCommitStoreDiagnosticCode =
  | 'VERSION_WRONG_DOCUMENT'
  | 'VERSION_MISSING_DEPENDENCY'
  | 'VERSION_MISSING_PARENT'
  | 'VERSION_OBJECT_STORE_FAILURE'
  | 'VERSION_INVALID_COMMIT_PAYLOAD'
  | 'VERSION_INVALID_COMMIT_ID'
  | 'VERSION_UNSUPPORTED_PARENT_COMMIT';

export type WorkbookCommitStoreDiagnostic = {
  readonly code: WorkbookCommitStoreDiagnosticCode;
  readonly severity: 'error' | 'corruption';
  readonly message: string;
  readonly documentId?: string;
  readonly expectedDocumentId?: string;
  readonly commitId?: WorkbookCommitId;
  readonly objectDigest?: ObjectDigest;
  readonly dependency?: VersionDependencyRef;
  readonly sourceDiagnostics?: readonly VersionObjectStoreDiagnostic[];
  readonly details?: Readonly<Record<string, string | number | boolean | null>>;
};

export type CreateWorkbookCommitInput = {
  readonly documentId: string;
  readonly parentCommitIds?: readonly (WorkbookCommitId | string)[];
  readonly snapshotRootRecord: VersionObjectRecord<unknown>;
  readonly semanticChangeSetRecord: VersionObjectRecord<unknown>;
  readonly mutationSegmentRecords?: readonly VersionObjectRecord<unknown>[];
  readonly author: VersionAuthor;
  readonly createdAt: string;
  readonly annotation?: WorkbookCommitAnnotationSummary;
  readonly completenessDiagnostics?: readonly WorkbookCommitCompletenessDiagnostic[];
  readonly redactionSummaryRecord?: VersionObjectRecord<unknown>;
  readonly verificationSummaryRecord?: VersionObjectRecord<unknown>;
  readonly resolvedMergeAttemptDigest?: ObjectDigest;
};

export type CreateWorkbookCommitResult =
  | {
      readonly status: 'success';
      readonly commit: WorkbookCommit;
      readonly objectBatch: readonly VersionObjectRecord<unknown>[];
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'failed';
      readonly diagnostics: readonly WorkbookCommitStoreDiagnostic[];
      readonly mutationGuarantee: 'no-objects-written';
    };

export type ReadWorkbookCommitResult =
  | {
      readonly status: 'success';
      readonly commit: WorkbookCommit;
      readonly diagnostics: readonly [];
    }
  | {
      readonly status: 'failed';
      readonly diagnostics: readonly WorkbookCommitStoreDiagnostic[];
    };
