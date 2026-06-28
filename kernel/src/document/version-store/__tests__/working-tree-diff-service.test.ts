import { jest } from '@jest/globals';

import type {
  VersionSurfaceStatus,
  WorkbookCommitId,
  WorkbookCommitRef,
} from '@mog-sdk/contracts/api';

import type { SemanticWorkbookStateEnvelope } from '../../../bridges/compute/compute-types.gen';
import type {
  SemanticMutationCaptureServices,
  SemanticMutationCaptureWorkingTreeBasis,
} from '../semantic-mutation-capture';
import type { VersionSemanticStateReaderPort } from '../semantic-state-reader';
import type { VersionStoreProvider } from '../provider';
import {
  createWorkbookVersionWorkingTreeDiffService,
  type WorkingTreeActiveCheckoutHeadResolution,
} from '../working-tree-diff-service';

const BASE_COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;
const REF_REVISION = { kind: 'counter', value: '1' } as const;

describe('WorkbookVersionWorkingTreeDiffService', () => {
  it('returns an empty read-only page for a clean working tree', async () => {
    const before = semanticEnvelope('before');
    const services = createHarness({
      surface: surfaceStatus({ dirty: false }),
      basis: basisState({ revision: 0 }),
      currentStates: [before, before],
    });

    const result = await services.service.diffWorkingTree({ pageSize: 10 });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.items).toEqual([]);
    expect(result.kind).toBe('workingTree');
    expect(result.baseCommitId).toBe(BASE_COMMIT_ID);
    expect(result.baseSemanticStateDigest).toMatchObject({ digest: 'before' });
    expect(result.currentSemanticStateDigest).toMatchObject({ digest: 'before' });
    expect(services.semanticStateReader.diffSemanticStates).not.toHaveBeenCalled();
    expect(services.provider.readGraphRegistry).not.toHaveBeenCalled();
    expect(services.semanticMutationCapture.captureNormalCommit).not.toHaveBeenCalled();
    expect(services.semanticMutationCapture.resetNormalCaptureForCheckout).not.toHaveBeenCalled();
  });

  it('diffs captured dirty preimage against current semantic state', async () => {
    const before = semanticEnvelope('before');
    const after = semanticEnvelope('after');
    const services = createHarness({
      surface: surfaceStatus({ dirty: true }),
      basis: basisState({ revision: 3, beforeSemanticState: before, pendingCaptured: 1 }),
      currentStates: [after, after],
      semanticDiff: {
        beforeDigest: before.stateDigest,
        afterDigest: after.stateDigest,
        changes: [semanticChange('change-1', '42')],
      },
    });

    const result = await services.service.diffWorkingTree({ pageSize: 10 });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.structural).toMatchObject({
      kind: 'metadata',
      changeId: 'change-1',
      entityId: 'sheet-1!A1',
    });
    expect(result.items[0]?.after).toEqual({ kind: 'value', value: '42' });
    expect(result.captureRevision).toBe(3);
    expect(result.baseSemanticStateDigest).toMatchObject({ digest: 'before' });
    expect(result.currentSemanticStateDigest).toMatchObject({ digest: 'after' });
  });

  it('projects a dirty cell value edit once when Rust emits cell aggregate and value child changes', async () => {
    const before = semanticEnvelope('before');
    const after = semanticEnvelope('after');
    const services = createHarness({
      surface: surfaceStatus({ dirty: true }),
      basis: basisState({ revision: 3, beforeSemanticState: before, pendingCaptured: 1 }),
      currentStates: [after, after],
      semanticDiff: {
        beforeDigest: before.stateDigest,
        afterDigest: after.stateDigest,
        changes: [
          semanticChange('added:cell:sheet-1:r0:c0', 'hello'),
          semanticCellValueChange('added:value:cell:sheet-1:r0:c0', 'hello'),
        ],
      },
    });

    const result = await services.service.diffWorkingTree({ pageSize: 10 });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.structural).toMatchObject({
      kind: 'metadata',
      changeId: 'added:value:cell:sheet-1:r0:c0',
      domain: 'cells.values',
      entityId: 'sheet-1!A1',
      propertyPath: ['value'],
    });
    expect(result.items[0]?.after).toEqual({ kind: 'value', value: 'hello' });
  });

  it('projects a dirty direct-format edit from the Rust semantic diff', async () => {
    const before = semanticEnvelope('before');
    const after = semanticEnvelope('after');
    const services = createHarness({
      surface: surfaceStatus({ dirty: true }),
      basis: basisState({ revision: 3, beforeSemanticState: before, pendingCaptured: 1 }),
      currentStates: [after, after],
      semanticDiff: {
        beforeDigest: before.stateDigest,
        afterDigest: after.stateDigest,
        changes: [
          semanticDirectFormatChange({
            changeId: 'added:direct-format:cell:sheet-1:r2:c1',
            sheetId: 'sheet-1',
            row: 2,
            column: 1,
            properties: {
              numberFormat: '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)',
            },
          }),
        ],
      },
    });

    const result = await services.service.diffWorkingTree({ pageSize: 10 });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      structural: {
        kind: 'metadata',
        changeId: 'added:direct-format:cell:sheet-1:r2:c1',
        domain: 'cells.formats.direct',
        entityId: 'sheet-1!B3',
        propertyPath: ['format'],
      },
      before: { kind: 'value', value: null },
      after: {
        kind: 'value',
        value: {
          kind: 'object',
          fields: [
            {
              key: 'numberFormat',
              value: '_($* #,##0.00_);_($* (#,##0.00);_($* "-"??_);_(@_)',
            },
          ],
        },
      },
      display: { address: { kind: 'value', value: 'B3' } },
      historical: { cell: { sheetId: 'sheet-1', row: 2, column: 1 } },
    });
  });

  it('projects a dirty sheet create from the Rust semantic diff', async () => {
    const before = semanticEnvelope('before');
    const after = semanticEnvelope('after');
    const services = createHarness({
      surface: surfaceStatus({ dirty: true }),
      basis: basisState({ revision: 3, beforeSemanticState: before, pendingCaptured: 1 }),
      currentStates: [after, after],
      semanticDiff: {
        beforeDigest: before.stateDigest,
        afterDigest: after.stateDigest,
        changes: [
          semanticSheetChange({
            changeId: 'added:sheet:sheet-2',
            sheetId: 'sheet-2',
            name: 'Sheet 2',
          }),
        ],
      },
    });

    const result = await services.service.diffWorkingTree({ pageSize: 10 });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      structural: {
        kind: 'metadata',
        changeId: 'added:sheet:sheet-2',
        domain: 'sheet',
        entityId: 'sheet-2',
        propertyPath: ['sheet'],
      },
      before: { kind: 'value', value: null },
      after: {
        kind: 'value',
        value: {
          kind: 'object',
          fields: [{ key: 'name', value: 'Sheet 2' }],
        },
      },
      display: { entityLabel: { kind: 'value', value: 'Sheet 2' } },
    });
  });

  it('diffs against the current branch head when no explicit checkout session exists', async () => {
    const before = semanticEnvelope('before');
    const after = semanticEnvelope('after');
    const services = createHarness({
      surface: surfaceStatus({
        dirty: true,
        current: {
          checkedOutCommitId: undefined,
          refHeadAtMaterialization: undefined,
          branchName: 'main',
          currentRefHeadId: BASE_COMMIT_ID,
        },
      }),
      basis: basisState({ revision: 2, beforeSemanticState: before, pendingCaptured: 1 }),
      currentStates: [after, after],
      activeCheckout: { status: 'absent' },
      semanticDiff: {
        beforeDigest: before.stateDigest,
        afterDigest: after.stateDigest,
        changes: [semanticChange('change-1', 'implicit-base')],
      },
    });

    const result = await services.service.diffWorkingTree({ pageSize: 10 });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.baseCommitId).toBe(BASE_COMMIT_ID);
    expect(result.targetRef).toBe('refs/heads/main');
    expect(result.items[0]?.after).toEqual({ kind: 'value', value: 'implicit-base' });
  });

  it('fails closed for uncaptured dirty mutations', async () => {
    const before = semanticEnvelope('before');
    const after = semanticEnvelope('after');
    const services = createHarness({
      surface: surfaceStatus({ dirty: true }),
      basis: {
        ...basisState({ revision: 1, beforeSemanticState: before, pendingCaptured: 1 }),
        pendingUncapturedNormalMutationCount: 1,
        hasPendingNormalMutations: true,
        hasUncapturedNormalMutations: true,
        pendingUncapturedNormalMutationSummaries: [
          {
            sequence: 1,
            operation: 'compute_set_cell',
            capturedAt: '2026-06-28T00:00:00.000Z',
            reason: 'missingOperationContext',
          },
        ],
      },
      currentStates: [after],
    });

    const result = await services.service.diffWorkingTree();

    expect(result.status).toBe('degraded');
    if (result.status !== 'degraded') return;
    expect(result.diagnostics[0]?.issueCode).toBe('VERSION_WORKING_TREE_DIFF_UNCAPTURED');
    expect(services.semanticStateReader.diffSemanticStates).not.toHaveBeenCalled();
  });

  it('blocks dirty working-tree diff while a version commit is settling', async () => {
    const commitInProgress = surfaceDiagnostic('version.surfaceStatus.commitInProgress');
    const services = createHarness({
      surface: surfaceStatus({
        dirty: true,
        dirtyFields: {
          checkoutSafe: false,
          unsafeReasons: [commitInProgress],
          diagnostics: [commitInProgress],
        },
      }),
      basis: basisState({ revision: 1 }),
      currentStates: [semanticEnvelope('current')],
    });

    const result = await services.service.diffWorkingTree();

    expect(result.status).toBe('degraded');
    if (result.status !== 'degraded') return;
    expect(result.diagnostics).toEqual([
      expect.objectContaining({
        issueCode: 'VERSION_WORKING_TREE_DIFF_COMMIT_IN_PROGRESS',
        details: expect.objectContaining({ category: 'commitInProgress' }),
      }),
    ]);
    expect(result.diagnostics.map((diagnostic) => diagnostic.issueCode)).not.toContain(
      'VERSION_WORKING_TREE_DIFF_UNAVAILABLE',
    );
    expect(services.semanticStateReader.diffSemanticStates).not.toHaveBeenCalled();
  });

  it.each([
    [
      'stale checkout',
      surfaceStatus({ dirty: true, current: { stale: true, staleReason: 'refMoved' } }),
      'VERSION_WORKING_TREE_DIFF_STALE',
    ],
    [
      'pending provider writes',
      surfaceStatus({ dirty: true, dirtyFields: { pendingProviderWrites: true } }),
      'VERSION_WORKING_TREE_DIFF_PENDING_WRITES',
    ],
    [
      'pending recalculation',
      surfaceStatus({ dirty: true, dirtyFields: { pendingRecalc: true } }),
      'VERSION_WORKING_TREE_DIFF_PENDING_RECALC',
    ],
    [
      'unsupported dirty domains',
      surfaceStatus({ dirty: true, dirtyFields: { unsupportedDirtyDomains: ['charts'] } }),
      'VERSION_WORKING_TREE_DIFF_UNSUPPORTED_DIRTY_STATE',
    ],
    [
      'active live collaboration',
      surfaceStatus({
        dirty: true,
        dirtyFields: {
          liveCollaboration: {
            state: 'active',
            statusRevision: 'collab-1',
            inFlightRemoteUpdateCount: 1,
          },
        },
      }),
      'VERSION_WORKING_TREE_DIFF_LIVE_COLLABORATION',
    ],
  ])('fails closed for %s', async (_label, surface, issueCode) => {
    const before = semanticEnvelope('before');
    const after = semanticEnvelope('after');
    const services = createHarness({
      surface,
      basis: basisState({ revision: 1, beforeSemanticState: before, pendingCaptured: 1 }),
      currentStates: [after],
    });

    const result = await services.service.diffWorkingTree();

    expect(result.status).toBe('degraded');
    if (result.status !== 'degraded') return;
    expect(result.diagnostics).toEqual([expect.objectContaining({ issueCode })]);
    expect(services.semanticStateReader.diffSemanticStates).not.toHaveBeenCalled();
  });

  it('fails closed when no active checkout base can be resolved', async () => {
    const current = semanticEnvelope('current');
    const services = createHarness({
      surface: surfaceStatus({
        dirty: true,
        current: {
          headCommitId: undefined,
          branchName: undefined,
          currentRefHeadId: undefined,
          checkedOutCommitId: undefined,
          refHeadAtMaterialization: undefined,
        },
      }),
      basis: basisState({ revision: 1, beforeSemanticState: current, pendingCaptured: 1 }),
      currentStates: [current],
      activeCheckout: { status: 'absent' },
    });

    const result = await services.service.diffWorkingTree();

    expect(result.status).toBe('degraded');
    if (result.status !== 'degraded') return;
    expect(result.diagnostics[0]).toEqual(
      expect.objectContaining({ issueCode: 'VERSION_WORKING_TREE_DIFF_UNAVAILABLE' }),
    );
    expect(services.semanticMutationCapture.readWorkingTreeBasis).not.toHaveBeenCalled();
    expect(services.semanticStateReader.readCurrentSemanticState).not.toHaveBeenCalled();
  });

  it('fails closed when the current semantic state cannot be read', async () => {
    const services = createHarness({
      surface: surfaceStatus({ dirty: true }),
      basis: basisState({ revision: 1, pendingCaptured: 1 }),
      currentStates: [],
      readCurrentSemanticStateError: new Error('semantic reader unavailable'),
    });

    const result = await services.service.diffWorkingTree();

    expect(result.status).toBe('degraded');
    if (result.status !== 'degraded') return;
    expect(result.diagnostics[0]).toEqual(
      expect.objectContaining({
        issueCode: 'VERSION_WORKING_TREE_DIFF_UNAVAILABLE',
        safeMessage: 'semantic reader unavailable',
      }),
    );
  });

  it('fails closed when a dirty workbook has no captured preimage', async () => {
    const current = semanticEnvelope('current');
    const services = createHarness({
      surface: surfaceStatus({ dirty: true }),
      basis: basisState({ revision: 1, pendingCaptured: 1 }),
      currentStates: [current],
    });

    const result = await services.service.diffWorkingTree();

    expect(result.status).toBe('degraded');
    if (result.status !== 'degraded') return;
    expect(result.diagnostics[0]).toEqual(
      expect.objectContaining({ issueCode: 'VERSION_WORKING_TREE_DIFF_UNAVAILABLE' }),
    );
    expect(services.semanticStateReader.diffSemanticStates).not.toHaveBeenCalled();
  });

  it('fails closed when semantic preimage capture failed', async () => {
    const before = semanticEnvelope('before');
    const current = semanticEnvelope('current');
    const services = createHarness({
      surface: surfaceStatus({ dirty: true }),
      basis: {
        ...basisState({ revision: 1, beforeSemanticState: before, pendingCaptured: 1 }),
        semanticStateCaptureFailure: 'preimage read failed',
      },
      currentStates: [current],
    });

    const result = await services.service.diffWorkingTree();

    expect(result.status).toBe('degraded');
    if (result.status !== 'degraded') return;
    expect(result.diagnostics[0]).toEqual(
      expect.objectContaining({
        issueCode: 'VERSION_WORKING_TREE_DIFF_UNAVAILABLE',
        safeMessage: 'preimage read failed',
      }),
    );
    expect(services.semanticStateReader.diffSemanticStates).not.toHaveBeenCalled();
  });

  it('uses Rust semantic diff digests for dirty working-tree identity', async () => {
    const before = semanticEnvelope('captured-envelope-before');
    const after = semanticEnvelope('current-envelope-after');
    const rustBefore = semanticEnvelope('rust-before');
    const rustAfter = semanticEnvelope('rust-after');
    const services = createHarness({
      surface: surfaceStatus({ dirty: true }),
      basis: basisState({ revision: 1, beforeSemanticState: before, pendingCaptured: 1 }),
      currentStates: [after, after],
      semanticDiff: {
        beforeDigest: rustBefore.stateDigest,
        afterDigest: rustAfter.stateDigest,
        changes: [semanticChange('change-1', '42')],
      },
    });

    const result = await services.service.diffWorkingTree();

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.baseSemanticStateDigest).toMatchObject({ digest: 'rust-before' });
    expect(result.currentSemanticStateDigest).toMatchObject({ digest: 'rust-after' });
  });

  it('fails closed when Rust diff omits usable state digests', async () => {
    const before = semanticEnvelope('before');
    const after = semanticEnvelope('after');
    const services = createHarness({
      surface: surfaceStatus({ dirty: true }),
      basis: basisState({ revision: 1, beforeSemanticState: before, pendingCaptured: 1 }),
      currentStates: [after],
      semanticDiff: {
        beforeDigest: semanticEnvelope('').stateDigest,
        afterDigest: after.stateDigest,
        changes: [semanticChange('change-1', '42')],
      },
    });

    const result = await services.service.diffWorkingTree();

    expect(result.status).toBe('degraded');
    if (result.status !== 'degraded') return;
    expect(result.diagnostics[0]).toEqual(
      expect.objectContaining({
        issueCode: 'VERSION_WORKING_TREE_DIFF_DIGEST_MISMATCH',
        details: expect.objectContaining({ category: 'semanticDiffDigestMissing' }),
      }),
    );
  });

  it('rejects mid-request dirty status changes', async () => {
    const before = semanticEnvelope('before');
    const after = semanticEnvelope('after');
    const services = createHarness({
      surface: [
        surfaceStatus({ dirty: true, statusRevision: 'dirty-1' }),
        surfaceStatus({ dirty: true, statusRevision: 'dirty-2' }),
      ],
      basis: basisState({ revision: 1, beforeSemanticState: before, pendingCaptured: 1 }),
      currentStates: [after, after],
      semanticDiff: {
        beforeDigest: before.stateDigest,
        afterDigest: after.stateDigest,
        changes: [semanticChange('change-1', '42')],
      },
    });

    const result = await services.service.diffWorkingTree();

    expect(result.status).toBe('degraded');
    if (result.status !== 'degraded') return;
    expect(result.diagnostics[0]?.issueCode).toBe('VERSION_WORKING_TREE_DIFF_STALE');
  });

  it('rejects mid-request capture revision changes', async () => {
    const before = semanticEnvelope('before');
    const after = semanticEnvelope('after');
    const services = createHarness({
      surface: surfaceStatus({ dirty: true }),
      basis: [
        basisState({ revision: 1, beforeSemanticState: before, pendingCaptured: 1 }),
        basisState({ revision: 2, beforeSemanticState: before, pendingCaptured: 1 }),
      ],
      currentStates: [after, after],
      semanticDiff: {
        beforeDigest: before.stateDigest,
        afterDigest: after.stateDigest,
        changes: [semanticChange('change-1', '42')],
      },
    });

    const result = await services.service.diffWorkingTree();

    expect(result.status).toBe('degraded');
    if (result.status !== 'degraded') return;
    expect(result.diagnostics[0]?.issueCode).toBe('VERSION_WORKING_TREE_DIFF_STALE');
  });

  it('rejects mid-request current semantic digest changes', async () => {
    const before = semanticEnvelope('before');
    const after = semanticEnvelope('after');
    const changedAfter = semanticEnvelope('changed-after');
    const services = createHarness({
      surface: surfaceStatus({ dirty: true }),
      basis: basisState({ revision: 1, beforeSemanticState: before, pendingCaptured: 1 }),
      currentStates: [after, changedAfter],
      semanticDiff: {
        beforeDigest: before.stateDigest,
        afterDigest: after.stateDigest,
        changes: [semanticChange('change-1', '42')],
      },
    });

    const result = await services.service.diffWorkingTree();

    expect(result.status).toBe('degraded');
    if (result.status !== 'degraded') return;
    expect(result.diagnostics[0]?.issueCode).toBe('VERSION_WORKING_TREE_DIFF_STALE');
  });

  it('binds page tokens to the current working-tree identity', async () => {
    const before = semanticEnvelope('before');
    const after = semanticEnvelope('after');
    const changedAfter = semanticEnvelope('changed-after');
    const first = createHarness({
      surface: surfaceStatus({ dirty: true }),
      basis: basisState({ revision: 1, beforeSemanticState: before, pendingCaptured: 1 }),
      currentStates: [after, after],
      semanticDiff: {
        beforeDigest: before.stateDigest,
        afterDigest: after.stateDigest,
        changes: [semanticChange('change-1', '42'), semanticChange('change-2', '43')],
      },
    });
    const firstPage = await first.service.diffWorkingTree({ pageSize: 1 });
    expect(firstPage.status).toBe('success');
    if (firstPage.status !== 'success') return;
    expect(firstPage.nextPageToken).toBeDefined();

    const second = createHarness({
      surface: surfaceStatus({ dirty: true }),
      basis: basisState({ revision: 1, beforeSemanticState: before, pendingCaptured: 1 }),
      currentStates: [changedAfter],
      semanticDiff: {
        beforeDigest: before.stateDigest,
        afterDigest: changedAfter.stateDigest,
        changes: [semanticChange('change-1', '42'), semanticChange('change-2', '43')],
      },
    });
    const stalePage = await second.service.diffWorkingTree({
      pageSize: 1,
      pageToken: firstPage.nextPageToken,
    });

    expect(stalePage.status).toBe('degraded');
    if (stalePage.status !== 'degraded') return;
    expect(stalePage.diagnostics[0]?.issueCode).toBe('VERSION_STALE_PAGE_CURSOR');
  });

  it('binds page tokens to the access context', async () => {
    const before = semanticEnvelope('before');
    const after = semanticEnvelope('after');
    const first = createHarness({
      surface: surfaceStatus({ dirty: true }),
      basis: basisState({ revision: 1, beforeSemanticState: before, pendingCaptured: 1 }),
      currentStates: [after, after],
      providerAccess: { principalScope: 'reader-a' },
      semanticDiff: {
        beforeDigest: before.stateDigest,
        afterDigest: after.stateDigest,
        changes: [semanticChange('change-1', '42'), semanticChange('change-2', '43')],
      },
    });
    const firstPage = await first.service.diffWorkingTree({ pageSize: 1 });
    expect(firstPage.status).toBe('success');
    if (firstPage.status !== 'success') return;

    const second = createHarness({
      surface: surfaceStatus({ dirty: true }),
      basis: basisState({ revision: 1, beforeSemanticState: before, pendingCaptured: 1 }),
      currentStates: [after],
      providerAccess: { principalScope: 'reader-b' },
      semanticDiff: {
        beforeDigest: before.stateDigest,
        afterDigest: after.stateDigest,
        changes: [semanticChange('change-1', '42'), semanticChange('change-2', '43')],
      },
    });
    const stalePage = await second.service.diffWorkingTree({
      pageSize: 1,
      pageToken: firstPage.nextPageToken,
    });

    expect(stalePage.status).toBe('degraded');
    if (stalePage.status !== 'degraded') return;
    expect(stalePage.diagnostics[0]?.issueCode).toBe('VERSION_STALE_PAGE_CURSOR');
  });
});

