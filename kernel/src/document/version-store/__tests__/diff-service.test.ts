import type { VersionAuthor } from '@mog-sdk/contracts/versioning';
import type { WorkbookDiffPage } from '@mog-sdk/contracts/api';

import { createWorkbookVersionDiffService } from '../diff-service';
import {
  VERSION_GRAPH_HEAD_REF,
  VERSION_GRAPH_MAIN_REF,
  type CommitVersionGraphInput,
} from '../graph-store';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import type { VersionObjectType, WorkbookCommitId } from '../object-digest';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../provider';
import type { RefVersion } from '../ref-store';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

const CREATED_AT = '2026-06-20T00:00:00.000Z';

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
    expect(firstPage.nextPageToken).toEqual(expect.stringContaining(childCommitId));

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

  it('rejects stale page tokens before returning entries', async () => {
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

    await expect(
      service.diff(
        { kind: 'commit', id: rootCommitId },
        { kind: 'commit', id: childCommitId },
        { pageToken: `vc04diff:${childCommitId}:${rootCommitId}:1` },
      ),
    ).resolves.toMatchObject({
      status: 'degraded',
      items: [],
      diagnostics: [expect.objectContaining({ issueCode: 'VERSION_STALE_PAGE_CURSOR' })],
    });
  });
});

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.issueCode}`);
  }
}

async function graphWithRootAndChild(options: { readonly semanticPayload: unknown }) {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
  expectInitializeSuccess(initialized);
  const appended = await appendChild(
    {
      provider,
      namespace: namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'),
      rootCommitId: initialized.rootCommit.id,
      headCommitId: initialized.rootCommit.id,
      headRevision: initialized.initialHead.revision,
    },
    {
      label: 'child',
      semanticPayload: options.semanticPayload,
    },
  );
  return {
    provider,
    namespace: namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'),
    rootCommitId: initialized.rootCommit.id,
    childCommitId: appended.childCommitId,
  };
}

async function appendChild(
  graph: {
    readonly provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
    readonly namespace: VersionGraphNamespace;
    readonly rootCommitId?: WorkbookCommitId;
    readonly headCommitId?: WorkbookCommitId;
    readonly headRevision?: RefVersion;
  },
  options: {
    readonly label: string;
    readonly semanticPayload: unknown;
  },
): Promise<{ readonly childCommitId: WorkbookCommitId }> {
  const opened = await graph.provider.openGraph(graph.namespace);
  const head = await opened.readHead();
  if (head.status !== 'success') throw new Error('expected graph head before append');

  const committed = await opened.commit(
    await commitInput(
      graph.namespace,
      options.label,
      options.semanticPayload,
      head.head.id,
      head.head.refRevision as RefVersion,
    ),
  );
  if (committed.status !== 'success') {
    throw new Error(`expected commit success: ${committed.diagnostics[0]?.code}`);
  }
  return { childCommitId: committed.commit.id };
}

async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        schemaVersion: 1,
        changes: [],
      }),
      author: AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

async function commitInput(
  namespace: VersionGraphNamespace,
  label: string,
  semanticPayload: unknown,
  expectedHeadCommitId: WorkbookCommitId,
  expectedMainRefVersion: RefVersion,
): Promise<CommitVersionGraphInput> {
  return {
    snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      label,
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(
      namespace,
      'workbook.semanticChangeSet.v1',
      semanticPayload,
    ),
    mutationSegmentRecords: [
      await objectRecord(namespace, 'workbook.mutationSegment.v1', {
        segmentId: `${label}-segment-1`,
      }),
    ],
    author: AUTHOR,
    createdAt: CREATED_AT,
    completenessDiagnostics: [],
    expectedHeadCommitId,
    expectedMainRefVersion,
  };
}

async function objectRecord(
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
  payload: unknown,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

function validSemanticPayload(label: string, changes: readonly unknown[]) {
  return {
    schemaVersion: 1,
    label,
    changes,
  };
}

function vc06SemanticChanges() {
  return [
    semanticRecord({
      changeId: 'vc06-named-range-definition',
      domain: 'named-ranges',
      entityId: 'name:RevenueTotal',
      propertyPath: ['definition'],
      before: null,
      after: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'name', value: 'RevenueTotal' },
      ]),
      display: redactedEntityLabelDisplay(),
    }),
    semanticRecord({
      changeId: 'vc06-table-definition',
      domain: 'tables',
      entityId: 'sheet-1!table:table-sales',
      propertyPath: ['definition'],
      before: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'tableId', value: 'table-sales' },
        { key: 'name', value: 'SalesTable' },
        { key: 'sheetId', value: 'sheet-1' },
      ]),
      after: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'tableId', value: 'table-sales' },
        { key: 'name', value: 'SalesTable' },
        { key: 'sheetId', value: 'sheet-1' },
      ]),
      display: entityLabelDisplay('SalesTable'),
    }),
    semanticRecord({
      changeId: 'vc06-comment-cell',
      domain: 'comments-notes',
      entityId: 'sheet-1!comment:cell-b2',
      propertyPath: ['cell'],
      before: null,
      after: semanticObject([
        { key: 'kind', value: 'Set' },
        { key: 'cellId', value: 'cell-b2' },
        { key: 'address', value: 'B2' },
      ]),
      display: sheetAddressDisplay('Sheet1', 'B2'),
    }),
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
    semanticRecord({
      changeId: 'vc06-chart-source-range',
      domain: 'charts.source-range',
      entityId: 'sheet-1!chart:chart-sales',
      propertyPath: ['sourceRange'],
      before: semanticObject([
        { key: 'kind', value: 'updated' },
        { key: 'objectId', value: 'chart-sales' },
        { key: 'objectType', value: 'chart' },
        { key: 'dataRange', value: 'Sheet1!$A$1:$C$20' },
        { key: 'categoryRange', value: 'Sheet1!$A$2:$A$20' },
      ]),
      after: semanticObject([
        { key: 'kind', value: 'updated' },
        { key: 'objectId', value: 'chart-sales' },
        { key: 'objectType', value: 'chart' },
        { key: 'dataRange', value: 'Sheet1!$A$1:$D$20' },
        { key: 'categoryRange', value: 'Sheet1!$A$2:$A$20' },
        { key: 'changedFields', value: { kind: 'array', values: ['dataRange'] } },
      ]),
      display: entityLabelDisplay('chart-sales'),
    }),
    semanticRecord({
      changeId: 'vc06-floating-object-anchor',
      domain: 'floating-objects.anchors',
      entityId: 'sheet-1!object:shape-logo',
      propertyPath: ['anchor'],
      before: semanticObject([
        { key: 'kind', value: 'updated' },
        { key: 'objectId', value: 'shape-logo' },
        { key: 'objectType', value: 'shape' },
        {
          key: 'anchor',
          value: semanticObject([
            { key: 'anchorRow', value: 1 },
            { key: 'anchorCol', value: 1 },
            { key: 'anchorMode', value: 'twoCell' },
          ]),
        },
        { key: 'width', value: 120 },
        { key: 'height', value: 80 },
      ]),
      after: semanticObject([
        { key: 'kind', value: 'updated' },
        { key: 'objectId', value: 'shape-logo' },
        { key: 'objectType', value: 'shape' },
        { key: 'changedFields', value: { kind: 'array', values: ['anchor', 'width'] } },
        {
          key: 'anchor',
          value: semanticObject([
            { key: 'anchorRow', value: 2 },
            { key: 'anchorCol', value: 3 },
            { key: 'anchorMode', value: 'twoCell' },
          ]),
        },
        { key: 'width', value: 160 },
        { key: 'height', value: 80 },
      ]),
      display: entityLabelDisplay('shape-logo'),
    }),
  ];
}

function semanticRecord(input: {
  readonly changeId: string;
  readonly domain: string;
  readonly entityId: string;
  readonly propertyPath: readonly string[];
  readonly before: unknown;
  readonly after: unknown;
  readonly display: unknown;
}) {
  return {
    structural: {
      kind: 'metadata',
      changeId: input.changeId,
      domain: input.domain,
      entityId: input.entityId,
      propertyPath: [...input.propertyPath],
    },
    before: { kind: 'value', value: input.before },
    after: { kind: 'value', value: input.after },
    display: input.display,
  };
}

function semanticObject(fields: readonly { readonly key: string; readonly value: unknown }[]) {
  return {
    kind: 'object',
    fields: fields.map((field) => ({ key: field.key, value: field.value })),
  };
}

function entityLabelDisplay(value: string) {
  return {
    entityLabel: { kind: 'value', value },
  };
}

function redactedEntityLabelDisplay() {
  return {
    entityLabel: { kind: 'redacted', reason: 'redaction-policy' },
  };
}

function addressDisplay(value: string) {
  return {
    address: { kind: 'value', value },
  };
}

function sheetAddressDisplay(sheetName: string, address: string) {
  return {
    sheetName: { kind: 'value', value: sheetName },
    address: { kind: 'value', value: address },
  };
}
