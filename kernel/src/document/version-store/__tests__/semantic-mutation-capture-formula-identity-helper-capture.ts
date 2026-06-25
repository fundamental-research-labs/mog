import { jest } from '@jest/globals';

import { createSemanticMutationCapture } from '../semantic-mutation-capture';
import { createComputeBridgeSemanticStateReader } from '../semantic-state-reader';
import {
  AUTHOR,
  NOW,
  semanticEnvelope,
  semanticWorkbookState,
} from './semantic-mutation-capture-formula-test-helpers';
import { canonicalFormulaIdentityDiff } from './semantic-mutation-capture-formula-identity-helper-diff';

export type FormulaIdentityCapture = ReturnType<typeof createSemanticMutationCapture>;

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

export type CanonicalFormulaIdentityCaptureHarness = ReturnType<
  typeof createCanonicalFormulaIdentityCapture
>;
