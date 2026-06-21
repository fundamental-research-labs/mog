import 'fake-indexeddb/auto';

import type { VersionAuthor } from '@mog-sdk/contracts/versioning';
import type { VersionCommitExpectedHead, VersionMainRefName } from '@mog-sdk/contracts/api';

import {
  computeEmptyResolutionSetDigest,
  computeMergeApplyResultDigest,
  computeResolvedAttemptDigest,
  idempotencyKeyForResolvedAttempt,
  intentIdForResolvedAttemptDigest,
  type BeginMergeApplyIntentInput,
  type MergeApplyIntentStore,
} from '../merge-apply-intent-store';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import type { VersionObjectType, WorkbookCommitId } from '../object-digest';
import {
  InMemoryVersionDocumentProviderBackend,
  createInMemoryVersionStoreProvider,
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
  type VersionGraphInitializeResult,
} from '../provider';
import { createIndexedDbVersionStoreProvider } from '../provider-indexeddb-backend';
import { deleteVersionStoreIndexedDbForTesting } from '../provider-indexeddb-schema';

const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'document-1',
  principalScope: 'principal-1',
};

const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

const BASE = `commit:sha256:${'1'.repeat(64)}` as WorkbookCommitId;
const OURS = `commit:sha256:${'2'.repeat(64)}` as WorkbookCommitId;
const THEIRS = `commit:sha256:${'3'.repeat(64)}` as WorkbookCommitId;
const TARGET_REF = 'refs/heads/main' as VersionMainRefName;
const EXPECTED_TARGET_HEAD: VersionCommitExpectedHead = {
  commitId: OURS,
  revision: { kind: 'counter', value: '1' },
};

beforeEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

afterEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

