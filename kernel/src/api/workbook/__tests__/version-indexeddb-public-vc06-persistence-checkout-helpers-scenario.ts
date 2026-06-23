import type { VersionHead, Workbook, WorkbookCommitSummary } from '@mog-sdk/contracts/api';

export type DurableCheckoutScenario = {
  readonly documentId: string;
  readonly graphId: string;
  readonly rootLabel: string;
  readonly mutate: (wb: Workbook) => Promise<void>;
  readonly expectDurableGraph: (input: {
    readonly wb: Workbook;
    readonly rootHead: VersionHead;
    readonly committed: WorkbookCommitSummary;
  }) => Promise<void>;
  readonly expectVisibleState: (wb: Workbook) => Promise<void>;
};
