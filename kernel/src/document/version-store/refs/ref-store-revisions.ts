import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type {
  LiveRefRecord,
  ProviderEpoch,
  RefVersion,
  TombstoneRefRecord,
  VersionDiagnostic,
  VersionErrorCode,
} from './ref-store-types';

const REF_VERSION_VALUE_RE = /^(0|[1-9][0-9]*)$/;

export class RefStoreValidationError extends Error {
  readonly code: VersionErrorCode;
  readonly diagnostics: readonly VersionDiagnostic[];

  constructor(code: VersionErrorCode, message: string, diagnostics: readonly VersionDiagnostic[]) {
    super(message);
    this.name = 'RefStoreValidationError';
    this.code = code;
    this.diagnostics = diagnostics;
  }
}

export function parseRefVersion(value: unknown, paramName = 'refVersion'): RefVersion {
  return parseRefVersionRecord(value, paramName);
}

export function normalizePersistedRefVersion(value: unknown, paramName = 'refVersion'): RefVersion {
  if (typeof value === 'string' && value.startsWith('rv:n:')) {
    return parseRefVersion({ kind: 'counter', value: value.slice('rv:n:'.length) }, paramName);
  }
  return parseRefVersion(value, paramName);
}

export function encodeRefVersionKey(refVersion: RefVersion): `rv:n:${string}` {
  const parsed = parseRefVersion(refVersion);
  return `rv:n:${parsed.value}`;
}

export function refVersionsEqual(left: RefVersion, right: RefVersion): boolean {
  return left.kind === right.kind && left.value === right.value;
}

export function nextRefVersion(current: RefVersion): RefVersion {
  const parsed = parseRefVersion(current);
  return freezeRefVersion({ kind: 'counter', value: incrementDecimalString(parsed.value) });
}

export function nextProviderEpoch(current: ProviderEpoch): ProviderEpoch {
  if (current.kind === 'counter' && REF_VERSION_VALUE_RE.test(current.value)) {
    return freezeProviderEpoch({ kind: 'counter', value: incrementDecimalString(current.value) });
  }
  return freezeProviderEpoch({ kind: 'opaque', value: `${current.value}:reused` });
}

export function freezeLiveRefRecord(record: LiveRefRecord): LiveRefRecord {
  return Object.freeze({
    ...record,
    providerEpoch: freezeProviderEpoch(record.providerEpoch),
    refVersion: freezeRefVersion(record.refVersion),
    createdBy: copyAuthor(record.createdBy),
    updatedBy: copyAuthor(record.updatedBy),
  });
}

export function freezeTombstoneRefRecord(record: TombstoneRefRecord): TombstoneRefRecord {
  return Object.freeze({
    ...record,
    previousProviderEpoch: freezeProviderEpoch(record.previousProviderEpoch),
    refVersion: freezeRefVersion(record.refVersion),
    deletedBy: copyAuthor(record.deletedBy),
    deleteDiagnostics: record.deleteDiagnostics?.map(cloneDiagnostic),
  });
}

export function cloneLiveRefRecord(record: LiveRefRecord): LiveRefRecord {
  return freezeLiveRefRecord({ ...record });
}

export function cloneTombstoneRefRecord(record: TombstoneRefRecord): TombstoneRefRecord {
  return freezeTombstoneRefRecord({ ...record });
}

export function freezeProviderEpoch(providerEpoch: ProviderEpoch): ProviderEpoch {
  return Object.freeze({ ...providerEpoch });
}

export function cloneProviderEpoch(providerEpoch: ProviderEpoch): ProviderEpoch {
  return freezeProviderEpoch(providerEpoch);
}

export function freezeRefVersion(refVersion: RefVersion): RefVersion {
  return parseRefVersionRecord(refVersion, 'refVersion');
}

export function cloneRefVersion(refVersion: RefVersion): RefVersion {
  return freezeRefVersion(refVersion);
}

export function cloneDiagnostic(item: VersionDiagnostic): VersionDiagnostic {
  return Object.freeze({
    code: item.code,
    severity: 'error',
    message: item.message,
    refName: item.refName,
    commitId: item.commitId,
    refVersion: item.refVersion === undefined ? undefined : cloneRefVersion(item.refVersion),
    refIncarnationId: item.refIncarnationId,
    previousRefIncarnationId: item.previousRefIncarnationId,
    tombstoneRefVersion:
      item.tombstoneRefVersion === undefined
        ? undefined
        : cloneRefVersion(item.tombstoneRefVersion),
    details: item.details === undefined ? undefined : Object.freeze({ ...item.details }),
  });
}

export function copyAuthor(author: VersionAuthor): VersionAuthor {
  return Object.freeze({ ...author });
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseRefVersionRecord(value: unknown, paramName: string): RefVersion {
  if (!isPlainRecord(value)) {
    throw invalidRefVersion(
      paramName,
      `${paramName} must be a structured RefVersion.`,
      'notRecord',
    );
  }
  if (value.kind !== 'counter') {
    throw invalidRefVersion(paramName, `${paramName} must use counter RefVersion kind.`, 'kind');
  }
  if (typeof value.value !== 'string') {
    throw invalidRefVersion(paramName, `${paramName} counter must be a string.`, 'counterType');
  }
  if (!REF_VERSION_VALUE_RE.test(value.value)) {
    throw invalidRefVersion(
      paramName,
      `${paramName} counter must be a non-negative base-10 integer without leading zeroes.`,
      'counterFormat',
    );
  }

  return Object.freeze({ kind: 'counter', value: value.value });
}

function invalidRefVersion(
  paramName: string,
  message: string,
  issue: string,
): RefStoreValidationError {
  return new RefStoreValidationError('invalidRefVersion', message, [
    diagnostic('invalidRefVersion', message, {
      issue,
      path: paramName,
      redacted: true,
    }),
  ]);
}

function incrementDecimalString(value: string): string {
  let carry = 1;
  let result = '';

  for (let i = value.length - 1; i >= 0; i--) {
    const digit = value.charCodeAt(i) - 48 + carry;
    if (digit === 10) {
      result = `0${result}`;
      carry = 1;
    } else {
      result = `${digit}${result}`;
      carry = 0;
    }
  }

  return carry === 1 ? `1${result}` : result;
}

function diagnostic(
  code: string,
  message: string,
  details?: Record<string, string | boolean>,
): VersionDiagnostic {
  return Object.freeze({
    code,
    severity: 'error',
    message,
    details: details === undefined ? undefined : Object.freeze({ ...details }),
  });
}
