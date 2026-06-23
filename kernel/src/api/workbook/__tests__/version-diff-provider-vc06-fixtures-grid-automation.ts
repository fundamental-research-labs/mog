import {
  addressDisplay,
  entityLabelDisplay,
  semanticObject,
  semanticRecord,
} from './version-diff-provider-fixtures';

export function vc06GridAutomationSemanticChanges() {
  return [
    semanticRecord({
      changeId: 'vc06-conditional-format-rule',
      domain: 'conditional-formatting',
      entityId: 'sheet-1!cf:cf-top-10',
      propertyPath: ['rule'],
      before: null,
      after: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'ruleId', value: 'cf-top-10' },
      ]),
      display: entityLabelDisplay('cf-top-10'),
    }),
    semanticRecord({
      changeId: 'vc06-data-validation-range',
      domain: 'data-validation',
      entityId: 'sheet-1!range:dv-status',
      propertyPath: ['range'],
      before: null,
      after: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'rangeKind', value: 'Validation' },
        { key: 'rangeId', value: 'dv-status' },
        { key: 'encoding', value: 'mog-range-meta-json-v1' },
        { key: 'rowCount', value: 19 },
        { key: 'colCount', value: 1 },
        {
          key: 'anchor',
          value: semanticObject([
            { key: 'kind', value: 'Elastic' },
            { key: 'startRow', value: 1 },
            { key: 'endRow', value: 19 },
            { key: 'startCol', value: 4 },
            { key: 'endCol', value: 4 },
          ]),
        },
      ]),
      display: entityLabelDisplay('Validation:dv-status'),
    }),
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
  ];
}