describe('merge apply intent store', () => {
  it('computes stable result and resolved-attempt digests', async () => {
    const first = await fastForwardIntentInput();
    const second = await fastForwardIntentInput();

    expect(first.resultDigest).toEqual(second.resultDigest);
    expect(first.resolutionSetDigest).toEqual(second.resolutionSetDigest);
    expect(first.resolvedAttemptDigest).toEqual(second.resolvedAttemptDigest);
    expect(first.intentId).toBe(second.intentId);
    expect(first.idempotencyKey).toBe(second.idempotencyKey);
  });

  it('begins, reads, completes, and snapshots in-memory intents idempotently', async () => {
    const backend = new InMemoryVersionDocumentProviderBackend();
    const provider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend,
      durability: 'snapshot-test-double',
    });
    const namespace = await initializeProvider(provider);
    const store = await provider.openMergeApplyIntentStore(namespace);
    const input = await fastForwardIntentInput();

    const created = await store.beginIntent(input);
    expect(created.status).toBe('created');
    if (created.status !== 'created') throw new Error('expected intent creation');

    await expect(store.beginIntent(input)).resolves.toMatchObject({
      status: 'existing',
      record: { intentId: input.intentId },
    });
    await expect(
      store.beginIntent({ ...input, createdAt: '2026-06-21T00:00:02.000Z' }),
    ).resolves.toMatchObject({
      status: 'existing',
      record: { intentId: input.intentId },
    });
    await expect(store.readByIntentId(input.intentId)).resolves.toMatchObject({
      status: 'found',
      record: { idempotencyKey: input.idempotencyKey },
    });
    await expect(store.readByIdempotencyKey(input.idempotencyKey)).resolves.toMatchObject({
      status: 'found',
      record: { intentId: input.intentId },
    });

    const conflicted = await store.beginIntent({
      ...input,
      resultDigest: await computeMergeApplyResultDigest({
        status: 'fastForward',
        base: BASE,
        ours: OURS,
        theirs: BASE,
        targetRef: TARGET_REF,
        expectedTargetHead: EXPECTED_TARGET_HEAD,
      }),
    });
    expect(conflicted).toMatchObject({
      status: 'conflict',
      diagnostics: [{ code: 'VERSION_INTENT_CONFLICT' }],
    });

    const completed = await store.completeIntent({
      intentId: input.intentId,
      resolvedAttemptDigest: input.resolvedAttemptDigest,
      completedAt: '2026-06-21T00:00:01.000Z',
      terminal: {
        status: 'fastForwarded',
        headBefore: OURS,
        headAfter: THEIRS,
        commitId: THEIRS,
      },
    });
    expect(completed).toMatchObject({
      status: 'completed',
      record: { state: 'finalized', terminal: { status: 'fastForwarded' } },
    });
    await expect(
      store.completeIntent({
        intentId: input.intentId,
        resolvedAttemptDigest: input.resolvedAttemptDigest,
        completedAt: '2026-06-21T00:00:04.000Z',
        terminal: {
          status: 'fastForwarded',
          headBefore: OURS,
          headAfter: THEIRS,
          commitId: THEIRS,
        },
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      record: {
        state: 'finalized',
        updatedAt: '2026-06-21T00:00:01.000Z',
        terminal: { status: 'fastForwarded' },
      },
    });
    await expect(
      store.completeIntent({
        intentId: input.intentId,
        resolvedAttemptDigest: input.resolvedAttemptDigest,
        completedAt: '2026-06-21T00:00:05.000Z',
        terminal: {
          status: 'staleTargetHead',
          headBefore: OURS,
          headAfter: BASE,
          commitId: BASE,
        },
      }),
    ).resolves.toMatchObject({
      status: 'conflict',
      diagnostics: [{ code: 'VERSION_INTENT_CONFLICT' }],
    });
    await expect(
      store.beginIntent({ ...input, createdAt: '2026-06-21T00:00:03.000Z' }),
    ).resolves.toMatchObject({
      status: 'existing',
      record: { state: 'finalized', terminal: { status: 'fastForwarded' } },
    });

    const snapshot = await backend.exportSnapshot();
    const reloadedBackend = await InMemoryVersionDocumentProviderBackend.fromSnapshot(snapshot);
    const reloadedProvider = createInMemoryVersionStoreProvider({
      documentScope: DOCUMENT_SCOPE,
      backend: reloadedBackend,
      durability: 'snapshot-test-double',
    });
    const reloadedStore = await reloadedProvider.openMergeApplyIntentStore(namespace);
    await expect(reloadedStore.readByIdempotencyKey(input.idempotencyKey)).resolves.toMatchObject({
      status: 'found',
      record: { state: 'finalized', terminal: { commitId: THEIRS } },
    });
  });

  it('persists merge apply intents through IndexedDB provider reloads', async () => {
    const provider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const namespace = await initializeProvider(provider);
    const store = await provider.openMergeApplyIntentStore(namespace);
    const input = await fastForwardIntentInput();

    await expect(store.beginIntent(input)).resolves.toMatchObject({ status: 'created' });
    const reloadedProvider = createIndexedDbVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const reloadedStore = await reloadedProvider.openMergeApplyIntentStore(namespace);

    await expect(reloadedStore.readByIdempotencyKey(input.idempotencyKey)).resolves.toMatchObject({
      status: 'found',
      record: {
        intentId: input.intentId,
        namespaceKey: expect.any(String),
        documentScopeKey: expect.any(String),
      },
    });
    await expect(
      reloadedStore.beginIntent({ ...input, createdAt: '2026-06-21T00:00:02.000Z' }),
    ).resolves.toMatchObject({
      status: 'existing',
      record: { intentId: input.intentId },
    });
    await expect(
      reloadedStore.completeIntent({
        intentId: input.intentId,
        resolvedAttemptDigest: input.resolvedAttemptDigest,
        completedAt: '2026-06-21T00:00:01.000Z',
        terminal: { status: 'fastForwarded', headBefore: OURS, headAfter: THEIRS },
      }),
    ).resolves.toMatchObject({ status: 'completed' });
    await expect(
      reloadedStore.completeIntent({
        intentId: input.intentId,
        resolvedAttemptDigest: input.resolvedAttemptDigest,
        completedAt: '2026-06-21T00:00:04.000Z',
        terminal: { status: 'fastForwarded', headBefore: OURS, headAfter: THEIRS },
      }),
    ).resolves.toMatchObject({
      status: 'completed',
      record: { updatedAt: '2026-06-21T00:00:01.000Z' },
    });
    await expect(
      reloadedStore.completeIntent({
        intentId: input.intentId,
        resolvedAttemptDigest: input.resolvedAttemptDigest,
        completedAt: '2026-06-21T00:00:05.000Z',
        terminal: { status: 'staleTargetHead', headBefore: OURS, headAfter: BASE },
      }),
    ).resolves.toMatchObject({
      status: 'conflict',
      diagnostics: [{ code: 'VERSION_INTENT_CONFLICT' }],
    });
    await expect(
      reloadedStore.beginIntent({ ...input, createdAt: '2026-06-21T00:00:03.000Z' }),
    ).resolves.toMatchObject({
      status: 'existing',
      record: { state: 'finalized', terminal: { status: 'fastForwarded' } },
    });
  });
});

