import type { Workbook } from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { DocumentFactory } from '../../document/document-factory';
import type { VersionObjectType } from '../../../document/version-store/object-digest';
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
  type VersionGraphInitializeResult,
} from '../../../document/version-store/provider';

const DOCUMENT_ID = 'vc04-public-cell-edit-diff';
const DOCUMENT_SCOPE: VersionDocumentScope = { documentId: DOCUMENT_ID };
const CREATED_AT = '2026-06-20T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

describe('WorkbookVersion public cell edit commit/diff vertical', () => {
  it('commits real worksheet value and formula edits from public APIs, then lists and diffs after reopen', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);

    const handle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let wb: Workbook | undefined;
    let reopenedHandle: Awaited<ReturnType<typeof DocumentFactory.create>> | undefined;
    let reopenedWb: Workbook | undefined;

    try {
      wb = await handle.workbook({ versioning: { provider } });

      await expect(wb.version.getHead()).resolves.toMatchObject({
        ok: true,
        value: {
          id: initialized.rootCommit.id,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
        },
      });

      await wb.activeSheet.setCell('A1', 42);
      await wb.activeSheet.setCell('A2', '=A1+1');
      await wb.activeSheet.setValue('B1', 7);
      await wb.activeSheet.setFormula('B2', '=B1+5');
      await wb.activeSheet.setRange('C1:D1', [[10, 20]]);
      await wb.activeSheet.setFormulas('C2:D2', [['=C1+1', '=D1+1']]);

      const commitResult = await wb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      if (!commitResult.ok) {
        throw new Error(`expected public cell edit commit success: ${commitResult.error.code}`);
      }
      const committed = commitResult.value;

      expect(committed.parents).toEqual([initialized.rootCommit.id]);
      expect(committed.author).toMatchObject({
        actorKind: 'user',
        redacted: true,
      });

      await expect(wb.version.getHead()).resolves.toMatchObject({
        ok: true,
        value: {
          id: committed.id,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
        },
      });
      await expect(wb.version.listCommits()).resolves.toMatchObject({
        ok: true,
        value: {
          items: [
            expect.objectContaining({ id: committed.id, parents: [initialized.rootCommit.id] }),
            expect.objectContaining({ id: initialized.rootCommit.id, parents: [] }),
          ],
        },
      });

      const diffResult = await wb.version.diff(initialized.rootCommit.id, committed.id);
      expect(diffResult).toMatchObject({
        ok: true,
        value: {
          order: 'semantic-change-order',
          limit: 50,
          items: expect.arrayContaining([
            expectedCellDiff('A1', 42),
            expectedCellDiff('A2', { kind: 'formula', formula: '=A1+1', result: 43 }),
            expectedCellDiff('B1', 7),
            expectedCellDiff('B2', { kind: 'formula', formula: '=B1+5', result: 12 }),
            expectedCellDiff('C1', 10),
            expectedCellDiff('D1', 20),
            expectedCellDiff('C2', { kind: 'formula', formula: '=C1+1', result: 11 }),
            expectedCellDiff('D2', { kind: 'formula', formula: '=D1+1', result: 21 }),
          ]),
        },
      });
      if (!diffResult.ok) throw new Error(`expected public diff success: ${diffResult.error.code}`);
      expect(diffResult.value.items).toHaveLength(8);

      await wb.close('skipSave');
      wb = undefined;
      await handle.dispose();

      reopenedHandle = await DocumentFactory.create({
        documentId: DOCUMENT_ID,
        environment: 'headless',
        userTimezone: 'UTC',
      });
      reopenedWb = await reopenedHandle.workbook({ versioning: { provider } });

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
            expect.objectContaining({ id: committed.id }),
            expect.objectContaining({ id: initialized.rootCommit.id }),
          ]),
        },
      });
      await expect(
        reopenedWb.version.diff(initialized.rootCommit.id, committed.id),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          items: expect.arrayContaining([
            expectedCellDiff('A1', 42),
            expectedCellDiff('A2', { kind: 'formula', formula: '=A1+1', result: 43 }),
            expectedCellDiff('B1', 7),
            expectedCellDiff('B2', { kind: 'formula', formula: '=B1+5', result: 12 }),
            expectedCellDiff('C1', 10),
            expectedCellDiff('D1', 20),
            expectedCellDiff('C2', { kind: 'formula', formula: '=C1+1', result: 11 }),
            expectedCellDiff('D2', { kind: 'formula', formula: '=D1+1', result: 21 }),
          ]),
        },
      });
    } finally {
      if (reopenedWb) await reopenedWb.close('skipSave');
      if (reopenedHandle) await reopenedHandle.dispose();
      if (wb) await wb.close('skipSave');
      await handle.dispose();
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

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

async function initializeInput(
  graphId: string,
  label: string,
): Promise<VersionGraphInitializeInput> {
  const namespace = namespaceForDocumentScope(DOCUMENT_SCOPE, graphId);
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
