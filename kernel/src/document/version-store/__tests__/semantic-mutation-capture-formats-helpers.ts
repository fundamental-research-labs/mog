import type { VersionOperationContext } from '@mog-sdk/contracts/versioning';

import type { MutationResult } from '../../../bridges/compute/compute-types.gen';
import type {
  VersionNormalCommitCaptureInput,
  VersionNormalCommitCaptureResult,
} from '../commit-service';
import type { VersionGraphNamespace } from '../object-store';
import { createRustBackedTestSemanticMutationCapture } from './semantic-mutation-capture-test-helpers';

const NAMESPACE: VersionGraphNamespace = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  graphId: 'graph-1',
  principalScope: 'principal-1',
};

export const NOW = new Date('2026-06-20T00:00:00.000Z');

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

export function operationContext(): VersionOperationContext {
  return {
    operationId: 'formats.set:1',
    kind: 'mutation',
    author: { authorId: 'user-1', actorKind: 'user' },
    createdAt: NOW.toISOString(),
    sheetIds: ['sheet-1'],
    domainIds: ['cells.formats.direct'],
    capturePolicy: 'commitEligible',
    writeAdmissionMode: 'capture',
  };
}

export function createFormatSemanticMutationCapture() {
  return createRustBackedTestSemanticMutationCapture({ now: () => NOW });
}

export function captureInput(): VersionNormalCommitCaptureInput {
  return { namespace: NAMESPACE } as VersionNormalCommitCaptureInput;
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
