import type { WorkbookCommitId } from '@mog-sdk/contracts/api';

import {
  TARGET_REF,
  type CleanReviewFixture,
} from './version-apply-merge-idempotency-stale-ordering-helpers-core';

export async function readTargetHeadCommitId(
  fixture: CleanReviewFixture,
): Promise<WorkbookCommitId> {
  const read = await fixture.graph.readRef(TARGET_REF);
  expect(read.status).toBe('success');
  if (read.status !== 'success' || !('commitId' in read.ref)) {
    throw new Error(`expected target ref read success: ${read.diagnostics[0]?.code}`);
  }
  return read.ref.commitId;
}
