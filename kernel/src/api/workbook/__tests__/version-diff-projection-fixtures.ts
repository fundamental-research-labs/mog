export function validSemanticPayload(label: string, changes: readonly unknown[]) {
  return {
    schemaVersion: 1,
    label,
    changes,
  };
}

export function defaultCellChange(label: string) {
  return semanticRecord({
    changeId: `${label}-cell-a1`,
    domain: 'cell',
    entityId: 'sheet-1!A1',
    propertyPath: ['value'],
    before: null,
    after: label,
    display: sheetAddressDisplay('Sheet1', 'A1'),
  });
}

export function semanticRecord(input: {
  readonly changeId: string;
  readonly domain: string;
  readonly entityId: string;
  readonly propertyPath: readonly string[];
  readonly before: unknown;
  readonly after: unknown;
  readonly display: unknown;
  readonly pageCursorOrderKey?: unknown;
}) {
  return {
    ...(input.pageCursorOrderKey ? { pageCursorOrderKey: input.pageCursorOrderKey } : {}),
    structural: {
      kind: 'metadata',
      changeId: input.changeId,
      domain: input.domain,
      entityId: input.entityId,
      propertyPath: [...input.propertyPath],
    },
    before: { kind: 'value', value: input.before },
    after: { kind: 'value', value: input.after },
    display: input.display,
  };
}

export function semanticObject(
  fields: readonly { readonly key: string; readonly value: unknown }[],
) {
  return {
    kind: 'object',
    fields: fields.map((field) => ({ key: field.key, value: field.value })),
  };
}

export function entityLabelDisplay(value: string) {
  return {
    entityLabel: { kind: 'value', value },
  };
}

export function sheetAddressDisplay(sheetName: string, address: string) {
  return {
    sheetName: { kind: 'value', value: sheetName },
    address: { kind: 'value', value: address },
  };
}

export function changeIds(
  items: readonly {
    readonly structural: { readonly kind: string; readonly changeId?: string };
  }[],
): readonly string[] {
  return items.map((item) => item.structural.changeId ?? item.structural.kind);
}
