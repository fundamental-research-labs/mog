import {
  type PendingRemoteSegmentId,
  type PendingRemoteSegmentRecord,
  type PendingRemoteSegmentState,
  comparePendingRemoteSegmentRecords,
} from './pending-remote-segment-store';
import { decodeStoredPendingRemoteSegment } from './provider-indexeddb-pending-remote-segments-codec';

export function findBySegmentIdInStore(
  store: IDBObjectStore,
  namespaceKey: string,
  documentScopeKey: string,
  segmentId: PendingRemoteSegmentId,
): Promise<PendingRemoteSegmentRecord | null> {
  return new Promise<PendingRemoteSegmentRecord | null>((resolve, reject) => {
    const request = store.index('namespaceKey').openCursor(IDBKeyRange.only(namespaceKey));
    request.onerror = () =>
      reject(request.error ?? new Error('pending remote segment cursor failed'));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(null);
        return;
      }
      const candidate = decodeStoredPendingRemoteSegment(
        cursor.value,
        namespaceKey,
        documentScopeKey,
      );
      if (candidate?.pendingRemoteSegmentId === segmentId) {
        resolve(candidate);
        return;
      }
      cursor.continue();
    };
  });
}

export function findByStateInStore(
  store: IDBObjectStore,
  namespaceKey: string,
  documentScopeKey: string,
  state: PendingRemoteSegmentState,
): Promise<readonly PendingRemoteSegmentRecord[]> {
  return new Promise<readonly PendingRemoteSegmentRecord[]>((resolve, reject) => {
    const records: PendingRemoteSegmentRecord[] = [];
    const request = store.index('namespaceKey').openCursor(IDBKeyRange.only(namespaceKey));
    request.onerror = () =>
      reject(request.error ?? new Error('pending remote segment state cursor failed'));
    request.onsuccess = () => {
      const cursor = request.result;
      if (!cursor) {
        resolve(records);
        return;
      }
      const candidate = decodeStoredPendingRemoteSegment(
        cursor.value,
        namespaceKey,
        documentScopeKey,
      );
      if (candidate?.state === state) {
        records.push(candidate);
      }
      cursor.continue();
    };
  }).then((records) => [...records].sort(comparePendingRemoteSegmentRecords));
}
