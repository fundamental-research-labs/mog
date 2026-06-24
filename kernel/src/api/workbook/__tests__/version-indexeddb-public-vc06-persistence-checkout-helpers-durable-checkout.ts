import type { VersionHead, Workbook, WorkbookCommitSummary } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { withVersionManifest } from './version-domain-support-test-utils';
import { INDEXEDDB_VERSION_STORE_PROVIDER_KIND } from '../../../document/version-store/provider-indexeddb/backend';
import type { VersionDocumentScope } from '../../../document/version-store/provider';
import { rootWrite } from './version-indexeddb-public-vc06-persistence-checkout-helpers-root-write';
import type { DurableCheckoutScenario } from './version-indexeddb-public-vc06-persistence-checkout-helpers-scenario';

type DocumentHandle = Awaited<ReturnType<typeof DocumentFactory.create>>;

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
