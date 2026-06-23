import type { PendingRemoteSegmentRecord } from './pending-remote-segment-store';
import type {
  PendingRemotePromotionGroup,
  PromotedRecoveryRecord,
} from './pending-remote-promotion-helpers-types';
import { sortPendingRemoteSegments } from './pending-remote-promotion-validation';

export function groupPendingRemoteSegments(
  records: readonly PendingRemoteSegmentRecord[],
): readonly PendingRemotePromotionGroup[] {
  const groups = new Map<string, PendingRemoteSegmentRecord[]>();
  for (const record of sortPendingRemoteSegments(records)) {
    const key = promotionGroupKey(record);
    const existing = groups.get(key);
    if (existing) existing.push(record);
    else groups.set(key, [record]);
  }
  return Object.freeze(
    [...groups.values()].map((recordsInGroup) => ({
      records: Object.freeze([...recordsInGroup]),
    })),
  );
}

export function promotedPeersForGroup(
  group: PendingRemotePromotionGroup,
  promotedRecords: readonly PromotedRecoveryRecord[],
): readonly PromotedRecoveryRecord[] {
  const first = group.records[0];
  if (!first) return [];
  const key = promotionGroupKey(first);
  return promotedRecords.filter((record) => promotionGroupKey(record) === key);
}

function promotionGroupKey(record: PendingRemoteSegmentRecord): string {
  // Grouping is conservative: explicit group id, shared commit objects/author, earliest created-at.
  const groupId = record.operationContext.groupId;
  return typeof groupId === 'string' && groupId.length > 0
    ? `group:${groupId}`
    : `segment:${record.pendingRemoteSegmentId}`;
}
