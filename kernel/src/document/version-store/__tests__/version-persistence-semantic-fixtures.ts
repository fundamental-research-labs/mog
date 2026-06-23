export function vc06SemanticChangeSetPayload() {
  return {
    schemaVersion: 1,
    changes: [
      metadataChange({
        changeId: 'mutation-1:named-range:0',
        domain: 'named-ranges',
        entityId: 'name:RevenueTotal',
        propertyPath: ['definition'],
        after: semanticObjectValue([
          { key: 'kind', value: 'Set' },
          { key: 'name', value: 'RevenueTotal' },
        ]),
        display: { entityLabel: { kind: 'value', value: 'RevenueTotal' } },
      }),
      metadataChange({
        changeId: 'mutation-1:table:0',
        domain: 'tables',
        entityId: 'sheet-1!table:table-1',
        propertyPath: ['definition'],
        after: semanticObjectValue([
          { key: 'kind', value: 'Set' },
          { key: 'tableId', value: 'table-1' },
          { key: 'name', value: 'SalesTable' },
          { key: 'sheetId', value: 'sheet-1' },
        ]),
        display: { entityLabel: { kind: 'value', value: 'SalesTable' } },
      }),
      metadataChange({
        changeId: 'mutation-1:comment:0',
        domain: 'comments-notes',
        entityId: 'sheet-1!comment:cell-a1',
        propertyPath: ['cell'],
        after: semanticObjectValue([
          { key: 'kind', value: 'Set' },
          { key: 'cellId', value: 'cell-a1' },
          { key: 'address', value: 'A1' },
        ]),
        display: { address: { kind: 'value', value: 'A1' } },
      }),
      metadataChange({
        changeId: 'mutation-1:conditional-format:0',
        domain: 'conditional-formatting',
        entityId: 'sheet-1!cf:cf-top-10',
        propertyPath: ['rule'],
        after: semanticObjectValue([
          { key: 'kind', value: 'Set' },
          { key: 'ruleId', value: 'cf-top-10' },
          { key: 'appliesTo', value: 'B2:B20' },
          { key: 'type', value: 'top10' },
        ]),
        display: { entityLabel: { kind: 'value', value: 'cf-top-10' } },
      }),
      metadataChange({
        changeId: 'mutation-1:range:0',
        domain: 'data-validation',
        entityId: 'sheet-1!range:dv-status',
        propertyPath: ['range'],
        after: semanticObjectValue([
          { key: 'kind', value: 'Set' },
          { key: 'rangeKind', value: 'Validation' },
          { key: 'rangeId', value: 'dv-status' },
          { key: 'encoding', value: 'mog-range-meta-json-v1' },
          { key: 'rowCount', value: 19 },
          { key: 'colCount', value: 1 },
          {
            key: 'anchor',
            value: semanticObjectValue([
              { key: 'kind', value: 'Elastic' },
              { key: 'startRow', value: 1 },
              { key: 'endRow', value: 19 },
              { key: 'startCol', value: 4 },
              { key: 'endCol', value: 4 },
            ]),
          },
        ]),
        display: { entityLabel: { kind: 'value', value: 'Validation:dv-status' } },
      }),
      metadataChange({
        changeId: 'mutation-1:filter:0',
        domain: 'filters',
        entityId: 'sheet-1!autoFilter',
        propertyPath: ['state'],
        after: semanticObjectValue([
          { key: 'kind', value: 'Set' },
          { key: 'hasActiveFilter', value: true },
          { key: 'visibleRowCount', value: 2 },
        ]),
        display: { entityLabel: { kind: 'value', value: 'AutoFilter' } },
      }),
      metadataChange({
        changeId: 'mutation-1:sort:0',
        domain: 'sorts',
        entityId: 'sheet-1!A1:B2',
        propertyPath: ['order'],
        after: semanticObjectValue([
          { key: 'kind', value: 'Applied' },
          { key: 'range', value: 'A1:B2' },
          { key: 'rowsMoved', value: 1 },
        ]),
        display: { address: { kind: 'value', value: 'A1:B2' } },
      }),
      metadataChange({
        changeId: 'mutation-1:chart:0',
        domain: 'charts.source-range',
        entityId: 'sheet-1!chart:chart-1',
        propertyPath: ['sourceRange'],
        after: semanticObjectValue([
          { key: 'kind', value: 'created' },
          { key: 'objectId', value: 'chart-1' },
          { key: 'objectType', value: 'chart' },
          { key: 'chartType', value: 'bar' },
          { key: 'dataRange', value: 'A1:B10' },
          { key: 'seriesRange', value: 'A1:A10' },
          { key: 'categoryRange', value: 'B1:B10' },
        ]),
        display: { entityLabel: { kind: 'value', value: 'chart-1' } },
      }),
      metadataChange({
        changeId: 'mutation-1:floating-object:0',
        domain: 'floating-objects.anchors',
        entityId: 'sheet-1!object:picture-1',
        propertyPath: ['anchor'],
        after: semanticObjectValue([
          { key: 'kind', value: 'updated' },
          { key: 'objectId', value: 'picture-1' },
          { key: 'objectType', value: 'picture' },
          { key: 'changedFields', value: { kind: 'array', values: ['anchor', 'width'] } },
          {
            key: 'bounds',
            value: semanticObjectValue([
              { key: 'x', value: 10 },
              { key: 'y', value: 20 },
              { key: 'width', value: 320 },
              { key: 'height', value: 180 },
              { key: 'rotation', value: 0 },
            ]),
          },
        ]),
        display: { entityLabel: { kind: 'value', value: 'picture-1' } },
      }),
    ],
  };
}

function metadataChange(input: {
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

function semanticObjectValue(fields: readonly { readonly key: string; readonly value: unknown }[]) {
  return { kind: 'object', fields };
}
