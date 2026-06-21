import type {
  VersionApplyMergeResolution,
  VersionCommitExpectedHead,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionMainRefName,
  VersionMergeChange,
  VersionMergeConflict,
  VersionMergeConflictResolutionOption,
  VersionRefName,
} from '@mog-sdk/contracts/api';

import {
  createMergePreviewArtifactRecord,
  createMergeResolutionSetArtifactRecord,
  createResolvedMergeAttemptArtifactRecord,
  mergePreviewArtifactRef,
  mergeResolutionSetArtifactRef,
  mergeResultIdForPreviewDigest,
} from '../merge-attempt-artifacts';
import {
  objectDigestFromWorkbookCommitId,
  workbookCommitIdFromObjectDigest,
  type WorkbookCommitId,
} from '../object-digest';
import {
  createInMemoryVersionObjectStore,
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectPutBatchResult,
  type VersionObjectRecord,
} from '../object-store';

const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  graphId: 'graph-1',
};

const TARGET_REF = 'refs/heads/main' as VersionMainRefName;

describe('merge attempt artifact records', () => {
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
    expect(mergeResultIdForPreviewDigest(first.digest)).toBe(`merge-result:${first.digest.digest}`);

    const store = createInMemoryVersionObjectStore(NAMESPACE);
    expectSuccess(
      await store.putObjects([
        resolved,
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
  });

  it('canonicalizes conflict options and non-empty resolution-set ordering', async () => {
    const commits = await commitSet('conflict');
    const firstConflict = mergeConflict('Sheet1!A1', 'base', 'ours', 'theirs');
    const secondConflict = mergeConflict('Sheet1!B1', 'old', 'left', 'right');

    const first = await createMergePreviewArtifactRecord(NAMESPACE, {
      status: 'conflicted',
      base: commits.base.id,
      ours: commits.ours.id,
      theirs: commits.theirs.id,
      conflicts: [
        reverseConflictOptions(secondConflict),
        reverseConflictOptions(firstConflict),
      ],
    });
    const reordered = await createMergePreviewArtifactRecord(NAMESPACE, {
      status: 'conflicted',
      base: commits.base.id,
      ours: commits.ours.id,
      theirs: commits.theirs.id,
      conflicts: [firstConflict, secondConflict],
    });
    const changed = await createMergePreviewArtifactRecord(NAMESPACE, {
      status: 'conflicted',
      base: commits.base.id,
      ours: commits.ours.id,
      theirs: commits.theirs.id,
      conflicts: [mergeConflict('Sheet1!A1', 'base', 'ours', 'other'), secondConflict],
    });

    expect(first.digest).toEqual(reordered.digest);
    expect(changed.digest.digest).not.toBe(first.digest.digest);
    expect(first.preimage.payload.conflicts.map((conflict) => conflict.structural.entityId)).toEqual([
      'Sheet1!A1',
      'Sheet1!B1',
    ]);
    expect(first.preimage.payload.conflicts[0].resolutionOptions.map((option) => option.optionId)).toEqual([
      'option:Sheet1!A1:acceptBase',
      'option:Sheet1!A1:acceptOurs',
      'option:Sheet1!A1:acceptTheirs',
    ]);

    const acceptA = resolutionFor(firstConflict, 'acceptTheirs');
    const acceptB = resolutionFor(secondConflict, 'acceptOurs');
    const resolutionSet = await createMergeResolutionSetArtifactRecord(NAMESPACE, [acceptB, acceptA]);
    const reorderedResolutionSet = await createMergeResolutionSetArtifactRecord(NAMESPACE, [
      acceptA,
      acceptB,
    ]);
    const changedResolutionSet = await createMergeResolutionSetArtifactRecord(NAMESPACE, [
      resolutionFor(firstConflict, 'acceptBase'),
      acceptB,
    ]);

    expect(resolutionSet.digest).toEqual(reorderedResolutionSet.digest);
    expect(changedResolutionSet.digest.digest).not.toBe(resolutionSet.digest.digest);
    expect(resolutionSet.preimage.payload.resolutions.map((resolution) => resolution.conflictId)).toEqual([
      firstConflict.conflictId,
      secondConflict.conflictId,
    ]);

    const resolved = await createResolvedMergeAttemptArtifactRecord(NAMESPACE, {
      resultDigest: first.digest,
      resolutionSetDigest: resolutionSet.digest,
      targetRef: TARGET_REF,
      expectedTargetHead: {
        commitId: commits.ours.id,
        revision: { kind: 'counter', value: '7' },
      },
    });
    const changedTarget = await createResolvedMergeAttemptArtifactRecord(NAMESPACE, {
      resultDigest: first.digest,
      resolutionSetDigest: resolutionSet.digest,
      targetRef: 'refs/heads/other' as VersionRefName,
      expectedTargetHead: {
        commitId: commits.ours.id,
        revision: { kind: 'counter', value: '7' },
      },
    });
    expect(changedTarget.digest.digest).not.toBe(resolved.digest.digest);
  });
});

async function commitSet(label: string) {
  const base = await commitRecord(`${label}-base`);
  const ours = await commitRecord(`${label}-ours`);
  const theirs = await commitRecord(`${label}-theirs`);
  return { base, ours, theirs };
}

async function commitRecord(label: string): Promise<{
  readonly id: WorkbookCommitId;
  readonly record: VersionObjectRecord<unknown>;
}> {
  const record = await createVersionObjectRecord(NAMESPACE, {
    objectType: 'workbook.commit.v1',
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload: { label },
  });
  return { id: workbookCommitIdFromObjectDigest(record.digest), record };
}

function commitDependency(commitId: WorkbookCommitId) {
  return {
    kind: 'commit',
    commitId,
    digest: objectDigestFromWorkbookCommitId(commitId),
  };
}

function mergeChange(entityId: string, mergedValue: string): VersionMergeChange {
  return {
    structural: structural(entityId),
    base: value('base'),
    ours: value('ours'),
    theirs: value('theirs'),
    merged: value(mergedValue),
  };
}

function mergeConflict(
  entityId: string,
  baseValue: string,
  oursValue: string,
  theirsValue: string,
): VersionMergeConflict {
  const conflictId = `conflict:${entityId}`;
  const conflictDigest = `sha256:${entityId}:${baseValue}:${oursValue}:${theirsValue}`;
  return {
    conflictId,
    conflictDigest,
    conflictKind: 'same-property',
    structural: structural(entityId),
    base: value(baseValue),
    ours: value(oursValue),
    theirs: value(theirsValue),
    resolutionOptions: [
      resolutionOption(entityId, conflictId, 'acceptOurs', value(oursValue)),
      resolutionOption(entityId, conflictId, 'acceptTheirs', value(theirsValue)),
      resolutionOption(entityId, conflictId, 'acceptBase', value(baseValue)),
    ],
  };
}

function reverseConflictOptions(conflict: VersionMergeConflict): VersionMergeConflict {
  return {
    ...conflict,
    resolutionOptions: [...conflict.resolutionOptions].reverse(),
  };
}

function resolutionOption(
  entityId: string,
  conflictId: string,
  kind: VersionMergeConflictResolutionOption['kind'],
  optionValue: VersionDiffValue,
): VersionMergeConflictResolutionOption {
  return {
    optionId: `option:${entityId}:${kind}`,
    conflictId,
    kind,
    value: optionValue,
    recalcRequired: true,
  };
}

function resolutionFor(
  conflict: VersionMergeConflict,
  kind: VersionApplyMergeResolution['kind'],
): VersionApplyMergeResolution {
  const option = conflict.resolutionOptions.find((candidate) => candidate.kind === kind);
  if (!option) throw new Error(`missing option ${kind}`);
  return {
    conflictId: conflict.conflictId,
    expectedConflictDigest: conflict.conflictDigest,
    optionId: option.optionId,
    kind,
  };
}

function structural(entityId: string): VersionDiffStructuralMetadata {
  return {
    kind: 'metadata',
    changeId: `change:${entityId}`,
    domain: 'cells.values',
    entityId,
    propertyPath: ['value'],
  };
}

function value(value: string): VersionDiffValue {
  return { kind: 'value', value };
}

function expectSuccess(result: VersionObjectPutBatchResult): void {
  if (result.status !== 'success') {
    throw new Error(`expected object batch success, received ${result.status}`);
  }
}
