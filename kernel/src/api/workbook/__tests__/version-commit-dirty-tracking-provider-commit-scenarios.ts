import { expect, it, jest } from '@jest/globals';

import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import { createRustBackedTestSemanticMutationCapture } from '../../../document/version-store/__tests__/semantic-mutation-capture-test-helpers';
import {
  cellWriteResult,
  createMockEventBus,
  createWorkbook,
  DOCUMENT_SCOPE,
  expectInitializeSuccess,
  expectOnlyRootCommit,
  initializeInput,
  operationContext,
} from './version-commit-dirty-tracking-test-utils';

export function registerProviderCommitDirtyTrackingScenarios(): void {
  it('clears workbook dirty after a successful commit only when captured state is drained', async () => {
    const eventBus = createMockEventBus();
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-clean', 'root'),
    );
    expectInitializeSuccess(initialized);
    const semanticMutationCapture = createRustBackedTestSemanticMutationCapture();
    const wb = createWorkbook({
      eventBus,
      versioning: {
        provider,
        semanticMutationCapture,
        snapshotRootByteSyncPort: { encodeDiff: jest.fn(async () => new Uint8Array([0x01])) },
      },
    });
    eventBus.emit({ type: 'test:dirty' });
    semanticMutationCapture.mutationCapture.recordMutationResult({
      operation: 'compute_batch_set_cells_by_position',
      operationContext: operationContext({
        operationId: 'dirty-clean-cell-write',
        sheetIds: ['sheet-1'],
        domainIds: ['cells.values'],
      }),
      directEdits: [{ sheetId: 'sheet-1', row: 0, col: 0 }],
      result: cellWriteResult(42),
    });

    const commitResult = await wb.version.commit();
    expect(commitResult).toMatchObject({ ok: true });

    expect(wb.isDirty).toBe(false);
    expect(semanticMutationCapture.readNormalCommitCaptureState()).toMatchObject({
      pendingCapturedNormalMutationCount: 0,
      pendingUncapturedNormalMutationCount: 0,
    });
  });

  it('rejects a stale dirty marker without creating an empty provider-backed commit', async () => {
    const eventBus = createMockEventBus();
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-stale-dirty', 'root'),
    );
    expectInitializeSuccess(initialized);
    const semanticMutationCapture = createRustBackedTestSemanticMutationCapture();
    const encodeDiff = jest.fn(async () => new Uint8Array([0x03]));
    const wb = createWorkbook({
      eventBus,
      versioning: {
        provider,
        semanticMutationCapture,
        snapshotRootByteSyncPort: { encodeDiff },
      },
    });
    eventBus.emit({ type: 'test:stale-dirty-marker' });

    const commitResult = await wb.version.commit();

    expect(commitResult).toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_MISSING_CHANGE_SET',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                reason: 'empty-normal-capture',
                dirtyWorkingState: true,
                pendingCapturedNormalMutationCount: 0,
                pendingUncapturedNormalMutationCount: 0,
              }),
            }),
          }),
        ],
      },
    });
    expect(encodeDiff).not.toHaveBeenCalled();
    expect(wb.isDirty).toBe(true);
    expect(semanticMutationCapture.readNormalCommitCaptureState()).toMatchObject({
      pendingCapturedNormalMutationCount: 0,
      pendingUncapturedNormalMutationCount: 0,
    });
    await expectOnlyRootCommit(provider, 'graph-stale-dirty', initialized);
  });
}
