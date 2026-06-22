import { jest } from '@jest/globals';

(globalThis as any).window = {};

import type { BridgeTransport } from '@rust-bridge/client';
import type { IKernelContext } from '@mog-sdk/contracts/kernel';
import type {
  VersionOperationContext,
  VersionShadowObservationRecord,
} from '@mog-sdk/contracts/versioning';
import { ComputeCore } from '../compute-core';
import type { MutationResult } from '../compute-types.gen';
import type { MutationAdmissionDiagnostic } from '../mutation-admission';

function mutationResult(overrides: Partial<MutationResult> = {}): MutationResult {
  return {
    recalc: {
      changedCells: [],
      projectionChanges: [],
      errors: [],
      validationAnnotations: [],
      metrics: {},
    },
    ...overrides,
  } as MutationResult;
}

function makeMockContext(overrides: Partial<IKernelContext> = {}): IKernelContext {
  return {
    clock: {
      now: jest.fn(() => 1782086400000),
      dateNow: jest.fn(() => 1782086400000),
    },
    workbookLinkScope: jest.fn(() => ({
      requestingDocumentId: 'doc-shadow-1',
      requestingSessionId: 'session-1',
      actor: 'user-1',
      principal: { tags: ['user'] },
    })),
    eventBus: { emit: jest.fn(), on: jest.fn(() => () => {}), off: jest.fn() },
    setPendingUndoDescription: jest.fn(),
    getPendingUndoDescription: jest.fn(() => null),
    clearPendingUndoDescription: jest.fn(),
    destroy: jest.fn(),
    services: {
      undo: {
        notifyForwardMutation: jest.fn(async () => undefined),
      },
    },
    ...overrides,
  } as unknown as IKernelContext;
}

function createStartedCore(ctx: IKernelContext, transport: BridgeTransport): ComputeCore {
  const core = new ComputeCore(ctx, 'test-doc', transport);
  (core as any)._phase = 'STARTED';
  (core as any).engineCreated = true;
  return core;
}

describe('version mutation shadow observation', () => {
  it('emits redacted production mutation observations without requiring mutation capture', async () => {
    const observations: VersionShadowObservationRecord[] = [];
    const result = mutationResult({
      recalc: {
        changedCells: [
          {
            cellId: 'cell-a1',
            sheetId: 'sheet-1',
            position: { row: 0, col: 0 },
            oldValue: 'private-old',
            value: 'private-new',
            extraFlags: 0,
          },
        ],
        projectionChanges: [],
        errors: [],
        validationAnnotations: [],
        metrics: {},
      },
    });
    const ctx = makeMockContext({
      versioning: {
        shadowObservationSink: {
          recordObservation: (record: VersionShadowObservationRecord) => {
            observations.push(record);
          },
        },
        shadowObservationOptions: {
          environmentId: 'headless-local',
          rolloutStage: 'shadow-only',
          redactionPolicy: 'metadata-only',
          redactionPolicyDigest: 'sha256:redaction-policy',
        },
      },
    } as unknown as Partial<IKernelContext>);
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), result]),
    };
    const core = createStartedCore(ctx, transport);
    const operationContext: VersionOperationContext = {
      operationId: 'operation-shadow-1',
      kind: 'mutation',
      author: { authorId: 'user-1', actorKind: 'user' },
      createdAt: '2026-06-20T00:00:00.000Z',
      workbookId: 'doc-shadow-1',
      sheetIds: ['sheet-1'],
      domainIds: ['cells.values'],
      capturePolicy: 'commitEligible',
      writeAdmissionMode: 'capture',
    };

    await core.mutatePublic(
      'compute_batch_set_cells_by_position',
      () =>
        transport.call('compute_batch_set_cells_by_position', { docId: 'test-doc' }) as Promise<
          [Uint8Array, MutationResult]
        >,
      [{ sheetId: 'sheet-1', row: 0, col: 0 }],
      { operationContext },
    );

    expect(observations).toHaveLength(1);
    expect(observations[0]).toMatchObject({
      schemaVersion: 1,
      recordKind: 'version-shadow-observation',
      observedAt: '2026-06-22T00:00:00.000Z',
      environmentId: 'headless-local',
      documentId: 'doc-shadow-1',
      rolloutStage: 'shadow-only',
      captureMode: 'shadow',
      sampleStatus: 'observed',
      operation: {
        command: 'compute_batch_set_cells_by_position',
        operationId: 'operation-shadow-1',
        kind: 'mutation',
        entrypointIds: ['compute_batch_set_cells_by_position'],
        domainIds: ['cells.values'],
        sheetIds: ['sheet-1'],
        capturePolicy: 'commitEligible',
        writeAdmissionMode: 'capture',
        domainClass: 'authored',
      },
      actor: {
        actorKind: 'user',
        redactedAuthorClass: 'user',
      },
      result: {
        changedCellCount: 1,
        directEditCount: 1,
        directEditRangeCount: 0,
        affectedSheetIds: ['sheet-1'],
        diagnosticCodes: [],
      },
      redaction: {
        policy: 'metadata-only',
        policyDigest: 'sha256:redaction-policy',
      },
    });
    expect(JSON.stringify(observations[0])).not.toContain('private-new');
    expect(observations[0].sourceArtifactRefs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          artifactId: 'operation-context',
          digest: expect.objectContaining({ algorithm: 'opaque' }),
        }),
        expect.objectContaining({
          artifactId: 'mutation-result',
          digest: expect.objectContaining({ algorithm: 'opaque' }),
        }),
      ]),
    );
  });

  it('converts observation sink failures into diagnostics without failing the mutation', async () => {
    const diagnostics: MutationAdmissionDiagnostic[] = [];
    const ctx = makeMockContext({
      versioning: {
        shadowObservationSink: {
          recordObservation: () => {
            throw new Error('sink unavailable');
          },
        },
      },
      versioningAdmissionDiagnostics: {
        record: (diagnostic: MutationAdmissionDiagnostic) => diagnostics.push(diagnostic),
      },
    } as unknown as Partial<IKernelContext>);
    const transport: BridgeTransport & { call: jest.Mock } = {
      call: jest.fn(async () => [new Uint8Array(), mutationResult()]),
    };
    const core = createStartedCore(ctx, transport);

    await expect(
      core.mutatePublic(
        'compute_set_cell',
        () =>
          transport.call('compute_set_cell', { docId: 'test-doc' }) as Promise<
            [Uint8Array, MutationResult]
          >,
      ),
    ).resolves.toEqual(expect.any(Object));

    expect(diagnostics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: 'versioning.shadow-observation.sink-error',
          severity: 'warning',
          command: 'compute_set_cell',
        }),
      ]),
    );
    expect(transport.call).toHaveBeenCalledWith('compute_set_cell', { docId: 'test-doc' });
  });
});
