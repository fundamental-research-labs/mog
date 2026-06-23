import type {
  ObjectDigest,
  VersionCreateReviewInput,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionMergeConflict,
  VersionMergeResultId,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor as GraphVersionAuthor } from '@mog-sdk/contracts/versioning';

import { WorkbookVersionImpl } from '../version';
import { attachWorkbookVersioning } from '../version-wiring';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import { mergeResultIdForPreviewDigest } from '../../../document/version-store/merge-attempt-artifacts';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'w9-04-review-provider-access',
  principalScope: 'principal-owner',
};
export const BASE_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}` as const;
export const HEAD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}` as const;
export const RAW_CELL_VALUE = 'RAW-CELL-VALUE-W9-04';
export const SECRET_DOMAIN = 'cells.values.secret-domain';
export const SECRET_PATH = 'changes[1].after.value';
export const PRINCIPAL_SECRET = 'principal-secret';
export const PRINCIPAL_OTHER = 'principal-other';
export const SECRET_REF = 'refs/heads/w10-09-secret-review';
export const SECRET_BRANCH = 'w10-09-secret-branch';
export const SECRET_TABLE_ID = 'table:w10-09-secret';
export const SECRET_TABLE_NAME = 'W10-09 Hidden Table';

const CREATED_AT = '2026-06-23T00:00:00.000Z';
const GRAPH_AUTHOR: GraphVersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'Reviewer',
};
const REVIEW_AUTHOR = { kind: 'user', trust: 'trusted', displayName: 'Reviewer' } as const;
const REDACTION_POLICY = {
  mode: 'default',
  redactSecrets: true,
  redactExternalLinks: true,
  redactAgentTrace: true,
} as const;

export function mergeReviewBaseInput(resultDigest: ObjectDigest): {
  readonly resultId: VersionMergeResultId;
  readonly resultDigest: ObjectDigest;
  readonly redactionPolicyDigest: ObjectDigest;
} {
  return {
    resultId: mergeResultIdForReviewDigest(resultDigest),
    resultDigest,
    redactionPolicyDigest: resultDigest,
  };
}

export function mergeResultIdForReviewDigest(digestValue: ObjectDigest): VersionMergeResultId {
  return mergeResultIdForPreviewDigest(digestValue as any);
}

export function digest(digit: string): ObjectDigest {
  return { algorithm: 'sha256', digest: digit.repeat(64) };
}

