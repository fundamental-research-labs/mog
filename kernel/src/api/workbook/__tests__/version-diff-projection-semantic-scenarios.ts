import { expect, it } from '@jest/globals';

import {
  entityLabelDisplay,
  semanticObject,
  semanticRecord,
  sheetAddressDisplay,
  validSemanticPayload,
} from './version-diff-projection-fixtures';
import {
  createVersion,
  graphWithMergeTarget,
  graphWithRootAndChild,
} from './version-diff-projection-test-utils';

export function registerProjectionSemanticScenarios(): void {
  it('projects materialized merge semantic changes from merge base to merge commit', async () => {
    const graph = await graphWithMergeTarget({ materializedMergeProof: true });
    const version = createVersion(graph.provider);

    const result = await version.diff(graph.baseCommitId, graph.mergeCommitId);

    expect(result).toMatchObject({
      ok: true,
      value: {
        items: [graph.mergeChange],
        readRevision: { kind: 'counter', value: '2' },
        order: 'semantic-change-order',
      },
    });
  });

  it('projects materialized merge slices from base, ours, and theirs through public diff', async () => {
    const formulaOurs = { kind: 'formula', formula: '=A1+1', result: 2 };
    const formulaTheirs = { kind: 'formula', formula: '=A1+2', result: 3 };
    const mergeChanges = [
      mergeChange({
        changeId: 'merge-cells-value',
        domain: 'cells.values',
        entityId: 'sheet-1!A1',
        propertyPath: ['value'],
        base: 1,
        ours: 2,
        theirs: 3,
        merged: 4,
        address: 'A1',
      }),
      mergeChange({
        changeId: 'merge-formula-ours-noop',
        domain: 'cells.formulas',
        entityId: 'sheet-1!B1',
        propertyPath: ['formula'],
        base: { kind: 'formula', formula: '=A1', result: 1 },
        ours: formulaOurs,
        theirs: formulaTheirs,
        merged: formulaOurs,
        address: 'B1',
      }),
      mergeChange({
        changeId: 'merge-value-theirs-noop',
        domain: 'cells.values',
        entityId: 'sheet-1!C1',
        propertyPath: ['value'],
        base: 'base',
        ours: 'ours',
        theirs: 'theirs-kept',
        merged: 'theirs-kept',
        address: 'C1',
      }),
      mergeChange({
        changeId: 'merge-value-base-noop',
        domain: 'cells.values',
        entityId: 'sheet-1!D1',
        propertyPath: ['value'],
        base: 'base-kept',
        ours: 'ours-alt',
        theirs: 'theirs-alt',
        merged: 'base-kept',
        address: 'D1',
      }),
    ];
    const graph = await graphWithMergeTarget({
      materializedMergeProof: true,
      changes: [],
      mergeChanges,
    });
    const version = createVersion(graph.provider);

    const baseToMerge = await version.diff(graph.baseCommitId, graph.mergeCommitId);
    const oursToMerge = await version.diff(graph.oursCommitId, graph.mergeCommitId);
    const theirsToMerge = await version.diff(graph.theirsCommitId, graph.mergeCommitId);

    expect(baseToMerge).toMatchObject({ ok: true });
    expect(oursToMerge).toMatchObject({ ok: true });
    expect(theirsToMerge).toMatchObject({ ok: true });
    if (!baseToMerge.ok || !oursToMerge.ok || !theirsToMerge.ok) {
      throw new Error('expected public materialized merge diffs to succeed');
    }

    expect(changeIds(baseToMerge.value.items)).toEqual([
      'merge-cells-value',
      'merge-formula-ours-noop',
      'merge-value-theirs-noop',
    ]);
    expect(changeIds(oursToMerge.value.items)).toEqual([
      'merge-cells-value',
      'merge-value-theirs-noop',
      'merge-value-base-noop',
    ]);
    expect(changeIds(theirsToMerge.value.items)).toEqual([
      'merge-cells-value',
      'merge-formula-ours-noop',
      'merge-value-base-noop',
    ]);

    expect(baseToMerge.value.items[0]).toMatchObject({
      before: { kind: 'value', value: 1 },
      after: { kind: 'value', value: 4 },
    });
    expect(oursToMerge.value.items[0]).toMatchObject({
      before: { kind: 'value', value: 2 },
      after: { kind: 'value', value: 4 },
    });
    expect(theirsToMerge.value.items[0]).toMatchObject({
      before: { kind: 'value', value: 3 },
      after: { kind: 'value', value: 4 },
    });
    expect(theirsToMerge.value.items[1]).toMatchObject({
      structural: expect.objectContaining({
        domain: 'cells.formulas',
        propertyPath: ['formula'],
      }),
      before: { kind: 'value', value: formulaTheirs },
      after: { kind: 'value', value: formulaOurs },
    });
  });

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
      expect.objectContaining({
        domain: 'sheet',
        entityId: 'sheet-beta',
        propertyPath: ['tabColor'],
      }),
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

function mergeChange(input: {
  readonly changeId: string;
  readonly domain: string;
  readonly entityId: string;
  readonly propertyPath: readonly string[];
  readonly base: unknown;
  readonly ours: unknown;
  readonly theirs: unknown;
  readonly merged: unknown;
  readonly address: string;
}) {
  return {
    structural: {
      kind: 'metadata',
      changeId: input.changeId,
      domain: input.domain,
      entityId: input.entityId,
      propertyPath: [...input.propertyPath],
    },
    base: { kind: 'value', value: input.base },
    ours: { kind: 'value', value: input.ours },
    theirs: { kind: 'value', value: input.theirs },
    merged: { kind: 'value', value: input.merged },
    display: sheetAddressDisplay('Sheet1', input.address),
  };
}

function changeIds(
  items: readonly {
    readonly structural: { readonly kind: string; readonly changeId?: string };
  }[],
): readonly string[] {
  return items.map((item) => item.structural.changeId ?? item.structural.kind);
}
