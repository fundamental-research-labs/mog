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
  type VersionStoreProvider,
} from '../../../document/version-store/provider';

const DOCUMENT_ID = 'vc04-public-cell-edit-diff';
const DOCUMENT_SCOPE: VersionDocumentScope = { documentId: DOCUMENT_ID };
const CREATED_AT = '2026-06-20T00:00:00.000Z';
const AUTHOR: VersionAuthor = {
  authorId: 'user-1',
  actorKind: 'user',
  displayName: 'User One',
};
type StoredSemanticChangeSetPayload = {
  readonly source: {
    readonly beforeStateDigest: SemanticDigest;
    readonly afterStateDigest: SemanticDigest;
  };
  readonly semanticDiff: {
    readonly beforeDigest: SemanticDigest;
    readonly afterDigest: SemanticDigest;
    readonly changes: readonly unknown[];
  };
  readonly changes: readonly unknown[];
  readonly reviewChanges: readonly unknown[];
  readonly [key: string]: unknown;
};
type SemanticDigest = {
  readonly algorithm: string;
  readonly byteLength: number;
  readonly value: string;
};

describe('WorkbookVersion public cell edit commit/diff vertical', () => {
  it('commits a single plain text edit from public APIs', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);

    const handle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let wb: Workbook | undefined;

    try {
      wb = await handle.workbook({ versioning: { provider } });
      await wb.activeSheet.setCell('A1', 'base');

      const commitResult = await wb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      if (!commitResult.ok) {
        throw new Error(
          `expected public text edit commit success: ${commitResult.error.code}: ${JSON.stringify(
            commitResult.error,
          )}`,
        );
      }

      const storedSemanticChangeSet = await readSemanticChangeSetPayload(
        provider,
        commitResult.value.id,
      );
      expect(storedSemanticChangeSet).toMatchObject({
        schemaVersion: 1,
        source: {
          kind: 'rustSemanticDiff',
          beforeStateDigest: expectedSemanticDigest(),
          afterStateDigest: expectedSemanticDigest(),
        },
        reviewChanges: [expectedCellDiff('A1', 'base')],
      });
      expect(storedSemanticChangeSet.semanticDiff.changes.length).toBeGreaterThan(0);

      const diffResult = await wb.version.diff(initialized.rootCommit.id, commitResult.value.id);
      expect(diffResult).toMatchObject({
        ok: true,
        value: {
          items: [expectedCellDiff('A1', 'base')],
        },
      });
    } finally {
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });

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
        throw new Error(
          `expected public cell edit commit success: ${commitResult.error.code}: ${JSON.stringify(
            commitResult.error,
          )}`,
        );
      }
      const committed = commitResult.value;

      expect(committed.parents).toEqual([initialized.rootCommit.id]);
      expect(committed.author).toMatchObject({
        actorKind: 'user',
        redacted: true,
      });
      const storedSemanticChangeSet = await readSemanticChangeSetPayload(provider, committed.id);
      expect(storedSemanticChangeSet).toMatchObject({
        schemaVersion: 1,
        source: {
          kind: 'rustSemanticDiff',
          beforeStateDigest: expectedSemanticDigest(),
          afterStateDigest: expectedSemanticDigest(),
        },
        semanticDiff: {
          beforeDigest: expectedSemanticDigest(),
          afterDigest: expectedSemanticDigest(),
          changes: expect.arrayContaining([
            expect.objectContaining({
              domainId: 'authored-grid',
              kind: 'added',
              objectId: 'cell:sheet#0:r0:c0',
              objectKind: 'cell',
            }),
            expect.objectContaining({
              domainId: 'cells.formulas',
              kind: 'added',
              objectId: 'formula:cell:sheet#0:r1:c0',
              objectKind: 'cell-formula',
            }),
          ]),
        },
        reviewChanges: expect.arrayContaining([
          expectedCellDiff('A1', 42),
          expectedCellDiff('A2', { kind: 'formula', formula: '=A1+1', result: 43 }),
        ]),
      });
      expect(storedSemanticChangeSet.source.beforeStateDigest).not.toEqual(
        storedSemanticChangeSet.source.afterStateDigest,
      );
      expect(storedSemanticChangeSet.semanticDiff.beforeDigest).toEqual(
        storedSemanticChangeSet.source.beforeStateDigest,
      );
      expect(storedSemanticChangeSet.semanticDiff.afterDigest).toEqual(
        storedSemanticChangeSet.source.afterStateDigest,
      );
      expect(storedSemanticChangeSet.changes).toEqual(storedSemanticChangeSet.semanticDiff.changes);
      expect(storedSemanticChangeSet.changes.length).toBeGreaterThan(0);
      expect(storedSemanticChangeSet.reviewChanges).toHaveLength(8);

      const committedHeadResult = await wb.version.getHead();
      expect(committedHeadResult).toMatchObject({
        ok: true,
        value: {
          id: committed.id,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
        },
      });
      if (!committedHeadResult.ok) {
        throw new Error(`expected committed head: ${committedHeadResult.error.code}`);
      }
      const committedHead = committedHeadResult.value;
      if (!committedHead.refRevision) {
        throw new Error('expected committed head to expose a ref revision');
      }
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

      await wb.activeSheet.clearData('A1:A2');
      await wb.activeSheet.clear('B1:B2', 'contents');
      await expect(wb.activeSheet.replaceAll('C1:D1', '0', '5')).resolves.toBe(2);

      const clearReplaceCommitResult = await wb.version.commit({
        expectedHead: {
          commitId: committedHead.id,
          revision: committedHead.refRevision,
        },
      });
      if (!clearReplaceCommitResult.ok) {
        throw new Error(
          `expected public clear/replace commit success: ${clearReplaceCommitResult.error.code}`,
        );
      }
      const clearReplaceCommitted = clearReplaceCommitResult.value;

      expect(clearReplaceCommitted.parents).toEqual([committed.id]);
      await expect(wb.version.getHead()).resolves.toMatchObject({
        ok: true,
        value: {
          id: clearReplaceCommitted.id,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
        },
      });

      const clearReplaceDiff = await wb.version.diff(committed.id, clearReplaceCommitted.id);
      expect(clearReplaceDiff).toMatchObject({
        ok: true,
        value: {
          order: 'semantic-change-order',
          limit: 50,
          items: expect.arrayContaining([
            expectedCellDiff('A1', null),
            expectedCellDiff('A2', null),
            expectedCellDiff('B1', null),
            expectedCellDiff('B2', null),
            expectedCellDiff('C1', 15),
            expectedCellDiff('D1', 25),
          ]),
        },
      });
      if (!clearReplaceDiff.ok) {
        throw new Error(
          `expected public clear/replace diff success: ${clearReplaceDiff.error.code}`,
        );
      }
      expect(clearReplaceDiff.value.items).toHaveLength(6);

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
          id: clearReplaceCommitted.id,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
        },
      });
      await expect(reopenedWb.version.listCommits()).resolves.toMatchObject({
        ok: true,
        value: {
          items: expect.arrayContaining([
            expect.objectContaining({ id: clearReplaceCommitted.id }),
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
      await expect(
        reopenedWb.version.diff(committed.id, clearReplaceCommitted.id),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          items: expect.arrayContaining([
            expectedCellDiff('A1', null),
            expectedCellDiff('A2', null),
            expectedCellDiff('B1', null),
            expectedCellDiff('B2', null),
            expectedCellDiff('C1', 15),
            expectedCellDiff('D1', 25),
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

  it('commits a public row insertion with rows-columns review diff evidence', async () => {
    const provider = createInMemoryVersionStoreProvider({ documentScope: DOCUMENT_SCOPE });
    const initialized = await provider.initializeGraph(await initializeInput('graph-1', 'root'));
    expectInitializeSuccess(initialized);

    const handle = await DocumentFactory.create({
      documentId: DOCUMENT_ID,
      environment: 'headless',
      userTimezone: 'UTC',
    });
    let wb: Workbook | undefined;

    try {
      wb = await handle.workbook({ versioning: { provider } });
      const activeSheet = wb.activeSheet;
      await activeSheet.setCell('A2', '=A1*2');
      await activeSheet.structure.insertRows(1, 1);
      await expect(activeSheet.getFormula('A3')).resolves.toBe('=A1*2');

      const commitResult = await wb.version.commit({
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      });
      if (!commitResult.ok) {
        throw new Error(
          `expected public row insertion commit success: ${commitResult.error.code}: ${JSON.stringify(
            commitResult.error,
          )}`,
        );
      }

      const storedSemanticChangeSet = await readSemanticChangeSetPayload(
        provider,
        commitResult.value.id,
      );
      expect(storedSemanticChangeSet.reviewChanges).toEqual(
        expect.arrayContaining([expectedRowOrderDiff('2:2')]),
      );

      const diffResult = await wb.version.diff(initialized.rootCommit.id, commitResult.value.id);
      expect(diffResult).toMatchObject({
        ok: true,
        value: {
          items: expect.arrayContaining([expectedRowOrderDiff('2:2')]),
        },
      });
    } finally {
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });
});

function expectedSemanticDigest() {
  return expect.objectContaining({
    algorithm: 'sha256',
    byteLength: expect.any(Number),
    value: expect.any(String),
  });
}

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

function expectedRowOrderDiff(address: string) {
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

function expectInitializeSuccess(
  result: VersionGraphInitializeResult,
): asserts result is Extract<VersionGraphInitializeResult, { status: 'success' }> {
  expect(result.status).toBe('success');
  if (result.status !== 'success') {
    throw new Error(`expected initialize success: ${result.diagnostics[0]?.code}`);
  }
}

async function readSemanticChangeSetPayload(
  provider: VersionStoreProvider,
  commitId: string,
): Promise<StoredSemanticChangeSetPayload> {
  const graph = await provider.openGraph(namespaceForDocumentScope(DOCUMENT_SCOPE, 'graph-1'));
  const read = await graph.readCommit(commitId);
  expect(read.status).toBe('success');
  if (read.status !== 'success') {
    throw new Error('expected committed record to be readable');
  }
  const semanticChangeSetRecord = await graph.getObjectRecord({
    kind: 'object',
    objectType: 'workbook.semanticChangeSet.v1',
    digest: read.commit.payload.semanticChangeSetDigest,
  });
  expect(typeof semanticChangeSetRecord.preimage.payload).toBe('object');
  expect(semanticChangeSetRecord.preimage.payload).not.toBeNull();
  return semanticChangeSetRecord.preimage.payload as StoredSemanticChangeSetPayload;
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
