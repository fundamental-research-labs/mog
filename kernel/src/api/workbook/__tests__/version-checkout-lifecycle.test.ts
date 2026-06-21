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

const CREATED_AT = '2026-06-20T00:00:00.000Z';
const DOCUMENT_SCOPE: VersionDocumentScope = {
  workspaceId: 'workspace-1',
  documentId: 'checkout-lifecycle-doc',
  principalScope: 'principal-1',
};
const VERSION_AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};

describe('WorkbookVersion checkout lifecycle materialization', () => {
  it('publishes named ranges and tables from a real snapshot-root checkout into a clean active workbook facade', async () => {
    const { provider, initialized } = await initializeVersionGraph();
    const sourceHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    const checkoutHandle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let sourceWb: Workbook | undefined;
    let checkoutWb: Workbook | undefined;

    try {
      sourceWb = await sourceHandle.workbook({ versioning: { provider } });

      await authorVc06State(sourceWb);
      const committed = await sourceWb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      sourceWb.markClean();

      checkoutWb = await checkoutHandle.workbook({ versioning: { provider } });
      checkoutWb.markClean();

      const result = await checkoutWb.version.checkout({ kind: 'commit', id: committed.id });

      expect(result).toMatchObject({
        status: 'success',
        materialization: 'applied',
        mutationGuarantee: 'workbook-state-materialized',
        plan: {
          commitId: committed.id,
          strategy: 'fullSnapshot',
        },
        diagnostics: [],
      });
      await expect(checkoutWb.activeSheet.getCell('D1')).resolves.toMatchObject({ value: 7 });
      await expect(checkoutWb.activeSheet.getCell('D2')).resolves.toMatchObject({ value: 42 });
      expect(checkoutWb.activeSheet.name).toBe('Sheet1');
      expect(checkoutWb.activeSheet.index).toBe(0);
      expect(
        (await checkoutWb.getSheets()).map((sheet) => ({
          name: sheet.name,
          index: sheet.index,
        })),
      ).toEqual([{ name: 'Sheet1', index: 0 }]);

      await expect(checkoutWb.names.get('RevenueCells')).resolves.toMatchObject({
        name: 'RevenueCells',
        reference: 'Sheet1!B2:B3',
        comment: 'VC-06 named range',
      });
      await expect(checkoutWb.names.list()).resolves.toEqual([
        expect.objectContaining({
          name: 'RevenueCells',
          reference: 'Sheet1!B2:B3',
          comment: 'VC-06 named range',
        }),
      ]);

      const table = await checkoutWb.activeSheet.tables.get('SalesTable');
      expect(table).toMatchObject({
        name: 'SalesTable',
        range: 'A1:B3',
        hasHeaderRow: true,
        hasTotalsRow: false,
      });
      expect(table?.columns.map((column) => column.name)).toEqual(['Region', 'Revenue']);
    } finally {
      if (checkoutWb) await checkoutWb.close('skipSave');
      if (sourceWb) await sourceWb.close('skipSave');
      await checkoutHandle.dispose();
      await sourceHandle.dispose();
    }
  });

  it('rejects dirty post-commit checkout without discarding workbook edits', async () => {
    const { provider, initialized } = await initializeVersionGraph();
    const handle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let wb: Workbook | undefined;

    try {
      wb = await handle.workbook({ versioning: { provider } });

      await wb.activeSheet.setCell('A1', 7);
      await wb.activeSheet.setCell('A2', '=A1*6');
      const committed = await wb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      wb.markClean();

      await wb.activeSheet.setCell('A1', 99);
      await wb.activeSheet.setCell('A2', '=A1+1');

      const result = await wb.version.checkout({ kind: 'commit', id: committed.id });

      expect(result).toMatchObject({
        status: 'degraded',
        materialization: 'not-applied',
        mutationGuarantee: 'no-workbook-mutation',
        diagnostics: [
          expect.objectContaining({
            issueCode: 'VERSION_CHECKOUT_DIRTY_WORKING_STATE',
            recoverability: 'none',
            redacted: true,
          }),
        ],
      });
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 99 });
      await expect(wb.activeSheet.getCell('A2')).resolves.toMatchObject({ value: 100 });
    } finally {
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });
});

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

async function initializeVersionGraph(): Promise<{
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>;
  initialized: Extract<VersionGraphInitializeResult, { status: 'success' }>;
}> {
  const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
  const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
  expectInitializeSuccess(initialized);
  return { provider, initialized };
}

async function authorVc06State(wb: Workbook): Promise<void> {
  const sheet = wb.activeSheet;
  await sheet.setCell('A1', 'Region');
  await sheet.setCell('B1', 'Revenue');
  await sheet.setCell('A2', 'West');
  await sheet.setCell('B2', 12);
  await sheet.setCell('A3', 'East');
  await sheet.setCell('B3', 30);
  await sheet.setCell('D1', 7);
  await sheet.setCell('D2', '=D1*6');
  await wb.names.add('RevenueCells', 'Sheet1!B2:B3', 'VC-06 named range');
  await sheet.tables.add('A1:B3', {
    name: 'SalesTable',
    hasHeaders: true,
  });
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
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  };
}
