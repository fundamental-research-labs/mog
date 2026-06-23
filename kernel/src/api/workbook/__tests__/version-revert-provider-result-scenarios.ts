import { expect, it, jest } from '@jest/globals';
import type { VersionRevertInput, VersionRevertResult } from '@mog-sdk/contracts/api';

import {
  COMMIT_A,
  COMMIT_B,
  COMMIT_C,
  COMMIT_D,
  MAIN_REF,
  MAIN_REVISION,
  STALE_MAIN_REVISION,
  workbookVersionWithRevertService,
} from './version-revert-test-utils';

export function registerRevertProviderResultScenarios(): void {
  it('delegates merge commit revert with the selected mainline parent', async () => {
    const input = {
      target: { kind: 'mergeCommit', commitId: COMMIT_C, mainlineParent: 2 },
      targetRef: MAIN_REF,
      expectedTargetHead: { commitId: COMMIT_B, revision: MAIN_REVISION },
      reason: 'undo-merge',
    } satisfies VersionRevertInput;
    const providerResult: VersionRevertResult = {
      schemaVersion: 1,
      status: 'applied',
      target: input.target,
      commitRef: {
        id: COMMIT_D,
        refName: MAIN_REF,
        refRevision: STALE_MAIN_REVISION,
      },
      reviewInvalidationIds: ['review-merge-2'],
      diagnostics: [],
      mutationGuarantee: 'revert-commit-created',
    };
    const revert = jest.fn(async () => providerResult);
    const readRef = jest.fn(async () => ({
      ref: { name: MAIN_REF, commitId: COMMIT_B, revision: MAIN_REVISION },
    }));
    const version = workbookVersionWithRevertService(revert, { readService: { readRef } });

    await expect(version.revert(input, { includeDiagnostics: true })).resolves.toStrictEqual({
      ok: true,
      value: providerResult,
    });
    expect(readRef).toHaveBeenCalledWith(MAIN_REF);
    expect(revert).toHaveBeenCalledWith(input, { includeDiagnostics: true });
  });

  it('preserves range revert conflict diagnostics returned by the provider', async () => {
    const input = {
      target: { kind: 'range', baseCommitId: COMMIT_A, headCommitId: COMMIT_C },
    } satisfies VersionRevertInput;
    const revert = jest.fn(async () => ({
      schemaVersion: 1,
      status: 'requires-review',
      target: input.target,
      diagnostics: [
        {
          issueCode: 'VERSION_REVERT_CONFLICT',
          severity: 'error',
          recoverability: 'retry',
          messageTemplateId: 'version.revert.VERSION_REVERT_CONFLICT',
          safeMessage: 'Range revert requires conflict review.',
          payload: {
            operation: 'revert',
            conflictKind: 'same-property',
            rangeConflictCount: 2,
            secret: 'do-not-leak',
          },
          redacted: true,
          mutationGuarantee: 'ref-not-mutated',
        },
      ],
      mutationGuarantee: 'ref-not-mutated',
    }));
    const version = workbookVersionWithRevertService(revert);

    const result = await version.revert(input, { dryRun: true });
    expect(result).toMatchObject({
      ok: true,
      value: {
        status: 'requires-review',
        target: input.target,
        diagnostics: [
          expect.objectContaining({
            issueCode: 'VERSION_REVERT_CONFLICT',
            recoverability: 'retry',
            safeMessage: 'Range revert requires conflict review.',
            payload: expect.objectContaining({
              operation: 'revert',
              targetKind: 'range',
              conflictKind: 'same-property',
              rangeConflictCount: 2,
            }),
            mutationGuarantee: 'ref-not-mutated',
          }),
        ],
        mutationGuarantee: 'ref-not-mutated',
      },
    });
    expect(JSON.stringify(result)).not.toContain('do-not-leak');
    expect(revert).toHaveBeenCalledTimes(1);
  });
}
