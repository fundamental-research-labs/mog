export const SAFE_STATUS_REVISION_RE = /^[A-Za-z0-9:._|/-]{1,512}$/;

export function isSafeCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

export function utf8Length(value: string): number {
  return new TextEncoder().encode(value.normalize('NFC')).byteLength;
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
