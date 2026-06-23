import {
  entityLabelDisplay,
  redactedEntityLabelDisplay,
  semanticObject,
  semanticRecord,
  sheetAddressDisplay,
} from './version-diff-provider-fixtures';

export function vc06StructuredEntitySemanticChanges() {
  return [
    semanticRecord({
      changeId: 'vc06-named-range-definition',
      domain: 'named-ranges',
      entityId: 'name:RevenueTotal',
      propertyPath: ['definition'],
      before: null,
      after: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'name', value: 'RevenueTotal' },
      ]),
      display: redactedEntityLabelDisplay(),
    }),
    semanticRecord({
      changeId: 'vc06-table-definition',
      domain: 'tables',
      entityId: 'sheet-1!table:table-sales',
      propertyPath: ['definition'],
      before: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'tableId', value: 'table-sales' },
        { key: 'name', value: 'SalesTable' },
        { key: 'sheetId', value: 'sheet-1' },
      ]),
      after: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'tableId', value: 'table-sales' },
        { key: 'name', value: 'SalesTable' },
        { key: 'sheetId', value: 'sheet-1' },
      ]),
      display: entityLabelDisplay('SalesTable'),
    }),
    semanticRecord({
      changeId: 'vc06-comment-cell',
      domain: 'comments-notes',
      entityId: 'sheet-1!comment:cell-b2',
      propertyPath: ['cell'],
      before: null,
      after: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'cellId', value: 'cell-b2' },
        { key: 'address', value: 'B2' },
      ]),
      display: sheetAddressDisplay('Sheet1', 'B2'),
    }),
  ];
}
