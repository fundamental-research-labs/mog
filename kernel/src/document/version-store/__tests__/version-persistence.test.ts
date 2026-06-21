import type { VersionAuthor } from '@mog-sdk/contracts/versioning';
import { jest } from '@jest/globals';

import { DocumentFactory } from '../../../api/document/document-factory';
import {
  createDocumentLifecycleSnapshotRootHydrator,
  type SnapshotRootFreshLifecycleMaterialization,
} from '../../../api/document/snapshot-root-lifecycle-hydrator';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import type { VersionObjectType } from '../object-digest';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeResult,
} from '../provider';
import {
  createWorkbookSnapshotRootRecord,
  createYrsFullStateSnapshotRootPayload,
} from '../snapshot-root-capture';
import { createVersionPersistence } from '../version-persistence';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
const CREATED_AT = '2026-06-20T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

describe('VersionPersistence', () => {
  it('reloads a committed snapshot root through a fresh lifecycle', async () => {
    const sourceHandle = await DocumentFactory.create({
      documentId: 'persistence-source-doc',
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let materialized: SnapshotRootFreshLifecycleMaterialization | undefined;

    try {
      const sourceWorkbook = await sourceHandle.workbook();
      await sourceWorkbook.activeSheet.setCell('A1', 11);
      await sourceWorkbook.activeSheet.setCell('A2', '=A1+31');

      const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
      const snapshotRootPayload = createYrsFullStateSnapshotRootPayload(
        await sourceHandle.createSyncPort().encodeDiff(new Uint8Array([0])),
      );
      const snapshotRootRecord = await createWorkbookSnapshotRootRecord(
        namespace,
        snapshotRootPayload,
      );
      const semanticChangeSetPayload = vc06SemanticChangeSetPayload();
      const semanticChangeSetRecord = await objectRecord(
        namespace,
        'workbook.semanticChangeSet.v1',
        semanticChangeSetPayload,
      );
      const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
      const initialized = await provider.initializeGraph({
        expectedRegistryRevision: null,
        graphId: 'graph-1',
        rootWrite: {
          snapshotRootRecord,
          semanticChangeSetRecord,
          author: AUTHOR,
          createdAt: CREATED_AT,
          completenessDiagnostics: [],
        },
      });
      expectInitializeSuccess(initialized);

      const lifecycleHydrator = createDocumentLifecycleSnapshotRootHydrator({
        userTimezone: 'UTC',
        documentIdFactory: () => 'persistence-reloaded-doc',
      });
      const hydrateYrsFullState = jest.fn(
        lifecycleHydrator.hydrateYrsFullState.bind(lifecycleHydrator),
      );
      const persistence = createVersionPersistence({
        provider,
        hydrator: { hydrateYrsFullState },
      });

      const result = await persistence.reload({ target: 'ref', refName: 'main' });

      expect(result.ok).toBe(true);
      if (!result.ok) throw new Error(`expected reload success: ${result.error.code}`);
      materialized = result.materialized;
      expect(result.reload).toBe('fresh-lifecycle');
      expect(result.materialization).toBe('fresh-lifecycle');
      expect(result.commitId).toBe(initialized.rootCommit.id);
      expect(result.snapshotRootDigest).toEqual(snapshotRootRecord.digest);
      expect(result.snapshotRootRecord.digest).toEqual(snapshotRootRecord.digest);
      expect(result.mutationGuarantee).toBe('no-current-workbook-mutation');
      expect(hydrateYrsFullState).toHaveBeenCalledTimes(1);
      expect(materialized.documentId).toBe('persistence-reloaded-doc');
      await expect(materialized.workbook.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 11,
      });
      await expect(materialized.workbook.activeSheet.getCell('A2')).resolves.toMatchObject({
        value: 42,
      });

      const reloadedGraph = await provider.openGraph(namespace);
      const reloadedCommit = await reloadedGraph.readCommit(initialized.rootCommit.id);
      expect(reloadedCommit.status).toBe('success');
      if (reloadedCommit.status !== 'success') {
        throw new Error(
          `expected reloaded commit read success: ${reloadedCommit.diagnostics[0]?.code}`,
        );
      }
      expect(reloadedCommit.commit.payload.semanticChangeSetDigest).toEqual(
        semanticChangeSetRecord.digest,
      );
      const reloadedSemanticChangeSetRecord = await reloadedGraph.getObjectRecord({
        kind: 'object',
        objectType: 'workbook.semanticChangeSet.v1',
        digest: reloadedCommit.commit.payload.semanticChangeSetDigest,
      });
      expect(reloadedSemanticChangeSetRecord.preimage.payload).toEqual(semanticChangeSetPayload);
      expect(reloadedSemanticChangeSetRecord.preimage.payload).toMatchObject({
        changes: expect.arrayContaining([
          expect.objectContaining({
            structural: expect.objectContaining({ domain: 'named-ranges' }),
          }),
          expect.objectContaining({
            structural: expect.objectContaining({ domain: 'tables' }),
          }),
          expect.objectContaining({
            structural: expect.objectContaining({ domain: 'comments-notes' }),
          }),
          expect.objectContaining({
            structural: expect.objectContaining({
              domain: 'conditional-formatting',
              entityId: 'sheet-1!cf:cf-top-10',
              propertyPath: ['rule'],
            }),
          }),
          expect.objectContaining({
            structural: expect.objectContaining({
              domain: 'data-validation',
              entityId: 'sheet-1!range:dv-status',
              propertyPath: ['range'],
            }),
          }),
          expect.objectContaining({
            structural: expect.objectContaining({ domain: 'filters' }),
          }),
          expect.objectContaining({
            structural: expect.objectContaining({ domain: 'sorts' }),
          }),
          expect.objectContaining({
            structural: expect.objectContaining({ domain: 'charts.source-range' }),
          }),
          expect.objectContaining({
            structural: expect.objectContaining({ domain: 'floating-objects.anchors' }),
          }),
        ]),
      });

      await sourceWorkbook.activeSheet.setCell('A1', 99);
      await expect(materialized.workbook.activeSheet.getCell('A1')).resolves.toMatchObject({
        value: 11,
      });
    } finally {
      if (materialized) await materialized.dispose();
      await sourceHandle.dispose();
    }
  });

  it('fails closed when no materialization service or provider is attached', async () => {
    const persistence = createVersionPersistence();

    const result = await persistence.reload({
      target: 'commit',
      commitId: 'commit:sha256:0000000000000000000000000000000000000000000000000000000000000000',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected reload failure');
    expect(result.error.code).toBe('VERSION_PERSISTENCE_RELOAD_SERVICE_UNAVAILABLE');
    expect(result.mutationGuarantee).toBe('no-current-workbook-mutation');
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_PERSISTENCE_RELOAD_SERVICE_UNAVAILABLE',
        severity: 'error',
      }),
    ]);
  });

  it('diagnoses object-written ref-not-advanced boundaries without mutating the visible graph', async () => {
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph({
      expectedRegistryRevision: null,
      graphId: 'graph-1',
      rootWrite: {
        snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
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
    });
    expectInitializeSuccess(initialized);
    const before = await provider.readGraphRegistry();
    expect(before.status).toBe('ok');
    const persistence = createVersionPersistence({ provider });

    const result = await persistence.persistBoundary({
      boundary: 'segment-written-ref-not-advanced',
      commitId: initialized.rootCommit.id,
    });
    const after = await provider.readGraphRegistry();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(`expected boundary success: ${result.error.code}`);
    expect(result).toMatchObject({
      status: 'diagnosed',
      boundary: 'segment-written-ref-not-advanced',
      commitId: initialized.rootCommit.id,
      graphId: 'graph-1',
      recoveryAction: 'reload-visible-graph',
      mutationGuarantee: 'ref-not-mutated',
      retryable: false,
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_PERSISTENCE_BOUNDARY_REF_NOT_ADVANCED',
          severity: 'warning',
          recoveryAction: 'reload-visible-graph',
        }),
      ],
    });
    expect(after).toEqual(before);
  });

  it('fails persistence-boundary diagnostics closed without a provider', async () => {
    const persistence = createVersionPersistence();

    const result = await persistence.persistBoundary({
      boundary: 'segment-written-ref-not-advanced',
    });

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected boundary failure');
    expect(result.error.code).toBe('VERSION_PERSISTENCE_BOUNDARY_PROVIDER_UNAVAILABLE');
    expect(result.mutationGuarantee).toBe('no-write-attempted');
    expect(result.retryable).toBe(false);
  });

  it('rejects unsupported persistence-boundary requests before provider reads', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const readGraphRegistry = jest.spyOn(provider, 'readGraphRegistry');
    const persistence = createVersionPersistence({ provider });

    const result = await persistence.persistBoundary({
      boundary: 'unsupported-boundary',
    } as never);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected boundary failure');
    expect(result.error.code).toBe('VERSION_PERSISTENCE_BOUNDARY_INVALID_REQUEST');
    expect(result.mutationGuarantee).toBe('no-write-attempted');
    expect(readGraphRegistry).not.toHaveBeenCalled();
  });
});

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

