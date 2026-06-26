import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type {
  MutationResult,
  ObjectDigest,
  RangeChange,
  SemanticWorkbookDiff,
  SemanticWorkbookState,
  SemanticWorkbookStateEnvelope,
} from '../../../bridges/compute/compute-types.gen';
import type {
  VersionNormalCommitCaptureInput,
  VersionNormalCommitCaptureResult,
} from '../commit-service';
import { createSemanticMutationCapture } from '../semantic-mutation-capture';
import type {
  SemanticMutationCaptureOptions,
  SemanticMutationCaptureServices,
  VersionMutationCaptureRecordInput,
} from '../semantic-mutation-capture';
import { classifySemanticMutationCaptureLane } from '../semantic-mutation-capture-lanes';
import type { WorkbookCommitId } from '../object-digest';
import type { VersionGraphNamespace } from '../object-store';

const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  graphId: 'graph-1',
  principalScope: 'principal-1',
};

const DOCUMENT_SCOPE = {
  workspaceId: NAMESPACE.workspaceId,
  documentId: NAMESPACE.documentId,
  principalScope: NAMESPACE.principalScope,
};

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

const NOW = new Date('2026-06-20T00:00:00.000Z');
export const COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;

export function createTestSemanticMutationCapture() {
  return createRustBackedTestSemanticMutationCapture({ author: AUTHOR, now: () => NOW });
}

export function createRustBackedTestSemanticMutationCapture(
  options: SemanticMutationCaptureOptions = {},
  testOptions: {
    readonly diffChangeCount?: (pendingCapturedNormalMutationCount: number) => number;
  } = {},
): SemanticMutationCaptureServices {
  let diffChangeCount = 0;
  let pendingBeforeCapture: Promise<void> | undefined;
  const capture = createSemanticMutationCapture({
    ...options,
    semanticStateReader: {
      readCurrentSemanticState: async () => semanticStateEnvelope('test-state'),
      diffSemanticStates: async () => testSemanticDiff(diffChangeCount),
    },
  });
  const recordPreMutation = capture.mutationCapture.recordPreMutation?.bind(
    capture.mutationCapture,
  );
  const recordMutationResult = capture.mutationCapture.recordMutationResult.bind(
    capture.mutationCapture,
  );
  const snapshotPendingRemoteMutations = (
    capture.mutationCapture as unknown as {
      snapshotPendingRemoteMutations?: () => readonly unknown[];
    }
  ).snapshotPendingRemoteMutations?.bind(capture.mutationCapture);

  function ensureBeforeCapture(input: VersionMutationCaptureRecordInput): void {
    if (classifySemanticMutationCaptureLane(input.operationContext) !== 'normalLocal') {
      return;
    }
    pendingBeforeCapture ??= Promise.resolve(
      recordPreMutation?.({
        operation: input.operation,
        ...(input.directEdits ? { directEdits: input.directEdits } : {}),
        ...(input.directEditRanges ? { directEditRanges: input.directEditRanges } : {}),
        operationContext: input.operationContext,
      }),
    );
  }

  return {
    mutationCapture: {
      recordPreMutation: (input) => {
        pendingBeforeCapture = Promise.resolve(recordPreMutation?.(input));
        return pendingBeforeCapture;
      },
      recordMutationResult: (input) => {
        ensureBeforeCapture(input);
        recordMutationResult(input);
      },
      ...(snapshotPendingRemoteMutations ? { snapshotPendingRemoteMutations } : {}),
    },
    captureNormalCommit: async (input) => {
      await pendingBeforeCapture;
      const pendingCapturedNormalMutationCount =
        capture.readNormalCommitCaptureState().pendingCapturedNormalMutationCount;
      diffChangeCount =
        testOptions.diffChangeCount?.(pendingCapturedNormalMutationCount) ??
        pendingCapturedNormalMutationCount;
      const result = await capture.captureNormalCommit(input);
      if (result.status !== 'success') return result;
      const finalize = result.finalize;
      return {
        ...result,
        finalize: (finalizeResult) => {
          finalize?.(finalizeResult);
          if (finalizeResult.status === 'success') {
            pendingBeforeCapture = undefined;
          }
        },
      };
    },
    capturePendingRemoteSegment: (input) => capture.capturePendingRemoteSegment(input),
    readNormalCommitCaptureState: () => capture.readNormalCommitCaptureState(),
    resetNormalCaptureForCheckout: (input) => {
      pendingBeforeCapture = undefined;
      capture.resetNormalCaptureForCheckout(input);
    },
  };
}

