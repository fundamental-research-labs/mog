import { expect, it, jest } from '@jest/globals';
import type { VersionRevertInput, VersionRevertResult } from '@mog-sdk/contracts/api';

import {
  VERSION_REVERT_CAS_UNAVAILABLE_DIAGNOSTIC_CODE,
  VERSION_REVERT_PENDING_PROVIDER_WRITES_DIAGNOSTIC_CODE,
  VERSION_REVERT_STALE_HEAD_DIAGNOSTIC_CODE,
} from '../version/revert/version-revert';
import {
  COMMIT_A,
  COMMIT_B,
  COMMIT_C,
  COMMIT_D,
  MAIN_REF,
  MAIN_REVISION,
  STALE_MAIN_REVISION,
  pendingProviderWritesDirtyStatus,
  singleCommitInput,
  workbookVersionWithRevertService,
} from './version-revert-test-utils';

export function registerRevertProviderPreflightScenarios(): void {
  it('blocks apply when the target ref moved after a dry-run preview', async () => {
    const input = {
      target: { kind: 'commit', commitId: COMMIT_A },
      targetRef: MAIN_REF,
      expectedTargetHead: { commitId: COMMIT_B, revision: MAIN_REVISION },
    } satisfies VersionRevertInput;
    const preview: VersionRevertResult = {
      schemaVersion: 1,
      status: 'planned',
      target: input.target,
      diagnostics: [],
      mutationGuarantee: 'no-write-attempted',
    };
    const revert = jest.fn(async () => preview);
    const readRef = jest.fn(async () => ({
      ref: { name: MAIN_REF, commitId: COMMIT_C, revision: STALE_MAIN_REVISION },
    }));
    const version = workbookVersionWithRevertService(revert, { readService: { readRef } });

    await expect(version.revert(input, { dryRun: true })).resolves.toStrictEqual({
      ok: true,
      value: preview,
    });
    const stale = await version.revert(input, { includeDiagnostics: true });

    expect(stale).toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.revert',
        diagnostics: [
          expect.objectContaining({
            code: VERSION_REVERT_STALE_HEAD_DIAGNOSTIC_CODE,
            data: expect.objectContaining({
              mutationGuarantee: 'ref-not-mutated',
              payload: expect.objectContaining({
                operation: 'revert',
                reason: 'staleTargetHead',
                refName: MAIN_REF,
                expectedCommitId: COMMIT_B,
                actualCommitId: COMMIT_C,
                expectedRevision: MAIN_REVISION.value,
                actualRevision: STALE_MAIN_REVISION.value,
              }),
            }),
          }),
        ],
      },
    });
    expect(revert).toHaveBeenCalledTimes(1);
    expect(readRef).toHaveBeenCalledTimes(1);
  });

  it('blocks explicit target ref apply when target head preconditions cannot be read', async () => {
    const input = {
      target: { kind: 'commit', commitId: COMMIT_A },
      targetRef: MAIN_REF,
    } satisfies VersionRevertInput;
    const revert = jest.fn(async () => ({
      schemaVersion: 1,
      status: 'applied',
      target: input.target,
      commitRef: { id: COMMIT_D },
      diagnostics: [],
      mutationGuarantee: 'revert-commit-created',
    }));
    const version = workbookVersionWithRevertService(revert);

    await expect(version.revert(input, { includeDiagnostics: true })).resolves.toMatchObject({
      ok: false,
      error: {
        target: 'workbook.version.revert',
        diagnostics: [
          expect.objectContaining({
            code: VERSION_REVERT_CAS_UNAVAILABLE_DIAGNOSTIC_CODE,
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                operation: 'revert',
                refName: MAIN_REF,
                reason: 'target-ref-cas',
                expectedHeadProvided: false,
              }),
            }),
          }),
        ],
      },
    });
    expect(revert).not.toHaveBeenCalled();
  });

  it('blocks provider revert while pending remote writes are waiting for promotion', async () => {
    const revert = jest.fn(async () => ({
      schemaVersion: 1,
      status: 'planned',
      target: singleCommitInput().target,
      diagnostics: [],
      mutationGuarantee: 'no-write-attempted',
    }));
    const version = workbookVersionWithRevertService(revert, {
      surfaceStatusService: { readDirtyStatus: pendingProviderWritesDirtyStatus },
    });

    await expect(version.revert(singleCommitInput())).resolves.toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: VERSION_REVERT_PENDING_PROVIDER_WRITES_DIAGNOSTIC_CODE,
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                operation: 'revert',
                reason: 'pendingProviderWrites',
                pendingRemoteSegmentCount: 2,
                remoteSyncApplyActiveCount: 1,
              }),
            }),
          }),
        ],
      },
    });
    expect(revert).not.toHaveBeenCalled();
  });
}
