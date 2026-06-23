import type {
  VersionCreateReviewInput,
  WorkbookVersionReviewDecisionTarget,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor as GraphVersionAuthor } from '@mog-sdk/contracts/versioning';

import { WorkbookVersionImpl } from '../version';
import { attachWorkbookVersioning } from '../version-wiring';
import type {
  CommitVersionGraphInput,
  VersionGraphInitializeResult,
} from '../../../document/version-store/graph-store';
import type {
  VersionObjectType,
  WorkbookCommitId,
} from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import {
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
} from '../../../document/version-store/provider';
import type { RefVersion } from '../../../document/version-store/ref-store';

export const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};
export const BASE_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}` as const;
export const HEAD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}` as const;
export const REVIEW_ID = `review:sha256:${'a'.repeat(64)}` as const;
export const AUTHOR = { kind: 'user', trust: 'trusted', displayName: 'Reviewer' } as const;
export const SENSITIVE_ACTOR = {
  kind: 'agent',
  trust: 'trusted',
  displayName: 'Reviewer',
  principalId: 'principal-secret',
  agentRunId: 'agent-secret',
} as const;

const GRAPH_AUTHOR: GraphVersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'Reviewer',
};
const REDACTION_POLICY = {
  mode: 'default',
  redactSecrets: true,
  redactExternalLinks: true,
  redactAgentTrace: true,
} as const;

export function createReviewInput(clientRequestId: string): VersionCreateReviewInput {
  return {
    clientRequestId,
    subject: {
      kind: 'commitRange',
      baseCommitId: BASE_COMMIT_ID,
      headCommitId: HEAD_COMMIT_ID,
    },
    createdBy: AUTHOR,
    redactionPolicy: REDACTION_POLICY,
  };
}

export function versionForProvider(provider: unknown): WorkbookVersionImpl {
  const ctx = { documentId: DOCUMENT_SCOPE.documentId } as any;
  attachWorkbookVersioning(ctx, { provider: provider as any });
  return new WorkbookVersionImpl(ctx);
}

export function inaccessibleReviewResult(operation: string, capability: string) {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${operation}`,
      diagnostics: [
        {
          code: 'VERSION_PERMISSION_DENIED',
          severity: 'error',
          message: `${operation} denied for principal-secret.`,
          data: {
            payload: {
              deniedCapabilities: [capability],
              deniedPrincipal: 'principal-secret',
              principalScope: 'principal-secret',
            },
          },
        },
      ],
    },
  } as const;
}

export function expectDeniedReviewDiagnostic(
  result: unknown,
  operation: string,
  capability: string,
): void {
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${operation}`,
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_PERMISSION_DENIED',
          message: `${operation} denied for redacted-principal.`,
          data: {
            payload: expect.objectContaining({
              deniedCapabilities: [capability],
            }),
          },
        }),
      ],
    },
  });
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain('principal-secret');
  expect(serialized).not.toContain('deniedPrincipal');
  expect(serialized).not.toContain('principalScope');
  expect(serialized).toContain('redacted-principal');
}

export async function firstReviewDiffTarget(
  version: WorkbookVersionImpl,
  reviewId: string,
): Promise<WorkbookVersionReviewDecisionTarget> {
  const diff = await version.getReviewDiff({ reviewId });
  if (!diff.ok) throw new Error(`expected review diff success: ${diff.error.code}`);
  return diff.value.changes[0].target;
}

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.issueCode}`);
  }
}

type GraphWithRootAndChildOptions = {
  readonly reviewChanges?: readonly unknown[];
  readonly completenessDiagnostics?: NonNullable<
    CommitVersionGraphInput['completenessDiagnostics']
  >;
};

export async function graphWithRootAndChild(
  changes: readonly unknown[],
  options: GraphWithRootAndChildOptions = {},
) {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput('graph-1'));
  expectInitializeSuccess(initialized);
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
  const opened = await provider.openGraph(namespace);
  const head = await opened.readHead();
  if (head.status !== 'success') throw new Error('expected graph head before append');
  const committed = await opened.commit(
    await commitInput(
      namespace,
      head.head.id,
      head.head.refRevision as RefVersion,
      changes,
      options,
    ),
  );
  if (committed.status !== 'success') {
    throw new Error(`expected commit success: ${committed.diagnostics[0]?.code}`);
  }
  return {
    provider,
    rootCommitId: initialized.rootCommit.id,
    childCommitId: committed.commit.id,
  };
}

async function initializeInput(graphId: string): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
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
      createdAt: '2026-06-22T00:00:00.000Z',
      completenessDiagnostics: [],
    },
  };
}

async function commitInput(
  namespace: VersionGraphNamespace,
  expectedHeadCommitId: WorkbookCommitId,
  expectedMainRefVersion: RefVersion,
  changes: readonly unknown[],
  options: GraphWithRootAndChildOptions = {},
): Promise<CommitVersionGraphInput> {
  return {
    snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
      label: 'child',
      sheets: [],
    }),
    semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
      schemaVersion: 1,
      changes,
      ...(options.reviewChanges === undefined ? {} : { reviewChanges: options.reviewChanges }),
    }),
    mutationSegmentRecords: [
      await objectRecord(namespace, 'workbook.mutationSegment.v1', {
        segmentId: 'child-segment-1',
      }),
    ],
    author: GRAPH_AUTHOR,
    createdAt: '2026-06-22T00:00:01.000Z',
    completenessDiagnostics: options.completenessDiagnostics ?? [],
    expectedHeadCommitId,
    expectedMainRefVersion,
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
