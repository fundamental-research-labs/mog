import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { MutationResult, RangeChange } from '../../../bridges/compute/compute-types.gen';
import type {
  VersionNormalCommitCaptureInput,
  VersionNormalCommitCaptureResult,
} from '../commit-service';
import { createSemanticMutationCapture } from '../semantic-mutation-capture';
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
  return createSemanticMutationCapture({ author: AUTHOR, now: () => NOW });
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
  return (captured.input.semanticChangeSetRecord.preimage.payload as any).changes;
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
  return { sheetId, rangeId, kind: changeKind, data: new TextEncoder().encode(JSON.stringify(meta)) };
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
