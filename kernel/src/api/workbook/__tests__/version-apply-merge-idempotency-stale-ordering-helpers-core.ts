import type {
  ObjectDigest as PublicObjectDigest,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeChange,
  VersionMergeResultId,
  VersionRefName,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { VersionGraphWriteResult } from '../../../document/version-store/graph';
import type { ObjectDigest } from '../../../document/version-store/object-digest';
import type { VersionGraphNamespace } from '../../../document/version-store/object-store';
import type { InMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import type { VersionGraphStore } from '../../../document/version-store/provider-graph-store';
import type { WorkbookVersionImpl } from '../version';

export const DOCUMENT_ID = 'vc07-public-apply-merge-idempotency-stale-ordering';
export const DOCUMENT_RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
export const CREATED_AT = '2026-06-21T00:00:00.000Z';

export const TARGET_REF = 'refs/heads/main' as VersionMainRefName;
export const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export type VersionGraphWriteSuccess = Extract<
  VersionGraphWriteResult,
  { readonly status: 'success' }
>;
export type ApplyMergeServiceFactory = (input: {
  readonly graph: VersionGraphStore;
  readonly namespace: VersionGraphNamespace;
}) => Record<string, unknown>;
export type MergeCommitServiceInput = {
  readonly base: WorkbookCommitId;
  readonly ours: WorkbookCommitId;
  readonly theirs: WorkbookCommitId;
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly changes: readonly VersionMergeChange[];
  readonly resolutionCount: number;
  readonly resolvedMergeAttemptDigest?: ObjectDigest;
};

export type CleanPreviewMetadata = {
  readonly resultId: VersionMergeResultId;
  readonly resultDigest: PublicObjectDigest;
  readonly previewArtifactDigest: PublicObjectDigest;
};

export type CleanReviewFixture = {
  readonly provider: InMemoryVersionStoreProvider;
  readonly graph: VersionGraphStore;
  readonly namespace: VersionGraphNamespace;
  readonly version: WorkbookVersionImpl;
  readonly baseCommitId: WorkbookCommitId;
  readonly oursCommitId: WorkbookCommitId;
  readonly theirsCommitId: WorkbookCommitId;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly preview: CleanPreviewMetadata;
};
