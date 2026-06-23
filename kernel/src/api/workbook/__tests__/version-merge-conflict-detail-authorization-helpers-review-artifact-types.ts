import type {
  ObjectDigest,
  VersionCommitExpectedHead,
  VersionMergeConflict,
  VersionMergeResultId,
} from '@mog-sdk/contracts/api';

import type { WorkbookVersionImpl } from '../version';
import type { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';

export type ReviewFixture = {
  readonly provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
  readonly version: WorkbookVersionImpl;
  readonly preview: {
    readonly resultId: VersionMergeResultId;
    readonly resultDigest: ObjectDigest;
    readonly conflicts: readonly VersionMergeConflict[];
  };
  readonly target: VersionCommitExpectedHead;
};
