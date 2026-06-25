import type { DocumentByteSyncPort } from '../providers/provider';

import {
  VERSION_OBJECT_SCHEMA_VERSION,
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from './object-store';

export const WORKBOOK_SNAPSHOT_ROOT_OBJECT_TYPE = 'workbook.snapshotRoot.v1';
export const YRS_FULL_STATE_SNAPSHOT_ROOT_SCHEMA_VERSION = 1;
export const YRS_FULL_STATE_SNAPSHOT_ROOT_KIND = 'yrsFullState';
export const YRS_FULL_STATE_SNAPSHOT_ROOT_ENCODING = 'base64';
export const YRS_FULL_STATE_SNAPSHOT_ROOT_SOURCE =
  'DocumentByteSyncPort.encodeDiff(empty-state-vector-v1)';

export type YrsFullStateSnapshotRootPayload = {
  readonly schemaVersion: typeof YRS_FULL_STATE_SNAPSHOT_ROOT_SCHEMA_VERSION;
  readonly kind: typeof YRS_FULL_STATE_SNAPSHOT_ROOT_KIND;
  readonly encoding: typeof YRS_FULL_STATE_SNAPSHOT_ROOT_ENCODING;
  readonly bytes: string;
  readonly byteLength: number;
  readonly source: typeof YRS_FULL_STATE_SNAPSHOT_ROOT_SOURCE;
};

export type WorkbookSnapshotRootPayload = YrsFullStateSnapshotRootPayload;
export type WorkbookSnapshotRootRecord = VersionObjectRecord<WorkbookSnapshotRootPayload>;
export type SnapshotRootByteSyncPort = Pick<DocumentByteSyncPort, 'encodeDiff'>;

export type SnapshotRootCaptureErrorCode =
  | 'SNAPSHOT_ROOT_INVALID_BYTE_SYNC_RESULT'
  | 'SNAPSHOT_ROOT_INVALID_PAYLOAD'
  | 'SNAPSHOT_ROOT_INVALID_RECORD';

export class SnapshotRootCaptureError extends Error {
  readonly code: SnapshotRootCaptureErrorCode;
  readonly path: string;

  constructor(code: SnapshotRootCaptureErrorCode, message: string, path = 'snapshotRoot') {
    super(message);
    this.name = 'SnapshotRootCaptureError';
    this.code = code;
    this.path = path;
  }
}

export async function captureYrsFullStateSnapshotRootPayload(
  syncPort: SnapshotRootByteSyncPort,
): Promise<YrsFullStateSnapshotRootPayload> {
  const bytes = await syncPort.encodeDiff(new Uint8Array([0]));
  return createYrsFullStateSnapshotRootPayload(bytes, 'encodeDiffResult');
}

export async function captureWorkbookSnapshotRootRecord(
  namespace: VersionGraphNamespace,
  syncPort: SnapshotRootByteSyncPort,
): Promise<WorkbookSnapshotRootRecord> {
  return createWorkbookSnapshotRootRecord(
    namespace,
    await captureYrsFullStateSnapshotRootPayload(syncPort),
  );
}

export function createYrsFullStateSnapshotRootPayload(
  bytes: Uint8Array,
  path = 'bytes',
): YrsFullStateSnapshotRootPayload {
  const snapshotBytes = cloneNonEmptyBytes(bytes, path);
  return Object.freeze({
    schemaVersion: YRS_FULL_STATE_SNAPSHOT_ROOT_SCHEMA_VERSION,
    kind: YRS_FULL_STATE_SNAPSHOT_ROOT_KIND,
    encoding: YRS_FULL_STATE_SNAPSHOT_ROOT_ENCODING,
    bytes: bytesToBase64(snapshotBytes),
    byteLength: snapshotBytes.byteLength,
    source: YRS_FULL_STATE_SNAPSHOT_ROOT_SOURCE,
  });
}

export function validateYrsFullStateSnapshotRootPayload(
  payload: unknown,
  path = 'snapshotRoot',
): YrsFullStateSnapshotRootPayload {
  if (!isPlainRecord(payload)) {
    throw invalidPayload('Snapshot root payload must be an object.', path);
  }

  assertExactKeys(
    payload,
    ['schemaVersion', 'kind', 'encoding', 'bytes', 'byteLength', 'source'],
    path,
  );

  if (payload.schemaVersion !== YRS_FULL_STATE_SNAPSHOT_ROOT_SCHEMA_VERSION) {
    throw invalidPayload(
      'Snapshot root payload schema version is not supported.',
      `${path}.schemaVersion`,
    );
  }
  if (payload.kind !== YRS_FULL_STATE_SNAPSHOT_ROOT_KIND) {
    throw invalidPayload('Snapshot root payload kind is not supported.', `${path}.kind`);
  }
  if (payload.encoding !== YRS_FULL_STATE_SNAPSHOT_ROOT_ENCODING) {
    throw invalidPayload('Snapshot root payload encoding is not supported.', `${path}.encoding`);
  }
  if (payload.source !== YRS_FULL_STATE_SNAPSHOT_ROOT_SOURCE) {
    throw invalidPayload('Snapshot root payload source is not supported.', `${path}.source`);
  }
  if (typeof payload.bytes !== 'string') {
    throw invalidPayload('Snapshot root payload bytes must be a base64 string.', `${path}.bytes`);
  }
  const byteLength = payload.byteLength;
  if (!Number.isSafeInteger(byteLength) || typeof byteLength !== 'number' || byteLength <= 0) {
    throw invalidPayload(
      'Snapshot root payload byteLength must be a positive safe integer.',
      `${path}.byteLength`,
    );
  }

  const decodedByteLength = canonicalBase64DecodedByteLength(payload.bytes, `${path}.bytes`);
  if (decodedByteLength !== byteLength) {
    throw invalidPayload('Snapshot root payload byteLength does not match decoded bytes.', path);
  }

  return Object.freeze({
    schemaVersion: YRS_FULL_STATE_SNAPSHOT_ROOT_SCHEMA_VERSION,
    kind: YRS_FULL_STATE_SNAPSHOT_ROOT_KIND,
    encoding: YRS_FULL_STATE_SNAPSHOT_ROOT_ENCODING,
    bytes: payload.bytes,
    byteLength,
    source: YRS_FULL_STATE_SNAPSHOT_ROOT_SOURCE,
  });
}

export function decodeYrsFullStateSnapshotRootPayload(payload: unknown): Uint8Array {
  const validated = validateYrsFullStateSnapshotRootPayload(payload);
  return decodeCanonicalBase64Bytes(validated.bytes, validated.byteLength, 'snapshotRoot.bytes');
}

export async function createWorkbookSnapshotRootRecord(
  namespace: VersionGraphNamespace,
  payload: YrsFullStateSnapshotRootPayload,
): Promise<WorkbookSnapshotRootRecord> {
  const canonicalPayload = validateYrsFullStateSnapshotRootPayload(payload);
  return createVersionObjectRecord(namespace, {
    objectType: WORKBOOK_SNAPSHOT_ROOT_OBJECT_TYPE,
    schemaVersion: VERSION_OBJECT_SCHEMA_VERSION,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload: canonicalPayload,
  });
}

export function validateWorkbookSnapshotRootRecord(
  record: VersionObjectRecord<unknown>,
): WorkbookSnapshotRootRecord {
  if (!isPlainRecord(record) || !isPlainRecord(record.preimage)) {
    throw invalidRecord('Snapshot root record must be a version object record.');
  }

  if (record.preimage.objectType !== WORKBOOK_SNAPSHOT_ROOT_OBJECT_TYPE) {
    throw invalidRecord(
      'Snapshot root record object type is not supported.',
      'record.preimage.objectType',
    );
  }
  if (record.preimage.schemaVersion !== VERSION_OBJECT_SCHEMA_VERSION) {
    throw invalidRecord(
      'Snapshot root record schema version is not supported.',
      'record.preimage.schemaVersion',
    );
  }
  if (record.preimage.payloadEncoding !== 'mog-canonical-json-v1') {
    throw invalidRecord(
      'Snapshot root record payload encoding is not supported.',
      'record.preimage.payloadEncoding',
    );
  }
  if (!Array.isArray(record.preimage.dependencies) || record.preimage.dependencies.length !== 0) {
    throw invalidRecord(
      'Yrs full-state snapshot root records must not declare dependencies.',
      'record.preimage.dependencies',
    );
  }

  validateYrsFullStateSnapshotRootPayload(record.preimage.payload, 'record.preimage.payload');
  return record as WorkbookSnapshotRootRecord;
}

export function decodeWorkbookSnapshotRootRecord(record: VersionObjectRecord<unknown>): Uint8Array {
  const validated = validateWorkbookSnapshotRootRecord(record);
  return decodeCanonicalBase64Bytes(
    validated.preimage.payload.bytes,
    validated.preimage.payload.byteLength,
    'record.preimage.payload.bytes',
  );
}

function cloneNonEmptyBytes(bytes: Uint8Array, path: string): Uint8Array {
  if (!(bytes instanceof Uint8Array)) {
    throw new SnapshotRootCaptureError(
      'SNAPSHOT_ROOT_INVALID_BYTE_SYNC_RESULT',
      'Snapshot root capture expected encodeDiff to return Uint8Array bytes.',
      path,
    );
  }
  if (bytes.byteLength === 0) {
    throw new SnapshotRootCaptureError(
      'SNAPSHOT_ROOT_INVALID_BYTE_SYNC_RESULT',
      'Snapshot root capture requires non-empty Yrs full-state bytes.',
      path,
    );
  }
  return new Uint8Array(bytes);
}

function assertExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  const hasExactKeys =
    actual.length === expected.length && actual.every((key, index) => key === expected[index]);
  if (!hasExactKeys) {
    throw invalidPayload(
      `Snapshot root payload must have exact keys: ${expected.join(', ')}.`,
      path,
    );
  }
}

