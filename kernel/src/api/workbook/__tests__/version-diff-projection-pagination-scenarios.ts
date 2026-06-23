import { expect, it } from '@jest/globals';

import {
  changeIds,
  entityLabelDisplay,
  semanticRecord,
  sheetAddressDisplay,
  validSemanticPayload,
} from './version-diff-projection-fixtures';
import {
  createVersion,
  graphWithRootAndChild,
  providerWithPermutedSemanticReads,
} from './version-diff-projection-test-utils';

export function registerProjectionPaginationScenarios(): void {
  it('paginates deterministically with public cursors across shuffled provider reads', async () => {
    const changes = [
      semanticRecord({
        changeId: 'sheet-beta-rename',
        domain: 'sheet',
        entityId: 'sheet-beta',
        propertyPath: ['name'],
        before: 'Beta',
        after: 'Forecast',
        display: entityLabelDisplay('Forecast'),
        pageCursorOrderKey: {
          domainOrder: 10,
          hashPropertyPath: '/sheets/sheet-beta/name',
          hashIdentity: 'sheet-beta',
          valueClass: 'authored',
        },
      }),
      semanticRecord({
        changeId: 'cell-alpha-a1',
        domain: 'cell',
        entityId: 'sheet-alpha!A1',
        propertyPath: ['value'],
        before: null,
        after: 'A',
        display: sheetAddressDisplay('Alpha', 'A1'),
        pageCursorOrderKey: {
          domainOrder: 20,
          hashPropertyPath: '/sheets/sheet-alpha/cells/A1/value',
          hashIdentity: 'sheet-alpha!A1',
          valueClass: 'authored',
        },
      }),
      semanticRecord({
        changeId: 'cell-gamma-c3',
        domain: 'cell',
        entityId: 'sheet-gamma!C3',
        propertyPath: ['value'],
        before: null,
        after: 'C',
        display: sheetAddressDisplay('Gamma', 'C3'),
        pageCursorOrderKey: {
          domainOrder: 30,
          hashPropertyPath: '/sheets/sheet-gamma/cells/C3/value',
          hashIdentity: 'sheet-gamma!C3',
          valueClass: 'authored',
        },
      }),
    ];
    const graph = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload('child', changes),
    });
    const provider = providerWithPermutedSemanticReads(graph.provider, [
      [2, 0, 1],
      [1, 2, 0],
      [0, 1, 2],
      [2, 1, 0],
    ]);
    const version = createVersion(provider);

    const replay = await version.diff(graph.rootCommitId, graph.childCommitId, { pageSize: 10 });
    if (!replay.ok) throw new Error(`expected replay diff success: ${replay.error.code}`);
    const replayIds = changeIds(replay.value.items);
    expect(replayIds).toEqual(['sheet-beta-rename', 'cell-alpha-a1', 'cell-gamma-c3']);

    const firstPage = await version.diff(graph.rootCommitId, graph.childCommitId, { pageSize: 1 });
    if (!firstPage.ok || !firstPage.value.nextCursor) {
      throw new Error('expected first diff page and cursor');
    }
    const secondPage = await version.diff(graph.rootCommitId, graph.childCommitId, {
      pageSize: 1,
      pageToken: firstPage.value.nextCursor,
    });
    if (!secondPage.ok || !secondPage.value.nextCursor) {
      throw new Error('expected second diff page and cursor');
    }
    const thirdPage = await version.diff(graph.rootCommitId, graph.childCommitId, {
      pageSize: 1,
      pageToken: secondPage.value.nextCursor,
    });
    if (!thirdPage.ok) throw new Error(`expected third diff page success: ${thirdPage.error.code}`);

    expect(
      changeIds([...firstPage.value.items, ...secondPage.value.items, ...thirdPage.value.items]),
    ).toEqual(replayIds);
    expect(thirdPage.value).not.toHaveProperty('nextCursor');
  });
}