function vc06SemanticChangeSetPayload() {
  return {
    schemaVersion: 1,
    changes: [
      metadataChange({
        changeId: 'mutation-1:named-range:0',
        domain: 'named-ranges',
        entityId: 'name:RevenueTotal',
        propertyPath: ['definition'],
        after: semanticObjectValue([
          { key: 'kind', value: 'Set' },
          { key: 'name', value: 'RevenueTotal' },
        ]),
        display: { entityLabel: { kind: 'value', value: 'RevenueTotal' } },
      }),
      metadataChange({
        changeId: 'mutation-1:table:0',
        domain: 'tables',
        entityId: 'sheet-1!table:table-1',
        propertyPath: ['definition'],
        after: semanticObjectValue([
          { key: 'kind', value: 'Set' },
          { key: 'tableId', value: 'table-1' },
          { key: 'name', value: 'SalesTable' },
          { key: 'sheetId', value: 'sheet-1' },
        ]),
        display: { entityLabel: { kind: 'value', value: 'SalesTable' } },
      }),
      metadataChange({
        changeId: 'mutation-1:comment:0',
        domain: 'comments-notes',
        entityId: 'sheet-1!comment:cell-a1',
        propertyPath: ['cell'],
        after: semanticObjectValue([
          { key: 'kind', value: 'Set' },
          { key: 'cellId', value: 'cell-a1' },
          { key: 'address', value: 'A1' },
        ]),
        display: { address: { kind: 'value', value: 'A1' } },
      }),
      metadataChange({
        changeId: 'mutation-1:conditional-format:0',
        domain: 'conditional-formatting',
        entityId: 'sheet-1!cf:cf-top-10',
        propertyPath: ['rule'],
        after: semanticObjectValue([
          { key: 'kind', value: 'Set' },
          { key: 'ruleId', value: 'cf-top-10' },
          { key: 'appliesTo', value: 'B2:B20' },
          { key: 'type', value: 'top10' },
        ]),
        display: { entityLabel: { kind: 'value', value: 'cf-top-10' } },
      }),
      metadataChange({
        changeId: 'mutation-1:range:0',
        domain: 'data-validation',
        entityId: 'sheet-1!range:dv-status',
        propertyPath: ['range'],
        after: semanticObjectValue([
          { key: 'kind', value: 'Set' },
          { key: 'rangeKind', value: 'Validation' },
          { key: 'rangeId', value: 'dv-status' },
          { key: 'encoding', value: 'mog-range-meta-json-v1' },
          { key: 'rowCount', value: 19 },
          { key: 'colCount', value: 1 },
          {
            key: 'anchor',
            value: semanticObjectValue([
              { key: 'kind', value: 'Elastic' },
              { key: 'startRow', value: 1 },
              { key: 'endRow', value: 19 },
              { key: 'startCol', value: 4 },
              { key: 'endCol', value: 4 },
            ]),
          },
        ]),
        display: { entityLabel: { kind: 'value', value: 'Validation:dv-status' } },
      }),
      metadataChange({
        changeId: 'mutation-1:filter:0',
        domain: 'filters',
        entityId: 'sheet-1!autoFilter',
        propertyPath: ['state'],
        after: semanticObjectValue([
          { key: 'kind', value: 'Set' },
          { key: 'hasActiveFilter', value: true },
          { key: 'visibleRowCount', value: 2 },
        ]),
        display: { entityLabel: { kind: 'value', value: 'AutoFilter' } },
      }),
      metadataChange({
        changeId: 'mutation-1:sort:0',
        domain: 'sorts',
        entityId: 'sheet-1!A1:B2',
        propertyPath: ['order'],
        after: semanticObjectValue([
          { key: 'kind', value: 'Applied' },
          { key: 'range', value: 'A1:B2' },
          { key: 'rowsMoved', value: 1 },
        ]),
        display: { address: { kind: 'value', value: 'A1:B2' } },
      }),
      metadataChange({
        changeId: 'mutation-1:chart:0',
        domain: 'charts.source-range',
        entityId: 'sheet-1!chart:chart-1',
        propertyPath: ['sourceRange'],
        after: semanticObjectValue([
          { key: 'kind', value: 'created' },
          { key: 'objectId', value: 'chart-1' },
          { key: 'objectType', value: 'chart' },
          { key: 'chartType', value: 'bar' },
          { key: 'dataRange', value: 'A1:B10' },
          { key: 'seriesRange', value: 'A1:A10' },
          { key: 'categoryRange', value: 'B1:B10' },
        ]),
        display: { entityLabel: { kind: 'value', value: 'chart-1' } },
      }),
      metadataChange({
        changeId: 'mutation-1:floating-object:0',
        domain: 'floating-objects.anchors',
        entityId: 'sheet-1!object:picture-1',
        propertyPath: ['anchor'],
        after: semanticObjectValue([
          { key: 'kind', value: 'updated' },
          { key: 'objectId', value: 'picture-1' },
          { key: 'objectType', value: 'picture' },
          { key: 'changedFields', value: { kind: 'array', values: ['anchor', 'width'] } },
          {
            key: 'bounds',
            value: semanticObjectValue([
              { key: 'x', value: 10 },
              { key: 'y', value: 20 },
              { key: 'width', value: 320 },
              { key: 'height', value: 180 },
              { key: 'rotation', value: 0 },
            ]),
          },
        ]),
        display: { entityLabel: { kind: 'value', value: 'picture-1' } },
      }),
    ],
  };
}

function metadataChange(input: {
  readonly changeId: string;
  readonly domain: string;
  readonly entityId: string;
  readonly propertyPath: readonly string[];
  readonly after: unknown;
  readonly display?: {
    readonly address?: { readonly kind: 'value'; readonly value: string };
    readonly entityLabel?: { readonly kind: 'value'; readonly value: string };
  };
}) {
  return {
    structural: {
      kind: 'metadata',
      changeId: input.changeId,
      domain: input.domain,
      entityId: input.entityId,
      propertyPath: input.propertyPath,
    },
    before: { kind: 'value', value: null },
    after: { kind: 'value', value: input.after },
    ...(input.display ? { display: input.display } : {}),
  };
}

function semanticObjectValue(fields: readonly { readonly key: string; readonly value: unknown }[]) {
  return { kind: 'object', fields };
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}