const BASE64_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
const BASE64_ENCODE_CHUNK_BYTE_LENGTH = 0x3000;

function bytesToBase64(bytes: Uint8Array): string {
  const chunks: string[] = [];
  for (let offset = 0; offset < bytes.byteLength; offset += BASE64_ENCODE_CHUNK_BYTE_LENGTH) {
    chunks.push(
      encodeBase64Chunk(
        bytes,
        offset,
        Math.min(offset + BASE64_ENCODE_CHUNK_BYTE_LENGTH, bytes.byteLength),
      ),
    );
  }
  return chunks.join('');
}

function decodeCanonicalBase64Bytes(value: string, byteLength: number, path: string): Uint8Array {
  const bytes = new Uint8Array(byteLength);
  let outputOffset = 0;

  for (let offset = 0; offset < value.length; offset += 4) {
    const first = requiredBase64Value(value.charCodeAt(offset), path);
    const second = requiredBase64Value(value.charCodeAt(offset + 1), path);
    const thirdCode = value.charCodeAt(offset + 2);
    const fourthCode = value.charCodeAt(offset + 3);
    const third = thirdCode === 61 ? 0 : requiredBase64Value(thirdCode, path);
    const fourth = fourthCode === 61 ? 0 : requiredBase64Value(fourthCode, path);

    bytes[outputOffset++] = (first << 2) | (second >> 4);
    if (thirdCode !== 61) {
      bytes[outputOffset++] = ((second & 0x0f) << 4) | (third >> 2);
    }
    if (fourthCode !== 61) {
      bytes[outputOffset++] = ((third & 0x03) << 6) | fourth;
    }
  }

  return bytes;
}

function encodeBase64Chunk(bytes: Uint8Array, start: number, end: number): string {
  let output = '';
  let index = start;
  for (; index + 2 < end; index += 3) {
    const combined = (bytes[index] << 16) | (bytes[index + 1] << 8) | bytes[index + 2];
    output +=
      BASE64_ALPHABET[(combined >> 18) & 0x3f] +
      BASE64_ALPHABET[(combined >> 12) & 0x3f] +
      BASE64_ALPHABET[(combined >> 6) & 0x3f] +
      BASE64_ALPHABET[combined & 0x3f];
  }

  const remaining = end - index;
  if (remaining === 1) {
    const first = bytes[index];
    output += BASE64_ALPHABET[first >> 2] + BASE64_ALPHABET[(first & 0x03) << 4] + '==';
  } else if (remaining === 2) {
    const combined = (bytes[index] << 8) | bytes[index + 1];
    output +=
      BASE64_ALPHABET[(combined >> 10) & 0x3f] +
      BASE64_ALPHABET[(combined >> 4) & 0x3f] +
      BASE64_ALPHABET[(combined & 0x0f) << 2] +
      '=';
  }

  return output;
}

function canonicalBase64DecodedByteLength(value: string, path: string): number {
  if (value.length === 0 || value.length % 4 !== 0) {
    throw invalidPayload('Snapshot root payload bytes must be canonical base64.', path);
  }

  let padding = 0;
  const last = value.charCodeAt(value.length - 1);
  const secondLast = value.charCodeAt(value.length - 2);
  if (last === 61) padding++;
  if (secondLast === 61) padding++;

  const dataLength = value.length - padding;
  for (let index = 0; index < dataLength; index++) {
    if (base64Value(value.charCodeAt(index)) === null) {
      throw invalidPayload('Snapshot root payload bytes must be canonical base64.', path);
    }
  }
  for (let index = dataLength; index < value.length; index++) {
    if (value.charCodeAt(index) !== 61) {
      throw invalidPayload('Snapshot root payload bytes must be canonical base64.', path);
    }
  }
  if (padding === 1 && requiredBase64Value(value.charCodeAt(value.length - 2), path) & 0x03) {
    throw invalidPayload('Snapshot root payload bytes must use canonical base64 padding.', path);
  }
  if (padding === 2 && requiredBase64Value(value.charCodeAt(value.length - 3), path) & 0x0f) {
    throw invalidPayload('Snapshot root payload bytes must use canonical base64 padding.', path);
  }

  return (value.length / 4) * 3 - padding;
}

function requiredBase64Value(charCode: number, path: string): number {
  const value = base64Value(charCode);
  if (value === null) {
    throw invalidPayload('Snapshot root payload bytes must be canonical base64.', path);
  }
  return value;
}

function base64Value(charCode: number): number | null {
  if (charCode >= 65 && charCode <= 90) return charCode - 65;
  if (charCode >= 97 && charCode <= 122) return charCode - 71;
  if (charCode >= 48 && charCode <= 57) return charCode + 4;
  if (charCode === 43) return 62;
  if (charCode === 47) return 63;
  return null;
}

function invalidPayload(message: string, path: string): SnapshotRootCaptureError {
  return new SnapshotRootCaptureError('SNAPSHOT_ROOT_INVALID_PAYLOAD', message, path);
}

function invalidRecord(message: string, path = 'record'): SnapshotRootCaptureError {
  return new SnapshotRootCaptureError('SNAPSHOT_ROOT_INVALID_RECORD', message, path);
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
