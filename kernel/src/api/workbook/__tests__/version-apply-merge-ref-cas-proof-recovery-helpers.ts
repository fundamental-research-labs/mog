import type {
  MergeApplyIntentRecord,
  MergeApplyIntentStore,
} from '../../../document/version-store/merge-apply-intent-store';

export function createFinalizingCompleteIntent(
  record: MergeApplyIntentRecord,
): MergeApplyIntentStore['completeIntent'] {
  return async (input) => ({
    status: 'completed' as const,
    record: { ...record, state: 'finalized' as const, terminal: input.terminal },
    diagnostics: [],
  });
}
