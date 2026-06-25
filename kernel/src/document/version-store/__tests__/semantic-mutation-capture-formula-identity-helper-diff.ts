import type {
  SemanticWorkbookDiff,
  SemanticWorkbookStateEnvelope,
} from '../../../bridges/compute/compute-types.gen';
import { semanticDigest } from './semantic-mutation-capture-formula-test-helpers';

export function canonicalFormulaIdentityDiff(
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
