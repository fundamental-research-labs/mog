export function tableFilterReviewSafeChanges() {
  return [
    semanticRecord({
      changeId: 'review-safe-table-definition',
      domain: 'tables',
      entityId: 'sheet-1!table:table-review-safe-sales',
      propertyPath: ['definition'],
      before: null,
      after: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'tableId', value: 'table-review-safe-sales' },
        { key: 'sheetId', value: 'sheet-1' },
      ]),
      display: redactedEntityLabelDisplay(),
    }),
    semanticRecord({
      changeId: 'review-safe-filter-state',
      domain: 'filters',
      entityId: 'sheet-1!filter:filter-review-safe-sales',
      propertyPath: ['state'],
      before: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'filterId', value: 'filter-review-safe-sales' },
        { key: 'hasActiveFilter', value: false },
        { key: 'visibleRowCount', value: 20 },
      ]),
      after: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'filterId', value: 'filter-review-safe-sales' },
        { key: 'filterKind', value: 'autoFilter' },
        { key: 'hasActiveFilter', value: true },
        { key: 'hiddenRowCount', value: 7 },
        { key: 'visibleRowCount', value: 13 },
        {
          key: 'unsupportedReasons',
          value: { kind: 'array', values: ['criteria-values-redacted'] },
        },
      ]),
      display: redactedEntityLabelDisplay(),
    }),
  ];
}

export function omittedMacroChange() {
  return semanticRecord({
    changeId: 'omitted-unsupported-macro',
    domain: 'macros.vba',
    entityId: 'module:principal-secret',
    propertyPath: ['source'],
    before: null,
    after: 'macro-source-secret',
    display: entityLabelDisplay('principal-secret Macro'),
  });
}

export function unsupportedNamedRangeRawFieldChange(rawSecret: string) {
  return semanticRecord({
    changeId: 'vc06-unsupported-named-range-raw-field',
    domain: 'named-ranges',
    entityId: 'name:RevenueTotal',
    propertyPath: ['definition'],
    before: null,
    after: semanticObject([
      { key: 'kind', value: 'Set' },
      { key: 'name', value: 'RevenueTotal' },
      { key: 'secretFormula', value: rawSecret },
    ]),
    display: entityLabelDisplay('RevenueTotal'),
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
}) {
  return {
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

export function redactedEntityLabelDisplay() {
  return {
    entityLabel: { kind: 'redacted', reason: 'redaction-policy' },
  };
}

export function addressDisplay(value: string) {
  return {
    address: { kind: 'value', value },
  };
}

export function sheetAddressDisplay(sheetName: string, address: string) {
  return {
    sheetName: { kind: 'value', value: sheetName },
    address: { kind: 'value', value: address },
  };
}

export function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
