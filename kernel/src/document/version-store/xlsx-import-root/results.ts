import type { VersionHistoryRootPolicy } from '@mog-sdk/contracts/versioning';

import type { WorkbookCommitId } from '../object-digest';
import type { VersionGraphNamespace } from '../object-store';
import type { VersionGraphStore, VersionStoreDiagnostic } from '../provider';
import type { VersionSemanticStateReaderPort } from '../semantic-state-reader';
import type { SnapshotRootByteSyncPort } from '../snapshot-root-capture';
import type { XlsxVersionImportRootProvenance } from './provenance';

export type XlsxVersionExistingGraphImportInput = {
  readonly namespace: VersionGraphNamespace;
  readonly graph: VersionGraphStore;
  readonly snapshotRootByteSyncPort: SnapshotRootByteSyncPort;
  readonly semanticStateReader: VersionSemanticStateReaderPort;
  readonly provenance: XlsxVersionImportRootProvenance;
  readonly createdAt: string;
  readonly historyRootPolicy?: VersionHistoryRootPolicy;
};

export type XlsxVersionExistingGraphImportResult =
  | {
      readonly status: 'committed';
      readonly commitId: WorkbookCommitId;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    }
  | {
      readonly status: 'unchanged' | 'skipped';
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    }
  | {
      readonly status: 'failed';
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };
