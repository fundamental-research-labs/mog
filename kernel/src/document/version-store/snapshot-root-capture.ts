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

  const decoded = decodeBase64Strict(payload.bytes, `${path}.bytes`);
  if (decoded.byteLength !== byteLength) {
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
  return decodeBase64Strict(validateYrsFullStateSnapshotRootPayload(payload).bytes);
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
  if (
    !Array.isArray(record.preimage.dependencies) ||
    record.preimage.dependencies.length !== 0
  ) {
    throw invalidRecord(
      'Yrs full-state snapshot root records must not declare dependencies.',
      'record.preimage.dependencies',
    );
  }

  validateYrsFullStateSnapshotRootPayload(record.preimage.payload, 'record.preimage.payload');
  return record as WorkbookSnapshotRootRecord;
}

export function decodeWorkbookSnapshotRootRecord(record: VersionObjectRecord<unknown>): Uint8Array {
  return decodeYrsFullStateSnapshotRootPayload(
    validateWorkbookSnapshotRootRecord(record).preimage.payload,
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

const BASE64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.byteLength; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

function decodeBase64Strict(value: string, path = 'snapshotRoot.bytes'): Uint8Array {
  if (value.length === 0 || value.length % 4 !== 0 || !BASE64_RE.test(value)) {
    throw invalidPayload('Snapshot root payload bytes must be canonical base64.', path);
  }

  let binary: string;
  try {
    binary = atob(value);
  } catch {
    throw invalidPayload('Snapshot root payload bytes must be canonical base64.', path);
  }

  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index++) {
    bytes[index] = binary.charCodeAt(index);
  }

  if (bytesToBase64(bytes) !== value) {
    throw invalidPayload('Snapshot root payload bytes must use canonical base64 padding.', path);
  }

  return bytes;
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
