import { expect, it, jest } from '@jest/globals';

import { createRustBackedTestSemanticMutationCapture } from '../../../document/version-store/__tests__/semantic-mutation-capture-test-helpers';
import {
  cellWriteResult,
  commitId,
  commitRef,
  commitSummary,
  createMockEventBus,
  createWorkbook,
  CREATED_AT,
  emptyMutationResult,
  missingChangeSetCommitResult,
  operationContext,
  VERSION_AUTHOR,
} from './version-commit-dirty-tracking-test-utils';

export function registerWriteServiceCommitDirtyTrackingScenarios(): void {
  it('rejects a derived-only dirty marker before a permissive write service can commit', async () => {
    const eventBus = createMockEventBus();
    const semanticMutationCapture = createRustBackedTestSemanticMutationCapture();
    const commit = jest.fn(async () => ({
      status: 'success',
      commit: commitSummary('child'),
      diagnostics: [],
    }));
    const wb = createWorkbook({
      eventBus,
      versioning: {
        writeService: { commit } as any,
        semanticMutationCapture,
      },
    });
    eventBus.emit({ type: 'test:derived-only-dirty-marker' });
    semanticMutationCapture.mutationCapture.recordMutationResult({
      operation: 'compute_derived_output_promotion',
      operationContext: operationContext({
        operationId: 'derived-only-marker',
        kind: 'derived-output-promotion',
        capturePolicy: 'derivedOnly',
        writeAdmissionMode: 'shadowOnly',
        domainIds: ['cells.formulas'],
      }),
      result: cellWriteResult(42),
    });

    const commitResult = await wb.version.commit();

    expect(commitResult).toMatchObject(missingChangeSetCommitResult('uncaptured-normal-mutations'));
    expect(commit).not.toHaveBeenCalled();
    expect(wb.isDirty).toBe(true);
    expect(semanticMutationCapture.readNormalCommitCaptureState()).toMatchObject({
      pendingCapturedNormalMutationCount: 0,
      pendingUncapturedNormalMutationCount: 1,
    });
  });

  it('rejects a semantic no-op dirty marker before a permissive write service can commit', async () => {
    const eventBus = createMockEventBus();
    const semanticMutationCapture = createRustBackedTestSemanticMutationCapture(
      {},
      { diffChangeCount: () => 0 },
    );
    const commit = jest.fn(async () => ({
      status: 'success',
      commit: commitSummary('child'),
      diagnostics: [],
    }));
    const wb = createWorkbook({
      eventBus,
      versioning: {
        writeService: { commit } as any,
        semanticMutationCapture,
      },
    });
    eventBus.emit({ type: 'test:no-op-dirty-marker' });
    semanticMutationCapture.mutationCapture.recordMutationResult({
      operation: 'compute_batch_set_cells_by_position',
      operationContext: operationContext({
        operationId: 'semantic-no-op-marker',
        sheetIds: ['sheet-1'],
        domainIds: ['cells.values'],
      }),
      directEdits: [{ sheetId: 'sheet-1', row: 0, col: 0 }],
      result: emptyMutationResult(),
    });

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
                pendingCapturedNormalMutationCount: 1,
                pendingUncapturedNormalMutationCount: 0,
              }),
            }),
          }),
        ],
      },
    });
    expect(commit).not.toHaveBeenCalled();
    expect(wb.isDirty).toBe(true);
    expect(semanticMutationCapture.readNormalCommitCaptureState()).toMatchObject({
      pendingCapturedNormalMutationCount: 1,
      pendingUncapturedNormalMutationCount: 0,
    });
  });

  it('rejects zero-parent service summaries as empty normal commits', async () => {
    const commit = jest.fn(async () => ({
      status: 'success',
      commit: {
        id: commitId('child'),
        parents: [],
        createdAt: CREATED_AT,
        author: VERSION_AUTHOR,
      },
    }));
    const wb = createWorkbook({
      versioning: {
        writeService: { commit } as any,
      },
    });

    const result = await wb.version.commit();

    expect(result).toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_MISSING_CHANGE_SET',
            data: expect.objectContaining({
              mutationGuarantee: 'unknown-after-crash',
              payload: expect.objectContaining({
                operation: 'commitGraphWrite',
                reason: 'empty-normal-commit',
              }),
            }),
          }),
        ],
      },
    });
    expect(commit).toHaveBeenCalledTimes(1);
  });

  it('keeps workbook dirty when the commit save head token is stale at baseline update time', async () => {
    const eventBus = createMockEventBus();
    const commit = jest.fn(async () => ({
      status: 'success',
      commit: commitSummary('child'),
      diagnostics: [],
    }));
    const readHead = jest.fn(async () => ({
      status: 'success',
      head: commitRef('moved', '3'),
      diagnostics: [],
    }));
    const wb = createWorkbook({
      eventBus,
      versioning: {
        writeService: { commit, readHead } as any,
      },
    });
    eventBus.emit({ type: 'test:dirty-before-commit' });

    await expect(wb.version.commit()).resolves.toMatchObject({
      ok: true,
      value: {
        id: commitId('child'),
      },
    });

    expect(readHead).toHaveBeenCalled();
    expect(wb.isDirty).toBe(true);
  });
}
