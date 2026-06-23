import {
  addressDisplay,
  entityLabelDisplay,
  semanticObject,
  semanticRecord,
} from './diff-service-fixtures-semantic-builders';

export function vc06ViewObjectSemanticChanges() {
  return [
    semanticRecord({
      changeId: 'vc06-filter-state',
      domain: 'filters',
      entityId: 'sheet-1!filter:auto-filter-1',
      propertyPath: ['state'],
      before: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'filterId', value: 'auto-filter-1' },
        { key: 'hasActiveFilter', value: false },
        { key: 'visibleRowCount', value: 20 },
      ]),
      after: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'filterId', value: 'auto-filter-1' },
        { key: 'filterKind', value: 'autoFilter' },
        { key: 'hasActiveFilter', value: true },
        { key: 'hiddenRowCount', value: 3 },
        { key: 'visibleRowCount', value: 17 },
      ]),
      display: entityLabelDisplay('sheet-1!filter:auto-filter-1'),
    }),
    semanticRecord({
      changeId: 'vc06-sort-order',
      domain: 'sorts',
      entityId: 'sheet-1!A1:D20',
      propertyPath: ['order'],
      before: null,
      after: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'range', value: 'A1:D20' },
        { key: 'rowsMoved', value: 6 },
      ]),
      display: addressDisplay('A1:D20'),
    }),
    semanticRecord({
      changeId: 'vc06-chart-source-range',
      domain: 'charts.source-range',
      entityId: 'sheet-1!chart:chart-sales',
      propertyPath: ['sourceRange'],
      before: semanticObject([
        { key: 'kind', value: 'updated' },
        { key: 'objectId', value: 'chart-sales' },
        { key: 'objectType', value: 'chart' },
        { key: 'dataRange', value: 'Sheet1!$A$1:$C$20' },
        { key: 'categoryRange', value: 'Sheet1!$A$2:$A$20' },
      ]),
      after: semanticObject([
        { key: 'kind', value: 'updated' },
        { key: 'objectId', value: 'chart-sales' },
        { key: 'objectType', value: 'chart' },
        { key: 'dataRange', value: 'Sheet1!$A$1:$D$20' },
        { key: 'categoryRange', value: 'Sheet1!$A$2:$A$20' },
        { key: 'changedFields', value: { kind: 'array', values: ['dataRange'] } },
      ]),
      display: entityLabelDisplay('chart-sales'),
    }),
    semanticRecord({
      changeId: 'vc06-floating-object-anchor',
      domain: 'floating-objects.anchors',
      entityId: 'sheet-1!object:shape-logo',
      propertyPath: ['anchor'],
      before: semanticObject([
        { key: 'kind', value: 'updated' },
        { key: 'objectId', value: 'shape-logo' },
        { key: 'objectType', value: 'shape' },
        {
          key: 'anchor',
          value: semanticObject([
            { key: 'anchorRow', value: 1 },
            { key: 'anchorCol', value: 1 },
            { key: 'anchorMode', value: 'twoCell' },
          ]),
        },
        { key: 'width', value: 120 },
        { key: 'height', value: 80 },
      ]),
      after: semanticObject([
        { key: 'kind', value: 'updated' },
        { key: 'objectId', value: 'shape-logo' },
        { key: 'objectType', value: 'shape' },
        { key: 'changedFields', value: { kind: 'array', values: ['anchor', 'width'] } },
        {
          key: 'anchor',
          value: semanticObject([
            { key: 'anchorRow', value: 2 },
            { key: 'anchorCol', value: 3 },
            { key: 'anchorMode', value: 'twoCell' },
          ]),
        },
        { key: 'width', value: 160 },
        { key: 'height', value: 80 },
      ]),
      display: entityLabelDisplay('shape-logo'),
    }),
  ];
}
