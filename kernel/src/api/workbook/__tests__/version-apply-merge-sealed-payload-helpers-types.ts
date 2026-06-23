import type {
  ObjectDigest,
  VersionMergeResult,
  VersionMergeResultId,
} from '@mog-sdk/contracts/api';

import type { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';

export type PersistedConflictPreview = Extract<VersionMergeResult, { status: 'conflicted' }> & {
  readonly resultId: VersionMergeResultId;
  readonly resultDigest: ObjectDigest;
  readonly previewArtifactDigest: ObjectDigest;
};

export type SealedPayloadVersionStoreProvider = ReturnType<
  typeof createInMemoryVersionStoreProvider
>;
