import { jest } from '@jest/globals';

import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import {
  DOCUMENT_SCOPE,
  cellValueMutationResult,
  createProviderBackedVersion,
  expectInitializeSuccess,
  expectOnlyRootCommit,
  initializeInput,
  versionContext,
} from './version-commit-snapshot-root.helpers';

export function registerContextlessSemanticMutationsScenario(): void {
  it('rejects contextless semantic mutations before snapshot capture with redacted diagnostics', async () => {
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
      result: cellValueMutationResult(forbiddenPayload),
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
  });
}
