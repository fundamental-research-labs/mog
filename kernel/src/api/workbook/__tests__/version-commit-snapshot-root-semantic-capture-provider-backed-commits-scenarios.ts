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
  cellValueMutationResult,
  expectInitializeSuccess,
  initializeInput,
  operationContext,
} from './version-commit-snapshot-root.helpers';

export function registerProviderBackedSemanticMutationCaptureScenario(): void {
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
      result: cellValueMutationResult(42),
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
}
