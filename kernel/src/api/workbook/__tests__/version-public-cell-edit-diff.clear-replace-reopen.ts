import type { Workbook } from '@mog-sdk/contracts/api';

import { DocumentFactory } from '../../document/document-factory';
import { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import { withVersionManifest } from './version-domain-support-test-utils';
import {
  DOCUMENT_ID,
  DOCUMENT_SCOPE,
  expectInitializeSuccess,
  expectedCellDiff,
  expectedSemanticDigest,
  initializeInput,
  readSemanticChangeSetPayload,
} from './version-public-cell-edit-diff.helpers';

export function registerPublicCellEditClearReplaceReopenScenario(): void {
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
      wb = await handle.workbook({ versioning: withVersionManifest({ provider }) });

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
              domainId: 'cells.values',
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
      reopenedWb = await reopenedHandle.workbook({ versioning: withVersionManifest({ provider }) });

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
}
