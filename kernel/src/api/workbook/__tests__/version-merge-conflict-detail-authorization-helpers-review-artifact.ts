import type {
  ObjectDigest,
  VersionCommitExpectedHead,
  VersionMergeConflict,
  VersionMergeResultId,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { WorkbookVersionImpl } from '../version';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import { mergeResultIdForPreviewDigest } from '../../../document/version-store/merge-attempt-artifacts';
import {
  createInMemoryVersionStoreProvider,
  InMemoryVersionDocumentProviderBackend,
  namespaceForDocumentScope,
  type VersionAccessContext,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';
import { withVersionManifest } from './version-domain-support-test-utils';
import { basicConflict } from './version-merge-conflict-detail-authorization-helpers-conflicts';
import { conflictDigestObject } from './version-merge-conflict-detail-authorization-helpers-digests';

const DOCUMENT_ID = 'w9-06-merge-conflict-detail-auth';
const DOCUMENT_RUN_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
const CREATED_AT = '2026-06-23T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export const TARGET_REF = 'refs/heads/main' as const;

export type ReviewFixture = {
  readonly provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
  readonly version: WorkbookVersionImpl;
  readonly preview: {
    readonly resultId: VersionMergeResultId;
    readonly resultDigest: ObjectDigest;
    readonly conflicts: readonly VersionMergeConflict[];
  };
  readonly target: VersionCommitExpectedHead;
};

export async function withReviewArtifact(
  graphId: string,
  run: (fixture: ReviewFixture) => Promise<void>,
  options: {
    readonly accessContext?: VersionAccessContext;
    readonly conflicts?: readonly VersionMergeConflict[];
    readonly versioning?: Record<string, unknown>;
  } = {},
): Promise<void> {
  const documentScope = documentScopeForGraph(graphId);
  const provider = createInMemoryVersionStoreProvider({
    documentScope,
    accessContext: options.accessContext,
    backend: new InMemoryVersionDocumentProviderBackend(),
  });
  const initialized = await provider.initializeGraph(
    await initializeInput(graphId, 'root', documentScope),
  );
  expectInitializeSuccess(initialized);

  const namespace = namespaceForDocumentScope(documentScope, graphId);
  const conflicts = options.conflicts ?? [basicConflict()];
  const previewRecord = await objectRecord(namespace, 'workbook.mergePreview.v1', {
    schemaVersion: 1,
    recordKind: 'mergePreview',
    status: 'conflicted',
    base: initialized.rootCommit.id,
    ours: initialized.rootCommit.id,
    theirs: initialized.rootCommit.id,
    changes: [],
    conflicts,
  });
  const graph = await provider.openGraph(namespace, provider.accessContext);
  expect(await graph.putObjects([previewRecord])).toMatchObject({ status: 'success' });

  await run({
    provider,
    version: new WorkbookVersionImpl({
      versioning: withVersionManifest({ provider, ...(options.versioning ?? {}) }),
    } as any),
    preview: {
      resultId: mergeResultIdForPreviewDigest(previewRecord.digest),
      resultDigest: previewRecord.digest,
      conflicts,
    },
    target: {
      commitId: initialized.rootCommit.id,
      revision: initialized.initialHead.revision,
    },
  });
}

export async function putResolutionPayload(input: {
  readonly version: WorkbookVersionImpl;
  readonly preview: ReviewFixture['preview'];
  readonly conflict: VersionMergeConflict;
  readonly option: VersionMergeConflict['resolutionOptions'][number];
  readonly redactionPolicyDigest: ObjectDigest;
  readonly target: VersionCommitExpectedHead;
  readonly value: any;
  readonly purpose: 'chooseValue' | 'custom';
  readonly domainPayloadSchema?: string;
}) {
  const result = await input.version.putMergeResolutionPayload({
    resultId: input.preview.resultId,
    resultDigest: input.preview.resultDigest,
    redactionPolicyDigest: input.redactionPolicyDigest,
    conflictId: input.conflict.conflictId,
    expectedConflictDigest: conflictDigestObject(input.conflict.conflictDigest),
    optionId: input.option.optionId,
    kind: input.option.kind,
    targetRef: TARGET_REF,
    expectedTargetHead: input.target,
    value: input.value,
    purpose: input.purpose,
    ...(input.domainPayloadSchema ? { domainPayloadSchema: input.domainPayloadSchema } : {}),
  });
  if (!result.ok) throw new Error(`expected payload put success: ${result.error.code}`);
  return result.value;
}

async function initializeInput(
  graphId: string,
  label: string,
  documentScope: VersionDocumentScope,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [],
      }),
      author: AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}

function documentScopeForGraph(graphId: string): VersionDocumentScope {
  return { documentId: `${DOCUMENT_ID}-${DOCUMENT_RUN_ID}-${graphId}` };
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
    throw new Error(`expected version graph initialize success: ${result.diagnostics[0]?.code}`);
  }
}
