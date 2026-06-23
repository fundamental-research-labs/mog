import { VERSION_DIFF_PUBLIC_CURSOR_PREFIX } from '@mog-sdk/contracts/versioning';

import { createWorkbookVersionDiffService } from '../diff-service';
import { escapeRegExp, graphWithRootAndChild, validSemanticPayload } from './diff-service-fixtures';

export function registerDiffServiceProjectionPaginationScenarios(): void {
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
