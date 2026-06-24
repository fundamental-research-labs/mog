import {
  type PendingRemoteSegmentRecord,
  isPendingRemoteSegmentRecord,
} from './pending-remote-segment-store';
import { cloneJson } from './provider-indexeddb/internal';
import type { StoredPendingRemoteSegment } from './provider-indexeddb-pending-remote-segments-types';

export function storedPendingRemoteSegment(
  record: PendingRemoteSegmentRecord,
): StoredPendingRemoteSegment {
  return {
    schemaVersion: 1,
    namespaceKey: record.namespaceKey,
    documentScopeKey: record.documentScopeKey,
    operation: 'pending-remote-segment',
    record: cloneJson(record),
  };
}

export function decodeStoredPendingRemoteSegment(
  value: unknown,
  namespaceKey: string,
  documentScopeKey: string,
): PendingRemoteSegmentRecord | null {
  if (
    !isRecord(value) ||
    value.schemaVersion !== 1 ||
    value.operation !== 'pending-remote-segment'
  ) {
    return null;
  }
  if (value.namespaceKey !== namespaceKey || value.documentScopeKey !== documentScopeKey) {
    return null;
  }
  return isPendingRemoteSegmentRecord(value.record) ? cloneJson(value.record) : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
