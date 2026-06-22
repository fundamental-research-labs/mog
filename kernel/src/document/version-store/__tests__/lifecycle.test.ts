import 'fake-indexeddb/auto';

import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import {
  createWorkbookVersionCommitService,
  type VersionNormalCommitCapture,
} from '../commit-service';
import {
  resolveDocumentWorkbookVersioningLifecycle,
  type DocumentWorkbookVersioningLifecycleConfig,
} from '../lifecycle';
import type { VersionObjectType } from '../object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../object-store';
import { namespaceForDocumentScope, type VersionGraphInitializeInput } from '../provider';
import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../provider-indexeddb-backend';
import { deleteVersionStoreIndexedDbForTesting } from '../provider-indexeddb-schema';

const DOCUMENT_ID = 'version-store-lifecycle-blank-root';
const GRAPH_ID = 'blank-workbook-root';
const CREATED_AT = '2026-06-22T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

beforeEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

afterEach(async () => {
  await deleteVersionStoreIndexedDbForTesting();
});

describe('version-store lifecycle root initialization', () => {
  it('initializes the blank workbook graph once and rejects an empty authored commit', async () => {
    const namespace = namespaceForDocumentScope({ documentId: DOCUMENT_ID }, GRAPH_ID);
    const firstRootBuilder = jest.fn(() => rootWrite('root-one', namespace));
    const secondRootBuilder = jest.fn(() => rootWrite('root-two', namespace));

    const first = await resolveDocumentWorkbookVersioningLifecycle({
      documentId: DOCUMENT_ID,
      versioning: versioningConfig(firstRootBuilder),
    });
    expect(first.diagnostics).toEqual([]);
    expect(firstRootBuilder).toHaveBeenCalledTimes(1);

    const provider = first.versioning?.provider;
    if (!provider) throw new Error('expected lifecycle to attach a provider');
    const writeService = createWorkbookVersionCommitService({
      provider,
      captureNormalCommit: emptyAuthoredCapture,
    });

    const firstHead = await writeService.readHead();
    expect(firstHead).toMatchObject({
      status: 'success',
      head: {
        refName: 'refs/heads/main',
        resolvedFrom: 'HEAD',
      },
    });

    const second = await resolveDocumentWorkbookVersioningLifecycle({
      documentId: DOCUMENT_ID,
      versioning: versioningConfig(secondRootBuilder),
    });
    expect(second.diagnostics).toEqual([]);
    expect(secondRootBuilder).not.toHaveBeenCalled();

    const emptyCommit = await writeService.commit({ message: 'empty' });
    expect(emptyCommit).toMatchObject({
      status: 'failed',
      diagnostics: [expect.objectContaining({ code: 'VERSION_MISSING_CHANGE_SET' })],
    });

    const commits = await writeService.listCommits();
    expect(commits).toMatchObject({
      status: 'success',
      commits: [expect.objectContaining({ parents: [] })],
    });
    if (commits.status !== 'success') {
      throw new Error(`expected commit list success: ${commits.diagnostics[0]?.code}`);
    }
    expect(commits.commits).toHaveLength(1);

    await first.versioning?.provider?.dispose('test-teardown');
    await second.versioning?.provider?.dispose('test-teardown');
  });
});

function versioningConfig(
  buildRootWrite: () => Promise<VersionGraphInitializeInput['rootWrite']>,
): DocumentWorkbookVersioningLifecycleConfig {
  return {
    providerSelection: {
      kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
      initialize: {
        graphId: GRAPH_ID,
        buildRootWrite,
      },
    },
    captureNormalCommit: emptyAuthoredCapture,
  };
}

const emptyAuthoredCapture: VersionNormalCommitCapture = async ({ namespace }) => ({
  status: 'success',
  input: {
    ...(await rootWrite('empty-authored', namespace)),
    mutationSegmentRecords: [],
  },
});

async function rootWrite(
  label: string,
  namespace: VersionGraphNamespace,
): Promise<VersionGraphInitializeInput['rootWrite']> {
  return {
    snapshotRootRecord: await objectRecord(
      'workbook.snapshotRoot.v1',
      { label, sheets: ['sheet-1'] },
      namespace,
    ),
    semanticChangeSetRecord: await objectRecord(
      'workbook.semanticChangeSet.v1',
      { label, changes: [] },
      namespace,
    ),
    author: AUTHOR,
    createdAt: CREATED_AT,
    completenessDiagnostics: [],
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
