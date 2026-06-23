import { expect } from '@jest/globals';

export function missingChangeSetCommitResult(reason: string) {
  return {
    ok: false,
    error: {
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_MISSING_CHANGE_SET',
          data: expect.objectContaining({
            mutationGuarantee: 'no-write-attempted',
            payload: expect.objectContaining({
              reason,
              pendingCapturedNormalMutationCount: 0,
              pendingUncapturedNormalMutationCount: 1,
            }),
          }),
        }),
      ],
    },
  };
}
