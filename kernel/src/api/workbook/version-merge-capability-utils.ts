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

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