function createHarness(input: {
  readonly surface: VersionSurfaceStatus | readonly VersionSurfaceStatus[];
  readonly basis:
    | SemanticMutationCaptureWorkingTreeBasis
    | readonly SemanticMutationCaptureWorkingTreeBasis[];
  readonly currentStates: readonly SemanticWorkbookStateEnvelope[];
  readonly semanticDiff?: Awaited<ReturnType<VersionSemanticStateReaderPort['diffSemanticStates']>>;
  readonly readCurrentSemanticStateError?: Error;
  readonly activeCheckout?: WorkingTreeActiveCheckoutHeadResolution;
  readonly providerAccess?: Partial<VersionStoreProvider['accessContext']>;
}) {
  const surfaces = Array.isArray(input.surface) ? [...input.surface] : [input.surface];
  const bases = Array.isArray(input.basis) ? [...input.basis] : [input.basis];
  const currentStates = [...input.currentStates];
  const lastSurface = surfaces.at(-1)!;
  const lastBasis = bases.at(-1)!;
  const lastCurrentState = currentStates.at(-1)!;
  const semanticStateReader: VersionSemanticStateReaderPort = {
    readCurrentSemanticState: jest.fn(async () => {
      if (input.readCurrentSemanticStateError) throw input.readCurrentSemanticStateError;
      return currentStates.shift() ?? lastCurrentState;
    }),
    diffSemanticStates: jest.fn(
      async () =>
        input.semanticDiff ?? {
          beforeDigest: lastCurrentState.stateDigest,
          afterDigest: lastCurrentState.stateDigest,
          changes: [],
        },
    ),
  };
  const providerInstance = provider(input.providerAccess);
  const semanticMutationCapture = capture(() => bases.shift() ?? lastBasis);
  const service = createWorkbookVersionWorkingTreeDiffService({
    provider: providerInstance,
    semanticMutationCapture,
    semanticStateReader,
    readSurfaceStatus: jest.fn(async () => surfaces.shift() ?? lastSurface),
    readActiveCheckoutHead: jest.fn(async () => input.activeCheckout ?? activeCheckout()),
  });

  return { service, semanticStateReader, semanticMutationCapture, provider: providerInstance };
}

