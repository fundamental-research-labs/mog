import type { ObjectDigest } from './object-digest';
import { throwValidation } from './object-store-diagnostics';

export type CanonicalJsonValue =
  | null
  | boolean
  | number
  | string
  | readonly CanonicalJsonValue[]
  | { readonly [key: string]: CanonicalJsonValue };

export function normalizeCanonicalJsonValue(value: unknown, path: string): CanonicalJsonValue {
  if (value === null) {
    return null;
  }

  if (typeof value === 'string' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throwValidation('VERSION_INVALID_PAYLOAD', 'Canonical JSON numbers must be finite.', {
        path,
      });
    }
    if (Number.isInteger(value) && !Number.isSafeInteger(value)) {
      throwValidation('VERSION_INVALID_PAYLOAD', 'Canonical JSON integers must be safe integers.', {
        path,
      });
    }
    return Object.is(value, -0) ? 0 : value;
  }

  if (Array.isArray(value)) {
    const normalizedArray: CanonicalJsonValue[] = [];
    for (let index = 0; index < value.length; index++) {
      if (!Object.prototype.hasOwnProperty.call(value, index)) {
        throwValidation(
          'VERSION_INVALID_PAYLOAD',
          'Canonical JSON arrays must not contain holes.',
          {
            path: `${path}[${index}]`,
          },
        );
      }
      normalizedArray.push(normalizeCanonicalJsonValue(value[index], `${path}[${index}]`));
    }
    return Object.freeze(normalizedArray);
  }

  if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
    throwValidation(
      'VERSION_INVALID_PAYLOAD',
      'Canonical JSON payload contains unsupported values.',
      {
        path,
      },
    );
  }

  if (!isPlainRecord(value)) {
    throwValidation('VERSION_INVALID_PAYLOAD', 'Canonical JSON payload must use plain objects.', {
      path,
    });
  }

  const normalizedEntries: Array<readonly [string, CanonicalJsonValue]> = [];
  const seen = new Set<string>();
  for (const [key, childValue] of Object.entries(value)) {
    if (typeof childValue === 'undefined') {
      throwValidation(
        'VERSION_INVALID_PAYLOAD',
        'Canonical JSON objects must not contain undefined.',
        {
          path: `${path}.${key}`,
        },
      );
    }
    const normalizedKey = key.normalize('NFC');
    if (seen.has(normalizedKey)) {
      throwValidation(
        'VERSION_INVALID_PAYLOAD',
        'Canonical JSON object has duplicate keys after NFC normalization.',
        {
          path,
          details: { key: normalizedKey },
        },
      );
    }
    seen.add(normalizedKey);
    normalizedEntries.push([
      normalizedKey,
      normalizeCanonicalJsonValue(childValue, `${path}.${normalizedKey}`),
    ]);
  }
  normalizedEntries.sort(([left], [right]) => compareCodePointStrings(left, right));

  const normalizedRecord: Record<string, CanonicalJsonValue> = {};
  for (const [key, childValue] of normalizedEntries) {
    normalizedRecord[key] = childValue;
  }
  return Object.freeze(normalizedRecord);
}

export function canonicalJsonStringify(value: CanonicalJsonValue | unknown): string {
  const canonicalValue = normalizeCanonicalJsonValue(value, 'value');

  if (canonicalValue === null) {
    return 'null';
  }
  if (typeof canonicalValue === 'string') {
    return JSON.stringify(canonicalValue);
  }
  if (typeof canonicalValue === 'number') {
    return JSON.stringify(canonicalValue);
  }
  if (typeof canonicalValue === 'boolean') {
    return canonicalValue ? 'true' : 'false';
  }
  if (Array.isArray(canonicalValue)) {
    return `[${canonicalValue.map((item) => canonicalJsonStringify(item)).join(',')}]`;
  }

  const entries = Object.entries(canonicalValue).sort(([left], [right]) =>
    compareCodePointStrings(left, right),
  );
  return `{${entries
    .map(([key, childValue]) => `${JSON.stringify(key)}:${canonicalJsonStringify(childValue)}`)
    .join(',')}}`;
}

export function cloneBytesPayload(value: unknown, path: string): Uint8Array {
  if (value instanceof ArrayBuffer) {
    return new Uint8Array(value.slice(0));
  }
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(
      value.buffer.slice(value.byteOffset, value.byteOffset + value.byteLength),
    );
  }
  const message = 'Bytes payload must be ArrayBuffer or ArrayBufferView.';
  throwValidation('VERSION_INVALID_PAYLOAD', message, { path });
}

export function clonePayload<TPayload>(payload: TPayload): TPayload {
  if (payload instanceof Uint8Array) {
    return new Uint8Array(payload) as TPayload;
  }
  if (payload instanceof ArrayBuffer) {
    return payload.slice(0) as TPayload;
  }
  if (Array.isArray(payload)) {
    return payload.map((item) => clonePayload(item)) as TPayload;
  }
  if (isPlainRecord(payload)) {
    const cloned: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(payload)) {
      cloned[key] = clonePayload(value);
    }
    return cloned as TPayload;
  }
  return payload;
}

export async function sha256ObjectDigest(bytes: Uint8Array): Promise<ObjectDigest> {
  if (typeof globalThis.crypto?.subtle?.digest !== 'function') {
    throwValidation('VERSION_STORE_UNAVAILABLE', 'SHA-256 Web Crypto support is unavailable.');
  }
  const digestInput = new Uint8Array(bytes.byteLength);
  digestInput.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', digestInput);
  return Object.freeze({ algorithm: 'sha256', digest: bytesToHex(new Uint8Array(digest)) });
}

export function utf8Encode(value: string): Uint8Array {
  return textEncoder.encode(value);
}

export function concatBytes(...chunks: readonly Uint8Array[]): Uint8Array {
  const length = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

export function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareCodePointStrings(left: string, right: string): number {
  const leftPoints = Array.from(left);
  const rightPoints = Array.from(right);
  const length = Math.min(leftPoints.length, rightPoints.length);
  for (let index = 0; index < length; index++) {
    const leftPoint = leftPoints[index].codePointAt(0) ?? 0;
    const rightPoint = rightPoints[index].codePointAt(0) ?? 0;
    if (leftPoint !== rightPoint) {
      return leftPoint - rightPoint;
    }
  }
  return leftPoints.length - rightPoints.length;
}

const textEncoder = new TextEncoder();
