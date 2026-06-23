import type {
  VersionApplyMergeResolution,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionMainRefName,
  VersionMergeChange,
  VersionMergeConflict,
  VersionMergeConflictResolutionOption,
} from '@mog-sdk/contracts/api';

import {
  objectDigestFromWorkbookCommitId,
  workbookCommitIdFromObjectDigest,
  type WorkbookCommitId,
} from '../object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectPutBatchResult,
  type VersionObjectRecord,
} from '../object-store';

export const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  graphId: 'graph-1',
};

export const TARGET_REF = 'refs/heads/main' as VersionMainRefName;

export async function commitSet(label: string) {
  const base = await commitRecord(`${label}-base`);
  const ours = await commitRecord(`${label}-ours`);
  const theirs = await commitRecord(`${label}-theirs`);
  return { base, ours, theirs };
}

export async function commitRecord(label: string): Promise<{
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

export function commitDependency(commitId: WorkbookCommitId) {
  return {
    kind: 'commit',
    commitId,
    digest: objectDigestFromWorkbookCommitId(commitId),
  };
}

export function mergeChange(entityId: string, mergedValue: string): VersionMergeChange {
  return {
    structural: structural(entityId),
    base: value('base'),
    ours: value('ours'),
    theirs: value('theirs'),
    merged: value(mergedValue),
  };
}

export function mergeConflict(
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

export function reverseConflictOptions(conflict: VersionMergeConflict): VersionMergeConflict {
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

export function resolutionFor(
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

export function expectSuccess(result: VersionObjectPutBatchResult): void {
  if (result.status !== 'success') {
    throw new Error(`expected object batch success, received ${result.status}`);
  }
}
