import {
  metadataChange,
  semanticObjectValue,
} from './version-persistence-semantic-fixtures-builders';

export function vc06DefinitionSemanticChanges() {
  return [
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
  ];
}
