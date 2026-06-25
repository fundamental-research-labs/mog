import type { VersionDiffEntry } from '@mog-sdk/contracts/api';

import { createWorkbookVersionDiffService } from '../diff-service';
import { graphWithMergeTarget, sheetAddressDisplay } from './diff-service-fixtures';

export function registerDiffServiceProjectionMergeScenarios(): void {
  it('projects materialized merge slices and filters role-local no-op changes', async () => {
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
    const graph = await graphWithMergeTarget({ changes: [], mergeChanges });
    const service = createWorkbookVersionDiffService({ provider: graph.provider });

    const baseToMerge = await service.diff(
      { kind: 'commit', id: graph.baseCommitId },
      { kind: 'commit', id: graph.mergeCommitId },
    );
    const oursToMerge = await service.diff(
      { kind: 'commit', id: graph.oursCommitId },
      { kind: 'commit', id: graph.mergeCommitId },
    );
    const theirsToMerge = await service.diff(
      { kind: 'commit', id: graph.theirsCommitId },
      { kind: 'commit', id: graph.mergeCommitId },
    );

    expect(baseToMerge).toMatchObject({ status: 'success', diagnostics: [] });
    expect(oursToMerge).toMatchObject({ status: 'success', diagnostics: [] });
    expect(theirsToMerge).toMatchObject({ status: 'success', diagnostics: [] });
    if (
      baseToMerge.status !== 'success' ||
      oursToMerge.status !== 'success' ||
      theirsToMerge.status !== 'success'
    ) {
      throw new Error('expected materialized merge diffs to succeed');
    }

    expect(changeIds(baseToMerge.items)).toEqual([
      'merge-cells-value',
      'merge-formula-ours-noop',
      'merge-value-theirs-noop',
    ]);
    expect(changeIds(oursToMerge.items)).toEqual([
      'merge-cells-value',
      'merge-value-theirs-noop',
      'merge-value-base-noop',
    ]);
    expect(changeIds(theirsToMerge.items)).toEqual([
      'merge-cells-value',
      'merge-formula-ours-noop',
      'merge-value-base-noop',
    ]);

    expect(baseToMerge.items[0]).toMatchObject({
      before: { kind: 'value', value: 1 },
      after: { kind: 'value', value: 4 },
    });
    expect(oursToMerge.items[0]).toMatchObject({
      before: { kind: 'value', value: 2 },
      after: { kind: 'value', value: 4 },
    });
    expect(theirsToMerge.items[0]).toMatchObject({
      before: { kind: 'value', value: 3 },
      after: { kind: 'value', value: 4 },
    });
    expect(theirsToMerge.items[1]).toMatchObject({
      structural: expect.objectContaining({
        domain: 'cells.formulas',
        propertyPath: ['formula'],
      }),
      before: { kind: 'value', value: formulaTheirs },
      after: { kind: 'value', value: formulaOurs },
    });
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

function changeIds(items: readonly VersionDiffEntry[]): readonly string[] {
  return items.map((item) =>
    item.structural.kind === 'metadata' ? item.structural.changeId : item.structural.kind,
  );
}
