export function formatValue(value: Record<string, unknown>) {
  return {
    kind: 'object',
    fields: Object.keys(value)
      .sort()
      .map((key) => ({ key, value: value[key] })),
  };
}
