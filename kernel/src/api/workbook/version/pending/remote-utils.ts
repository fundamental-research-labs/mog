export function isPublicPayloadValue(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

export function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