export function mutationResult(overrides: Partial<MutationResult> = {}): MutationResult {
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

export function capturedChanges(
  captured: Extract<VersionNormalCommitCaptureResult, { status: 'success' }>,
): any[] {
  const payload = captured.input.semanticChangeSetRecord.preimage.payload as any;
  return payload.reviewChanges ?? payload.changes;
}

export function semanticAfterObject(fields: { key: string; value: unknown }[]) {
  return { kind: 'value', value: { kind: 'object', fields } };
}

export function encodedRangeChange(
  sheetId: string,
  rangeId: string,
  changeKind: RangeChange['kind'],
  rangeKind: string,
): RangeChange {
  const meta = {
    rangeId,
    kind: rangeKind,
    anchor: {
      Elastic: {
        startRow: 'row-1',
        endRow: 'row-2',
        startCol: 'col-1',
        endCol: 'col-2',
      },
    },
    encoding: 'None',
    rowIds: ['row-1', 'row-2'],
    colIds: ['col-1', 'col-2'],
  };
  return {
    sheetId,
    rangeId,
    kind: changeKind,
    data: new TextEncoder().encode(JSON.stringify(meta)),
  };
}

export function floatingObjectData(id: string, type: string, data: Record<string, unknown>) {
  return {
    id,
    sheetId: 'sheet-1',
    type,
    anchor: {
      anchorRow: 1,
      anchorCol: 2,
      anchorRowOffsetEmu: 0,
      anchorColOffsetEmu: 0,
      anchorMode: 'twoCell',
      endRow: 4,
      endCol: 5,
      endRowOffsetEmu: 0,
      endColOffsetEmu: 0,
    },
    width: 320,
    height: 180,
    zIndex: 3,
    rotation: 0,
    flipH: false,
    flipV: false,
    locked: false,
    visible: true,
    printable: true,
    opacity: 1,
    name: id,
    createdAt: 1,
    updatedAt: 2,
    ...data,
  } as any;
}

export function captureInput(): VersionNormalCommitCaptureInput {
  return {
    provider: { documentScope: DOCUMENT_SCOPE },
    namespace: NAMESPACE,
    currentRef: { name: 'main', commitId: COMMIT_ID },
    currentHead: { name: 'HEAD', commitId: COMMIT_ID },
    currentMain: { name: 'main', commitId: COMMIT_ID },
  } as VersionNormalCommitCaptureInput;
}

export function expectCaptureSuccess(
  result: VersionNormalCommitCaptureResult,
): Extract<VersionNormalCommitCaptureResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected capture success: ${result.diagnostics[0]?.code}`);
  }
  return result;
}

export function expectCaptureMissingChangeSet(result: VersionNormalCommitCaptureResult): void {
  expect(result).toMatchObject({
    status: 'failed',
    diagnostics: [expect.objectContaining({ code: 'VERSION_MISSING_CHANGE_SET' })],
  });
}

function semanticStateEnvelope(seed: string): SemanticWorkbookStateEnvelope {
  return { state: semanticState(), stateDigest: digest(seed) };
}

function semanticState(): SemanticWorkbookState {
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
        cells: {
          'cell:sheet#0:r0:c0': {
            objectId: 'cell:sheet#0:r0:c0',
            sheetId: 'sheet#0',
            row: 0,
            column: 0,
            value: { valueKind: 'number', canonicalValue: 1 },
          },
        },
      },
    },
  };
}

function testSemanticDiff(changeCount: number): SemanticWorkbookDiff {
  return {
    beforeDigest: digest('before'),
    afterDigest: digest('after'),
    changes:
      changeCount > 0
        ? [
            {
              changeId: 'test-rust-diff:cell:0',
              kind: 'updated',
              domainId: 'cells.values',
              objectId: 'cell:sheet#0:r0:c0',
              objectKind: 'cell',
              beforeDigest: digest('cell-before'),
              afterDigest: digest('cell-after'),
            },
          ]
        : [],
  };
}

function digest(seed: string): ObjectDigest {
  const repeated = seed.repeat(Math.ceil(64 / seed.length)).slice(0, 64);
  return { algorithm: 'sha256', digest: repeated };
}
