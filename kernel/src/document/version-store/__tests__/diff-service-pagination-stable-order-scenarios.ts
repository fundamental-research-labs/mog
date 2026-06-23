import { createWorkbookVersionDiffService } from '../diff-service';
import {
  addressDisplay,
  graphWithRootAndChild,
  providerWithPermutedSemanticReads,
  semanticRecord,
  validSemanticPayload,
} from './diff-service-fixtures';

export function registerDiffServicePaginationStableOrderScenarios(): void {
  it('paginates by stable semantic order keys when equal pre-change order replays differently', async () => {
    const tiedCursorKey = {
      domainOrder: 50,
      hashPropertyPath: '/sheets/sheet-1/cells/value',
      valueClass: 'authored',
    };
    const changes = [
      semanticRecord({
        changeId: 'pre-change-order-tie',
        domain: 'cell',
        entityId: 'sheet-1!C1',
        propertyPath: ['value'],
        before: null,
        after: 'C',
        display: addressDisplay('C1'),
        pageCursorOrderKey: tiedCursorKey,
      }),
      semanticRecord({
        changeId: 'pre-change-order-tie',
        domain: 'cell',
        entityId: 'sheet-1!A1',
        propertyPath: ['value'],
        before: null,
        after: 'A',
        display: addressDisplay('A1'),
        pageCursorOrderKey: tiedCursorKey,
      }),
      semanticRecord({
        changeId: 'pre-change-order-tie',
        domain: 'cell',
        entityId: 'sheet-1!B1',
        propertyPath: ['value'],
        before: null,
        after: 'B',
        display: addressDisplay('B1'),
        pageCursorOrderKey: tiedCursorKey,
      }),
    ];
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload('child', changes),
    });
    const service = createWorkbookVersionDiffService({
      provider: providerWithPermutedSemanticReads(provider, [
        [2, 0, 1],
        [1, 2, 0],
        [0, 1, 2],
        [2, 1, 0],
      ]),
    });

    const replay = await service.diff(
      { kind: 'commit', id: rootCommitId },
      { kind: 'commit', id: childCommitId },
      { pageSize: 10 },
    );
    if (replay.status !== 'success') {
      throw new Error(`expected replay diff success: ${replay.diagnostics[0]?.issueCode}`);
    }
    const replayIds = replay.items.map((item) =>
      item.structural.kind === 'metadata' ? item.structural.changeId : item.structural.kind,
    );
    expect(replayIds).toHaveLength(3);
    expect(new Set(replayIds).size).toBe(3);
    expect(replayIds).toEqual([...replayIds].sort());

    const firstPage = await service.diff(
      { kind: 'commit', id: rootCommitId },
      { kind: 'commit', id: childCommitId },
      { pageSize: 1 },
    );
    if (firstPage.status !== 'success' || !firstPage.nextPageToken) {
      throw new Error('expected first diff page and cursor');
    }
    const secondPage = await service.diff(
      { kind: 'commit', id: rootCommitId },
      { kind: 'commit', id: childCommitId },
      { pageSize: 1, pageToken: firstPage.nextPageToken },
    );
    if (secondPage.status !== 'success' || !secondPage.nextPageToken) {
      throw new Error('expected second diff page and cursor');
    }
    const thirdPage = await service.diff(
      { kind: 'commit', id: rootCommitId },
      { kind: 'commit', id: childCommitId },
      { pageSize: 1, pageToken: secondPage.nextPageToken },
    );
    if (thirdPage.status !== 'success') {
      throw new Error(`expected third diff page success: ${thirdPage.diagnostics[0]?.issueCode}`);
    }

    const pagedIds = [...firstPage.items, ...secondPage.items, ...thirdPage.items].map((item) =>
      item.structural.kind === 'metadata' ? item.structural.changeId : item.structural.kind,
    );
    expect(pagedIds).toEqual(replayIds);
    expect(thirdPage).not.toHaveProperty('nextPageToken');
  });
}
