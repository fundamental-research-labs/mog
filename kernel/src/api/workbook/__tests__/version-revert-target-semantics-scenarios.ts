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
  singleCommitInput,
  versionWithMutationGuards,
} from './version-revert-test-utils';

export function registerRevertTargetSemanticsScenarios(): void {
  it.each([
    {
      label: 'single commit',
      input: singleCommitInput(),
      payload: { targetKind: 'commit', mainlineParent: null },
    },
    {
      label: 'commit range',
      input: {
        target: { kind: 'range', baseCommitId: COMMIT_A, headCommitId: COMMIT_B },
      } satisfies VersionRevertInput,
      payload: { targetKind: 'range', mainlineParent: null },
    },
    {
      label: 'merge commit with first-parent mainline',
      input: {
        target: { kind: 'mergeCommit', commitId: COMMIT_C, mainlineParent: 1 },
      } satisfies VersionRevertInput,
      payload: { targetKind: 'mergeCommit', mainlineParent: 1 },
    },
    {
      label: 'merge commit with second-parent mainline',
      input: {
        target: { kind: 'mergeCommit', commitId: COMMIT_C, mainlineParent: 2 },
      } satisfies VersionRevertInput,
      payload: { targetKind: 'mergeCommit', mainlineParent: 2 },
    },
  ])(
    'admits $label target semantics before the disabled revert boundary',
    async ({ input, payload }) => {
      const { version, mutationGuards } = versionWithMutationGuards(
        {},
        { attachRevertService: false },
      );

      const result = await version.revert(input, { dryRun: true, includeDiagnostics: true });

      expect(result).toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.revert',
          diagnostics: expect.arrayContaining([
            expect.objectContaining({
              code: VERSION_REVERT_UNAVAILABLE_DIAGNOSTIC_CODE,
              data: expect.objectContaining({
                mutationGuarantee: 'no-write-attempted',
                payload: expect.objectContaining({
                  operation: 'revert',
                  dependency: 'upstreamRevertContract',
                  targetKind: payload.targetKind,
                  dryRun: true,
                }),
              }),
            }),
            expect.objectContaining({
              code: VERSION_REVERT_TARGET_REJECTED_DIAGNOSTIC_CODE,
              data: expect.objectContaining({
                mutationGuarantee: 'no-write-attempted',
                payload: expect.objectContaining({
                  operation: 'revert',
                  ...payload,
                }),
              }),
            }),
          ]),
        },
      });
      expect(expectDiagnosticCodes(result)).not.toContain('VERSION_INVALID_OPTIONS');
      expectFailureDiagnosticsRedactedNoWrite(result, mutationGuards);
    },
  );
}
