import { jest } from '@jest/globals';

import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
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

export function registerSemanticNoopWritesScenario(): void {
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
}
