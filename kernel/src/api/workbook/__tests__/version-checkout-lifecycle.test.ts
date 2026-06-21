import type { Workbook } from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import { DocumentFactory } from '../../document/document-factory';
import type { VersionNormalCommitCapture } from '../../../document/version-store/commit-service';
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
  it('publishes a real snapshot-root checkout into a clean active workbook facade', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const handle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let wb: Workbook | undefined;

    try {
      wb = await handle.workbook({
        versioning: {
          provider,
          captureNormalCommit: createNormalCommitCapture('checkpoint'),
        },
      });

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

      const result = await wb.version.checkout({ kind: 'commit', id: committed.id });

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
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 7 });
      await expect(wb.activeSheet.getCell('A2')).resolves.toMatchObject({ value: 42 });
    } finally {
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });

  it('rejects dirty post-commit checkout without discarding workbook edits', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);
    const handle = await DocumentFactory.create({
      documentId: DOCUMENT_SCOPE.documentId,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let wb: Workbook | undefined;

    try {
      wb = await handle.workbook({
        versioning: {
          provider,
          captureNormalCommit: createNormalCommitCapture('checkpoint'),
        },
      });

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

function createNormalCommitCapture(label: string): VersionNormalCommitCapture {
  return async ({ namespace, currentMain }) => ({
    status: 'success',
    input: {
      snapshotRootRecord: await objectRecord(namespace, 'workbook.snapshotRoot.v1', {
        label,
        parent: currentMain.commitId,
        sheets: [],
      }),
      semanticChangeSetRecord: await objectRecord(namespace, 'workbook.semanticChangeSet.v1', {
        label,
        changes: [{ id: `${label}-change-1`, domain: 'test' }],
      }),
      mutationSegmentRecords: [
        await objectRecord(namespace, 'workbook.mutationSegment.v1', {
          segmentId: `${label}-segment-1`,
          baseCommitId: currentMain.commitId,
        }),
      ],
      author: VERSION_AUTHOR,
      createdAt: CREATED_AT,
      completenessDiagnostics: [],
    },
  });
}
