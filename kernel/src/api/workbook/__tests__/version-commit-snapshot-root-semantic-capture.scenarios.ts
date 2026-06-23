import { jest } from '@jest/globals';

import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
} from '../../../document/version-store/provider';
import { WorkbookVersionImpl } from '../version';
import { attachWorkbookVersioning } from '../version-wiring';
import { versioningWithDomainSupportManifest } from './version-domain-support-test-utils';
import {
  DOCUMENT_SCOPE,
  createProviderBackedVersion,
  emptyMutationResult,
  expectInitializeSuccess,
  expectOnlyRootCommit,
  initializeInput,
  operationContext,
  versionContext,
} from './version-commit-snapshot-root.helpers';

export function registerSnapshotRootSemanticCaptureScenarios(): void {
  it('installs default semantic mutation capture for provider-backed commits', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const encodeDiff = jest.fn(async () => new Uint8Array([0x05, 0x06]));
    const ctx = {} as any;
    attachWorkbookVersioning(
      ctx,
      versioningWithDomainSupportManifest({
        provider,
        snapshotRootByteSyncPort: { encodeDiff },
      }),
    );
    ctx.versioning.mutationCapture.recordMutationResult({
      operation: 'compute_batch_set_cells_by_position',
      operationContext: operationContext({
        operationId: 'local-cell-write-1',
        sheetIds: ['sheet-1'],
        domainIds: ['cells.values'],
      }),
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
        author: { actorKind: 'user', displayName: 'User One', redacted: true },
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

  it('rejects semantic no-op writes without creating empty commits', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-noop', 'root'));
    expectInitializeSuccess(initialized);
    const encodeDiff = jest.fn(async () => new Uint8Array([0x07]));
    const version = createProviderBackedVersion(provider, encodeDiff);

    versionContext(version).versioning.mutationCapture.recordMutationResult({
      operation: 'compute_batch_set_cells_by_position',
      operationContext: operationContext({
        operationId: 'semantic-noop-write',
        sheetIds: ['sheet-1'],
        domainIds: ['cells.values'],
      }),
      directEdits: [{ sheetId: 'sheet-1', row: 0, col: 0 }],
      result: emptyMutationResult(),
    });

    const commitResult = await version.commit();

    expect(commitResult).toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_MISSING_CHANGE_SET',
            data: expect.objectContaining({
              redacted: true,
              mutationGuarantee: 'no-write-attempted',
            }),
          }),
        ],
      },
    });
    expect(JSON.stringify(commitResult)).not.toContain('semantic-noop-write');
    expect(encodeDiff).not.toHaveBeenCalled();
    await expectOnlyRootCommit(provider, 'graph-noop', initialized);
  });

  it(
    'rejects contextless semantic mutations before snapshot capture with redacted diagnostics',
    async () => {
      const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
      const initialized = await provider.initializeGraph(
        await initializeInput('graph-missing-context', 'root'),
      );
      expectInitializeSuccess(initialized);
      const encodeDiff = jest.fn(async () => new Uint8Array([0x08]));
      const version = createProviderBackedVersion(provider, encodeDiff);
      const forbiddenPayload = 'raw-contextless-secret';

      versionContext(version).versioning.mutationCapture.recordMutationResult({
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
                value: forbiddenPayload,
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

      const commitResult = await version.commit();

      expect(commitResult).toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_MISSING_CHANGE_SET',
              message: 'The version commit has no eligible captured change set.',
              data: expect.objectContaining({
                redacted: true,
                mutationGuarantee: 'no-write-attempted',
              }),
            }),
          ],
        },
      });
      expect(JSON.stringify(commitResult)).not.toContain(forbiddenPayload);
      expect(encodeDiff).not.toHaveBeenCalled();
      await expectOnlyRootCommit(provider, 'graph-missing-context', initialized);
    },
  );

  it('preserves grouped operation receipts in committed mutation segments', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-grouped-receipts', 'root'),
    );
    expectInitializeSuccess(initialized);
    const encodeDiff = jest.fn(async () => new Uint8Array([0x09]));
    const version = createProviderBackedVersion(provider, encodeDiff);
    const groupId = 'sheet-add-group-1';

    const ctx = versionContext(version);
    ctx.versioning.mutationCapture.recordMutationResult({
      operation: 'compute_create_sheet_with_default_col_width',
      operationContext: operationContext({
        operationId: 'sheet-add-create',
        groupId,
        sheetIds: ['sheet-created'],
        domainIds: ['sheets'],
      }),
      result: {
        sheetChanges: [
          {
            sheetId: 'sheet-created',
            kind: 'Set',
            field: 'sheet',
            name: 'Forecast',
            index: 1,
          },
        ],
      },
    });
    ctx.versioning.mutationCapture.recordMutationResult({
      operation: 'compute_move_sheet',
      operationContext: operationContext({
        operationId: 'sheet-add-move',
        groupId,
        sheetIds: ['sheet-created'],
        domainIds: ['sheets'],
      }),
      result: {
        sheetChanges: [
          {
            sheetId: 'sheet-created',
            kind: 'Set',
            field: 'order',
            oldIndex: 1,
            index: 0,
          },
        ],
      },
    });

    const commitResult = await version.commit();
    expect(commitResult).toMatchObject({ ok: true });
    if (!commitResult.ok) throw new Error(`expected commit success: ${commitResult.error.code}`);

    const graph = await provider.openGraph(
      namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-grouped-receipts'),
    );
    const read = await graph.readCommit(commitResult.value.id);
    expect(read.status).toBe('success');
    if (read.status !== 'success') throw new Error('expected committed record to be readable');
    const segmentDigests = read.commit.payload.mutationSegmentDigests;
    expect(segmentDigests).toHaveLength(2);

    const segmentPayloads = await Promise.all(
      segmentDigests.map(async (digest) => {
        const record = await graph.getObjectRecord({
          kind: 'object',
          objectType: 'workbook.mutationSegment.v1',
          digest,
        });
        return record.preimage.payload as any;
      }),
    );

    expect(segmentPayloads.map((payload) => payload.operation)).toEqual([
      'compute_create_sheet_with_default_col_width',
      'compute_move_sheet',
    ]);
    expect(segmentPayloads.map((payload) => payload.operationContext.operationId)).toEqual([
      'sheet-add-create',
      'sheet-add-move',
    ]);
    expect(segmentPayloads.map((payload) => payload.operationContext.groupId)).toEqual([
      groupId,
      groupId,
    ]);
  });
}
