import type { VersionMergeResultId } from '@mog-sdk/contracts/api';

import { intentIdForMergeResultId } from '../merge-apply-intent-store';
import type { PersistenceGraph } from './merge-service-persistence-graph-fixtures';

export async function expectNoIntentForReviewResult(
  graph: PersistenceGraph,
  resultId: VersionMergeResultId,
) {
  const intentId = intentIdForMergeResultId(resultId);
  if (!intentId) throw new Error('expected review result id to parse as an intent id');
  const store = await graph.provider.openMergeApplyIntentStore(graph.namespace);
  await expect(store.readByIntentId(intentId)).resolves.toMatchObject({ status: 'missing' });
}
