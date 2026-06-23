import {
  metadataChange,
  semanticObjectValue,
} from './version-persistence-semantic-fixtures-builders';

export function vc06ViewObjectSemanticChanges() {
  return [
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
  ];
}
