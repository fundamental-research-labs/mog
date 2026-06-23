import type { PendingRemoteSegmentRecord } from './pending-remote-segment-store';

export type StoredPendingRemoteSegment = {
  readonly schemaVersion: 1;
  readonly namespaceKey: string;
  readonly documentScopeKey: string;
  readonly operation: 'pending-remote-segment';
  readonly record: PendingRemoteSegmentRecord;
};
