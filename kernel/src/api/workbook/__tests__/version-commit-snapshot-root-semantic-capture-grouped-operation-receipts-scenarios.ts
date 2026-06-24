import { jest } from '@jest/globals';

import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
} from '../../../document/version-store/provider';
import {
  DOCUMENT_SCOPE,
  createProviderBackedVersion,
  expectInitializeSuccess,
  initializeInput,
  operationContext,
  versionContext,
} from './version-commit-snapshot-root.helpers';

export function registerGroupedOperationReceiptsScenario(): void {
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
    await ctx.versioning.mutationCapture.recordPreMutation({
      operation: 'compute_create_sheet_with_default_col_width',
      operationContext: operationContext({
        operationId: 'sheet-add-create',
        groupId,
        sheetIds: ['sheet-created'],
        domainIds: ['sheets'],
      }),
    });
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
