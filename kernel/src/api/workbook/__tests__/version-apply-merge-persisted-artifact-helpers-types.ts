import type { VersionHead, Workbook, WorkbookCommitSummary } from '@mog-sdk/contracts/api';

import type { VersionGraphNamespace } from '../../../document/version-store/object-store';
import type {
  createInMemoryVersionStoreProvider,
  VersionDocumentScope,
} from '../../../document/version-store/provider';

export type CellEdit = {
  readonly cell: string;
  readonly value: string;
};

export type PersistedMergeScenarioOptions = {
  readonly graphId: string;
  readonly branchName: string;
  readonly ours: readonly CellEdit[];
  readonly theirs: readonly CellEdit[];
  readonly applyMergeService?: unknown;
};

export type PersistedMergeScenario = {
  readonly graphId: string;
  readonly documentScope: VersionDocumentScope;
  readonly namespace: VersionGraphNamespace;
  readonly provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
  readonly sourceWb: Workbook;
  readonly branchWb: Workbook;
  readonly baseCommit: WorkbookCommitSummary;
  readonly oursCommit: WorkbookCommitSummary;
  readonly theirsCommit: WorkbookCommitSummary;
  readonly expectedTargetHead: {
    readonly commitId: WorkbookCommitSummary['id'];
    readonly revision: NonNullable<VersionHead['refRevision']>;
  };
  readonly openMergedWorkbook: () => Promise<Workbook>;
  readonly cleanup: () => Promise<void>;
};
