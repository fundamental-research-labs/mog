import { describe, expect, it } from '@jest/globals';
import type { Workbook } from '@mog-sdk/contracts/api';

import {
  createMaterializerDocumentHandle,
  expectCommit,
  expectHead,
  initializeMaterializerGraph,
  installVersionDomainDetectorNoopsOnHandles,
  installVersionDomainDetectorNoopsOnWorkbook,
  requireRefRevision,
  withVersionManifest,
} from './version-apply-merge-materializer-test-utils';

const ACTIVE_BRANCH_NAME = 'scenario/active-checkout-read-selectors';
const ACTIVE_BRANCH_REF = `refs/heads/${ACTIVE_BRANCH_NAME}`;

describe('WorkbookVersion active checkout read selectors', () => {
  it('resolves public HEAD reads through the active branch checkout', async () => {
    const { documentScope, provider, initialized } = await initializeMaterializerGraph(
      'active-checkout-read-selectors-branch',
    );
    const handle = await createMaterializerDocumentHandle(documentScope);
    installVersionDomainDetectorNoopsOnHandles(handle);
    let wb: Workbook | undefined;

    try {
      wb = await handle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(wb);

      await wb.activeSheet.setCell('A1', 'base');
      const baseCommit = await expectCommit(
        wb.version.commit({
          message: 'base on main before active branch checkout',
          expectedHead: {
            commitId: initialized.rootCommit.id,
            revision: initialized.initialHead.revision,
            symbolicHeadRevision: initialized.symbolicHead.revision,
          },
        }),
      );
      wb.markClean();

      const created = await wb.version.createBranch({
        name: ACTIVE_BRANCH_NAME as any,
        targetCommitId: baseCommit.id,
      });
      expect(created).toMatchObject({
        ok: true,
        value: {
          name: ACTIVE_BRANCH_REF,
          commitId: baseCommit.id,
        },
      });
      if (!created.ok) throw new Error(`expected branch create success: ${created.error.code}`);

      await expect(
        wb.version.checkout({ kind: 'ref', name: ACTIVE_BRANCH_REF as any }),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          materialization: 'applied',
          mutationGuarantee: 'workbook-state-materialized',
        },
      });
      installVersionDomainDetectorNoopsOnWorkbook(wb);

      await wb.activeSheet.setCell('B1', 'branch');
      const branchHeadBeforeCommit = await expectHead(wb);
      const branchCommit = await expectCommit(
        wb.version.commit({
          message: 'branch edit through active checkout',
          expectedHead: {
            commitId: branchHeadBeforeCommit.id,
            revision: requireRefRevision(branchHeadBeforeCommit),
          },
        }),
      );
      wb.markClean();
      const branchHead = await expectHead(wb);
      const branchRefRevision = requireRefRevision(branchHead);

      expect(branchCommit.parents).toEqual([baseCommit.id]);
      expect(branchHead).toMatchObject({
        id: branchCommit.id,
        refName: ACTIVE_BRANCH_REF,
        resolvedFrom: ACTIVE_BRANCH_REF,
        refRevision: branchRefRevision,
      });
      await expect(wb.version.readRef('HEAD')).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          ref: {
            name: 'HEAD',
            target: ACTIVE_BRANCH_REF,
            revision: branchRefRevision,
          },
        },
      });
      await expect(wb.version.getRef('HEAD')).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          ref: {
            name: 'HEAD',
            target: ACTIVE_BRANCH_REF,
            revision: branchRefRevision,
          },
        },
      });

      const implicitCommitIds = await expectCommitIds(
        wb.version.listCommits(),
        'implicit active branch listCommits',
      );
      const explicitHeadCommitIds = await expectCommitIds(
        wb.version.listCommits({ ref: 'HEAD' }),
        'explicit HEAD active branch listCommits',
      );
      expect(implicitCommitIds).toEqual(explicitHeadCommitIds);
      expect(implicitCommitIds).toEqual(
        expect.arrayContaining([branchCommit.id, baseCommit.id, initialized.rootCommit.id]),
      );

      await expectDiffContainsValue(
        wb,
        baseCommit.id,
        { kind: 'ref', name: 'HEAD' },
        'branch',
        'active branch HEAD diff',
      );
    } finally {
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });

  it('resolves public HEAD reads through the detached checkout commit', async () => {
    const { documentScope, provider, initialized } = await initializeMaterializerGraph(
      'active-checkout-read-selectors-detached',
    );
    const handle = await createMaterializerDocumentHandle(documentScope);
    installVersionDomainDetectorNoopsOnHandles(handle);
    let wb: Workbook | undefined;

    try {
      wb = await handle.workbook({ versioning: withVersionManifest({ provider }) });
      installVersionDomainDetectorNoopsOnWorkbook(wb);

      await wb.activeSheet.setCell('A1', 'alpha');
      const alphaCommit = await expectCommit(
        wb.version.commit({
          message: 'alpha on main before detached checkout',
          expectedHead: {
            commitId: initialized.rootCommit.id,
            revision: initialized.initialHead.revision,
            symbolicHeadRevision: initialized.symbolicHead.revision,
          },
        }),
      );
      wb.markClean();

      await wb.activeSheet.setCell('A1', 'beta');
      const alphaHead = await expectHead(wb);
      const betaCommit = await expectCommit(
        wb.version.commit({
          message: 'beta on main after detached checkout target',
          expectedHead: {
            commitId: alphaHead.id,
            revision: requireRefRevision(alphaHead),
          },
        }),
      );
      wb.markClean();

      await expect(
        wb.version.checkout({ kind: 'commit', id: alphaCommit.id }),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          materialization: 'applied',
          mutationGuarantee: 'workbook-state-materialized',
          plan: {
            commitId: alphaCommit.id,
            target: { kind: 'commit', commitId: alphaCommit.id },
          },
        },
      });
      installVersionDomainDetectorNoopsOnWorkbook(wb);
      await expect(wb.activeSheet.getCell('A1')).resolves.toMatchObject({ value: 'alpha' });

      await expect(wb.version.getHead()).resolves.toEqual({
        ok: true,
        value: { id: alphaCommit.id },
      });
      await expect(wb.version.readRef('HEAD')).resolves.toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.readRef',
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_PROVIDER_ERROR',
              data: expect.objectContaining({
                payload: expect.objectContaining({
                  reason: 'detached-active-checkout',
                }),
              }),
            }),
          ],
        },
      });
      await expect(wb.version.getRef('HEAD')).resolves.toMatchObject({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.getRef',
          diagnostics: [
            expect.objectContaining({
              code: 'VERSION_PROVIDER_ERROR',
              data: expect.objectContaining({
                payload: expect.objectContaining({
                  reason: 'detached-active-checkout',
                }),
              }),
            }),
          ],
        },
      });

      const implicitCommitIds = await expectCommitIds(
        wb.version.listCommits(),
        'implicit detached listCommits',
      );
      const explicitHeadCommitIds = await expectCommitIds(
        wb.version.listCommits({ ref: 'HEAD' }),
        'explicit HEAD detached listCommits',
      );
      expect(implicitCommitIds).toEqual(explicitHeadCommitIds);
      expect(implicitCommitIds).toEqual(
        expect.arrayContaining([alphaCommit.id, initialized.rootCommit.id]),
      );
      expect(implicitCommitIds).not.toContain(betaCommit.id);

      await expectDiffContainsValue(
        wb,
        initialized.rootCommit.id,
        { kind: 'ref', name: 'HEAD' },
        'alpha',
        'detached HEAD diff',
      );
    } finally {
      if (wb) await wb.close('skipSave');
      await handle.dispose();
    }
  });
});

async function expectCommitIds(
  resultPromise: ReturnType<Workbook['version']['listCommits']>,
  label: string,
): Promise<string[]> {
  const result = await resultPromise;
  if (!result.ok) throw new Error(`expected ${label} success: ${result.error.code}`);
  return result.value.items.map((commit) => commit.id);
}

async function expectDiffContainsValue(
  wb: Workbook,
  base: Parameters<Workbook['version']['diff']>[0],
  target: Parameters<Workbook['version']['diff']>[1],
  value: string,
  label: string,
): Promise<void> {
  const diff = await wb.version.diff(base, target);
  if (!diff.ok) throw new Error(`expected ${label} success: ${diff.error.code}`);
  expect(
    diff.value.items.some((entry) => entry.after.kind === 'value' && entry.after.value === value),
  ).toBe(true);
}
