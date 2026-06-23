import type { VersionDependencyRef } from '../object-digest';
import type { VersionObjectRecord } from '../object-store';
import {
  SnapshotRootCaptureError,
  WORKBOOK_SNAPSHOT_ROOT_OBJECT_TYPE,
  captureWorkbookSnapshotRootRecord,
  createWorkbookSnapshotRootRecord,
  createYrsFullStateSnapshotRootPayload,
  decodeWorkbookSnapshotRootRecord,
  validateWorkbookSnapshotRootRecord,
} from '../snapshot-root-capture';
import { FULL_STATE_BYTES, NAMESPACE } from './snapshot-root-capture-test-helpers';

export function registerSnapshotRootCaptureObjectRecordScenarios(): void {
  it('creates a workbook.snapshotRoot.v1 record in the supplied namespace', async () => {
    const record = await captureWorkbookSnapshotRootRecord(NAMESPACE, {
      encodeDiff: async () => FULL_STATE_BYTES,
    });

    expect(record.namespace).toEqual(NAMESPACE);
    expect(record.preimage).toMatchObject({
      objectType: WORKBOOK_SNAPSHOT_ROOT_OBJECT_TYPE,
      schemaVersion: 1,
      payloadEncoding: 'mog-canonical-json-v1',
      dependencies: [],
    });
    expect(record.preimage.payload).toEqual(
      createYrsFullStateSnapshotRootPayload(FULL_STATE_BYTES),
    );
    expect(Array.from(decodeWorkbookSnapshotRootRecord(record))).toEqual([...FULL_STATE_BYTES]);
  });

  it('validates the narrow materializable snapshot-root object-record shape', async () => {
    const record = await createWorkbookSnapshotRootRecord(
      NAMESPACE,
      createYrsFullStateSnapshotRootPayload(FULL_STATE_BYTES),
    );

    expect(validateWorkbookSnapshotRootRecord(record)).toBe(record);
    expect(() =>
      validateWorkbookSnapshotRootRecord({
        ...record,
        preimage: {
          ...record.preimage,
          objectType: 'workbook.semanticChangeSet.v1',
        },
      } as VersionObjectRecord<unknown>),
    ).toThrow(SnapshotRootCaptureError);
    expect(() =>
      validateWorkbookSnapshotRootRecord({
        ...record,
        preimage: {
          ...record.preimage,
          dependencies: [
            {
              kind: 'object',
              objectType: 'workbook.snapshotChunk.v1',
              digest: { algorithm: 'sha256', digest: 'aa'.repeat(32) },
            } satisfies VersionDependencyRef,
          ],
        },
      }),
    ).toThrow(SnapshotRootCaptureError);
  });
}
