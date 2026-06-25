import type { SemanticWorkbookStateEnvelope } from '../../../bridges/compute/compute-types.gen';
import type { CanonicalFormulaIdentityCaptureHarness } from './semantic-mutation-capture-formula-identity-helper-capture';

export function expectFormulaIdentityStateReaderCalls(
  harness: CanonicalFormulaIdentityCaptureHarness,
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
