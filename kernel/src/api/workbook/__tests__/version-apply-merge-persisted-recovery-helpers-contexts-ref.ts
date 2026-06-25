import type { WorkbookCommitId } from '@mog-sdk/contracts/api';

import { CREATED_AT, TARGET_REF } from './version-apply-merge-persisted-recovery-helpers-values';

export function refReadSuccess(commitId: WorkbookCommitId) {
  return {
    status: 'success' as const,
    ref: {
      name: TARGET_REF,
      commitId,
      revision: { kind: 'counter' as const, value: '2' },
      updatedAt: CREATED_AT,
    },
    diagnostics: [],
  };
}
