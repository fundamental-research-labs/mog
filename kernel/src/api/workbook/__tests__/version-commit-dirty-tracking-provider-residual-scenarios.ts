import { expect, it, jest } from '@jest/globals';

import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import { createRustBackedTestSemanticMutationCapture } from '../../../document/version-store/__tests__/semantic-mutation-capture-test-helpers';
import {
  cellWriteResult,
  createMockEventBus,
  createWorkbook,
  DOCUMENT_SCOPE,
  emptyMutationResult,
  expectInitializeSuccess,
  initializeInput,
  operationContext,
} from './version-commit-dirty-tracking-test-utils';

export function registerProviderResidualDirtyTrackingScenarios(): void {
  it('keeps workbook dirty when a local mutation is not captured by the committed range', async () => {
    const eventBus = createMockEventBus();
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-gap', 'root'));
    expectInitializeSuccess(initialized);
    const semanticMutationCapture = createRustBackedTestSemanticMutationCapture();
    const wb = createWorkbook({
      eventBus,
      versioning: {
        provider,
        semanticMutationCapture,
        snapshotRootByteSyncPort: { encodeDiff: jest.fn(async () => new Uint8Array([0x02])) },
      },
    });
    eventBus.emit({ type: 'test:dirty' });
    semanticMutationCapture.mutationCapture.recordMutationResult({
      operation: 'compute_unsupported_normal_local_write',
      operationContext: operationContext({
        operationId: 'dirty-gap-unsupported',
        domainIds: ['unsupported'],
      }),
      result: emptyMutationResult(),
    });
    semanticMutationCapture.mutationCapture.recordMutationResult({
      operation: 'compute_batch_set_cells_by_position',
      operationContext: operationContext({
        operationId: 'dirty-gap-cell-write',
        sheetIds: ['sheet-1'],
        domainIds: ['cells.values'],
      }),
      directEdits: [{ sheetId: 'sheet-1', row: 0, col: 0 }],
      result: cellWriteResult(42),
    });

    await expect(wb.version.commit()).resolves.toMatchObject({ ok: true });

    expect(wb.isDirty).toBe(true);
    expect(semanticMutationCapture.readNormalCommitCaptureState()).toMatchObject({
      pendingCapturedNormalMutationCount: 0,
      pendingUncapturedNormalMutationCount: 1,
    });
  });
}
