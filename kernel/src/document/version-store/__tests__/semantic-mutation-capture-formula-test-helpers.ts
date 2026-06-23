import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type {
  MutationResult,
  ObjectDigest,
  SemanticCellState,
  SemanticWorkbookState,
  SemanticWorkbookStateEnvelope,
} from '../../../bridges/compute/compute-types.gen';
import type {
  VersionNormalCommitCaptureInput,
  VersionNormalCommitCaptureResult,
} from '../commit-service';
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
export const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};
export const NOW = new Date('2026-06-20T00:00:00.000Z');
const COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as WorkbookCommitId;

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

export function semanticWorkbookState(
  cells: Record<string, SemanticCellState> = {},
): SemanticWorkbookState {
  return {
    schemaVersion: 'semantic-workbook-state.v1',
    domains: {
      'cells.values': authoredDomain('cells.values'),
      'cells.formulas': authoredDomain('cells.formulas'),
    },
    sheets: {
      'sheet#0': {
        sheetId: 'sheet#0',
        name: 'Sheet1',
        rowCount: 10,
        columnCount: 10,
        rows: {},
        columns: {},
        cells,
      },
    },
  };
}

function authoredDomain(domainId: string) {
  return {
    domainId,
    domainClass: 'authored' as const,
    capabilityState: 'supported' as const,
  };
}

export function semanticEnvelope(
  state: SemanticWorkbookState,
  digestSeed: string,
): SemanticWorkbookStateEnvelope {
  return {
    state,
    stateDigest: semanticDigest(digestSeed),
  };
}

export function semanticDigest(seed: string): ObjectDigest {
  return {
    algorithm: 'sha256',
    byteLength: 32,
    value: seed.repeat(64).slice(0, 64),
  };
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
