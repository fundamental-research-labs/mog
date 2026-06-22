import 'fake-indexeddb/auto';

import type { Workbook } from '@mog-sdk/contracts/api';
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

const DOCUMENT_ID = 'vc04-indexeddb-public-cell-edit-diff';
const DOCUMENT_SCOPE: VersionDocumentScope = { documentId: DOCUMENT_ID };
const GRAPH_ID = 'graph-indexeddb-public-cell-edit-diff';
const CREATED_AT = '2026-06-20T00:00:00.000Z';
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

describe('WorkbookVersion IndexedDB public cell edit commit/diff vertical', () => {
  it('commits public cell edits after the default blank workbook root initializer', async () => {
    const documentId = `${DOCUMENT_ID}-default-root`;
    const handle = await DocumentFactory.create({
      documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let wb: Workbook | undefined;

    try {
      wb = await handle.workbook({
        versioning: withVersionManifest({
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
          },
        }),
      });
      const rootHeadResult = await wb.version.getHead();
      if (!rootHeadResult.ok) {
        throw new Error(`expected initialized blank root head: ${rootHeadResult.error.code}`);
      }
      const rootHead = rootHeadResult.value;
      expect(rootHead.refName).toBe('refs/heads/main');
      expect(rootHead.refRevision).toBeDefined();

      await wb.activeSheet.setCell('A1', 'blank-root-edit');

      const committedResult = await wb.version.commit({
        expectedHead: {
          commitId: rootHead.id,
          revision: rootHead.refRevision,
        },
      });
      if (!committedResult.ok) {
        throw new Error(`expected default-root public commit: ${committedResult.error.code}`);
      }
      expect(committedResult).toMatchObject({
        ok: true,
        value: {
          parents: [rootHead.id],
        },
      });
      await expect(wb.version.getSurfaceStatus()).resolves.toMatchObject({
        dirty: {
          hasUncommittedLocalChanges: false,
          checkoutSafe: true,
        },
      });

      const diffResult = await wb.version.diff(rootHead.id, committedResult.value.id);
      if (!diffResult.ok) {
        throw new Error(`expected default-root diff: ${JSON.stringify(diffResult.error)}`);
      }
      expect(diffResult.value.items).toEqual(
        expect.arrayContaining([expectedCellDiff('A1', 'blank-root-edit')]),
      );
    } finally {
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });

  it('persists real public cell edit commits and semantic diffs across provider selection reopen', async () => {
    const firstHandle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let firstWb: Workbook | undefined;
    let reopenedHandle: Awaited<ReturnType<typeof DocumentFactory.create>> | undefined;
    let reopenedWb: Workbook | undefined;

    try {
      firstWb = await firstHandle.workbook({
        versioning: withVersionManifest({
          providerSelection: {
            kind: INDEXEDDB_VERSION_STORE_PROVIDER_KIND,
            requireDurablePersistence: true,
            initialize: {
              graphId: GRAPH_ID,
              rootWrite: await rootWrite('root'),
            },
          },
        }),
      });
      const rootHeadResult = await firstWb.version.getHead();
      expect(rootHeadResult).toMatchObject({
        ok: true,
        value: { refName: 'refs/heads/main', resolvedFrom: 'HEAD' },
      });
      if (!rootHeadResult.ok) {
        throw new Error(`expected initialized head: ${rootHeadResult.error.code}`);
      }
      const rootHead = rootHeadResult.value;
      if (!rootHead.refRevision) {
        throw new Error('expected initialized head to include a ref revision');
      }

      await firstWb.activeSheet.setCell('A1', 5);
      await firstWb.activeSheet.setFormula('A2', '=A1*2');

      const committedResult = await firstWb.version.commit({
        expectedHead: {
          commitId: rootHead.id,
          revision: rootHead.refRevision,
        },
      });
      expect(committedResult).toMatchObject({
        ok: true,
        value: {
          parents: [rootHead.id],
        },
      });
      if (!committedResult.ok) {
        throw new Error(`expected indexeddb public commit: ${committedResult.error.code}`);
      }
      const committed = committedResult.value;

      await firstWb.close('skipSave');
      firstWb = undefined;
      await firstHandle.dispose();

      reopenedHandle = await DocumentFactory.create({
        documentId: DOCUMENT_ID,
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
      const diffResult = await reopenedWb.version.diff(rootHead.id, committed.id);
      if (!diffResult.ok) {
        throw new Error(`expected indexeddb diff: ${JSON.stringify(diffResult.error)}`);
      }
      expect(diffResult).toMatchObject({
        ok: true,
        value: {
          items: expect.arrayContaining([
            expectedCellDiff('A1', 5),
            expectedCellDiff('A2', { kind: 'formula', formula: '=A1*2', result: 10 }),
          ]),
        },
      });
    } finally {
      if (reopenedWb) await reopenedWb.close('skipSave');
      if (reopenedHandle) await reopenedHandle.dispose();
      if (firstWb) await firstWb.close('skipSave');
      await firstHandle.dispose();
    }
  });
});

function expectedCellDiff(address: string, value: unknown) {
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

async function rootWrite(label: string): Promise<VersionGraphInitializeInput['rootWrite']> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, GRAPH_ID);
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
