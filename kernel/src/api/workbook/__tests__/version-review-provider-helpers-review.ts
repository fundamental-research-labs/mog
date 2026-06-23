import type {
  VersionCreateReviewInput,
  WorkbookVersionReviewDecisionTarget,
} from '@mog-sdk/contracts/api';

import { WorkbookVersionImpl } from '../version';
import { attachWorkbookVersioning } from '../version-wiring';
import {
  AUTHOR,
  BASE_COMMIT_ID,
  DOCUMENT_SCOPE,
  HEAD_COMMIT_ID,
  REDACTION_POLICY,
} from './version-review-provider-helpers-constants';

export function createReviewInput(clientRequestId: string): VersionCreateReviewInput {
  return {
    clientRequestId,
    subject: {
      kind: 'commitRange',
      baseCommitId: BASE_COMMIT_ID,
      headCommitId: HEAD_COMMIT_ID,
    },
    createdBy: AUTHOR,
    redactionPolicy: REDACTION_POLICY,
  };
}

export function versionForProvider(provider: unknown): WorkbookVersionImpl {
  const ctx = { documentId: DOCUMENT_SCOPE.documentId } as any;
  attachWorkbookVersioning(ctx, { provider: provider as any });
  return new WorkbookVersionImpl(ctx);
}

export function inaccessibleReviewResult(operation: string, capability: string) {
  return {
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${operation}`,
      diagnostics: [
        {
          code: 'VERSION_PERMISSION_DENIED',
          severity: 'error',
          message: `${operation} denied for principal-secret.`,
          data: {
            payload: {
              deniedCapabilities: [capability],
              deniedPrincipal: 'principal-secret',
              principalScope: 'principal-secret',
            },
          },
        },
      ],
    },
  } as const;
}

export function expectDeniedReviewDiagnostic(
  result: unknown,
  operation: string,
  capability: string,
): void {
  expect(result).toMatchObject({
    ok: false,
    error: {
      code: 'target_unavailable',
      target: `workbook.version.${operation}`,
      diagnostics: [
        expect.objectContaining({
          code: 'VERSION_PERMISSION_DENIED',
          message: `${operation} denied for redacted-principal.`,
          data: {
            payload: expect.objectContaining({
              deniedCapabilities: [capability],
            }),
          },
        }),
      ],
    },
  });
  const serialized = JSON.stringify(result);
  expect(serialized).not.toContain('principal-secret');
  expect(serialized).not.toContain('deniedPrincipal');
  expect(serialized).not.toContain('principalScope');
  expect(serialized).toContain('redacted-principal');
}

export async function firstReviewDiffTarget(
  version: WorkbookVersionImpl,
  reviewId: string,
): Promise<WorkbookVersionReviewDecisionTarget> {
  const diff = await version.getReviewDiff({ reviewId });
  if (!diff.ok) throw new Error(`expected review diff success: ${diff.error.code}`);
  return diff.value.changes[0].target;
}
