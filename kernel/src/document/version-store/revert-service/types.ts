import type { VersionRevertResult } from '@mog-sdk/contracts/api';

import type { WorkbookCommit } from '../commit-store';

export type RevertProviderFailure = {
  readonly status: 'failed';
  readonly diagnostics: readonly unknown[];
  readonly mutationGuarantee: 'no-write-attempted' | 'ref-not-mutated' | 'registry-not-visible';
  readonly retryable?: boolean;
};

export type RevertProviderResult = VersionRevertResult | RevertProviderFailure;

export type RevertPlan =
  | {
      readonly ok: true;
      readonly restoreCommit: WorkbookCommit;
      readonly commitsToInvert: readonly WorkbookCommit[];
    }
  | {
      readonly ok: false;
      readonly result: RevertProviderResult;
    };
