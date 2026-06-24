import { expect, it } from '@jest/globals';
import type { VersionRevertInput } from '@mog-sdk/contracts/api';

import {
  VERSION_REVERT_TARGET_REJECTED_DIAGNOSTIC_CODE,
  VERSION_REVERT_UNAVAILABLE_DIAGNOSTIC_CODE,
} from '../version/revert/version-revert';
import {
  COMMIT_A,
  COMMIT_B,
  COMMIT_C,
  expectDiagnosticCodes,
  expectFailureDiagnosticsRedactedNoWrite,
  versionWithMutationGuards,
} from './version-revert-test-utils';

export function registerRevertInvalidTargetScenarios(): void {
  it.each([
    {
      label: 'single commit target with range field',
      input: {
        target: { kind: 'commit', commitId: COMMIT_A, baseCommitId: COMMIT_B },
      },
      option: 'target.baseCommitId',
    },
    {
      label: 'range target with single-commit field',
      input: {
        target: {
          kind: 'range',
          baseCommitId: COMMIT_A,
          headCommitId: COMMIT_B,
          commitId: COMMIT_C,
        },
      },
      option: 'target.commitId',
    },
    {
      label: 'merge commit target with range field',
      input: {
        target: {
          kind: 'mergeCommit',
          commitId: COMMIT_C,
          mainlineParent: 1,
          baseCommitId: COMMIT_A,
        },
      },
      option: 'target.baseCommitId',
    },
    {
      label: 'merge commit target without mainline',
      input: {
        target: { kind: 'mergeCommit', commitId: COMMIT_C },
      },
      option: 'target.mainlineParent',
    },
    {
      label: 'merge commit target with zero mainline',
      input: {
        target: { kind: 'mergeCommit', commitId: COMMIT_C, mainlineParent: 0 },
      },
      option: 'target.mainlineParent',
    },
    {
      label: 'merge commit target with fractional mainline',
      input: {
        target: { kind: 'mergeCommit', commitId: COMMIT_C, mainlineParent: 1.5 },
      },
      option: 'target.mainlineParent',
    },
  ])('rejects $label before provider access or ref mutation', async ({ input, option }) => {
    const { version, mutationGuards } = versionWithMutationGuards();

    const result = await version.revert(input as VersionRevertInput, {
      includeDiagnostics: true,
    });

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.revert',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                operation: 'revert',
                option,
              }),
            }),
          }),
        ]),
      },
    });
    expect(expectDiagnosticCodes(result)).not.toContain(VERSION_REVERT_UNAVAILABLE_DIAGNOSTIC_CODE);
    expect(expectDiagnosticCodes(result)).not.toContain(
      VERSION_REVERT_TARGET_REJECTED_DIAGNOSTIC_CODE,
    );
    expectFailureDiagnosticsRedactedNoWrite(result, mutationGuards);
  });
}