function activeCheckout(): Extract<
  WorkingTreeActiveCheckoutHeadResolution,
  { status: 'resolved' }
> {
  return {
    status: 'resolved',
    session: {
      checkedOutCommitId: BASE_COMMIT_ID,
      branchName: 'main',
      refHeadAtMaterialization: BASE_COMMIT_ID,
      detached: false,
    },
    head: {
      id: BASE_COMMIT_ID,
      refName: 'refs/heads/main',
      resolvedFrom: 'refs/heads/main',
      refRevision: REF_REVISION,
    } satisfies WorkbookCommitRef,
  };
}

function provider(
  accessContext: Partial<VersionStoreProvider['accessContext']> = {},
): VersionStoreProvider {
  return {
    documentScope: { documentId: 'document-1' },
    accessContext: {
      principalScope: accessContext.principalScope ?? 'test-principal',
      capabilityIds: ['version:diff'],
      diagnosticsAllowed: true,
      ...accessContext,
    },
    capabilities: {} as VersionStoreProvider['capabilities'],
    readGraphRegistry: jest.fn() as never,
    initializeGraph: jest.fn() as never,
    openGraph: jest.fn() as never,
    scanDocumentIntegrity: jest.fn() as never,
    close: jest.fn() as never,
    dispose: jest.fn() as never,
  };
}

