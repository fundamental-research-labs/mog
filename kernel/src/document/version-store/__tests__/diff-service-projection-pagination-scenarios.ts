import { VERSION_DIFF_PUBLIC_CURSOR_PREFIX } from '@mog-sdk/contracts/versioning';

import { createWorkbookVersionDiffService } from '../diff-service';
import { escapeRegExp, graphWithRootAndChild, validSemanticPayload } from './diff-service-fixtures';

export function registerDiffServiceProjectionPaginationScenarios(): void {
  it('builds overview range groups and pages detail without exposing internal cursors', async () => {
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload(
        'child',
        Array.from({ length: 6 }, (_, index) =>
          cellValueChange({
            changeId: `change-${index + 1}`,
            row: Math.floor(index / 3),
            column: index % 3,
            before: index,
            after: index + 10,
          }),
        ),
      ),
    });
    const service = createWorkbookVersionDiffService({ provider });

    const overview = await service.diffOverview(
      { kind: 'commit', id: rootCommitId },
      { kind: 'commit', id: childCommitId },
      { groupLimit: 10 },
    );
    if ('status' in overview) throw new Error('expected overview success');

    expect(overview.summary).toMatchObject({
      exactTotalChanges: 6,
      countPrecision: 'exact',
      incomplete: false,
    });
    expect(overview.groups.items).toHaveLength(1);
    const group = overview.groups.items[0]!;
    expect(group).toMatchObject({
      kind: 'cellRange',
      domain: 'cells.values',
      sheetId: 'sheet-1',
      address: { kind: 'value', value: 'A1:C2' },
      changeCount: 6,
      hasDetail: true,
    });

    const firstDetail = await service.diffGroupDetail(
      { kind: 'commit', id: rootCommitId },
      { kind: 'commit', id: childCommitId },
      { groupId: group.groupId, pageSize: 2 },
    );
    expect(firstDetail).toMatchObject({
      status: 'success',
      items: [{ structural: { changeId: 'change-1' } }, { structural: { changeId: 'change-2' } }],
    });
    expect(firstDetail.nextPageToken).toEqual(
      expect.stringMatching(new RegExp(`^${escapeRegExp(VERSION_DIFF_PUBLIC_CURSOR_PREFIX)}`)),
    );
    expect(firstDetail.nextPageToken).not.toContain('vc04diff');
    expect(firstDetail.nextPageToken).not.toContain(rootCommitId);
    expect(firstDetail.nextPageToken).not.toContain(childCommitId);

    const secondDetail = await service.diffGroupDetail(
      { kind: 'commit', id: rootCommitId },
      { kind: 'commit', id: childCommitId },
      { groupId: group.groupId, pageSize: 2, pageToken: firstDetail.nextPageToken },
    );
    expect(secondDetail).toMatchObject({
      status: 'success',
      items: [{ structural: { changeId: 'change-3' } }, { structural: { changeId: 'change-4' } }],
    });
  });

  it('rejects detail cursors bound to a different group', async () => {
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload('child', [
        cellValueChange({ changeId: 'sheet-1-a1', row: 0, column: 0 }),
        cellValueChange({ changeId: 'sheet-1-a2', row: 1, column: 0 }),
        cellValueChange({ changeId: 'sheet-2-a1', sheetId: 'sheet-2', row: 0, column: 0 }),
        cellValueChange({ changeId: 'sheet-2-a2', sheetId: 'sheet-2', row: 1, column: 0 }),
      ]),
    });
    const service = createWorkbookVersionDiffService({ provider });
    const overview = await service.diffOverview(
      { kind: 'commit', id: rootCommitId },
      { kind: 'commit', id: childCommitId },
      { groupLimit: 10 },
    );
    if ('status' in overview) throw new Error('expected overview success');
    const [firstGroup, secondGroup] = overview.groups.items;
    if (!firstGroup || !secondGroup) throw new Error('expected two diff groups');

    const firstDetail = await service.diffGroupDetail(
      { kind: 'commit', id: rootCommitId },
      { kind: 'commit', id: childCommitId },
      { groupId: firstGroup.groupId, pageSize: 1 },
    );
    if (firstDetail.status !== 'success' || !firstDetail.nextPageToken) {
      throw new Error('expected first detail cursor');
    }

    const mismatchedDetail = await service.diffGroupDetail(
      { kind: 'commit', id: rootCommitId },
      { kind: 'commit', id: childCommitId },
      {
        groupId: secondGroup.groupId,
        pageSize: 1,
        pageToken: firstDetail.nextPageToken,
      },
    );
    expect(mismatchedDetail).toMatchObject({
      status: 'degraded',
      diagnostics: [{ issueCode: 'VERSION_STALE_PAGE_CURSOR' }],
    });
  });

  it('does not expose historical coordinates for redacted overview groups', async () => {
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload('child', [
        {
          ...cellValueChange({ changeId: 'redacted-cell', row: 0, column: 0 }),
          before: { kind: 'redacted', reason: 'redaction-policy' },
          after: { kind: 'redacted', reason: 'redaction-policy' },
          display: {
            sheetName: { kind: 'value', value: 'Private' },
            address: { kind: 'value', value: 'A1' },
          },
        },
      ]),
    });
    const service = createWorkbookVersionDiffService({ provider });

    const overview = await service.diffOverview(
      { kind: 'commit', id: rootCommitId },
      { kind: 'commit', id: childCommitId },
      { groupLimit: 10 },
    );
    if ('status' in overview) throw new Error('expected overview success');

    expect(overview.groups.items).toHaveLength(1);
    const group = overview.groups.items[0]!;
    expect(group.kind).toBe('redacted');
    expect(group).not.toHaveProperty('sheetId');
    expect(group).not.toHaveProperty('sheetName');
    expect(group).not.toHaveProperty('address');
  });

  it('projects a provider-backed parent-child semantic change set into public diff entries', async () => {
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload('child', [
        {
          changeId: 'change-1',
          domain: 'cell',
          entityId: 'sheet-1!A1',
          propertyPath: ['value'],
          before: { kind: 'value', value: 1 },
          after: { kind: 'value', value: { kind: 'formula', formula: '=A1+1', result: 2 } },
          display: {
            sheetName: { kind: 'value', value: 'Sheet1' },
            address: { kind: 'value', value: 'A1' },
          },
        },
        {
          changeId: 'change-2',
          domain: 'sheet',
          entityId: 'sheet-1',
          propertyPath: ['name'],
          before: { kind: 'value', value: 'Sheet1' },
          after: { kind: 'value', value: 'Forecast' },
          display: {
            entityLabel: { kind: 'value', value: 'Forecast' },
          },
        },
      ]),
    });
    const service = createWorkbookVersionDiffService({ provider });

    const firstPage = await service.diff(
      { kind: 'commit', id: rootCommitId },
      { kind: 'commit', id: childCommitId },
      { pageSize: 1 },
    );

    expect(firstPage).toMatchObject({
      status: 'success',
      items: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'change-1',
            domain: 'cell',
            entityId: 'sheet-1!A1',
            propertyPath: ['value'],
          },
          before: { kind: 'value', value: 1 },
          after: { kind: 'value', value: { kind: 'formula', formula: '=A1+1', result: 2 } },
          display: {
            sheetName: { kind: 'value', value: 'Sheet1' },
            address: { kind: 'value', value: 'A1' },
          },
        },
      ],
      order: 'semantic-change-order',
      diagnostics: [],
    });
    expect(firstPage.nextPageToken).toEqual(
      expect.stringMatching(new RegExp(`^${escapeRegExp(VERSION_DIFF_PUBLIC_CURSOR_PREFIX)}`)),
    );
    expect(firstPage.nextPageToken).not.toContain('vc04diff');
    expect(firstPage.nextPageToken).not.toContain(rootCommitId);
    expect(firstPage.nextPageToken).not.toContain(childCommitId);

    const secondPage = await service.diff(
      { kind: 'commit', id: rootCommitId },
      { kind: 'commit', id: childCommitId },
      { pageSize: 1, pageToken: firstPage.nextPageToken },
    );

    expect(secondPage).toMatchObject({
      status: 'success',
      items: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'change-2',
            domain: 'sheet',
            entityId: 'sheet-1',
            propertyPath: ['name'],
          },
          before: { kind: 'value', value: 'Sheet1' },
          after: { kind: 'value', value: 'Forecast' },
        },
      ],
      order: 'semantic-change-order',
      diagnostics: [],
    });
    expect(secondPage).not.toHaveProperty('nextPageToken');
  });
}

function cellValueChange({
  changeId,
  sheetId = 'sheet-1',
  row = 0,
  column = 0,
  before = null,
  after = 'value',
}: {
  readonly changeId: string;
  readonly sheetId?: string;
  readonly row?: number;
  readonly column?: number;
  readonly before?: unknown;
  readonly after?: unknown;
}) {
  return {
    structural: {
      kind: 'metadata',
      changeId,
      domain: 'cells.values',
      entityId: `${sheetId}!${row}:${column}`,
      propertyPath: ['value'],
    },
    before: { kind: 'value', value: before },
    after: { kind: 'value', value: after },
    display: {
      sheetName: { kind: 'value', value: sheetId },
      address: { kind: 'value', value: `${row}:${column}` },
    },
    historical: {
      cell: { sheetId, row, column },
    },
  };
}
