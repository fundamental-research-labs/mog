import { VERSION_DIFF_PUBLIC_CURSOR_PREFIX } from '@mog-sdk/contracts/versioning';

import { createWorkbookVersionDiffService } from '../diff-service';
import {
  addressDisplay,
  escapeRegExp,
  graphWithRootAndChild,
  redactedEntityLabelDisplay,
  semanticRecord,
  validSemanticPayload,
  vc06SemanticChanges,
} from './diff-service-fixtures';

describe('WorkbookVersionDiffService projection', () => {
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

  it('projects provider-backed VC-06 semantic domains into public diff entries', async () => {
    const semanticChanges = vc06SemanticChanges();
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload('child', semanticChanges),
    });
    const service = createWorkbookVersionDiffService({ provider });

    const result = await service.diff(
      { kind: 'commit', id: rootCommitId },
      { kind: 'commit', id: childCommitId },
    );

    expect(result).toMatchObject({
      status: 'success',
      items: semanticChanges,
      order: 'semantic-change-order',
      diagnostics: [],
    });
    expect(result.items).toEqual(semanticChanges);
    expect(
      result.items.map((entry) =>
        entry.structural.kind === 'metadata' ? entry.structural.domain : entry.structural.kind,
      ),
    ).toEqual([
      'named-ranges',
      'tables',
      'comments-notes',
      'conditional-formatting',
      'data-validation',
      'filters',
      'sorts',
      'charts.source-range',
      'floating-objects.anchors',
    ]);
    expect(result.items[0]?.display).toEqual(redactedEntityLabelDisplay());
    expect(JSON.stringify(result)).not.toContain('secretFormula');
  });

  it('projects Rust semantic changes when a payload has no review changes', async () => {
    const rustChanges = [
      semanticRecord({
        changeId: 'rust-cell-a1',
        domain: 'cell',
        entityId: 'sheet-1!A1',
        propertyPath: ['value'],
        before: null,
        after: 42,
        display: addressDisplay('A1'),
      }),
    ];
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: {
        schemaVersion: 1,
        source: {
          kind: 'rustSemanticDiff',
          beforeStateDigest: 'before-digest',
          afterStateDigest: 'after-digest',
        },
        changes: rustChanges,
        semanticDiff: {
          beforeDigest: 'before-digest',
          afterDigest: 'after-digest',
          changes: rustChanges,
          diagnostics: [],
        },
        reviewChanges: [],
      },
    });
    const service = createWorkbookVersionDiffService({ provider });

    await expect(
      service.diff({ kind: 'commit', id: rootCommitId }, { kind: 'commit', id: childCommitId }),
    ).resolves.toMatchObject({
      status: 'success',
      items: rustChanges,
      diagnostics: [],
    });
  });
});
