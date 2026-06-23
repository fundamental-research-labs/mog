import type {
  ObjectDigest,
  VersionCommitExpectedHead,
  VersionMergeConflict,
  VersionMergeResultId,
} from '@mog-sdk/contracts/api';

import type { WorkbookVersionImpl } from '../version';
import type { VersionObjectRecord } from '../../../document/version-store/object-store';
import type { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';

export type ObjectCorruptionFixture = {
  readonly graph: Awaited<
    ReturnType<ReturnType<typeof createInMemoryVersionStoreProvider>['openGraph']>
  >;
  readonly version: WorkbookVersionImpl;
  readonly previewRecord: VersionObjectRecord<unknown>;
  readonly preview: {
    readonly resultId: VersionMergeResultId;
    readonly resultDigest: ObjectDigest;
  };
  readonly conflict: VersionMergeConflict;
  readonly expectedTargetHead: VersionCommitExpectedHead;
};
