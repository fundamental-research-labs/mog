import { jest } from '@jest/globals';

import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
} from '../../../document/version-store/provider';
import { decodeWorkbookSnapshotRootRecord } from '../../../document/version-store/snapshot-root-capture';
import {
  CREATED_AT,
  DOCUMENT_SCOPE,
  createNormalCommitCapture,
  createWorkbookVersion,
  expectInitializeSuccess,
  initializeInput,
} from './version-commit-snapshot-root.helpers';

export function registerSnapshotRootMaterializationScenarios(): void {
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
    expect(snapshotRootRecord.preimage).toMatchObject({
      objectType: 'workbook.snapshotRoot.v1',
      schemaVersion: 1,
      payloadEncoding: 'bytes',
      dependencies: [],
    });
    expect(Array.from(snapshotRootRecord.preimage.payload as Uint8Array)).toEqual(
      Array.from(fullStateBytes),
    );
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
}