export function expectMergeReviewDiagnostic(
  value: unknown,
  operation: string,
  code: string,
  message: string,
): void {
  expect(value).toMatchObject({
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${operation}`,
      diagnostics: [
        expect.objectContaining({
          code,
          message,
          data: expect.objectContaining({
            redacted: true,
            payload: expect.objectContaining({ operation }),
          }),
        }),
      ],
    },
  });
}

export function expectNoDiagnosticLeaks(value: unknown, canaries: readonly string[]): void {
  const serialized = JSON.stringify(value);
  for (const canary of canaries) {
    expect(serialized).not.toContain(canary);
  }
}

export function versionForProvider(
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>,
) {
  const ctx = { documentId: provider.documentScope.documentId } as any;
  attachWorkbookVersioning(ctx, { provider });
  return new WorkbookVersionImpl(ctx);
}

export function createReviewInput(
  clientRequestId: string,
  baseCommitId: string,
  headCommitId: string,
): VersionCreateReviewInput {
  return {
    clientRequestId,
    subject: {
      kind: 'commitRange',
      baseCommitId: baseCommitId as VersionCreateReviewInput['baseCommitId'],
      headCommitId: headCommitId as VersionCreateReviewInput['headCommitId'],
    },
    baseCommitId: baseCommitId as VersionCreateReviewInput['baseCommitId'],
    headCommitId: headCommitId as VersionCreateReviewInput['headCommitId'],
    createdBy: REVIEW_AUTHOR,
    redactionPolicy: REDACTION_POLICY,
  };
}

export async function providerWithRootAndChildReviewChanges(
  graphId: string,
  reviewChanges: readonly unknown[],
) {
  const documentScope = {
    ...DOCUMENT_SCOPE,
    documentId: `${DOCUMENT_SCOPE.documentId}-${graphId}`,
  };
  const provider = createInMemoryVersionStoreProvider({ documentScope });
  const initialized = await provider.initializeGraph(await initializeInput(graphId, documentScope));
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  const graph = await provider.openGraph(namespace);
  const head = await graph.readHead();
  if (head.status !== 'success') throw new Error('expected initialized graph head');
  const committed = await graph.commit({
    snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      label: 'child',
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
      schemaVersion: 1,
      changes: reviewChanges,
      reviewChanges,
    }),
    mutationSegmentRecords: [
      await objectRecord(namespace, 'workbook.mutationSegment.v1', {
        segmentId: 'child-segment-1',
      }),
    ],
    author: GRAPH_AUTHOR,
    createdAt: CREATED_AT,
    completenessDiagnostics: [],
    expectedHeadCommitId: head.head.id,
    expectedMainRefVersion: head.head.refRevision as any,
  });
  if (committed.status !== 'success') {
    throw new Error(`expected child commit success: ${JSON.stringify(committed.diagnostics)}`);
  }
  return {
    provider,
    rootCommitId: initialized.rootCommit.id,
    childCommitId: committed.commit.id,
  };
}

export async function commitReviewFixture(
  graph: Awaited<ReturnType<ReturnType<typeof createInMemoryVersionStoreProvider>['openGraph']>>,
  namespace: VersionGraphNamespace,
  input: {
    readonly expectedHeadCommitId: string;
    readonly expectedMainRefVersion: unknown;
    readonly label: string;
  },
) {
  const committed = await graph.commit({
    snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      label: input.label,
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
      schemaVersion: 1,
      changes: [],
    }),
    mutationSegmentRecords: [
      await objectRecord(namespace, 'workbook.mutationSegment.v1', {
        segmentId: `${input.label}-segment`,
      }),
    ],
    author: GRAPH_AUTHOR,
    createdAt: CREATED_AT,
    completenessDiagnostics: [],
    expectedHeadCommitId: input.expectedHeadCommitId as any,
    expectedMainRefVersion: input.expectedMainRefVersion as any,
  });
  if (committed.status !== 'success') {
    throw new Error(
      `expected ${input.label} commit success: ${JSON.stringify(committed.diagnostics)}`,
    );
  }
  return committed;
}

export async function providerWithInitializedRegistry(graphId: string) {
  const documentScope = {
    ...DOCUMENT_SCOPE,
    documentId: `${DOCUMENT_SCOPE.documentId}-${graphId}`,
  };
  const provider = createInMemoryVersionStoreProvider({ documentScope });
  const initialized = await provider.initializeGraph(await initializeInput(graphId, documentScope));
  expectInitializeSuccess(initialized);
  return provider;
}

export function tableDefinitionConflict(): VersionMergeConflict {
  const conflictId = 'conflict:w10-09:secret-table';
  const structural: VersionDiffStructuralMetadata = {
    kind: 'metadata',
    changeId: 'change:w10-09-secret-table',
    domain: 'tables',
    entityId: SECRET_TABLE_ID,
    propertyPath: ['definition'],
  };
  const base = tableDefinitionValue('base');
  const ours = tableDefinitionValue('ours');
  const theirs = { kind: 'redacted', reason: 'permission-denied' } as const;
  return {
    conflictId,
    conflictDigest: `sha256:${'a'.repeat(64)}`,
    conflictKind: 'same-property',
    structural,
    base,
    ours,
    theirs,
    resolutionOptions: [
      resolutionOption(conflictId, 'acceptOurs', ours),
      resolutionOption(conflictId, 'acceptTheirs', theirs),
      resolutionOption(conflictId, 'acceptBase', base),
    ],
  };
}

export function tableDefinitionValue(name: string): VersionDiffValue {
  return {
    kind: 'value',
    value: {
      kind: 'object',
      fields: [
        { key: 'kind', value: 'tableDefinition' },
        { key: 'tableId', value: SECRET_TABLE_ID },
        { key: 'name', value: `${SECRET_TABLE_NAME} ${name}` },
        { key: 'sheetId', value: 'sheet-1' },
      ],
    },
  };
}

export function conflictDigestObject(conflictDigest: string): ObjectDigest {
  if (!conflictDigest.startsWith('sha256:')) {
    throw new Error(`expected sha256 conflict digest: ${conflictDigest}`);
  }
  return { algorithm: 'sha256', digest: conflictDigest.slice('sha256:'.length) };
}

function resolutionOption(
  conflictId: string,
  kind: VersionMergeConflict['resolutionOptions'][number]['kind'],
  value: VersionDiffValue,
): VersionMergeConflict['resolutionOptions'][number] {
  return {
    optionId: `option:w10-09:${kind}`,
    conflictId,
    kind,
    value,
    recalcRequired: false,
  };
}

async function initializeInput(
  graphId: string,
  documentScope: VersionDocumentScope,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label: 'root',
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        schemaVersion: 1,
        changes: [],
      }),
      author: GRAPH_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

async function objectRecord(
  namespace: VersionGraphNamespace,
  objectType: VersionObjectType,
  payload: unknown,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.issueCode}`);
  }
}
