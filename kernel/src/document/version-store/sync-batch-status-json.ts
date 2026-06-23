export function canonicalJsonStringify(value: unknown): string {
  if (value === null || typeof value === 'boolean' || typeof value === 'string') {
    return JSON.stringify(value);
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('canonical JSON number must be finite');
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJsonStringify).join(',')}]`;
  if (!isRecord(value)) throw new Error('value must be canonical JSON');
  return `{${Object.keys(value)
    .sort()
    .filter((key) => value[key] !== undefined)
    .map((key) => `${JSON.stringify(key)}:${canonicalJsonStringify(value[key])}`)
    .join(',')}}`;
}

export function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

export function optionalStringArray(value: unknown): boolean {
  return (
    value === undefined || (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  );
}

export function optionalNonNegativeInteger(value: unknown): boolean {
  return (
    value === undefined || (typeof value === 'number' && Number.isInteger(value) && value >= 0)
  );
}
