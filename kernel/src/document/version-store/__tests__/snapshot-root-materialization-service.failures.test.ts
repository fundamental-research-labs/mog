import { jest } from '@jest/globals';

import { createInMemoryVersionStoreProvider, namespaceForDocumentScope } from '../provider';
import { createSnapshotRootMaterializationService } from '../snapshot-root-materialization-service';

import {
  DOCUMENT_SCOPE,
  initializeGraphWithSnapshotRoot,
  objectRecord,
} from './snapshot-root-materialization-service.test-helpers';

describe('SnapshotRootMaterializationService failures', () => {
  it('fails closed before hydration for legacy synthetic sheet-list snapshot roots', async () => {
    const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-legacy-invalid-root');
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const snapshotRootRecord = await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      sheets: [],
    });
    const initialized = await initializeGraphWithSnapshotRoot(
      provider,
      namespace,
      snapshotRootRecord,
    );
    const hydrateYrsFullState = jest.fn();
    const service = createSnapshotRootMaterializationService({
      provider,
      hydrator: { hydrateYrsFullState },
    });

    const result = await service.materializeCommitSnapshotRoot(initialized.rootCommit.id);

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected materialization failure');
    expect(result.error.code).toBe('VERSION_SNAPSHOT_ROOT_MATERIALIZATION_RELOAD_FAILED');
    expect(result.snapshotRootDigest).toEqual(snapshotRootRecord.digest);
    expect(result.mutationGuarantee).toBe('no-current-workbook-mutation');
    expect(hydrateYrsFullState).not.toHaveBeenCalled();
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        code: 'VERSION_SNAPSHOT_ROOT_MATERIALIZATION_RELOAD_FAILED',
        sourceDiagnostics: [
          expect.objectContaining({
            code: 'VERSION_SNAPSHOT_ROOT_RELOAD_INVALID_ROOT',
          }),
        ],
      }),
    ]);
  });
});
