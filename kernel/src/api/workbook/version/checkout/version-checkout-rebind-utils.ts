const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;

type BoundMethod = (...args: readonly unknown[]) => unknown;

export function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isVersioningRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as unknown;
}

export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return isVersioningRecord(value) && typeof value.then === 'function';
}

export function isVersioningRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function isOptionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string';
}

export function toCommitId(value: unknown): string | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value) ? value : null;
}