function capture(
  readBasis: () => SemanticMutationCaptureWorkingTreeBasis,
): SemanticMutationCaptureServices {
  return {
    mutationCapture: { recordMutationResult: jest.fn() },
    captureNormalCommit: jest.fn() as never,
    capturePendingRemoteSegment: jest.fn() as never,
    readNormalCommitCaptureState: jest.fn(() => readBasis()),
    readWorkingTreeBasis: jest.fn(() => readBasis()),
    resetNormalCaptureForCheckout: jest.fn(),
  };
}

function basisState(input: {
  readonly revision: number;
  readonly beforeSemanticState?: SemanticWorkbookStateEnvelope;
  readonly pendingCaptured?: number;
}) {
  const pendingCaptured = input.pendingCaptured ?? 0;
  return {
    revision: input.revision,
    pendingCapturedNormalMutationCount: pendingCaptured,
    pendingUncapturedNormalMutationCount: 0,
    hasPendingNormalMutations: pendingCaptured > 0,
    hasUncapturedNormalMutations: false,
    ...(input.beforeSemanticState ? { beforeSemanticState: input.beforeSemanticState } : {}),
    pendingUncapturedNormalMutationSummaries: [],
  };
}

function surfaceStatus(input: {
  readonly dirty: boolean;
  readonly statusRevision?: string;
  readonly current?: Partial<VersionSurfaceStatus['current']>;
  readonly dirtyFields?: Partial<VersionSurfaceStatus['dirty']>;
}): VersionSurfaceStatus {
  return {
    schemaVersion: 1,
    documentId: 'document-1',
    stage: 'authoring',
    featureGateEnabled: true,
    storage: { ready: true, backend: 'memory', diagnostics: [] },
    current: {
      headCommitId: BASE_COMMIT_ID,
      branchName: 'refs/heads/main',
      checkedOutCommitId: BASE_COMMIT_ID,
      currentRefHeadId: BASE_COMMIT_ID,
      detached: false,
      stale: false,
      ...input.current,
    },
    dirty: {
      statusRevision: input.statusRevision ?? 'dirty-1',
      checkoutPreflightToken: `token-${input.statusRevision ?? 'dirty-1'}`,
      hasUncommittedLocalChanges: input.dirty,
      commitEligibleChanges: input.dirty,
      unsupportedDirtyDomains: [],
      pendingProviderWrites: false,
      pendingRecalc: false,
      checkoutSafe: true,
      unsafeReasons: [],
      source: 'VC-05',
      diagnostics: [],
      ...input.dirtyFields,
    },
    capabilities: {
      'version:read': { enabled: true },
      'version:diff': { enabled: true },
      'version:commit': { enabled: true },
      'version:branch': { enabled: true },
      'version:checkout': { enabled: true },
      'version:mergePreview': { enabled: true },
      'version:mergeApply': { enabled: true },
      'version:reviewRead': { enabled: true },
      'version:reviewWrite': { enabled: true },
      'version:proposal': { enabled: true },
      'version:provenance': { enabled: true },
      'version:remotePromote': { enabled: true },
      'version:revert': { enabled: true },
    },
    diagnostics: [],
  };
}

