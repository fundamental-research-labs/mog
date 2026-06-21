import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { MutationResult } from '../../../bridges/compute/compute-types.gen';
import { createSemanticMutationCapture } from '../semantic-mutation-capture';
import type { WorkbookCommitId } from '../object-digest';
import type { VersionGraphNamespace } from '../object-store';
import type {
  VersionNormalCommitCaptureInput,
  VersionNormalCommitCaptureResult,
} from '../commit-service';

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

describe('semantic mutation capture range cell operations', () => {
  it('captures clear range changes inside the authored range and preserves before formulas', async () => {
    const capture = createSemanticMutationCapture({ author: AUTHOR, now: () => NOW });

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_clear_range',
      directEditRanges: [{ sheetId: 'sheet-1', startRow: 0, startCol: 0, endRow: 1, endCol: 0 }],
      result: mutationResult({
        recalc: {
          changedCells: [
            {
              cellId: 'cell-a1',
              sheetId: 'sheet-1',
              position: { row: 0, col: 0 },
              oldValue: 10,
              value: null,
              extraFlags: 0,
            },
            {
              cellId: 'cell-a2',
              sheetId: 'sheet-1',
              position: { row: 1, col: 0 },
              oldFormula: '=A1*2',
              oldValue: 20,
              value: null,
              extraFlags: 0,
            },
            {
              cellId: 'cell-b2-cascade',
              sheetId: 'sheet-1',
              position: { row: 1, col: 1 },
              oldValue: 40,
              value: 0,
              extraFlags: 0,
            },
          ],
          projectionChanges: [],
          errors: [],
          validationAnnotations: [],
          metrics: {},
        },
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(captured.input.semanticChangeSetRecord.preimage.payload).toEqual({
      schemaVersion: 1,
      changes: [
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-1:cell:0',
            domain: 'cell',
            entityId: 'sheet-1!A1',
            propertyPath: ['value'],
          },
          before: { kind: 'value', value: 10 },
          after: { kind: 'value', value: null },
          display: { address: { kind: 'value', value: 'A1' } },
        },
        {
          structural: {
            kind: 'metadata',
            changeId: 'mutation-1:cell:1',
            domain: 'cell',
            entityId: 'sheet-1!A2',
            propertyPath: ['value'],
          },
          before: { kind: 'value', value: { kind: 'formula', formula: '=A1*2', result: 20 } },
          after: { kind: 'value', value: null },
          display: { address: { kind: 'value', value: 'A2' } },
        },
      ],
    });
    expect(captured.input.mutationSegmentRecords?.[0]?.preimage.payload).toMatchObject({
      operation: 'compute_clear_range',
      changeIds: ['mutation-1:cell:0', 'mutation-1:cell:1'],
      directEditRanges: [
        {
          sheetId: 'sheet-1',
          startRow: 0,
          startCol: 0,
          endRow: 1,
          endCol: 0,
          address: 'A1:A2',
        },
      ],
    });
  });

  it('captures replaceAll changed cells from exact edits instead of searched range', async () => {
    const capture = createSemanticMutationCapture({ author: AUTHOR, now: () => NOW });

    capture.mutationCapture.recordMutationResult({
      operation: 'compute_replace_all_in_range',
      directEdits: [
        { sheetId: 'sheet-1', row: 0, col: 0 },
        { sheetId: 'sheet-1', row: 0, col: 1 },
      ],
      directEditRanges: [{ sheetId: 'sheet-1', startRow: 0, startCol: 0, endRow: 0, endCol: 2 }],
      result: mutationResult({
        data: 2,
        recalc: {
          changedCells: [
            {
              cellId: 'cell-a1',
              sheetId: 'sheet-1',
              position: { row: 0, col: 0 },
              oldValue: 'old total',
              value: 'new total',
              extraFlags: 0,
            },
            {
              cellId: 'cell-b1',
              sheetId: 'sheet-1',
              position: { row: 0, col: 1 },
              oldValue: 'old detail',
              value: 'new detail',
              extraFlags: 0,
            },
            {
              cellId: 'cell-c1-formula-cascade',
              sheetId: 'sheet-1',
              position: { row: 0, col: 2 },
              oldFormula: '=A1&B1',
              newFormula: '=A1&B1',
              oldValue: 'old totalold detail',
              value: 'new totalnew detail',
              extraFlags: 0,
            },
            {
              cellId: 'cell-a2-cascade',
              sheetId: 'sheet-1',
              position: { row: 1, col: 0 },
              oldValue: 'old derived',
              value: 'new derived',
              extraFlags: 0,
            },
          ],
          projectionChanges: [],
          errors: [],
          validationAnnotations: [],
          metrics: {},
        },
      }),
    });

    const captured = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect((captured.input.semanticChangeSetRecord.preimage.payload as any).changes).toHaveLength(2);
    expect(captured.input.semanticChangeSetRecord.preimage.payload).toMatchObject({
      schemaVersion: 1,
      changes: [
        {
          structural: { entityId: 'sheet-1!A1' },
          before: { kind: 'value', value: 'old total' },
          after: { kind: 'value', value: 'new total' },
        },
        {
          structural: { entityId: 'sheet-1!B1' },
          before: { kind: 'value', value: 'old detail' },
          after: { kind: 'value', value: 'new detail' },
        },
      ],
    });
    expect(captured.input.mutationSegmentRecords?.[0]?.preimage.payload).toMatchObject({
      directEdits: [
        { sheetId: 'sheet-1', row: 0, col: 0, address: 'A1' },
        { sheetId: 'sheet-1', row: 0, col: 1, address: 'B1' },
      ],
      directEditRanges: [{ address: 'A1:C1' }],
    });

    captured.finalize?.({ status: 'success', commitId: COMMIT_ID });
    const afterSuccess = expectCaptureSuccess(await capture.captureNormalCommit(captureInput()));
    expect(afterSuccess.input.mutationSegmentRecords).toEqual([]);
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

function captureInput(): VersionNormalCommitCaptureInput {
  return { namespace: NAMESPACE } as VersionNormalCommitCaptureInput;
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
