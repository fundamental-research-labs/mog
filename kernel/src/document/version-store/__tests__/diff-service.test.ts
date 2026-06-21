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
