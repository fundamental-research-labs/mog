import {
  VERSION_OBJECT_SCHEMA_VERSION,
  createVersionObjectRecord,
  type VersionGraphNamespace,
} from '../object-store';
import {
  WORKBOOK_SNAPSHOT_ROOT_OBJECT_TYPE,
  createYrsFullStateSnapshotRootPayload,
  type SnapshotRootByteSyncPort,
  type WorkbookSnapshotRootRecord,
} from '../snapshot-root-capture';

export async function captureXlsxImportSnapshotRootRecord(
  namespace: VersionGraphNamespace,
  syncPort: SnapshotRootByteSyncPort,
): Promise<WorkbookSnapshotRootRecord> {
  const snapshotRootPayload = createYrsFullStateSnapshotRootPayload(
    await syncPort.encodeDiff(new Uint8Array([0])),
    'encodeDiffResult',
  );

  return createVersionObjectRecord(namespace, {
    objectType: WORKBOOK_SNAPSHOT_ROOT_OBJECT_TYPE,
    schemaVersion: VERSION_OBJECT_SCHEMA_VERSION,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload: snapshotRootPayload,
  });
}