function surfaceDiagnostic(code: string): VersionSurfaceStatus['dirty']['diagnostics'][number] {
  return {
    code,
    severity: 'warning',
    message: code,
    dependency: 'VC-05',
  };
}

function semanticEnvelope(digest: string): SemanticWorkbookStateEnvelope {
  return {
    state: {
      schemaVersion: '1',
      domains: {},
      sheets: {},
    },
    stateDigest: {
      algorithm: 'sha256',
      value: digest,
    },
  };
}

function semanticChange(changeId: string, after: string) {
  const objectId = 'cell:sheet-1:r0:c0';
  return {
    changeId,
    kind: 'added',
    domainId: 'cells.values',
    objectId,
    objectKind: 'cell',
    afterRecord: {
      objectId,
      objectKind: 'cell',
      domainId: 'cells.values',
      record: {
        objectId,
        sheetId: 'sheet-1',
        row: 0,
        column: 0,
        value: {
          valueKind: 'string',
          canonicalValue: after,
        },
      },
    },
  };
}

function semanticCellValueChange(changeId: string, after: string) {
  const cellObjectId = 'cell:sheet-1:r0:c0';
  const objectId = `value:${cellObjectId}`;
  return {
    changeId,
    kind: 'added',
    domainId: 'cells.values',
    objectId,
    objectKind: 'cell-value',
    afterRecord: {
      objectId,
      objectKind: 'cell-value',
      domainId: 'cells.values',
      record: {
        valueKind: 'string',
        canonicalValue: after,
      },
    },
  };
}

function semanticDirectFormatChange(input: {
  readonly changeId: string;
  readonly sheetId: string;
  readonly row: number;
  readonly column: number;
  readonly properties: Readonly<Record<string, unknown>>;
}) {
  const cellObjectId = `cell:${input.sheetId}:r${input.row}:c${input.column}`;
  const objectId = `direct-format:${cellObjectId}`;
  return {
    changeId: input.changeId,
    kind: 'added',
    domainId: 'cells.formats.direct',
    objectId,
    objectKind: 'direct-format',
    afterRecord: {
      objectId,
      objectKind: 'direct-format',
      domainId: 'cells.formats.direct',
      record: {
        properties: input.properties,
      },
    },
  };
}

function semanticSheetChange(input: {
  readonly changeId: string;
  readonly sheetId: string;
  readonly name: string;
}) {
  const objectId = `sheet:${input.sheetId}`;
  return {
    changeId: input.changeId,
    kind: 'added',
    domainId: 'sheets',
    objectId,
    objectKind: 'sheet',
    afterRecord: {
      objectId,
      objectKind: 'sheet',
      domainId: 'sheets',
      record: {
        sheetId: input.sheetId,
        name: input.name,
        rowCount: 1000,
        columnCount: 26,
      },
    },
  };
}
