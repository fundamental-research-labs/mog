import type { VersionAuthor, VersionOperationContext } from '@mog-sdk/contracts/versioning';
import { jest } from '@jest/globals';

import type {
  MutationResult,
  SemanticWorkbookDiff,
  SemanticWorkbookStateEnvelope,
} from '../../../bridges/compute/compute-types.gen';
import type {
  VersionNormalCommitCaptureInput,
  VersionNormalCommitCaptureResult,
} from '../commit-service';
import type { WorkbookCommitId } from '../object-digest';
import type { VersionGraphNamespace } from '../object-store';
import { createSemanticMutationCapture } from '../semantic-mutation-capture';
import { createRustBackedTestSemanticMutationCapture } from './semantic-mutation-capture-test-helpers';

const DOCUMENT_SCOPE = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  graphId: 'graph-1',
  principalScope: 'principal-1',
};

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

const NOW = new Date('2026-06-20T00:00:00.000Z');
const COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;

describe('semantic mutation capture dirty state', () => {
  it('skips pre-mutation semantic state reads for uncaptured row and column format metadata', async () => {
    const { capture, readCurrentSemanticState } = createCaptureWithReader();
    const operationContext = normalLocalOperationContext({
      operationId: 'formats.setRanges:1',
      domainIds: ['formats'],
    });

    await capture.mutationCapture.recordPreMutation?.({
      operation: 'compute_set_col_format',
      operationContext,
    });

    expect(readCurrentSemanticState).not.toHaveBeenCalled();

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_set_col_format',
      operationContext,
      result: mutationResult(),
    });

    expect(capture.readNormalCommitCaptureState()).toMatchObject({
      pendingCapturedNormalMutationCount: 0,
      pendingUncapturedNormalMutationCount: 1,
      hasPendingNormalMutations: true,
      hasUncapturedNormalMutations: true,
    });
  });

  it('skips pre-mutation semantic state reads for direct cell writes without edit evidence', async () => {
    const { capture, readCurrentSemanticState } = createCaptureWithReader();
    const operationContext = normalLocalOperationContext({
      operationId: 'worksheet.setCell:missing-direct-edits',
      domainIds: ['cells.values'],
    });

    await capture.mutationCapture.recordPreMutation?.({
      operation: 'compute_batch_set_cells_by_position',
      operationContext,
    });

    expect(readCurrentSemanticState).not.toHaveBeenCalled();

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_batch_set_cells_by_position',
      operationContext,
      result: mutationResult(),
    });

    expect(capture.readNormalCommitCaptureState()).toMatchObject({
      pendingCapturedNormalMutationCount: 0,
      pendingUncapturedNormalMutationCount: 1,
      hasPendingNormalMutations: true,
      hasUncapturedNormalMutations: true,
    });
  });

  it('keeps pre-mutation semantic state reads for direct cell writes with edit evidence', async () => {
    const { capture, readCurrentSemanticState } = createCaptureWithReader();
    const operationContext = normalLocalOperationContext({
      operationId: 'worksheet.setCell:1',
      domainIds: ['cells.values'],
    });
    const directEdits = [{ sheetId: 'sheet-1', row: 0, col: 0 }];

    await capture.mutationCapture.recordPreMutation?.({
      operation: 'compute_batch_set_cells_by_position',
      operationContext,
      directEdits,
    });

    expect(readCurrentSemanticState).toHaveBeenCalledTimes(1);

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_batch_set_cells_by_position',
      operationContext,
      directEdits,
      result: mutationResult(),
    });

    expect(capture.readNormalCommitCaptureState()).toMatchObject({
      pendingCapturedNormalMutationCount: 1,
      pendingUncapturedNormalMutationCount: 0,
      hasPendingNormalMutations: true,
      hasUncapturedNormalMutations: false,
    });
  });

  it('captures parsed bulk cell writes with edit evidence', async () => {
    const { capture, readCurrentSemanticState } = createCaptureWithReader();
    const operationContext = normalLocalOperationContext({
      operationId: 'worksheet.setCells:parsed',
      domainIds: ['cells.values'],
    });
    const directEditRanges = [
      { sheetId: 'sheet-1', startRow: 0, startCol: 0, endRow: 99, endCol: 99 },
    ];

    await capture.mutationCapture.recordPreMutation?.({
      operation: 'compute_set_cell_values_parsed',
      operationContext,
      directEditRanges,
    });

    expect(readCurrentSemanticState).toHaveBeenCalledTimes(1);

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_set_cell_values_parsed',
      operationContext,
      directEditRanges,
      result: mutationResult(),
    });

    expect(capture.readNormalCommitCaptureState()).toMatchObject({
      pendingCapturedNormalMutationCount: 1,
      pendingUncapturedNormalMutationCount: 0,
      hasPendingNormalMutations: true,
      hasUncapturedNormalMutations: false,
    });
  });

  it('reads a working-tree basis without draining pending normal capture', async () => {
    const { capture } = createCaptureWithReader();
    const operationContext = normalLocalOperationContext({
      operationId: 'worksheet.setCell:working-tree-basis',
      domainIds: ['cells.values'],
    });
    const directEdits = [{ sheetId: 'sheet-1', row: 0, col: 0 }];

    await capture.mutationCapture.recordPreMutation?.({
      operation: 'compute_batch_set_cells_by_position',
      operationContext,
      directEdits,
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_batch_set_cells_by_position',
      operationContext,
      directEdits,
      result: mutationResult(),
    });

    const before = capture.readNormalCommitCaptureState();
    const basis = capture.readWorkingTreeBasis();
    const after = capture.readNormalCommitCaptureState();

    expect(basis).toMatchObject({
      revision: before.revision,
      pendingCapturedNormalMutationCount: 1,
      pendingUncapturedNormalMutationCount: 0,
      hasPendingNormalMutations: true,
      hasUncapturedNormalMutations: false,
      beforeSemanticState: expect.objectContaining({
        stateDigest: expect.objectContaining({ digest: 'semantic-state-digest' }),
      }),
      pendingUncapturedNormalMutationSummaries: [],
    });
    expect(after).toEqual(before);
  });

  it('keeps uncaptured normal mutations in the capture state after successful finalization', async () => {
    const capture = createRustBackedTestSemanticMutationCapture({ author: AUTHOR, now: () => NOW });

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_unsupported_normal_local_write',
      result: mutationResult(),
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_rename_compute_sheet',
      result: mutationResult({
        sheetChanges: [
          {
            sheetId: 'sheet-1',
            kind: 'Set',
            field: 'name',
            oldName: 'Sheet1',
            name: 'Renamed',
          },
        ],
      }),
    });

    expect(capture.readNormalCommitCaptureState()).toMatchObject({
      pendingCapturedNormalMutationCount: 1,
      pendingUncapturedNormalMutationCount: 1,
      hasPendingNormalMutations: true,
      hasUncapturedNormalMutations: true,
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    captured.finalize?.({ status: 'success', commitId: COMMIT_ID });

    expect(capture.readNormalCommitCaptureState()).toMatchObject({
      pendingCapturedNormalMutationCount: 0,
      pendingUncapturedNormalMutationCount: 1,
      hasPendingNormalMutations: true,
      hasUncapturedNormalMutations: true,
    });
  });

  it('defers empty direct cell write receipts to the Rust semantic diff', async () => {
    const capture = createRustBackedTestSemanticMutationCapture({ author: AUTHOR, now: () => NOW });

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_batch_set_cells_by_position',
      operationContext: {
        operationId: 'worksheet.setCell:1',
        kind: 'mutation',
        author: AUTHOR,
        createdAt: NOW.toISOString(),
        sheetIds: ['sheet-1'],
        domainIds: ['cells'],
        capturePolicy: 'commitEligible',
        writeAdmissionMode: 'capture',
      },
      directEdits: [{ sheetId: 'sheet-1', row: 0, col: 0 }],
      result: mutationResult(),
    });

    expect(capture.readNormalCommitCaptureState()).toMatchObject({
      pendingCapturedNormalMutationCount: 1,
      pendingUncapturedNormalMutationCount: 0,
      hasPendingNormalMutations: true,
      hasUncapturedNormalMutations: false,
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(captured.input.semanticChangeSetRecord.preimage.payload).toMatchObject({
      schemaVersion: 1,
      source: { kind: 'rustSemanticDiff' },
      changes: [expect.objectContaining({ changeId: 'test-rust-diff:cell:0' })],
      reviewChanges: [],
    });
    expect(captured.input.mutationSegmentRecords?.[0]?.preimage.payload).toMatchObject({
      segmentId: 'mutation-1',
      operation: 'compute_batch_set_cells_by_position',
      changeIds: [],
      directEdits: [{ sheetId: 'sheet-1', row: 0, col: 0, address: 'A1' }],
    });

    captured.finalize?.({ status: 'success', commitId: COMMIT_ID });
    expect(capture.readNormalCommitCaptureState()).toMatchObject({
      pendingCapturedNormalMutationCount: 0,
      pendingUncapturedNormalMutationCount: 0,
      hasPendingNormalMutations: false,
      hasUncapturedNormalMutations: false,
    });
  });

  it('captures large fully projected plain cell writes with sheet names without a Rust semantic reader', async () => {
    const capture = createSemanticMutationCapture({
      author: AUTHOR,
      now: () => NOW,
      readSheetName: async (sheetId) => (sheetId === 'sheet-1' ? 'Sheet1' : null),
    });
    const operationContext = normalLocalOperationContext({
      operationId: 'worksheet.paste:large-plain-values',
      domainIds: ['cells.values'],
    });
    const directEdits = cellDirectEdits(100, 100);
    const directEditRanges = [
      { sheetId: 'sheet-1', startRow: 0, startCol: 0, endRow: 99, endCol: 99 },
    ];

    await capture.mutationCapture.recordPreMutation?.({
      operation: 'compute_batch_set_cells_by_position',
      operationContext,
      directEdits,
      directEditRanges,
    });
    capture.mutationCapture.recordMutationResult({
      operation: 'compute_batch_set_cells_by_position',
      operationContext,
      directEdits,
      directEditRanges,
      result: mutationResult({
        recalc: { ...mutationResult().recalc, changedCells: cellChanges(100, 100) },
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));

    expect(captured.input.semanticChangeSetRecord.preimage.payload).toMatchObject({
      schemaVersion: 1,
      source: {
        kind: 'semanticMutationProjection',
        reviewProjectionChangeCount: 10_000,
      },
      changes: [],
      compactReviewProjection: {
        schemaVersion: 1,
        kind: 'rectangularCellValueProjection',
        sheetId: 'sheet-1',
        sheetName: 'Sheet1',
        rowStart: 0,
        rowEnd: 99,
        columnStart: 0,
        columnEnd: 99,
        changeCount: 10_000,
        before: { kind: 'constant', value: { kind: 'blank' } },
        after: { kind: 'constant', value: 1 },
      },
    });
    expect(
      (captured.input.semanticChangeSetRecord.preimage.payload as any).reviewChanges,
    ).toBeUndefined();
    expect(captured.input.mutationSegmentRecords?.[0]?.preimage.payload).toMatchObject({
      segmentId: 'mutation-1',
      operation: 'compute_batch_set_cells_by_position',
      changeIds: [],
      changeIdCount: 10_000,
      omittedChangeIds: { reason: 'large-change-set', count: 10_000 },
      directEdits: [],
      directEditCount: 10_000,
      omittedDirectEdits: { reason: 'covered-by-direct-edit-ranges', count: 10_000 },
      directEditRanges: [{ sheetId: 'sheet-1', startRow: 0, startCol: 0, endRow: 99, endCol: 99 }],
    });
  });
});

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

