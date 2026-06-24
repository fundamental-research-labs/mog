import {
  SnapshotRootCaptureError,
  YRS_FULL_STATE_SNAPSHOT_ROOT_ENCODING,
  YRS_FULL_STATE_SNAPSHOT_ROOT_KIND,
  YRS_FULL_STATE_SNAPSHOT_ROOT_SCHEMA_VERSION,
  YRS_FULL_STATE_SNAPSHOT_ROOT_SOURCE,
  captureYrsFullStateSnapshotRootPayload,
  createYrsFullStateSnapshotRootPayload,
  decodeYrsFullStateSnapshotRootPayload,
  validateYrsFullStateSnapshotRootPayload,
  type YrsFullStateSnapshotRootPayload,
} from '../snapshot-root-capture';
import { FULL_STATE_BYTES } from './snapshot-root-capture-test-helpers';

export function registerSnapshotRootCapturePayloadScenarios(): void {
  it('creates a canonical yrs full-state payload and decodes the original bytes', () => {
    const payload = createYrsFullStateSnapshotRootPayload(FULL_STATE_BYTES);

    expect(payload).toEqual({
      schemaVersion: YRS_FULL_STATE_SNAPSHOT_ROOT_SCHEMA_VERSION,
      kind: YRS_FULL_STATE_SNAPSHOT_ROOT_KIND,
      encoding: YRS_FULL_STATE_SNAPSHOT_ROOT_ENCODING,
      bytes: 'AAEC/P3+/w==',
      byteLength: FULL_STATE_BYTES.byteLength,
      source: YRS_FULL_STATE_SNAPSHOT_ROOT_SOURCE,
    } satisfies YrsFullStateSnapshotRootPayload);
    expect(Array.from(decodeYrsFullStateSnapshotRootPayload(payload))).toEqual([
      ...FULL_STATE_BYTES,
    ]);
  });

  it('captures full-state bytes via encodeDiff(empty-state-vector-v1)', async () => {
    const returnedBytes = new Uint8Array([4, 5, 6, 7]);
    const encodeDiffCalls: Uint8Array[] = [];
    const encodeDiff = async (remoteStateVector: Uint8Array): Promise<Uint8Array> => {
      encodeDiffCalls.push(remoteStateVector);
      return returnedBytes;
    };

    const payload = await captureYrsFullStateSnapshotRootPayload({ encodeDiff });
    returnedBytes.fill(0);

    expect(encodeDiffCalls).toHaveLength(1);
    expect(Array.from(encodeDiffCalls[0])).toEqual([0]);
    expect(encodeDiffCalls[0]).toBeInstanceOf(Uint8Array);
    expect(payload.byteLength).toBe(4);
    expect(Array.from(decodeYrsFullStateSnapshotRootPayload(payload))).toEqual([4, 5, 6, 7]);
  });

  it('rejects empty or non-Uint8Array encodeDiff results', async () => {
    await expect(
      captureYrsFullStateSnapshotRootPayload({
        encodeDiff: async () => new Uint8Array(),
      }),
    ).rejects.toMatchObject({
      code: 'SNAPSHOT_ROOT_INVALID_BYTE_SYNC_RESULT',
      path: 'encodeDiffResult',
    });

    await expect(
      captureYrsFullStateSnapshotRootPayload({
        encodeDiff: async () => [1, 2, 3] as unknown as Uint8Array,
      }),
    ).rejects.toMatchObject({
      code: 'SNAPSHOT_ROOT_INVALID_BYTE_SYNC_RESULT',
      path: 'encodeDiffResult',
    });
  });

  it.each([
    ['non-object', null],
    ['missing keys', {}],
    [
      'extra key',
      {
        ...createYrsFullStateSnapshotRootPayload(FULL_STATE_BYTES),
        extra: true,
      },
    ],
    [
      'wrong schema version',
      {
        ...createYrsFullStateSnapshotRootPayload(FULL_STATE_BYTES),
        schemaVersion: 2,
      },
    ],
    [
      'wrong kind',
      {
        ...createYrsFullStateSnapshotRootPayload(FULL_STATE_BYTES),
        kind: 'workbookJson',
      },
    ],
    [
      'wrong encoding',
      {
        ...createYrsFullStateSnapshotRootPayload(FULL_STATE_BYTES),
        encoding: 'hex',
      },
    ],
    [
      'wrong source',
      {
        ...createYrsFullStateSnapshotRootPayload(FULL_STATE_BYTES),
        source: 'ProviderDoc.storageRead',
      },
    ],
    [
      'non-base64 bytes',
      {
        ...createYrsFullStateSnapshotRootPayload(FULL_STATE_BYTES),
        bytes: 'not base64',
      },
    ],
    [
      'non-canonical one-byte padding bits',
      {
        ...createYrsFullStateSnapshotRootPayload(FULL_STATE_BYTES),
        bytes: 'AB==',
        byteLength: 1,
      },
    ],
    [
      'non-canonical two-byte padding bits',
      {
        ...createYrsFullStateSnapshotRootPayload(FULL_STATE_BYTES),
        bytes: 'AAB=',
        byteLength: 2,
      },
    ],
    [
      'byte-length mismatch',
      {
        ...createYrsFullStateSnapshotRootPayload(FULL_STATE_BYTES),
        byteLength: FULL_STATE_BYTES.byteLength + 1,
      },
    ],
    [
      'zero byte length',
      {
        ...createYrsFullStateSnapshotRootPayload(FULL_STATE_BYTES),
        bytes: '',
        byteLength: 0,
      },
    ],
  ])('rejects malformed payloads: %s', (_label, payload) => {
    expect(() => validateYrsFullStateSnapshotRootPayload(payload)).toThrow(
      SnapshotRootCaptureError,
    );
  });
}
