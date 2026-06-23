import { expect, it } from '@jest/globals';

import {
  entityLabelDisplay,
  semanticObject,
  semanticRecord,
  sheetAddressDisplay,
  validSemanticPayload,
} from './version-diff-projection-fixtures';
import { createVersion, graphWithRootAndChild } from './version-diff-projection-test-utils';

export function registerProjectionSemanticScenarios(): void {
  it('projects multi-sheet edits and sheet rename/add/delete changes', async () => {
    const changes = [
      semanticRecord({
        changeId: 'cell-alpha-a1',
        domain: 'cell',
        entityId: 'sheet-alpha!A1',
        propertyPath: ['value'],
        before: null,
        after: 'North',
        display: sheetAddressDisplay('North', 'A1'),
      }),
      semanticRecord({
        changeId: 'cell-beta-b2',
        domain: 'cell',
        entityId: 'sheet-beta!B2',
        propertyPath: ['value'],
        before: 10,
        after: 20,
        display: sheetAddressDisplay('South', 'B2'),
      }),
      semanticRecord({
        changeId: 'sheet-beta-rename',
        domain: 'sheet',
        entityId: 'sheet-beta',
        propertyPath: ['name'],
        before: 'South',
        after: 'Forecast',
        display: entityLabelDisplay('Forecast'),
      }),
      semanticRecord({
        changeId: 'sheet-beta-tab-color',
        domain: 'sheet',
        entityId: 'sheet-beta',
        propertyPath: ['tabColor'],
        before: null,
        after: '#22c55e',
        display: entityLabelDisplay('Forecast'),
      }),
    ];
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload('child', changes),
    });
    const version = createVersion(provider);

    const result = await version.diff(rootCommitId, childCommitId);

    expect(result).toMatchObject({
      ok: true,
      value: {
        items: changes,
        readRevision: { kind: 'counter', value: '1' },
        order: 'semantic-change-order',
      },
    });
    if (!result.ok) throw new Error(`expected diff success: ${result.error.code}`);
    expect(result.value.items.map((entry) => entry.structural)).toEqual([
      expect.objectContaining({ domain: 'cell', entityId: 'sheet-alpha!A1' }),
      expect.objectContaining({ domain: 'cell', entityId: 'sheet-beta!B2' }),
      expect.objectContaining({ domain: 'sheet', entityId: 'sheet-beta', propertyPath: ['name'] }),
      expect.objectContaining({ domain: 'sheet', entityId: 'sheet-beta', propertyPath: ['tabColor'] }),
    ]);
  });

  it('projects cross-sheet range fields through the review-safe range boundary', async () => {
    const changes = [
      semanticRecord({
        changeId: 'validation-alpha-range',
        domain: 'data-validation',
        entityId: 'sheet-alpha!range:dv-alpha',
        propertyPath: ['range'],
        before: null,
        after: semanticObject([
          { key: 'kind', value: 'Set' },
          { key: 'rangeKind', value: 'Validation' },
          { key: 'rangeId', value: 'dv-alpha' },
          { key: 'encoding', value: 'mog-range-meta-json-v1' },
          { key: 'rowCount', value: 10 },
          { key: 'colCount', value: 2 },
          {
            key: 'anchor',
            value: semanticObject([
              { key: 'kind', value: 'Elastic' },
              { key: 'startRow', value: 1 },
              { key: 'endRow', value: 10 },
              { key: 'startCol', value: 1 },
              { key: 'endCol', value: 2 },
            ]),
          },
        ]),
        display: entityLabelDisplay('Validation:dv-alpha'),
      }),
      semanticRecord({
        changeId: 'chart-cross-sheet-range',
        domain: 'charts.source-range',
        entityId: 'sheet-beta!chart:chart-1',
        propertyPath: ['sourceRange'],
        before: null,
        after: semanticObject([
          { key: 'kind', value: 'updated' },
          { key: 'objectId', value: 'chart-1' },
          { key: 'objectType', value: 'chart' },
          { key: 'dataRange', value: 'Alpha!$A$1:$B$10' },
          { key: 'categoryRange', value: 'Beta!$C$1:$C$10' },
        ]),
        display: entityLabelDisplay('chart-1'),
      }),
    ];
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload('child', changes),
    });
    const version = createVersion(provider);

    const result = await version.diff(rootCommitId, childCommitId);

    if (!result.ok) throw new Error(`expected diff success: ${result.error.code}`);
    expect(result.value.items.map((entry) => entry.structural)).toEqual([
      expect.objectContaining({
        domain: 'data-validation',
        entityId: 'sheet-alpha!range:dv-alpha',
      }),
      expect.objectContaining({
        domain: 'charts.source-range',
        entityId: 'sheet-beta!chart:chart-1',
      }),
    ]);
    expect((result.value.items[1]?.after as any).value.fields).toEqual(
      expect.arrayContaining([
        { key: 'dataRange', value: 'Alpha!$A$1:$B$10' },
        { key: 'categoryRange', value: 'Beta!$C$1:$C$10' },
      ]),
    );
  });
}
