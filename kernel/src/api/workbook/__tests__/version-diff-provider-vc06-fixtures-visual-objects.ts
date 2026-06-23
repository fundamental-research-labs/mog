import {
  entityLabelDisplay,
  semanticObject,
  semanticRecord,
} from './version-diff-provider-fixtures';

export function vc06VisualObjectSemanticChanges() {
  return [
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
