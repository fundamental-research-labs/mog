import type {
  ObjectDigest,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeConflict,
  VersionRefName,
  VersionSealedResolutionPayloadRef,
  Workbook,
} from '@mog-sdk/contracts/api';

import { mergePreviewArtifactRef } from '../../../document/version-store/merge-attempt-artifacts';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
} from '../../../document/version-store/object-store';
import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';
import { REVIEW_EXTENSION_OBJECT_TYPE } from '../version/merge-review/version-merge-review-artifacts';
import {
  conflictDigestObject,
  internalSha256Digest,
} from './version-apply-merge-sealed-payload-helpers-digests';
import type {
  PersistedConflictPreview,
  SealedPayloadVersionStoreProvider,
} from './version-apply-merge-sealed-payload-helpers-types';

export async function putResolutionPayload(input: {
  readonly sourceWb: Workbook;
  readonly preview: PersistedConflictPreview;
  readonly conflict: VersionMergeConflict;
  readonly option: VersionMergeConflict['resolutionOptions'][number];
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly redactionPolicyDigest: ObjectDigest;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly domainPayloadSchema?: string;
  readonly value: any;
  readonly purpose: 'chooseValue' | 'custom';
}): Promise<VersionSealedResolutionPayloadRef> {
  const result = await input.sourceWb.version.putMergeResolutionPayload({
    resultId: input.preview.resultId,
    resultDigest: input.preview.resultDigest,
    redactionPolicyDigest: input.redactionPolicyDigest,
    conflictId: input.conflict.conflictId,
    expectedConflictDigest: conflictDigestObject(input.conflict.conflictDigest),
    optionId: input.option.optionId,
    kind: input.option.kind,
    ...(input.domainPayloadSchema ? { domainPayloadSchema: input.domainPayloadSchema } : {}),
    targetRef: input.targetRef ?? ('refs/heads/main' as VersionMainRefName),
    expectedTargetHead: input.expectedTargetHead,
    value: input.value,
    purpose: input.purpose,
  });
  if (!result.ok) throw new Error(`expected sealed payload put success: ${result.error.code}`);
  return result.value;
}

export async function putForgedResolutionPayload(input: {
  readonly provider: SealedPayloadVersionStoreProvider;
  readonly graphId: string;
  readonly documentScope: VersionDocumentScope;
  readonly preview: PersistedConflictPreview;
  readonly conflict: VersionMergeConflict;
  readonly option: VersionMergeConflict['resolutionOptions'][number];
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly redactionPolicyDigest: ObjectDigest;
  readonly dependencyResultDigest?: ObjectDigest;
  readonly value: any;
  readonly omitPayloadKeys?: readonly string[];
  readonly extraPayload?: Readonly<Record<string, unknown>>;
}): Promise<VersionSealedResolutionPayloadRef> {
  const namespace = namespaceForDocumentScope(input.documentScope, input.graphId);
  const graph = await input.provider.openGraph(namespace, input.provider.accessContext);
  const dependencyDigest = internalSha256Digest(
    input.dependencyResultDigest ?? input.preview.resultDigest,
  );
  const payload = {
    schemaVersion: 1,
    recordKind: 'mergeResolutionPayload',
    attemptId: input.preview.resultId,
    resultId: input.preview.resultId,
    resultDigest: input.preview.resultDigest,
    previewArtifactDigest: input.preview.resultDigest,
    redactionPolicyDigest: input.redactionPolicyDigest,
    conflictId: input.conflict.conflictId,
    conflictDigest: conflictDigestObject(input.conflict.conflictDigest),
    expectedConflictDigest: input.conflict.conflictDigest,
    optionId: input.option.optionId,
    kind: input.option.kind,
    targetRef: 'refs/heads/main' as VersionMainRefName,
    expectedTargetHead: input.expectedTargetHead,
    authority: payloadAuthorityForNamespace(namespace),
    purpose: 'chooseValue',
    value: input.value,
    ...(input.extraPayload ?? {}),
  };
  for (const key of input.omitPayloadKeys ?? []) delete (payload as Record<string, unknown>)[key];
  const record = await createVersionObjectRecord(namespace, {
    objectType: REVIEW_EXTENSION_OBJECT_TYPE,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [mergePreviewArtifactRef(dependencyDigest)],
    payload,
  });
  const persisted = await graph.putObjects([record]);
  expect(persisted).toMatchObject({ status: 'success' });
  return {
    schemaVersion: 1,
    kind: 'sealedResolutionPayload',
    payloadId: `merge-payload:${record.digest.digest}` as `merge-payload:${string}`,
    payloadDigest: record.digest,
    storageMode: 'serverEncrypted',
    resultId: input.preview.resultId,
    resultDigest: input.preview.resultDigest,
    conflictId: input.conflict.conflictId,
    optionId: input.option.optionId,
    resolutionKind: input.option.kind,
  };
}

function payloadAuthorityForNamespace(namespace: VersionGraphNamespace) {
  return {
    workspaceId: namespace.workspaceId ?? null,
    principalScope: namespace.principalScope ?? null,
  };
}
