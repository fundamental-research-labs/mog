import type { VersionHead, Workbook, WorkbookCommitSummary } from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { DocumentFactory } from '../../document/document-factory';
import { withVersionManifest } from './version-domain-support-test-utils';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
import {
  createVersionObjectRecord,
  type VersionGraphNamespace,
  type VersionObjectRecord,
} from '../../../document/version-store/object-store';
import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../../../document/version-store/provider-indexeddb-backend';
import { deleteVersionStoreIndexedDbForTesting } from '../../../document/version-store/provider-indexeddb-schema';
import {
  namespaceForDocumentScope,
  type VersionDocumentScope,
  type VersionGraphInitializeInput,
} from '../../../document/version-store/provider';

const CREATED_AT = '2026-06-22T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

export type DurableCheckoutScenario = {
  readonly documentId: string;
  readonly graphId: string;
  readonly rootLabel: string;
  readonly mutate: (wb: Workbook) => Promise<void>;
  readonly expectDurableGraph: (input: {
    readonly wb: Workbook;
    readonly rootHead: VersionHead;
    readonly committed: WorkbookCommitSummary;
  }) => Promise<void>;
  readonly expectVisibleState: (wb: Workbook) => Promise<void>;
};

type DocumentHandle = Awaited<ReturnType<typeof DocumentFactory.create>>;

export function installIndexedDbPublicVc06PersistenceCheckoutLifecycle(): void {
  beforeEach(async () => {
    await deleteVersionStoreIndexedDbForTesting();
  });

  afterEach(async () => {
    await deleteVersionStoreIndexedDbForTesting();
  });
}

export async function expectIndexedDbDurableCheckout(
  input: DurableCheckoutScenario,
): Promise<void> {
  const documentScope: VersionDocumentScope = { documentId: input.documentId };
  let authorHandle: DocumentHandle | undefined = await DocumentFactory.create({
    documentId: input.documentId,
    environment: 'headless',
    userTimezone: 'UTC',
  });
  let authorWb: Workbook | undefined;
  let reopenedHandle: DocumentHandle | undefined;
  let reopenedWb: Workbook | undefined;
  let checkoutHandle: DocumentHandle | undefined;
  let checkoutWb: Workbook | undefined;

  try {
    authorWb = await authorHandle.workbook({
      versioning: withVersionManifest({
        providerSelection: {
          kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
          requireDurablePersistence: true,
          initialize: {
            graphId: input.graphId,
            rootWrite: await rootWrite(documentScope, input.graphId, input.rootLabel),
          },
        },
      }),
    });
    const rootHead = await expectHead(authorWb);
    const rootRevision = requireRefRevision(rootHead);

    await input.mutate(authorWb);
    await input.expectVisibleState(authorWb);

    const committed = await expectCommit(
      authorWb.version.commit({
        expectedHead: {
          commitId: rootHead.id,
          revision: rootRevision,
        },
      }),
    );
    expect(committed.parents).toEqual([rootHead.id]);
    await input.expectVisibleState(authorWb);

    await authorWb.close('skipSave');
    authorWb = undefined;
    await authorHandle.dispose();
    authorHandle = undefined;

    reopenedHandle = await DocumentFactory.create({
      documentId: input.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    reopenedWb = await reopenedHandle.workbook({
      versioning: withVersionManifest({
        providerSelection: {
          kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
          requireDurablePersistence: true,
        },
      }),
    });

    await expect(reopenedWb.version.getHead()).resolves.toMatchObject({
      ok: true,
      value: {
        id: committed.id,
        refName: 'refs/heads/main',
        resolvedFrom: 'HEAD',
      },
    });
    await expect(reopenedWb.version.listCommits()).resolves.toMatchObject({
      ok: true,
      value: {
        items: expect.arrayContaining([
          expect.objectContaining({ id: committed.id, parents: [rootHead.id] }),
          expect.objectContaining({ id: rootHead.id, parents: [] }),
        ]),
      },
    });
    await input.expectDurableGraph({ wb: reopenedWb, rootHead, committed });

    await reopenedWb.close('skipSave');
    reopenedWb = undefined;
    await reopenedHandle.dispose();
    reopenedHandle = undefined;

    checkoutHandle = await DocumentFactory.create({
      documentId: input.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    checkoutWb = await checkoutHandle.workbook({
      versioning: withVersionManifest({
        providerSelection: {
          kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
          requireDurablePersistence: true,
        },
      }),
    });

    const checkout = await checkoutWb.version.checkout({ kind: 'commit', id: committed.id });
    if (!checkout.ok) {
      throw new Error(`expected indexeddb checkout success: ${JSON.stringify(checkout.error)}`);
    }
    expect(checkout.value).toMatchObject({
      status: 'success',
      materialization: 'applied',
      mutationGuarantee: 'workbook-state-materialized',
      plan: {
        commitId: committed.id,
        strategy: 'fullSnapshot',
      },
      diagnostics: [],
    });
    await input.expectVisibleState(checkoutWb);
  } finally {
    if (checkoutWb) await checkoutWb.close('skipSave');
    if (checkoutHandle) await checkoutHandle.dispose();
    if (reopenedWb) await reopenedWb.close('skipSave');
    if (reopenedHandle) await reopenedHandle.dispose();
    if (authorWb) await authorWb.close('skipSave');
    if (authorHandle) await authorHandle.dispose();
  }
}

export async function expectDiffContains(
  wb: Workbook,
  rootHead: VersionHead,
  committed: WorkbookCommitSummary,
  items: readonly unknown[],
): Promise<void> {
  const diffResult = await wb.version.diff(rootHead.id, committed.id);
  if (!diffResult.ok) {
    throw new Error(`expected indexeddb diff success: ${JSON.stringify(diffResult.error)}`);
  }
  expect(diffResult.value.items).toEqual(expect.arrayContaining(items));
}

export function expectedCellDiff(address: string, value: unknown) {
  return expect.objectContaining({
    structural: expect.objectContaining({
      domain: 'cell',
      entityId: expect.stringMatching(new RegExp(`!${address}$`)),
      propertyPath: ['value'],
    }),
    after: { kind: 'value', value },
    display: { address: { kind: 'value', value: address } },
  });
}

export function expectedRowOrderDiff(address: string) {
  return expect.objectContaining({
    structural: expect.objectContaining({
      domain: 'rows-columns',
      propertyPath: ['order'],
    }),
    after: {
      kind: 'value',
      value: expect.objectContaining({
        fields: expect.arrayContaining([
          { key: 'axis', value: 'row' },
          { key: 'displayRef', value: address },
        ]),
      }),
    },
    display: { address: { kind: 'value', value: address } },
  });
}

async function expectCommit(
  resultPromise: ReturnType<Workbook['version']['commit']>,
): Promise<WorkbookCommitSummary> {
  const result = await resultPromise;
  if (!result.ok) throw new Error(`expected commit success: ${JSON.stringify(result.error)}`);
  return result.value;
}

async function expectHead(wb: Workbook): Promise<VersionHead> {
  const result = await wb.version.getHead();
  if (!result.ok) throw new Error(`expected getHead success: ${JSON.stringify(result.error)}`);
  return result.value;
}

function requireRefRevision(head: VersionHead) {
  if (!head.refRevision) throw new Error('expected head to expose a ref revision');
  return head.refRevision;
}

async function rootWrite(
  documentScope: VersionDocumentScope,
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput['rootWrite']> {
  const namespace = namespaceForDocumentScope(documentScope, graphId);
  return {
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