async function fastForwardIntentInput(): Promise<BeginMergeApplyIntentInput> {
  const resultDigest = await computeMergeApplyResultDigest({
    status: 'fastForward',
    base: BASE,
    ours: OURS,
    theirs: THEIRS,
    targetRef: TARGET_REF,
    expectedTargetHead: EXPECTED_TARGET_HEAD,
  });
  const resolutionSetDigest = await computeEmptyResolutionSetDigest();
  const resolvedAttemptDigest = await computeResolvedAttemptDigest({
    resultDigest,
    resolutionSetDigest,
    targetRef: TARGET_REF,
    expectedTargetHead: EXPECTED_TARGET_HEAD,
  });
  return {
    intentId: intentIdForResolvedAttemptDigest(resolvedAttemptDigest),
    idempotencyKey: idempotencyKeyForResolvedAttempt({
      resolvedAttemptDigest,
      targetRef: TARGET_REF,
      expectedTargetHead: EXPECTED_TARGET_HEAD,
    }),
    applyKind: 'fastForward',
    base: BASE,
    ours: OURS,
    theirs: THEIRS,
    targetRef: TARGET_REF,
    expectedTargetHead: EXPECTED_TARGET_HEAD,
    resultDigest,
    resolutionSetDigest,
    resolvedAttemptDigest,
    createdAt: '2026-06-21T00:00:00.000Z',
  };
}

async function initializeProvider(provider: {
  initializeGraph(input: VersionGraphInitializeInput): Promise<VersionGraphInitializeResult>;
}): Promise<VersionGraphNamespace> {
  const input = await initializeInput('graph-1');
  const initialized = await provider.initializeGraph(input);
  expect(initialized.status).toBe('success');
  if (initialized.status !== 'success') {
    throw new Error(`expected initialize success: ${initialized.diagnostics[0]?.code}`);
  }
  return namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1');
}

async function initializeInput(graphId: string): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
  return {
    expectedRegistryRevision: null,
    graphId,
    rootWrite: {
      snapshotRootRecord: await objectRecord(
        'workbook.snapshotRoot.v1',
        { label: 'root', sheets: [] },
        namespace,
      ),
      semanticChangeSetRecord: await objectRecord(
        'workbook.semanticChangeSet.v1',
        { label: 'root', changes: [] },
        namespace,
      ),
      author: AUTHOR,
      createdAt: '2026-06-20T00:00:00.000Z',
      completenessDiagnostics: [],
    },
  };
}

async function objectRecord(
  objectType: VersionObjectType,
  payload: unknown,
  namespace: VersionGraphNamespace,
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [],
    payload,
  });
}
