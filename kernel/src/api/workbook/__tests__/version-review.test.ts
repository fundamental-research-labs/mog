import { jest } from '@jest/globals';
import type {
  WorkbookVersionReviewDiffPage,
  WorkbookVersionReviewRecord,
} from '@mog-sdk/contracts/api';

import { WorkbookVersionImpl } from '../version';

const BASE_COMMIT_ID = `commit:sha256:${'1'.repeat(64)}`;
const HEAD_COMMIT_ID = `commit:sha256:${'2'.repeat(64)}`;
const REVIEW_ID = 'review-1';
const AUTHOR = { kind: 'user', trust: 'trusted', displayName: 'Reviewer' } as const;
const REDACTION_POLICY = {
  mode: 'default',
  redactSecrets: true,
  redactExternalLinks: true,
  redactAgentTrace: true,
} as const;

function createReviewRecord(
  overrides: Partial<WorkbookVersionReviewRecord> = {},
): WorkbookVersionReviewRecord {
  return {
    schemaVersion: 1,
    id: REVIEW_ID,
    documentId: 'document-1',
    subject: {
      kind: 'commitRange',
      baseCommitId: BASE_COMMIT_ID,
      headCommitId: HEAD_COMMIT_ID,
    },
    status: 'open',
    baseCommitId: BASE_COMMIT_ID,
    headCommitId: HEAD_COMMIT_ID,
    revision: 1,
    createdBy: AUTHOR,
    createdAt: '2026-06-22T00:00:00.000Z',
    updatedAt: '2026-06-22T00:00:00.000Z',
    decisions: [],
    redaction: {
      policy: REDACTION_POLICY,
      redactedFields: [],
      diagnostics: [],
    },
    diagnostics: [],
    ...overrides,
  };
}

function createReviewDiffPage(): WorkbookVersionReviewDiffPage {
  return {
    schemaVersion: 1,
    source: 'semantic-diff',
    reviewId: REVIEW_ID,
    baseCommitId: BASE_COMMIT_ID,
    headCommitId: HEAD_COMMIT_ID,
    changeSetDigest: {
      algorithm: 'sha256',
      digest: 'a'.repeat(64),
    },
    changes: [],
    summary: {
      authoredChanges: 0,
      derivedChanges: 0,
      redactedChanges: 0,
    },
    limit: 50,
    diagnostics: [],
  };
}

function createVersion(reviewService: Record<string, unknown> | null = null) {
  return new WorkbookVersionImpl({
    versioning: reviewService ? { reviewService } : {},
  } as any);
}

