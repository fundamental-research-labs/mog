import { expect, it, jest } from '@jest/globals';

import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import { createSemanticMutationCapture } from '../../../document/version-store/semantic-mutation-capture';
import {
  cellWriteResult,
  commitId,
  commitRef,
  commitSummary,
  createMockEventBus,
  createWorkbook,
  CREATED_AT,
  DOCUMENT_SCOPE,
  emptyMutationResult,
  expectInitializeSuccess,
  expectOnlyRootCommit,
  initializeInput,
  missingChangeSetCommitResult,
  operationContext,
  VERSION_AUTHOR,
} from './version-commit-dirty-tracking-test-utils';

export function registerProviderCommitDirtyTrackingScenarios(): void {
  it('clears workbook dirty after a successful commit only when captured state is drained', async () => {
    const eventBus = createMockEventBus();
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-clean', 'root'),
    );
    expectInitializeSuccess(initialized);
    const semanticMutationCapture = createSemanticMutationCapture();
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
    const semanticMutationCapture = createSemanticMutationCapture();
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

export function registerWriteServiceCommitDirtyTrackingScenarios(): void {
  it('rejects a derived-only dirty marker before a permissive write service can commit', async () => {
    const eventBus = createMockEventBus();
    const semanticMutationCapture = createSemanticMutationCapture();
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

    expect(commitResult).toMatchObject(
      missingChangeSetCommitResult('uncaptured-normal-mutations'),
    );
    expect(commit).not.toHaveBeenCalled();
    expect(wb.isDirty).toBe(true);
    expect(semanticMutationCapture.readNormalCommitCaptureState()).toMatchObject({
      pendingCapturedNormalMutationCount: 0,
      pendingUncapturedNormalMutationCount: 1,
    });
  });

  it('rejects a semantic no-op dirty marker before a permissive write service can commit', async () => {
    const eventBus = createMockEventBus();
    const semanticMutationCapture = createSemanticMutationCapture();
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

    expect(commitResult).toMatchObject(
      missingChangeSetCommitResult('uncaptured-normal-mutations'),
    );
    expect(commit).not.toHaveBeenCalled();
    expect(wb.isDirty).toBe(true);
    expect(semanticMutationCapture.readNormalCommitCaptureState()).toMatchObject({
      pendingCapturedNormalMutationCount: 0,
      pendingUncapturedNormalMutationCount: 1,
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

export function registerProviderResidualDirtyTrackingScenarios(): void {
  it('keeps workbook dirty when a local mutation is not captured by the committed range', async () => {
    const eventBus = createMockEventBus();
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-gap', 'root'));
    expectInitializeSuccess(initialized);
    const semanticMutationCapture = createSemanticMutationCapture();
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

export function registerAsyncCommitDirtyTrackingScenarios(): void {
  it('keeps workbook dirty when another dirty event lands during the async commit', async () => {
    const eventBus = createMockEventBus();
    let resolveCommit!: (value: unknown) => void;
    let notifyCommitStarted!: () => void;
    const commitStarted = new Promise<void>((resolve) => {
      notifyCommitStarted = resolve;
    });
    const commit = jest.fn(() => {
      notifyCommitStarted();
      return new Promise((resolve) => {
        resolveCommit = resolve;
      });
    });
    const wb = createWorkbook({
      eventBus,
      versioning: {
        writeService: { commit } as any,
      },
    });
    eventBus.emit({ type: 'test:dirty-before-commit' });

    const commitResult = wb.version.commit();
    await commitStarted;
    eventBus.emit({ type: 'test:dirty-during-commit' });
    resolveCommit(commitSummary('child'));

    await expect(commitResult).resolves.toMatchObject({ ok: true });
    expect(wb.isDirty).toBe(true);
  });
}
