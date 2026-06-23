import type { VersionStoreDiagnostic } from '@mog-sdk/contracts/api';

import type {
  MergeResolutionSetArtifactPayload,
  ResolvedMergeAttemptArtifactPayload,
} from '../../document/version-store/merge-attempt-artifacts';

export type MergeReviewResolutionSetReadResult =
  | { readonly ok: true; readonly payload: MergeResolutionSetArtifactPayload }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export type MergeReviewResolvedAttemptReadResult =
  | { readonly ok: true; readonly payload: ResolvedMergeAttemptArtifactPayload }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export type SavedResolutionPayloadTarget = Pick<
  ResolvedMergeAttemptArtifactPayload,
  'targetRef' | 'expectedTargetHead'
>;
