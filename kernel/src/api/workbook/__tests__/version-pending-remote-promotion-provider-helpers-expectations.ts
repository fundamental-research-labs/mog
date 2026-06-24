import { expect } from '@jest/globals';

import type { WorkbookCommitId } from '../../../document/version-store/object-digest';
import type { PendingRemoteSegmentStore } from '../../../document/version-store/pending-remote-segment-store';
import type { VersionGraphStore } from '../../../document/version-store/provider';
import type { RefVersion } from '../../../document/version-store/refs/ref-store';
import type { PendingSegmentFixture } from './version-pending-remote-promotion-provider-helpers-pending-segments';

export async function expectReadHeadSuccess(graph: VersionGraphStore): Promise<{
  readonly commitId: WorkbookCommitId;
  readonly revision: RefVersion;
}> {
  const result = await graph.readHead();
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected readHead success: ${result.diagnostics[0]?.code}`);
  }
  return { commitId: result.main.commitId, revision: result.main.revision };
}

export async function expectGraphHead(
  graph: VersionGraphStore,
  expected: { readonly commitId: WorkbookCommitId; readonly revision: RefVersion },
): Promise<void> {
  const result = await expectReadHeadSuccess(graph);
  expect(result).toEqual(expected);
}

export async function expectBlockedPromotion(
  result: any,
  graph: VersionGraphStore,
  store: PendingRemoteSegmentStore,
  fixture: PendingSegmentFixture,
  headBefore: { readonly commitId: WorkbookCommitId; readonly revision: RefVersion },
  reason: string,
): Promise<void> {
  expect(result).toMatchObject({
    ok: true,
    value: {
      status: 'failed',
      promotedSegmentIds: [],
      commitIds: [],
      skipped: [{ segmentId: fixture.input.pendingRemoteSegmentId, reason }],
      diagnostics: [expect.objectContaining({ reason })],
    },
  });
  await expectGraphHead(graph, headBefore);
  await expect(store.readBySegmentId(fixture.input.pendingRemoteSegmentId)).resolves.toMatchObject({
    status: 'found',
    record: { state: 'pending' },
  });
}

export function expectSingleCommit(commitIds: readonly WorkbookCommitId[]): WorkbookCommitId {
  expect(commitIds).toHaveLength(1);
  const commitId = commitIds[0];
  if (commitId === undefined) throw new Error('expected single commit id');
  return commitId;
}
