import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

import { CREATED_AT, VERSION_AUTHOR } from './version-commit-snapshot-root-helpers-fixtures';

export function operationContext(
  overrides: Partial<VersionOperationContext> = {},
): VersionOperationContext {
  return {
    operationId: 'operation-1',
    kind: 'mutation',
    author: VERSION_AUTHOR,
    createdAt: CREATED_AT,
    domainIds: ['test'],
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
    ...overrides,
  };
}

export function emptyMutationResult() {
  return {
    recalc: {
      changedCells: [],
      projectionChanges: [],
      errors: [],
      validationAnnotations: [],
      metrics: {},
    },
  };
}

export function cellValueMutationResult(value: unknown) {
  return {
    recalc: {
      changedCells: [
        {
          cellId: 'cell-a1',
          sheetId: 'sheet-1',
          position: { row: 0, col: 0 },
          oldValue: null,
          value,
          extraFlags: 0,
        },
      ],
      projectionChanges: [],
      errors: [],
      validationAnnotations: [],
      metrics: {},
    },
  };
}
