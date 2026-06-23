import { jest } from '@jest/globals';

import { WorkbookVersionImpl } from '../version';

const COMMIT_ID = `commit:sha256:${'a'.repeat(64)}` as const;
const REVIEW_AUTHOR = { kind: 'user', trust: 'trusted', displayName: 'Reviewer' } as const;
const REDACTION_POLICY = {
  mode: 'default',
  redactSecrets: true,
  redactExternalLinks: true,
  redactAgentTrace: true,
} as const;

describe('WorkbookVersion public operation feature gates', () => {
  it('blocks read endpoints before provider access when versionControl is disabled', async () => {
    const readHead = jest.fn(async () => ({
      status: 'success',
      head: { id: COMMIT_ID, refName: 'refs/heads/main', resolvedFrom: 'HEAD' },
    }));
    const version = new WorkbookVersionImpl({
      featureGates: { capabilities: { versionControl: false } },
      versioning: { readService: { readHead } },
    } as any);

    await expect(version.getHead()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.getHead',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_CAPABILITY_DISABLED',
            message: 'The versionControl feature gate is disabled for this workbook.',
          }),
        ],
      },
    });
    expect(readHead).not.toHaveBeenCalled();
  });

  it('keeps read endpoints available when only editing is disabled', async () => {
    const readHead = jest.fn(async () => ({
      status: 'success',
      head: { id: COMMIT_ID, refName: 'refs/heads/main', resolvedFrom: 'HEAD' },
    }));
    const version = new WorkbookVersionImpl({
      featureGates: { editing: false },
      versioning: { readService: { readHead } },
    } as any);

    await expect(version.getHead()).resolves.toMatchObject({
      ok: true,
      value: {
        id: COMMIT_ID,
        refName: 'refs/heads/main',
        resolvedFrom: 'HEAD',
      },
    });
    expect(readHead).toHaveBeenCalledTimes(1);
  });

  it('blocks mutating endpoints before provider access when editing is disabled', async () => {
    const commit = jest.fn();
    const checkout = jest.fn();
    const createBranch = jest.fn();
    const createReview = jest.fn();
    const version = new WorkbookVersionImpl({
      featureGates: { editing: false },
      versioning: {
        writeService: { commit },
        checkoutService: { checkout },
        branchService: { createBranch },
        reviewService: { createReview },
      },
    } as any);

    await expect(version.commit({ message: 'blocked' })).resolves.toMatchObject({
      ok: false,
      error: blockedEditingError('commit'),
    });
    await expect(version.checkout({ kind: 'commit', id: COMMIT_ID })).resolves.toMatchObject({
      ok: false,
      error: blockedEditingError('checkout'),
    });
    await expect(
      version.createBranch({ name: 'scenario/blocked' as any, targetCommitId: COMMIT_ID }),
    ).resolves.toMatchObject({
      ok: false,
      error: blockedEditingError('createBranch'),
    });
    await expect(
      version.createReview({
        clientRequestId: 'review-1',
        subject: { kind: 'commit', commitId: COMMIT_ID },
        createdBy: REVIEW_AUTHOR,
        redactionPolicy: REDACTION_POLICY,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: blockedEditingError('createReview'),
    });

    expect(commit).not.toHaveBeenCalled();
    expect(checkout).not.toHaveBeenCalled();
    expect(createBranch).not.toHaveBeenCalled();
    expect(createReview).not.toHaveBeenCalled();
  });
});

function blockedEditingError(operation: string) {
  return {
    code: 'target_unavailable',
    target: `workbook.version.${operation}`,
    diagnostics: [
      expect.objectContaining({
        code: 'VERSION_CAPABILITY_DISABLED',
        message: 'Workbook editing is disabled by host feature gates.',
      }),
    ],
  };
}