function cellChanges(rows: number, columns: number): MutationResult['recalc']['changedCells'] {
  const out: MutationResult['recalc']['changedCells'] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      out.push({
        sheetId: 'sheet-1',
        position: { row, col },
        oldValue: undefined,
        value: 1,
      } as MutationResult['recalc']['changedCells'][number]);
    }
  }
  return out;
}

function cellDirectEdits(
  rows: number,
  columns: number,
): Array<{ sheetId: string; row: number; col: number }> {
  const out: Array<{ sheetId: string; row: number; col: number }> = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < columns; col++) {
      out.push({ sheetId: 'sheet-1', row, col });
    }
  }
  return out;
}

function captureInput(): VersionNormalCommitCaptureInput {
  return {
    provider: { documentScope: DOCUMENT_SCOPE },
    graph: {},
    accessContext: {},
    namespace: NAMESPACE,
    registry: {},
    currentHead: {
      name: 'HEAD',
      target: 'refs/heads/main',
      revision: { providerEpoch: 'test', counter: 1 },
    },
    currentMain: currentRef(),
    currentRef: currentRef(),
    options: {},
  } as VersionNormalCommitCaptureInput;
}

function currentRef() {
  return {
    name: 'refs/heads/main',
    commitId: COMMIT_ID,
    revision: { providerEpoch: 'test', counter: 1 },
    updatedAt: NOW.toISOString(),
  };
}