describe('WorkbookVersion review records facade', () => {
  it('fails closed for review methods when no review service is attached', async () => {
    const version = createVersion();

    await expect(version.listReviews()).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.listReviews',
        diagnostics: [expect.objectContaining({ code: 'VERSION_REVIEW_SERVICE_UNAVAILABLE' })],
      },
    });
    await expect(version.getReview({ reviewId: REVIEW_ID })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.getReview',
        diagnostics: [expect.objectContaining({ code: 'VERSION_REVIEW_SERVICE_UNAVAILABLE' })],
      },
    });
    await expect(
      version.createReview({
        clientRequestId: 'create-1',
        subject: {
          kind: 'commitRange',
          baseCommitId: BASE_COMMIT_ID,
          headCommitId: HEAD_COMMIT_ID,
        },
        createdBy: AUTHOR,
        redactionPolicy: REDACTION_POLICY,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.createReview',
        diagnostics: [expect.objectContaining({ code: 'VERSION_REVIEW_SERVICE_UNAVAILABLE' })],
      },
    });
    await expect(
      version.appendReviewDecision({
        reviewId: REVIEW_ID,
        expectedRevision: 1,
        clientRequestId: 'decision-1',
        decision: {
          target: { kind: 'proposal', proposalId: 'proposal-1' },
          decision: 'comment',
          reviewer: AUTHOR,
        },
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.appendReviewDecision',
        diagnostics: [expect.objectContaining({ code: 'VERSION_REVIEW_SERVICE_UNAVAILABLE' })],
      },
    });
    await expect(
      version.updateReviewStatus({
        reviewId: REVIEW_ID,
        expectedRevision: 1,
        clientRequestId: 'status-1',
        status: 'approved',
        actor: AUTHOR,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.updateReviewStatus',
        diagnostics: [expect.objectContaining({ code: 'VERSION_REVIEW_SERVICE_UNAVAILABLE' })],
      },
    });
    await expect(version.getReviewDiff({ reviewId: REVIEW_ID })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.getReviewDiff',
        diagnostics: [expect.objectContaining({ code: 'VERSION_REVIEW_SERVICE_UNAVAILABLE' })],
      },
    });
  });

  it('delegates successful review methods to the attached service', async () => {
    const review = createReviewRecord();
    const diffPage = createReviewDiffPage();
    const reviewService = {
      listReviews: jest.fn(async () => ({
        ok: true,
        value: { items: [review], limit: 25 },
      })),
      getReview: jest.fn(async () => ({ ok: true, value: review })),
      createReview: jest.fn(async () => ({ ok: true, value: review })),
      appendReviewDecision: jest.fn(async () => ({ ok: true, value: review })),
      updateReviewStatus: jest.fn(async () => ({ ok: true, value: review })),
      getReviewDiff: jest.fn(async () => ({ ok: true, value: diffPage })),
    };
    const version = createVersion(reviewService);

    await expect(version.listReviews({ limit: 25 })).resolves.toEqual({
      ok: true,
      value: { items: [review], limit: 25 },
    });
    await expect(version.getReview({ reviewId: REVIEW_ID })).resolves.toEqual({
      ok: true,
      value: review,
    });
    await expect(
      version.createReview({
        clientRequestId: 'create-1',
        subject: {
          kind: 'commitRange',
          baseCommitId: BASE_COMMIT_ID,
          headCommitId: HEAD_COMMIT_ID,
        },
        createdBy: AUTHOR,
        redactionPolicy: REDACTION_POLICY,
      }),
    ).resolves.toEqual({ ok: true, value: review });
    await expect(
      version.appendReviewDecision({
        reviewId: REVIEW_ID,
        expectedRevision: 1,
        clientRequestId: 'decision-1',
        decision: {
          target: { kind: 'proposal', proposalId: 'proposal-1' },
          decision: 'approve',
          reviewer: AUTHOR,
        },
      }),
    ).resolves.toEqual({ ok: true, value: review });
    await expect(
      version.updateReviewStatus({
        reviewId: REVIEW_ID,
        expectedRevision: 1,
        clientRequestId: 'status-1',
        status: 'approved',
        actor: AUTHOR,
      }),
    ).resolves.toEqual({ ok: true, value: review });
    await expect(version.getReviewDiff({ reviewId: REVIEW_ID })).resolves.toEqual({
      ok: true,
      value: diffPage,
    });

    expect(reviewService.listReviews).toHaveBeenCalledWith({ limit: 25 });
    expect(reviewService.getReview).toHaveBeenCalledWith({ reviewId: REVIEW_ID });
    expect(reviewService.getReviewDiff).toHaveBeenCalledWith({ reviewId: REVIEW_ID });
  });

  it('fails closed when a partial review service is missing a requested method', async () => {
    const version = createVersion({
      listReviews: jest.fn(async () => ({ ok: true, value: { items: [], limit: 50 } })),
    });

    await expect(version.listReviews()).resolves.toEqual({
      ok: true,
      value: { items: [], limit: 50 },
    });
    await expect(version.getReview({ reviewId: REVIEW_ID })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.getReview',
        diagnostics: [expect.objectContaining({ code: 'VERSION_REVIEW_METHOD_UNAVAILABLE' })],
      },
    });
  });

  it('validates review identity contracts before calling the service', async () => {
    const createReview = jest.fn();
    const updateReviewStatus = jest.fn();
    const version = createVersion({ createReview, updateReviewStatus });

    await expect(
      version.createReview({
        clientRequestId: 'create-1',
        subject: {
          kind: 'commitRange',
          baseCommitId: BASE_COMMIT_ID,
          headCommitId: HEAD_COMMIT_ID,
        },
        baseCommitId: HEAD_COMMIT_ID,
        createdBy: AUTHOR,
        redactionPolicy: REDACTION_POLICY,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'invalid_state',
        state: 'review_subject_base_mismatch',
      },
    });
    expect(createReview).not.toHaveBeenCalled();

    await expect(version.getReviewDiff({})).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'invalid_state',
        state: 'missing_review_diff_target',
      },
    });
    await expect(
      version.updateReviewStatus({
        reviewId: REVIEW_ID,
        expectedRevision: 1,
        clientRequestId: 'status-1',
        actor: AUTHOR,
      } as any),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.updateReviewStatus',
        diagnostics: [expect.objectContaining({ code: 'VERSION_INVALID_OPTIONS' })],
      },
    });
    expect(updateReviewStatus).not.toHaveBeenCalled();

    await expect(
      version.updateReviewStatus({
        reviewId: REVIEW_ID,
        expectedRevision: 1,
        clientRequestId: 'status-applied',
        status: 'applied',
        actor: AUTHOR,
      }),
    ).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.updateReviewStatus',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_INVALID_OPTIONS',
            data: expect.objectContaining({
              payload: expect.objectContaining({
                option: 'status',
              }),
            }),
          }),
        ],
      },
    });
    expect(updateReviewStatus).not.toHaveBeenCalled();
  });

  it('maps thrown provider errors into redacted diagnostics', async () => {
    const version = createVersion({
      getReview: jest.fn(async () => {
        throw new Error('internal backend detail');
      }),
    });

    await expect(version.getReview({ reviewId: REVIEW_ID })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.getReview',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_PROVIDER_ERROR',
            data: expect.objectContaining({
              redacted: true,
              recoverability: 'retry',
            }),
          }),
        ],
      },
    });
  });

  it('redacts denied principals from review read diagnostics', async () => {
    const version = createVersion({
      getReview: jest.fn(async () => ({
        ok: false,
        error: {
          code: 'target_unavailable',
          target: 'workbook.version.getReview',
          diagnostics: [
            {
              code: 'VERSION_REVIEW_ACCESS_DENIED',
              severity: 'error',
              message: 'Review read denied for principal-secret.',
              data: {
                deniedPrincipalId: 'principal-secret',
                payload: {
                  deniedCapabilities: ['version:reviewRead'],
                  deniedPrincipal: 'principal-secret',
                  principalScope: 'principal-secret',
                },
              },
            },
          ],
        },
      })),
    });

    const result = await version.getReview({ reviewId: REVIEW_ID });

    expect(result).toMatchObject({
      ok: false,
      error: {
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_REVIEW_ACCESS_DENIED',
            message: 'Review read denied for redacted-principal.',
            data: expect.objectContaining({
              payload: expect.objectContaining({
                deniedCapabilities: ['version:reviewRead'],
              }),
            }),
          }),
        ],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('principal-secret');
    expect(serialized).not.toContain('deniedPrincipal');
    expect(serialized).toContain('version:reviewRead');
  });

  it('fails closed when a review diff omits authored upstream changes', async () => {
    const version = createVersion({
      getReviewDiff: jest.fn(async () => ({
        ok: true,
        value: {
          ...createReviewDiffPage(),
          changes: [],
          upstreamDiff: {
            items: [
              {
                structural: {
                  kind: 'metadata',
                  changeId: 'change-hidden-vba',
                  domain: 'macros.vba',
                  entityId: 'module-1',
                  propertyPath: ['source'],
                },
                before: { kind: 'value', value: null },
                after: { kind: 'value', value: 'private macro source' },
              },
            ],
            limit: 50,
            readRevision: { kind: 'counter', value: '1' },
            order: 'semantic-change-order',
          },
        },
      })),
    });

    await expect(version.getReviewDiff({ reviewId: REVIEW_ID })).resolves.toMatchObject({
      ok: false,
      error: {
        code: 'target_unavailable',
        target: 'workbook.version.getReviewDiff',
        diagnostics: [
          expect.objectContaining({
            code: 'VERSION_REVIEW_DIFF_INCOMPLETE',
            data: expect.objectContaining({
              payload: expect.objectContaining({
                omittedChangeCount: 1,
                domain: 'macros.vba',
              }),
            }),
          }),
        ],
      },
    });
  });
});
