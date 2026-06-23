import { VERSION_DIFF_PUBLIC_CURSOR_PREFIX } from '@mog-sdk/contracts/versioning';
import type { VersionPageToken } from '@mog-sdk/contracts/api';

import { createWorkbookVersionDiffService } from '../diff-service';
import {
  internalPageTokenForOffset,
  internalPageTokenForOrderKey,
  publicPageTokenFor,
} from '../diff-service-pagination';
import {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
} from '../graph-store';
import {
  addressDisplay,
  appendChild,
  entityLabelDisplay,
  escapeRegExp,
  graphWithRootAndChild,
  providerWithPermutedSemanticReads,
  redactedEntityLabelDisplay,
  semanticObject,
  semanticRecord,
  validSemanticPayload,
  vc06SemanticChanges,
} from './diff-service-fixtures';

describe('WorkbookVersionDiffService', () => {
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
      {
        structural: {
          kind: 'metadata',
          changeId: 'rust-cell-a1',
          domain: 'cell',
          entityId: 'sheet-1!A1',
          propertyPath: ['value'],
        },
        before: { kind: 'value', value: null },
        after: { kind: 'value', value: 42 },
        display: { address: { kind: 'value', value: 'A1' } },
      },
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

  it('fails closed without leaking unsupported VC-06 raw payload fields', async () => {
    const rawSecret = 'Sheet1!$B$2:$B$20';
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload('child', [
        semanticRecord({
          changeId: 'vc06-unsupported-named-range-raw-field',
          domain: 'named-ranges',
          entityId: 'name:RevenueTotal',
          propertyPath: ['definition'],
          before: null,
          after: semanticObject([
            { key: 'kind', value: 'Set' },
            { key: 'name', value: 'RevenueTotal' },
            { key: 'secretFormula', value: rawSecret },
          ]),
          display: entityLabelDisplay('RevenueTotal'),
        }),
      ]),
    });
    const service = createWorkbookVersionDiffService({ provider });

    const result = await service.diff(
      { kind: 'commit', id: rootCommitId },
      { kind: 'commit', id: childCommitId },
    );

    expect(result).toMatchObject({
      status: 'degraded',
      items: [],
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_UNSUPPORTED_SCHEMA' })],
    });
    expect(JSON.stringify(result)).not.toContain(rawSecret);
    expect(JSON.stringify(result)).not.toContain('secretFormula');
  });

  it('resolves HEAD and refs/heads/main selectors through the visible graph', async () => {
    const { provider, rootCommitId } = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload('child', [
        {
          changeId: 'change-1',
          domain: 'cell',
          entityId: 'sheet-1!A1',
          propertyPath: ['value'],
          before: { kind: 'value', value: null },
          after: { kind: 'value', value: 10 },
        },
      ]),
    });
    const service = createWorkbookVersionDiffService({ provider });

    await expect(
      service.diff(
        { kind: 'commit', id: rootCommitId },
        { kind: 'ref', name: VERSION_GRAPH_HEAD_REF },
      ),
    ).resolves.toMatchObject({
      status: 'success',
      items: [expect.objectContaining({ after: { kind: 'value', value: 10 } })],
    });

    await expect(
      service.diff(
        { kind: 'commit', id: rootCommitId },
        { kind: 'ref', name: VERSION_GRAPH_MAIN_REF },
      ),
    ).resolves.toMatchObject({
      status: 'success',
      items: [expect.objectContaining({ after: { kind: 'value', value: 10 } })],
    });
  });

  it('fails closed without fabricated entries when semantic data is missing from the payload', async () => {
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: { schemaVersion: 1 },
    });
    const service = createWorkbookVersionDiffService({ provider });

    await expect(
      service.diff({ kind: 'commit', id: rootCommitId }, { kind: 'commit', id: childCommitId }),
    ).resolves.toMatchObject({
      status: 'degraded',
      items: [],
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_UNSUPPORTED_SCHEMA' })],
    });
  });

  it('fails closed without fabricated entries for unsupported semantic schemas', async () => {
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: {
        schemaVersion: 2,
        changes: [
          {
            id: 'skeletal-change',
            domain: 'cell',
          },
        ],
      },
    });
    const service = createWorkbookVersionDiffService({ provider });

    const result = await service.diff(
      { kind: 'commit', id: rootCommitId },
      { kind: 'commit', id: childCommitId },
    );

    expect(result).toMatchObject({
      status: 'degraded',
      items: [],
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_UNSUPPORTED_SCHEMA' })],
    });
    expect(JSON.stringify(result)).not.toContain('skeletal-change');
  });

  it('fails closed when selectors do not describe a direct parent-child diff', async () => {
    const graph = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload('child', [
        {
          changeId: 'change-1',
          domain: 'cell',
          entityId: 'sheet-1!A1',
          propertyPath: ['value'],
          before: { kind: 'value', value: 1 },
          after: { kind: 'value', value: 2 },
        },
      ]),
    });
    const { childCommitId: grandchildCommitId } = await appendChild(graph, {
      label: 'grandchild',
      semanticPayload: validSemanticPayload('grandchild', [
        {
          changeId: 'change-2',
          domain: 'cell',
          entityId: 'sheet-1!A1',
          propertyPath: ['value'],
          before: { kind: 'value', value: 2 },
          after: { kind: 'value', value: 3 },
        },
      ]),
    });
    const service = createWorkbookVersionDiffService({ provider: graph.provider });

    await expect(
      service.diff(
        { kind: 'commit', id: graph.rootCommitId },
        { kind: 'commit', id: grandchildCommitId },
      ),
    ).resolves.toMatchObject({
      status: 'degraded',
      items: [],
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_UNMATERIALIZABLE_COMMIT' })],
    });
  });

  it('rejects stale and malformed page tokens before returning entries', async () => {
    const { provider, rootCommitId, childCommitId } = await graphWithRootAndChild({
      semanticPayload: validSemanticPayload('child', [
        {
          changeId: 'change-1',
          domain: 'cell',
          entityId: 'sheet-1!A1',
          propertyPath: ['value'],
          before: { kind: 'value', value: 1 },
          after: { kind: 'value', value: 2 },
        },
      ]),
    });
    const service = createWorkbookVersionDiffService({ provider });
    const offsetToken = internalPageTokenForOffset(rootCommitId, childCommitId, 0);
    const malformedOffsetToken = `${offsetToken.slice(0, -1)}1e2` as VersionPageToken;
    const cases = [
      {
        pageToken: `${VERSION_DIFF_PUBLIC_CURSOR_PREFIX}stale-handle`,
        diagnostic: { issueCode: 'VERSION_STALE_PAGE_CURSOR' },
      },
      {
        pageToken: publicPageTokenFor(malformedOffsetToken),
        diagnostic: {
          issueCode: 'VERSION_STALE_PAGE_CURSOR',
          safeMessage: 'diff pageToken carries an invalid page offset.',
        },
      },
      {
        pageToken: publicPageTokenFor(
          internalPageTokenForOrderKey(rootCommitId, childCommitId, 'not-json-array'),
        ),
        diagnostic: {
          issueCode: 'VERSION_STALE_PAGE_CURSOR',
          safeMessage: 'diff pageToken carries an invalid order key.',
        },
      },
    ];

    for (const { pageToken, diagnostic: expectedDiagnostic } of cases) {
      await expect(
        service.diff(
          { kind: 'commit', id: rootCommitId },
          { kind: 'commit', id: childCommitId },
          { pageToken },
        ),
      ).resolves.toMatchObject({
        status: 'degraded',
        items: [],
        diagnostics: [expect.objectContaining(expectedDiagnostic)],
      });
    }
  });
});