function expectCaptureSuccess(
  result: VersionNormalCommitCaptureResult,
): Extract<VersionNormalCommitCaptureResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected capture success: ${result.diagnostics[0]?.code}`);
  }
  return result;
}

function createCaptureWithReader() {
  const readCurrentSemanticState = jest.fn(async () => semanticStateEnvelope());
  const diffSemanticStates = jest.fn(async () => semanticWorkbookDiff());
  const capture = createSemanticMutationCapture({
    author: AUTHOR,
    now: () => NOW,
    semanticStateReader: {
      readCurrentSemanticState,
      diffSemanticStates,
    },
  });
  return { capture, readCurrentSemanticState };
}

function normalLocalOperationContext(input: {
  readonly operationId: string;
  readonly domainIds: readonly string[];
}): VersionOperationContext {
  return {
    operationId: input.operationId,
    kind: 'mutation',
    author: AUTHOR,
    createdAt: NOW.toISOString(),
    sheetIds: ['sheet-1'],
    domainIds: input.domainIds,
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
  };
}

function semanticStateEnvelope(): SemanticWorkbookStateEnvelope {
  return {
    state: {
      schemaVersion: 'semantic-workbook-state.v1',
      workbookId: 'workbook-1',
      domains: {},
      sheets: {},
    },
    stateDigest: {
      algorithm: 'sha256',
      digest: 'semantic-state-digest',
    },
  };
}

function semanticWorkbookDiff(): SemanticWorkbookDiff {
  return {
    beforeDigest: {
      algorithm: 'sha256',
      digest: 'semantic-state-before',
    },
    afterDigest: {
      algorithm: 'sha256',
      digest: 'semantic-state-after',
    },
    changes: [],
  };
}
