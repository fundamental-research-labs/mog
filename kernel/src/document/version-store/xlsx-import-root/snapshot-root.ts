import type { VersionGraphNamespace } from '../object-store';
import {
  captureWorkbookSnapshotRootRecord,
  type SnapshotRootByteSyncPort,
  type WorkbookSnapshotRootRecord,
} from '../snapshot-root-capture';

export async function captureXlsxImportSnapshotRootRecord(
  namespace: VersionGraphNamespace,
  syncPort: SnapshotRootByteSyncPort,
): Promise<WorkbookSnapshotRootRecord> {
  return captureWorkbookSnapshotRootRecord(namespace, syncPort);
}
