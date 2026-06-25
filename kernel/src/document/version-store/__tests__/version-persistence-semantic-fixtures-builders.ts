export function metadataChange(input: {
  readonly changeId: string;
  readonly domain: string;
  readonly entityId: string;
  readonly propertyPath: readonly string[];
  readonly after: unknown;
  readonly display?: {
    readonly address?: { readonly kind: 'value'; readonly value: string };
    readonly entityLabel?: { readonly kind: 'value'; readonly value: string };
  };
}) {
  return {
    structural: {
      kind: 'metadata',
      changeId: input.changeId,
      domain: input.domain,
      entityId: input.entityId,
      propertyPath: input.propertyPath,
    },
    before: { kind: 'value', value: null },
    after: { kind: 'value', value: input.after },
    ...(input.display ? { display: input.display } : {}),
  };
}

export function semanticObjectValue(
  fields: readonly { readonly key: string; readonly value: unknown }[],
) {
  return { kind: 'object', fields };
}
