import { jest } from '@jest/globals';

import type {
  ObjectDigest,
  SemanticWorkbookDiff,
  SemanticWorkbookState,
  SemanticWorkbookStateEnvelope,
} from '../../../bridges/compute/compute-types.gen';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
} from '../../../document/version-store/provider';
import { WorkbookVersionImpl } from '../version';
import { attachWorkbookVersioning } from '../version-wiring';
import {
  installVersionDomainDetectorNoopsOnBridgeMock,
  versioningWithDomainSupportManifest,
} from './version-domain-support-test-utils';
import {
  DOCUMENT_SCOPE,
  cellValueMutationResult,
  expectInitializeSuccess,
  expectOnlyRootCommit,
  initializeInput,
  operationContext,
} from './version-commit-snapshot-root.helpers';

export function registerProviderBackedSemanticMutationCaptureScenario(): void {
  it('derives Rust semantic capture from the compute bridge for provider-backed commits', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const encodeDiff = jest.fn(async () => new Uint8Array([0x05, 0x06]));
    const before = semanticState(null);
    const after = semanticState(42);
    const beforeEnvelope = envelope(before, digest('before'));
    const afterEnvelope = envelope(after, digest('after'));
    const semanticDiff: SemanticWorkbookDiff = {
      beforeDigest: beforeEnvelope.stateDigest,
      afterDigest: afterEnvelope.stateDigest,
      changes: [
        {
          changeId: 'updated:cell:sheet#0:r0:c0',
          kind: 'updated',
          domainId: 'cells.values',
          objectId: 'cell:sheet#0:r0:c0',
          objectKind: 'cell',
          beforeDigest: digest('cell-before'),
          afterDigest: digest('cell-after'),
        },
      ],
    };
    const semanticWorkbookStateEnvelope = jest
      .fn()
      .mockResolvedValueOnce(beforeEnvelope)
      .mockResolvedValueOnce(afterEnvelope);
    const diffSemanticWorkbookStates = jest.fn().mockResolvedValue(semanticDiff);
    const ctx = {
      computeBridge: {
        semanticWorkbookStateEnvelope,
        diffSemanticWorkbookStates,
      },
    } as any;
    installVersionDomainDetectorNoopsOnBridgeMock(ctx.computeBridge);
    attachWorkbookVersioning(
      ctx,
      versioningWithDomainSupportManifest({
        provider,
        snapshotRootByteSyncPort: { encodeDiff },
      }),
    );
    await ctx.versioning.mutationCapture.recordPreMutation({
      operation: 'compute_batch_set_cells_by_position',
      operationContext: operationContext({
        operationId: 'local-cell-write-1',
        sheetIds: ['sheet-1'],
        domainIds: ['cells.values'],
      }),
      directEdits: [{ sheetId: 'sheet-1', row: 0, col: 0 }],
    });
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
    if (!commitResult.ok) {
      throw new Error(`expected commit success: ${JSON.stringify(commitResult.error, null, 2)}`);
    }
    expect(commitResult).toMatchObject({
      ok: true,
      value: {
        parents: [initialized.rootCommit.id],
        createdAt: expect.any(String),
        author: { actorKind: 'user', displayName: 'User One', redacted: true },
      },
    });
    const committed = commitResult.value;

    expect(encodeDiff).toHaveBeenCalledTimes(1);
    expect(semanticWorkbookStateEnvelope).toHaveBeenCalledTimes(2);
    expect(diffSemanticWorkbookStates).toHaveBeenCalledWith(before, after);

    const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
    const read = await graph.readCommit(committed.id);
    expect(read.status).toBe('success');
    if (read.status !== 'success') throw new Error('expected committed record to be readable');

    const semanticChangeSetRecord = await graph.getObjectRecord({
      kind: 'object',
      objectType: 'workbook.semanticChangeSet.v1',
      digest: read.commit.payload.semanticChangeSetDigest,
    });
    expect(semanticChangeSetRecord.preimage.payload).toMatchObject({
      schemaVersion: 1,
      source: {
        kind: 'rustSemanticDiff',
        beforeStateDigest: semanticDiff.beforeDigest,
        afterStateDigest: semanticDiff.afterDigest,
      },
      changes: [expect.objectContaining(semanticDiff.changes[0])],
      semanticDiff: {
        beforeDigest: semanticDiff.beforeDigest,
        afterDigest: semanticDiff.afterDigest,
        changes: [expect.objectContaining(semanticDiff.changes[0])],
      },
      reviewChanges: [
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

  it('rejects provider-backed normal commits when no Rust semantic reader is attached', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(
      await initializeInput('graph-missing-reader', 'root'),
    );
    expectInitializeSuccess(initialized);
    const encodeDiff = jest.fn(async () => new Uint8Array([0x07, 0x08]));
    const ctx = { computeBridge: {} } as any;
    installVersionDomainDetectorNoopsOnBridgeMock(ctx.computeBridge);
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
        operationId: 'local-cell-write-missing-reader',
        sheetIds: ['sheet-1'],
        domainIds: ['cells.values'],
      }),
      directEdits: [{ sheetId: 'sheet-1', row: 0, col: 0 }],
      result: cellValueMutationResult(42),
    });
    const version = new WorkbookVersionImpl(ctx);

    await expect(version.commit()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [expect.objectContaining({ code: 'VERSION_MISSING_CHANGE_SET' })],
      },
    });
    expect(encodeDiff).not.toHaveBeenCalled();

    await expectOnlyRootCommit(provider, 'graph-missing-reader', initialized);
  });
}

function semanticState(value: unknown): SemanticWorkbookState {
  return {
    schemaVersion: 'semantic-workbook-state.v1',
    workbookId: 'workbook-1',
    domains: {
      'cells.values': {
        domainId: 'cells.values',
        domainClass: 'authored',
        capabilityState: 'supported',
      },
    },
    sheets: {
      'sheet#0': {
        sheetId: 'sheet#0',
        name: 'Sheet1',
        rowCount: 1,
        columnCount: 1,
        rows: {},
        columns: {},
        cells:
          value === null
            ? {}
            : {
                'cell:sheet#0:r0:c0': {
                  objectId: 'cell:sheet#0:r0:c0',
                  sheetId: 'sheet#0',
                  row: 0,
                  column: 0,
                  value: {
                    valueKind: typeof value === 'number' ? 'number' : 'string',
                    canonicalValue: value,
                  },
                },
              },
      },
    },
  };
}

function envelope(
  state: SemanticWorkbookState,
  stateDigest: ObjectDigest,
): SemanticWorkbookStateEnvelope {
  return { state, stateDigest };
}

function digest(seed: string): ObjectDigest {
  const repeated = seed.repeat(Math.ceil(64 / seed.length)).slice(0, 64);
  return { algorithm: 'sha256', digest: repeated };
}
