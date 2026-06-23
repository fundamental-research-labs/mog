import type { ObjectDigest, VersionApplyMergeResolution } from '@mog-sdk/contracts/api';

import {
  MERGE_PREVIEW_OBJECT_TYPE,
  createMergeResolutionSetArtifactRecord,
  mergeResolutionSetArtifactRef,
} from '../../../document/version-store/merge-attempt-artifacts';
import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
} from '../../../document/version-store/provider';
import { objectRecord } from './version-apply-merge-sealed-payload-helpers-records';
import type {
  PersistedConflictPreview,
  SealedPayloadVersionStoreProvider,
} from './version-apply-merge-sealed-payload-helpers-types';

export async function readStoredResolutionSetResolution(input: {
  readonly provider: SealedPayloadVersionStoreProvider;
  readonly graphId: string;
  readonly documentScope: VersionDocumentScope;
  readonly resolutionSetDigest: ObjectDigest;
  readonly index?: number;
}): Promise<Record<string, unknown>> {
  const graph = await input.provider.openGraph(
    namespaceForDocumentScope(input.documentScope, input.graphId),
    input.provider.accessContext,
  );
  const record = await graph.getObjectRecord(
    mergeResolutionSetArtifactRef(input.resolutionSetDigest),
  );
  const resolution = (
    record.preimage.payload as { readonly resolutions: readonly Record<string, unknown>[] }
  ).resolutions[input.index ?? 0];
  if (!resolution) throw new Error('expected stored resolution set entry');
  return resolution;
}

export async function expectResolutionSetArtifactMissing(input: {
  readonly provider: SealedPayloadVersionStoreProvider;
  readonly graphId: string;
  readonly documentScope: VersionDocumentScope;
  readonly resolutions: readonly VersionApplyMergeResolution[];
}): Promise<void> {
  const namespace = namespaceForDocumentScope(input.documentScope, input.graphId);
  const expectedResolutionSet = await createMergeResolutionSetArtifactRecord(
    namespace,
    input.resolutions,
  );
  const graph = await input.provider.openGraph(namespace, input.provider.accessContext);
  await expect(
    graph.hasObject(mergeResolutionSetArtifactRef(expectedResolutionSet.digest)),
  ).resolves.toBe(false);
}

export async function putWrongPreviewArtifact(input: {
  readonly provider: SealedPayloadVersionStoreProvider;
  readonly graphId: string;
  readonly documentScope: VersionDocumentScope;
  readonly preview: PersistedConflictPreview;
}): Promise<ObjectDigest> {
  const namespace = namespaceForDocumentScope(input.documentScope, input.graphId);
  const graph = await input.provider.openGraph(namespace, input.provider.accessContext);
  const record = await objectRecord(namespace, MERGE_PREVIEW_OBJECT_TYPE, {
    schemaVersion: 1,
    recordKind: 'mergePreview',
    status: 'conflicted',
    base: input.preview.base,
    ours: input.preview.ours,
    theirs: input.preview.theirs,
    changes: [],
    conflicts: input.preview.conflicts,
  });
  const persisted = await graph.putObjects([record]);
  expect(persisted).toMatchObject({ status: 'success' });
  return record.digest;
}
