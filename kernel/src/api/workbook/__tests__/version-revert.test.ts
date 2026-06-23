import { expect } from '@jest/globals';
import type { VersionRevertInput } from '@mog-sdk/contracts/api';

import {
  VERSION_REVERT_CAS_UNAVAILABLE_DIAGNOSTIC_CODE,
  VERSION_REVERT_STALE_HEAD_DIAGNOSTIC_CODE,
  VERSION_REVERT_TARGET_REJECTED_DIAGNOSTIC_CODE,
  VERSION_REVERT_UNAVAILABLE_DIAGNOSTIC_CODE,
} from '../version-revert';
import {
  COMMIT_A,
  COMMIT_B,
  COMMIT_C,
  MAIN_REF,
  MAIN_REVISION,
  expectDiagnosticCodes,
  expectFailureDiagnosticsRedactedNoWrite,
  singleCommitInput,
  versionWithMutationGuards,
} from './version-revert-test-utils';

describe('WorkbookVersion VC-07/00 revert semantics', () => {
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

  it('rejects stale target refs without attempting revert, commit, or ref mutation', async () => {
    const { version, mutationGuards } = versionWithMutationGuards(
      {},
      { attachRevertService: false },
    );

    const result = await version.revert(
      {
        ...singleCommitInput(),
        targetRef: MAIN_REF,
        expectedTargetHead: { commitId: COMMIT_B, revision: MAIN_REVISION },
        preflight: {
          staleHead: {
            refName: MAIN_REF,
            expectedCommitId: COMMIT_B,
            actualCommitId: COMMIT_C,
          },
        },
      },
      { includeDiagnostics: true },
    );

    expect(result).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.revert',
        diagnostics: expect.arrayContaining([
          expect.objectContaining({
            code: VERSION_REVERT_STALE_HEAD_DIAGNOSTIC_CODE,
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                operation: 'revert',
                refName: MAIN_REF,
                expectedCommitId: COMMIT_B,
                actualCommitId: COMMIT_C,
              }),
            }),
          }),
          expect.objectContaining({
            code: VERSION_REVERT_CAS_UNAVAILABLE_DIAGNOSTIC_CODE,
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                operation: 'revert',
                refName: MAIN_REF,
                reason: 'target-ref-cas',
                expectedHeadProvided: true,
              }),
            }),
          }),
        ]),
      },
    });
    expect(expectDiagnosticCodes(result)).not.toContain('VERSION_INVALID_OPTIONS');
    expectFailureDiagnosticsRedactedNoWrite(result, mutationGuards);
  });
});
