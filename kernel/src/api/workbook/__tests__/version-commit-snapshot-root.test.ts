import { jest } from '@jest/globals';

import type { VersionAuthor } from '@mog-sdk/contracts/versioning';
import type { VersionNormalCommitCapture } from '../../../document/version-store/commit-service';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';
import {
  decodeWorkbookSnapshotRootRecord,
  YRS_FULL_STATE_SNAPSHOT_ROOT_KIND,
  YRS_FULL_STATE_SNAPSHOT_ROOT_SOURCE,
} from '../../../document/version-store/snapshot-root-capture';
import { WorkbookVersionImpl } from '../version';
import { attachWorkbookVersioning } from '../version-wiring';

const CREATED_AT = '2026-06-20T00:00:00.000Z';
const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

describe('WorkbookVersion commit snapshot-root capture', () => {
  it('materializes normal commit snapshot roots through the configured byte-sync port', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const fullStateBytes = new Uint8Array([0x01, 0x02, 0x03, 0x04]);
    const encodeDiff = jest.fn(async () => fullStateBytes);
    const captureNormalCommit = jest.fn(createNormalCommitCapture('child'));
    const version = createWorkbookVersion({
      provider,
      captureNormalCommit,
      snapshotRootByteSyncPort: { encodeDiff },
    });

    const commitResult = await version.commit();
    expect(commitResult).toMatchObject({
      ok: true,
      value: {
        parents: [initialized.rootCommit.id],
        createdAt: CREATED_AT,
        author: { actorKind: 'user', displayName: 'User One', redacted: true },
      },
    });
    if (!commitResult.ok) throw new Error(`expected commit success: ${commitResult.error.code}`);
    const committed = commitResult.value;

    expect(captureNormalCommit).toHaveBeenCalledTimes(1);
    expect(encodeDiff).toHaveBeenCalledTimes(1);
    expect(Array.from(encodeDiff.mock.calls[0]?.[0] as Uint8Array)).toEqual([0]);

    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    const read = await graph.readCommit(committed.id);
    expect(read.status).toBe('success');
    if (read.status !== 'success') throw new Error('expected committed record to be readable');

    const snapshotRootRecord = await graph.getObjectRecord({
      kind: 'object',
      objectType: 'workbook.snapshotRoot.v1',
      digest: read.commit.payload.snapshotRootDigest,
    });
    expect(snapshotRootRecord.preimage.payload).toMatchObject({
      schemaVersion: 1,
      kind: YRS_FULL_STATE_SNAPSHOT_ROOT_KIND,
      encoding: 'base64',
      byteLength: fullStateBytes.byteLength,
      source: YRS_FULL_STATE_SNAPSHOT_ROOT_SOURCE,
    });
    expect(snapshotRootRecord.preimage.payload).not.toHaveProperty('sheets');
    expect(Array.from(decodeWorkbookSnapshotRootRecord(snapshotRootRecord))).toEqual(
      Array.from(fullStateBytes),
    );
  });

  it('keeps provider-failed diagnostics when materialized snapshot-root capture fails', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const encodeDiff = jest.fn(async () => new Uint8Array());
    const captureNormalCommit = jest.fn(createNormalCommitCapture('child'));
    const version = createWorkbookVersion({
      provider,
      captureNormalCommit,
      snapshotRootByteSyncPort: { encodeDiff },
    });

    await expect(version.commit()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PROVIDER_FAILED',
            data: expect.objectContaining({ mutationGuarantee: 'no-write-attempted' }),
          }),
        ],
      },
    });
    expect(captureNormalCommit).toHaveBeenCalledTimes(1);
    expect(encodeDiff).toHaveBeenCalledTimes(1);

    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    await expect(graph.readHead()).resolves.toMatchObject({
      status: 'success',
      head: {
        id: initialized.rootCommit.id,
        refRevision: initialized.initialHead.revision,
      },
    });
  });

  it('installs default semantic mutation capture for provider-backed commits', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const encodeDiff = jest.fn(async () => new Uint8Array([0x05, 0x06]));
    const ctx = {} as any;
    attachWorkbookVersioning(ctx, {
      provider,
      snapshotRootByteSyncPort: { encodeDiff },
    });
    ctx.versioning.mutationCapture.recordMutationResult({
      operation: 'compute_batch_set_cells_by_position',
      directEdits: [{ sheetId: 'sheet-1', row: 0, col: 0 }],
      result: {
        recalc: {
          changedCells: [
            {
              cellId: 'cell-a1',
              sheetId: 'sheet-1',
              position: { row: 0, col: 0 },
              oldValue: null,
              value: 42,
              extraFlags: 0,
            },
          ],
          projectionChanges: [],
          errors: [],
          validationAnnotations: [],
          metrics: {},
        },
      },
    });
    const version = new WorkbookVersionImpl(ctx);

    const commitResult = await version.commit();
    expect(commitResult).toMatchObject({
      ok: true,
      value: {
        parents: [initialized.rootCommit.id],
        createdAt: expect.any(String),
        author: { actorKind: 'system', displayName: 'Mog Version Capture', redacted: true },
      },
    });
    if (!commitResult.ok) throw new Error(`expected commit success: ${commitResult.error.code}`);
    const committed = commitResult.value;

    expect(encodeDiff).toHaveBeenCalledTimes(1);

    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    const read = await graph.readCommit(committed.id);
    expect(read.status).toBe('success');
    if (read.status !== 'success') throw new Error('expected committed record to be readable');

    const semanticChangeSetRecord = await graph.getObjectRecord({
      kind: 'object',
      objectType: 'workbook.semanticChangeSet.v1',
      digest: read.commit.payload.semanticChangeSetDigest,
    });
    expect(semanticChangeSetRecord.preimage.payload).toEqual({
      schemaVersion: 1,
      changes: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-1:cell:0',
            domain: 'cell',
            entityId: 'sheet-1!A1',
            propertyPath: ['value'],
          },
          before: { kind: 'value', value: null },
          after: { kind: 'value', value: 42 },
          display: { address: { kind: 'value', value: 'A1' } },
        },
      ],
    });

    await expect(version.commit()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [expect.objectContaining({ code: 'VERSION_MISSING_CHANGE_SET' })],
      },
    });
    expect(encodeDiff).toHaveBeenCalledTimes(1);
  });
});

function createWorkbookVersion(
  versioning: Parameters<typeof attachWorkbookVersioning>[1],
): WorkbookVersionImpl {
  const ctx = {} as any;
  attachWorkbookVersioning(ctx, versioning);
  return new WorkbookVersionImpl(ctx);
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
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
        label,
        changes: [],
      }),
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

function createNormalCommitCapture(label: string): VersionNormalCommitCapture {
  return async ({ namespace, currentMain }) => ({
    status: 'success',
    input: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        parent: currentMain.commitId,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [{ id: `${label}-change-1`, domain: 'test' }],
      }),
      mutationSegmentRecords: [
        await objectRecord(namespace, 'workbook.mutationSegment.v1', {
          segmentId: `${label}-segment-1`,
          baseCommitId: currentMain.commitId,
        }),
      ],
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  });
}
