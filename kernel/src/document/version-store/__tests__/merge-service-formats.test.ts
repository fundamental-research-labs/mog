import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { createInMemoryWorkbookCommitStore } from '../commit-store';
import { createWorkbookVersionMergeService } from '../merge-service';
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

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-format-merge',
  principalScope: 'principal-1',
};

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

const CREATED_AT = '2026-06-21T00:00:00.000Z';

describe('WorkbookVersionMergeService direct cell formats', () => {
  it('previews same-cell value and direct-format edits as clean independent changes', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        valueChange('ours-a1-value', 'cells.values', 'sheet-1!A1', [], null, 'done'),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        formatChange('theirs-a1-format', 'sheet-1!A1', null, formatValue({ bold: true })),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const result = await service.merge({
      base: graph.rootCommitId,
      ours: graph.oursCommitId,
      theirs: graph.theirsCommitId,
    });

    expect(result).toMatchObject({
      status: 'clean',
      changes: [
        expect.objectContaining({
          structural: expect.objectContaining({
            domain: 'cells.values',
            entityId: 'sheet-1!A1',
            propertyPath: [],
          }),
          merged: { kind: 'value', value: 'done' },
        }),
        expect.objectContaining({
          structural: expect.objectContaining({
            domain: 'cells.formats.direct',
            entityId: 'sheet-1!A1',
            propertyPath: ['format'],
          }),
          merged: { kind: 'value', value: formatValue({ bold: true }) },
        }),
      ],
      conflicts: [],
      diagnostics: [],
      mutationGuarantee: 'preview-only',
    });
  });

  it('classifies direct-format same-property edits as stable conflicts', async () => {
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        formatChange('ours-a1-format', 'sheet-1!A1', null, formatValue({ bold: true })),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        formatChange('theirs-a1-format', 'sheet-1!A1', null, formatValue({ italic: true })),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    const forward = await service.merge({
      base: graph.rootCommitId,
      ours: graph.oursCommitId,
      theirs: graph.theirsCommitId,
    });
    const reversed = await service.merge({
      base: graph.rootCommitId,
      ours: graph.theirsCommitId,
      theirs: graph.oursCommitId,
    });

    expect(forward).toMatchObject({
      status: 'conflicted',
      changes: [],
      conflicts: [
        {
          conflictKind: 'same-property',
          structural: {
            kind: 'metadata',
            domain: 'cells.formats.direct',
            entityId: 'sheet-1!A1',
            propertyPath: ['format'],
          },
          base: { kind: 'value', value: null },
          ours: { kind: 'value', value: formatValue({ bold: true }) },
          theirs: { kind: 'value', value: formatValue({ italic: true }) },
        },
      ],
    });
    if (forward.status !== 'conflicted' || reversed.status !== 'conflicted') {
      throw new Error('expected both direct-format previews to conflict');
    }
    expect(forward.conflicts[0].conflictId).toBe(reversed.conflicts[0].conflictId);
    expect(forward.conflicts[0].conflictDigest).toBe(reversed.conflicts[0].conflictDigest);
    expect(forward.conflicts[0].structural).toEqual(reversed.conflicts[0].structural);
    expect(forward.conflicts[0].resolutionOptions.map((option) => option.optionId)).toEqual(
      reversed.conflicts[0].resolutionOptions.map((option) => option.optionId),
    );
  });

  it('classifies direct-format clear versus set as a conflict', async () => {
    const baseFormat = formatValue({ bold: true, fontColor: '#FF0000' });
    const graph = await graphWithRootAndDetachedChildren({
      oursSemanticPayload: validSemanticPayload([
        formatChange('ours-a1-clear', 'sheet-1!A1', baseFormat, null),
      ]),
      theirsSemanticPayload: validSemanticPayload([
        formatChange('theirs-a1-format', 'sheet-1!A1', baseFormat, formatValue({ italic: true })),
      ]),
    });
    const service = createWorkbookVersionMergeService({ provider: graph.provider });

    await expect(
      service.merge({
        base: graph.rootCommitId,
        ours: graph.oursCommitId,
        theirs: graph.theirsCommitId,
      }),
    ).resolves.toMatchObject({
      status: 'conflicted',
      changes: [],
      conflicts: [
        {
          structural: expect.objectContaining({
            domain: 'cells.formats.direct',
            entityId: 'sheet-1!A1',
            propertyPath: ['format'],
          }),
          base: { kind: 'value', value: baseFormat },
          ours: { kind: 'value', value: null },
          theirs: { kind: 'value', value: formatValue({ italic: true }) },
        },
      ],
      diagnostics: [],
    });
  });
});

async function graphWithRootAndDetachedChildren(options: {
  readonly oursSemanticPayload: unknown;
  readonly theirsSemanticPayload: unknown;
}) {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
  const rootCommitId = initialized.rootCommit.id;
  const graph = { provider, namespace, rootCommitId };

  const oursCommitId = await createDetachedChild(graph, {
    label: 'ours',
    parentCommitId: rootCommitId,
    semanticPayload: options.oursSemanticPayload,
  });
  const theirsCommitId = await createDetachedChild(graph, {
    label: 'theirs',
    parentCommitId: rootCommitId,
    semanticPayload: options.theirsSemanticPayload,
  });

  return {
    provider,
    namespace,
    rootCommitId,
    oursCommitId,
    theirsCommitId,
  };
}

async function createDetachedChild(
  graph: {
    readonly provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
    readonly namespace: VersionGraphNamespace;
  },
  options: {
    readonly label: string;
    readonly parentCommitId: WorkbookCommitId;
    readonly semanticPayload: unknown;
  },
): Promise<WorkbookCommitId> {
  const opened = await graph.provider.openGraph(graph.namespace);
  const commitStore = createInMemoryWorkbookCommitStore(opened.objectStore);
  const created = await commitStore.createWorkbookCommit({
    documentId: graph.namespace.documentId,
    parentCommitIds: [options.parentCommitId],
    snapshotRootRecord: await objectRecord(graph.namespace, 'workbook.snapshotRoot.v1', {
      label: options.label,
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(
      graph.namespace,
      'workbook.semanticChangeSet.v1',
      options.semanticPayload,
    ),
    mutationSegmentRecords: [
      await objectRecord(graph.namespace, 'workbook.mutationSegment.v1', {
        segmentId: `${options.label}-segment-1`,
      }),
    ],
    author: AUTHOR,
    createdAt: CREATED_AT,
    completenessDiagnostics: [],
  });
  if (created.status !== 'success') {
    throw new Error(`expected detached child commit success: ${created.diagnostics[0]?.code}`);
  }
  return created.commit.id;
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

function validSemanticPayload(changes: readonly unknown[]) {
  return {
    schemaVersion: 1,
    changes,
  };
}

function valueChange(
  changeId: string,
  domain: string,
  entityId: string,
  propertyPath: readonly string[],
  before: unknown,
  after: unknown,
) {
  return {
    changeId,
    domain,
    entityId,
    propertyPath,
    before: { kind: 'value', value: before },
    after: { kind: 'value', value: after },
    display: {
      address: { kind: 'value', value: entityId.split('!')[1] ?? entityId },
    },
  };
}

function formatChange(
  changeId: string,
  entityId: string,
  before: unknown,
  after: unknown,
) {
  return valueChange(changeId, 'cells.formats.direct', entityId, ['format'], before, after);
}

function formatValue(value: Record<string, unknown>) {
  return {
    kind: 'object',
    fields: Object.keys(value)
      .sort()
      .map((key) => ({ key, value: value[key] })),
  };
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}
