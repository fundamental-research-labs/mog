import { expect } from '@jest/globals';

import type { VersionMergeResult, Workbook, WorkbookCommitSummary } from '@mog-sdk/contracts/api';

import {
  expectPersistedPreviewMetadata,
  MATERIALIZER_TARGET_REF,
  type PersistedMaterializerPreviewMetadata,
} from './version-apply-merge-materializer-persisted-test-utils';

type FastForwardCommits = {
  readonly oursCommit: WorkbookCommitSummary;
  readonly theirsCommit: WorkbookCommitSummary;
};

type FastForwardApplyResultInput = FastForwardCommits & {
  readonly previewMetadata: PersistedMaterializerPreviewMetadata;
};

type FastForwardStaleTerminalInput = FastForwardApplyResultInput & {
  readonly afterTerminalCommit: WorkbookCommitSummary;
};

type FastForwardCommitGraphItem = {
  readonly id: WorkbookCommitSummary['id'];
  readonly parents: WorkbookCommitSummary['parents'];
};

export function expectPersistedFastForwardPreviewResult(
  value: VersionMergeResult,
  input: FastForwardCommits,
): PersistedMaterializerPreviewMetadata {
  expect(value).toMatchObject({
    status: 'fastForward',
    ours: input.oursCommit.id,
    theirs: input.theirsCommit.id,
    resultId: expect.stringMatching(/^merge-result:[0-9a-f]{64}$/),
    resultDigest: {
      algorithm: 'sha256',
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    },
    attemptPersistence: 'persisted',
    attemptKind: 'applyable',
    targetRef: MATERIALIZER_TARGET_REF,
  });

  return expectPersistedPreviewMetadata(
    value,
    'fastForward',
    'expected fast-forward preview to expose a persisted result id and digest',
  );
}

export function expectPersistedFastForwardAppliedResult(
  value: unknown,
  input: FastForwardApplyResultInput,
): void {
  expect(value).toMatchObject({
    status: 'fastForwarded',
    ours: input.oursCommit.id,
    theirs: input.theirsCommit.id,
    commitRef: {
      id: input.theirsCommit.id,
      refName: MATERIALIZER_TARGET_REF,
      resolvedFrom: MATERIALIZER_TARGET_REF,
      refRevision: { kind: 'counter', value: '3' },
    },
    resultId: input.previewMetadata.resultId,
    resultDigest: input.previewMetadata.resultDigest,
    resolutionSetDigest: {
      algorithm: 'sha256',
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    },
    resolvedAttemptDigest: {
      algorithm: 'sha256',
      digest: expect.stringMatching(/^[0-9a-f]{64}$/),
    },
    targetRef: MATERIALIZER_TARGET_REF,
    headBefore: input.oursCommit.id,
    headAfter: input.theirsCommit.id,
    changes: [],
    resolutionCount: 0,
    mutationGuarantee: 'ref-fast-forwarded',
  });
}

export function expectPersistedFastForwardRepeatedApplyResult(
  value: unknown,
  input: FastForwardApplyResultInput,
): void {
  expect(value).toMatchObject({
    status: 'alreadyApplied',
    ours: input.oursCommit.id,
    theirs: input.theirsCommit.id,
    commitRef: {
      id: input.theirsCommit.id,
      refName: MATERIALIZER_TARGET_REF,
      resolvedFrom: MATERIALIZER_TARGET_REF,
    },
    resultId: input.previewMetadata.resultId,
    resultDigest: input.previewMetadata.resultDigest,
    targetRef: MATERIALIZER_TARGET_REF,
    headBefore: input.oursCommit.id,
    headAfter: input.theirsCommit.id,
    changes: [],
    resolutionCount: 0,
    mutationGuarantee: 'ref-not-mutated',
  });
}

export function expectPersistedFastForwardStaleTerminalResult(
  value: unknown,
  input: FastForwardStaleTerminalInput,
): void {
  expect(value).toMatchObject({
    status: 'staleTargetHead',
    ours: input.oursCommit.id,
    theirs: input.theirsCommit.id,
    resultId: input.previewMetadata.resultId,
    resultDigest: input.previewMetadata.resultDigest,
    targetRef: MATERIALIZER_TARGET_REF,
    headBefore: input.oursCommit.id,
    headAfter: input.afterTerminalCommit.id,
    changes: [],
    mutationGuarantee: 'ref-not-mutated',
  });
}

export function expectPersistedFastForwardCommitGraph(
  items: readonly FastForwardCommitGraphItem[],
  input: FastForwardCommits,
): void {
  expect(items).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: input.theirsCommit.id,
        parents: [input.oursCommit.id],
      }),
    ]),
  );
  expect(
    items.some(
      (item) =>
        item.parents[0] === input.oursCommit.id && item.parents[1] === input.theirsCommit.id,
    ),
  ).toBe(false);
}

export async function expectPersistedFastForwardCheckoutCells(workbook: Workbook): Promise<void> {
  await expect(workbook.activeSheet.getCell('A1')).resolves.toMatchObject({
    value: 'base',
  });
  await expect(workbook.activeSheet.getCell('B1')).resolves.toMatchObject({
    value: 'ours',
  });
  await expect(workbook.activeSheet.getCell('C1')).resolves.toMatchObject({
    value: 'theirs',
  });
}

export async function expectPersistedFastForwardActiveCheckoutMaterialized(
  workbook: Workbook,
  input: FastForwardCommits,
): Promise<void> {
  await expect(workbook.version.getSurfaceStatus()).resolves.toMatchObject({
    current: {
      headCommitId: input.theirsCommit.id,
      checkedOutCommitId: input.theirsCommit.id,
      branchName: 'main',
      currentRefHeadId: input.theirsCommit.id,
      refHeadAtMaterialization: input.theirsCommit.id,
      detached: false,
      stale: false,
    },
  });
  await expectPersistedFastForwardCheckoutCells(workbook);
}
