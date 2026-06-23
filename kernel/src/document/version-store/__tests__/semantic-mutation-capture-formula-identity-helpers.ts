import { jest } from '@jest/globals';

import type {
  SemanticWorkbookDiff,
  SemanticWorkbookStateEnvelope,
} from '../../../bridges/compute/compute-types.gen';
import { createSemanticMutationCapture } from '../semantic-mutation-capture';
import { createComputeBridgeSemanticStateReader } from '../semantic-state-reader';
import {
  AUTHOR,
  NOW,
  mutationResult,
  semanticDigest,
  semanticEnvelope,
  semanticWorkbookState,
} from './semantic-mutation-capture-formula-test-helpers';

const FORMULA_IDENTITY_OPERATION = 'compute_batch_set_cells_by_position';

type FormulaIdentityCapture = ReturnType<typeof createSemanticMutationCapture>;

export function createCanonicalFormulaIdentityCapture() {
  const beforeState = semanticWorkbookState();
  const afterState = semanticWorkbookState({
    'cell:sheet#0:r1:c0': {
      objectId: 'cell:sheet#0:r1:c0',
      sheetId: 'sheet#0',
      row: 1,
      column: 0,
      value: { valueKind: 'number', canonicalValue: 43 },
      formula: {
        normalizedFormula: '{0}+1',
        dependencyObjectIds: ['cell:sheet#0:r0:c0'],
        refs: [
          {
            kind: 'cell',
            objectId: 'cell:sheet#0:r0:c0',
            sheetId: 'sheet#0',
            row: 0,
            column: 0,
            rowAbsolute: false,
            columnAbsolute: false,
          },
        ],
        dynamicArray: false,
        volatile: false,
        aggregate: false,
      },
    },
  });
  const beforeEnvelope = semanticEnvelope(beforeState, 'b');
  const afterEnvelope = semanticEnvelope(afterState, 'c');
  const semanticDiff = canonicalFormulaIdentityDiff(beforeEnvelope, afterEnvelope);
  const semanticWorkbookStateEnvelope = jest
    .fn()
    .mockResolvedValueOnce(beforeEnvelope)
    .mockResolvedValueOnce(afterEnvelope);
  const diffSemanticWorkbookStates = jest.fn().mockResolvedValue(semanticDiff);
  const capture = createSemanticMutationCapture({
    author: AUTHOR,
    now: () => NOW,
    semanticStateReader: createComputeBridgeSemanticStateReader({
      semanticWorkbookStateEnvelope,
      diffSemanticWorkbookStates,
    } as any),
  });

  return {
    beforeState,
    afterState,
    beforeEnvelope,
    afterEnvelope,
    semanticDiff,
    semanticWorkbookStateEnvelope,
    diffSemanticWorkbookStates,
    capture,
  };
}

export async function recordCanonicalFormulaIdentityMutation(
  capture: FormulaIdentityCapture,
): Promise<void> {
  await capture.mutationCapture.recordPreMutation?.({
    operation: FORMULA_IDENTITY_OPERATION,
  });
  capture.mutationCapture.recordMutationResult({
    operation: FORMULA_IDENTITY_OPERATION,
    directEdits: [{ sheetId: 'sheet-1', row: 1, col: 0 }],
    result: mutationResult({
      recalc: {
        changedCells: [
          {
            cellId: 'cell-a2',
            sheetId: 'sheet-1',
            position: { row: 1, col: 0 },
            oldValue: null,
            newFormula: '=A1+1',
            value: 43,
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
}

export function expectFormulaIdentityStateReaderCalls(
  harness: ReturnType<typeof createCanonicalFormulaIdentityCapture>,
): void {
  expect(harness.semanticWorkbookStateEnvelope).toHaveBeenCalledTimes(2);
  expect(harness.diffSemanticWorkbookStates).toHaveBeenCalledWith(
    harness.beforeState,
    harness.afterState,
  );
}

export function expectCanonicalFormulaIdentityPayload(
  payload: any,
  envelopes: {
    readonly beforeEnvelope: SemanticWorkbookStateEnvelope;
    readonly afterEnvelope: SemanticWorkbookStateEnvelope;
  },
): void {
  expect(payload.changes).toEqual(payload.semanticDiff.changes);
  expect(payload).toMatchObject({
    schemaVersion: 1,
    source: {
      kind: 'rustSemanticDiff',
      beforeStateDigest: envelopes.beforeEnvelope.stateDigest,
      afterStateDigest: envelopes.afterEnvelope.stateDigest,
    },
    changes: [
      expect.objectContaining({
        domainId: 'cells.values',
        objectId: 'cell:sheet#0:r1:c0',
        afterRecord: {
          objectId: 'cell:sheet#0:r1:c0',
          objectKind: 'cell',
          domainId: 'cells.values',
          record: expect.objectContaining({
            value: { valueKind: 'number', canonicalValue: 43 },
          }),
        },
      }),
      expect.objectContaining({
        domainId: 'cells.formulas',
        objectId: 'formula:cell:sheet#0:r1:c0',
        afterRecord: {
          objectId: 'formula:cell:sheet#0:r1:c0',
          objectKind: 'cell-formula',
          domainId: 'cells.formulas',
          record: expect.objectContaining({
            normalizedFormula: '{0}+1',
            dependencyObjectIds: ['cell:sheet#0:r0:c0'],
            refs: [
              expect.objectContaining({
                kind: 'cell',
                objectId: 'cell:sheet#0:r0:c0',
                sheetId: 'sheet#0',
                row: 0,
                column: 0,
              }),
            ],
          }),
        },
      }),
    ],
    reviewChanges: [
      {
        structural: {
          kind: 'metadata',
          changeId: 'mutation-1:cell:0',
          domain: 'cell',
          entityId: 'sheet-1!A2',
          propertyPath: ['value'],
        },
        before: { kind: 'value', value: null },
        after: { kind: 'value', value: { kind: 'formula', formula: '=A1+1', result: 43 } },
        display: { address: { kind: 'value', value: 'A2' } },
      },
    ],
  });
  const canonicalJson = JSON.stringify(payload.changes);
  expect(canonicalJson).toContain('"{0}+1"');
  expect(canonicalJson).toContain('"canonicalValue":43');
  expect(canonicalJson).not.toContain('=A1+1');
  expect(canonicalJson).not.toContain('"A1"');
  expect(canonicalJson).not.toContain('"A2"');
}

function canonicalFormulaIdentityDiff(
  beforeEnvelope: SemanticWorkbookStateEnvelope,
  afterEnvelope: SemanticWorkbookStateEnvelope,
): SemanticWorkbookDiff {
  return {
    beforeDigest: beforeEnvelope.stateDigest,
    afterDigest: afterEnvelope.stateDigest,
    changes: [
      {
        changeId: 'added:cell:sheet#0:r1:c0',
        kind: 'added',
        domainId: 'cells.values',
        objectId: 'cell:sheet#0:r1:c0',
        objectKind: 'cell',
        afterDigest: semanticDigest('1'),
      },
      {
        changeId: 'added:formula:cell:sheet#0:r1:c0',
        kind: 'added',
        domainId: 'cells.formulas',
        objectId: 'formula:cell:sheet#0:r1:c0',
        objectKind: 'cell-formula',
        afterDigest: semanticDigest('2'),
      },
    ],
  } satisfies SemanticWorkbookDiff;
}
