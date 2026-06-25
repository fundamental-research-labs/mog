export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

export function nested(value: unknown, key: string): Readonly<Record<string, unknown>> | null {
  if (!isRecord(value)) return null;
  const child = value[key];
  return isRecord(child) ? child : null;
}

export function arrayValue(value: unknown): readonly unknown[] | null {
  return Array.isArray(value) ? value : null;
}

export function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.length > 0 ? value : undefined;
}

export function readBoolean(
  value: Readonly<Record<string, unknown>> | null,
  keys: readonly string[],
): boolean | undefined {
  if (!value) return undefined;
  for (const key of keys) {
    if (typeof value[key] === 'boolean') return value[key] as boolean;
  }
  return undefined;
}
