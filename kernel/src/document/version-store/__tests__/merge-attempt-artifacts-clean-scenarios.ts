import type { VersionCommitExpectedHead } from '@mog-sdk/contracts/api';

import {
  createMergePreviewArtifactRecord,
  createMergeResolutionSetArtifactRecord,
  createResolvedMergeAttemptArtifactRecord,
  mergePreviewArtifactRef,
  mergeResolutionSetArtifactRef,
  mergeResolutionSetV2ArtifactRef,
  mergeResultIdForPreviewDigest,
} from '../merge-attempt-artifacts';
import { createInMemoryVersionObjectStore } from '../object-store';

import {
  commitDependency,
  commitSet,
  expectSuccess,
  mergeChange,
  NAMESPACE,
  TARGET_REF,
} from './merge-attempt-artifacts-test-helpers';

export function registerMergeAttemptArtifactsCleanScenarios(): void {
  it('stores canonical clean preview, empty resolution set, and resolved-attempt artifacts', async () => {
    const commits = await commitSet('clean');
    const expectedTargetHead: VersionCommitExpectedHead = {
      commitId: commits.ours.id,
      revision: { kind: 'counter', value: '7' },
    };

    const first = await createMergePreviewArtifactRecord(NAMESPACE, {
      status: 'clean',
      base: commits.base.id,
      ours: commits.ours.id,
      theirs: commits.theirs.id,
      changes: [mergeChange('Sheet1!B1', 'theirs'), mergeChange('Sheet1!A1', 'ours')],
    });
    const reordered = await createMergePreviewArtifactRecord(NAMESPACE, {
      status: 'clean',
      base: commits.base.id,
      ours: commits.ours.id,
      theirs: commits.theirs.id,
      changes: [mergeChange('Sheet1!A1', 'ours'), mergeChange('Sheet1!B1', 'theirs')],
    });
    expect(first.digest).toEqual(reordered.digest);
    expect(first.preimage.objectType).toBe('workbook.mergePreview.v1');
    expect(first.preimage.payload.changes.map((change) => change.structural.entityId)).toEqual([
      'Sheet1!A1',
      'Sheet1!B1',
    ]);
    expect(first.preimage.dependencies).toEqual(
      expect.arrayContaining([
        commitDependency(commits.base.id),
        commitDependency(commits.ours.id),
        commitDependency(commits.theirs.id),
      ]),
    );

    const resolutionSet = await createMergeResolutionSetArtifactRecord(NAMESPACE);
    expect(resolutionSet.preimage.objectType).toBe('workbook.mergeResolutionSet.v1');
    expect(resolutionSet.preimage.payload).toEqual({
      schemaVersion: 1,
      recordKind: 'mergeResolutionSet',
      resolutions: [],
    });

    const resultId = mergeResultIdForPreviewDigest(first.digest);
    const resolutionSetV2 = await createMergeResolutionSetArtifactRecord(NAMESPACE, {
      resultId,
      resultDigest: first.digest,
      previewArtifactDigest: first.digest,
      resolutions: [],
    });
    expect(resolutionSetV2.preimage.objectType).toBe('workbook.mergeResolutionSet.v2');
    expect(resolutionSetV2.preimage.dependencies).toEqual([mergePreviewArtifactRef(first.digest)]);
    expect(resolutionSetV2.preimage.payload).toEqual({
      schemaVersion: 2,
      recordKind: 'mergeResolutionSet',
      resultId,
      resultDigest: first.digest,
      previewArtifactDigest: first.digest,
      resolutions: [],
    });

    const resolved = await createResolvedMergeAttemptArtifactRecord(NAMESPACE, {
      resultDigest: first.digest,
      resolutionSetDigest: resolutionSet.digest,
      targetRef: TARGET_REF,
      expectedTargetHead,
    });
    expect(resolved.preimage.objectType).toBe('workbook.resolvedMergeAttempt.v1');
    expect(resolved.preimage.dependencies).toEqual([
      mergePreviewArtifactRef(first.digest),
      mergeResolutionSetArtifactRef(resolutionSet.digest),
    ]);
    expect(resultId).toBe(`merge-result:${first.digest.digest}`);

    const store = createInMemoryVersionObjectStore(NAMESPACE);
    expectSuccess(
      await store.putObjects([
        resolved,
        resolutionSetV2,
        resolutionSet,
        first,
        commits.base.record,
        commits.ours.record,
        commits.theirs.record,
      ]),
    );
    await expect(store.getObject(mergePreviewArtifactRef(first.digest))).resolves.toEqual(
      first.preimage.payload,
    );
    await expect(
      store.getObject(mergeResolutionSetV2ArtifactRef(resolutionSetV2.digest)),
    ).resolves.toEqual(resolutionSetV2.preimage.payload);
  });
}
