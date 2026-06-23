import { expect } from '@jest/globals';
import type {
  VersionSealedResolutionPayloadRef,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';

import { mergeResolutionSetArtifactRef } from '../../../document/version-store/merge-attempt-artifacts';
import type { AppliedPersistedConflictMerge } from './version-apply-merge-persisted-artifact-conflict-assertion-types';
import type { PersistedMergeScenario } from './version-apply-merge-persisted-artifact-test-utils';

export async function expectPersistedResolutionSetArtifact(
  fixture: PersistedMergeScenario,
  applied: AppliedPersistedConflictMerge,
  sealedPayloadRef: VersionSealedResolutionPayloadRef,
): Promise<void> {
  const graph = await fixture.provider.openGraph(fixture.namespace, fixture.provider.accessContext);
  await expect(
    graph.getObjectRecord(mergeResolutionSetArtifactRef(applied.resolutionSetDigest)),
  ).resolves.toMatchObject({
    preimage: {
      payload: {
        resolutions: [expect.objectContaining({ sealedPayloadRef })],
      },
    },
  });
}

export async function expectMergeCommitAndResolvedCell(input: {
  readonly fixture: PersistedMergeScenario;
  readonly mergeCommitId: WorkbookCommitSummary['id'];
  readonly oursCommit: WorkbookCommitSummary;
  readonly theirsCommit: WorkbookCommitSummary;
}): Promise<void> {
  const { fixture, mergeCommitId, oursCommit, theirsCommit } = input;

  await expect(fixture.sourceWb.version.listCommits()).resolves.toMatchObject({
    ok: true,
    value: {
      items: expect.arrayContaining([
        expect.objectContaining({
          id: mergeCommitId,
          parents: [oursCommit.id, theirsCommit.id],
        }),
      ]),
    },
  });

  const mergedWb = await fixture.openMergedWorkbook();
  const checkoutMerged = await mergedWb.version.checkout({
    kind: 'commit',
    id: mergeCommitId,
  });
  if (!checkoutMerged.ok) {
    throw new Error(`expected merged checkout success: ${checkoutMerged.error.code}`);
  }
  await expect(mergedWb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'theirs' });
}
