import { jest } from '@jest/globals';

import { installVersionDomainDetectorNoopsOnBridgeMock } from './version-domain-support-test-utils';
import { createProviderGraphFixture } from './version-refs-provider-fixtures';
import {
  CREATED_AT,
  createNormalCommitCapture,
  createWorkbook,
  resetWorkbookProviderTestMocks,
} from './version-refs-provider-test-utils';

describe('WorkbookVersion provider-backed targetRef commit scenarios', () => {
  beforeEach(() => {
    resetWorkbookProviderTestMocks();
  });

  it.each([
    ['branch name', 'scenario/provider-commit'],
    ['full ref', 'refs/heads/scenario/provider-commit'],
  ])(
    'commits public targetRef writes by %s to the provider-backed branch without advancing main',
    async (_label, targetRef) => {
      const { initialized, provider } = await createProviderGraphFixture();
      const captureNormalCommit = jest.fn(createNormalCommitCapture('branch-child'));
      const wb = createWorkbook({
        versioning: {
          provider,
          captureNormalCommit,
        },
      });
      installVersionDomainDetectorNoopsOnBridgeMock((wb.version as any).ctx?.computeBridge);

      await expect(
        wb.version.createBranch({
          name: 'scenario/provider-commit' as any,
          targetCommitId: initialized.rootCommit.id,
        }),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          name: 'refs/heads/scenario/provider-commit',
          commitId: initialized.rootCommit.id,
          revision: { kind: 'counter', value: '0' },
        },
      });

      const committed = await wb.version.commit({
        targetRef: targetRef as any,
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: { kind: 'counter', value: '0' },
        },
      });

      expect(captureNormalCommit).toHaveBeenCalledWith(
        expect.objectContaining({
          currentRef: expect.objectContaining({
            name: 'refs/heads/scenario/provider-commit',
            commitId: initialized.rootCommit.id,
          }),
          currentMain: expect.objectContaining({
            name: 'refs/heads/main',
            commitId: initialized.rootCommit.id,
          }),
          options: expect.objectContaining({
            targetRef: 'refs/heads/scenario/provider-commit',
          }),
        }),
      );
      expect(committed).toMatchObject({
        ok: true,
        value: {
          parents: [initialized.rootCommit.id],
          createdAt: CREATED_AT,
          author: { actorKind: 'user', displayName: 'User One', redacted: true },
        },
      });
      if (!committed.ok) throw new Error(`expected commit success: ${committed.error.code}`);
      expect(committed.value.id).not.toBe(initialized.rootCommit.id);

      await expect(
        wb.version.readRef('refs/heads/scenario/provider-commit' as any),
      ).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          ref: {
            name: 'refs/heads/scenario/provider-commit',
            commitId: committed.value.id,
            revision: { kind: 'counter', value: '1' },
          },
        },
      });
      await expect(wb.version.readRef('refs/heads/main')).resolves.toMatchObject({
        ok: true,
        value: {
          status: 'success',
          ref: {
            name: 'refs/heads/main',
            commitId: initialized.rootCommit.id,
            revision: initialized.initialHead.revision,
          },
        },
      });
      await expect(wb.version.getHead()).resolves.toMatchObject({
        ok: true,
        value: {
          id: initialized.rootCommit.id,
          refName: 'refs/heads/main',
          resolvedFrom: 'HEAD',
          refRevision: initialized.symbolicHead.revision,
        },
      });
    },
  );

  it('rejects symbolic HEAD revisions for explicit targetRef commits before capture', async () => {
    const { initialized, provider } = await createProviderGraphFixture();
    const captureNormalCommit = jest.fn(createNormalCommitCapture('should-not-run'));
    const wb = createWorkbook({
      versioning: {
        provider,
        captureNormalCommit,
      },
    });

    await expect(
      wb.version.commit({
        targetRef: 'scenario/provider-commit' as any,
        expectedHead: {
          commitId: initialized.rootCommit.id,
          revision: initialized.initialHead.revision,
          symbolicHeadRevision: initialized.symbolicHead.revision,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              mutationGuarantee: 'no-write-attempted',
              payload: expect.objectContaining({
                option: 'expectedHead.symbolicHeadRevision',
              }),
              redacted: true,
            }),
          }),
        ],
      },
    });
    expect(captureNormalCommit).not.toHaveBeenCalled();
  });
});
