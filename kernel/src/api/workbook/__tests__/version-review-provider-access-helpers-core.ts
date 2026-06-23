import type {
  ObjectDigest,
  VersionCreateReviewInput,
  VersionMergeResultId,
} from '@mog-sdk/contracts/api';

import { WorkbookVersionImpl } from '../version';
import { attachWorkbookVersioning } from '../version-wiring';
import { mergeResultIdForPreviewDigest } from '../../../document/version-store/merge-attempt-artifacts';
import type { createInMemoryVersionStoreProvider } from '../../../document/version-store/provider';
import {
  REDACTION_POLICY,
  REVIEW_AUTHOR,
} from './version-review-provider-access-helpers-constants';

export function mergeReviewBaseInput(resultDigest: ObjectDigest): {
  readonly resultId: VersionMergeResultId;
  readonly resultDigest: ObjectDigest;
  readonly redactionPolicyDigest: ObjectDigest;
} {
  return {
    resultId: mergeResultIdForReviewDigest(resultDigest),
    resultDigest,
    redactionPolicyDigest: resultDigest,
  };
}

export function mergeResultIdForReviewDigest(digestValue: ObjectDigest): VersionMergeResultId {
  return mergeResultIdForPreviewDigest(digestValue as any);
}

export function digest(digit: string): ObjectDigest {
  return { algorithm: 'sha256', digest: digit.repeat(64) };
}

export function versionForProvider(
  provider: ReturnType<typeof createInMemoryVersionStoreProvider>,
) {
  const ctx = { documentId: provider.documentScope.documentId } as any;
  attachWorkbookVersioning(ctx, { provider });
  return new WorkbookVersionImpl(ctx);
}

export function createReviewInput(
  clientRequestId: string,
  baseCommitId: string,
  headCommitId: string,
): VersionCreateReviewInput {
  return {
    clientRequestId,
    subject: {
      kind: 'commitRange',
      baseCommitId: baseCommitId as VersionCreateReviewInput['baseCommitId'],
      headCommitId: headCommitId as VersionCreateReviewInput['headCommitId'],
    },
    baseCommitId: baseCommitId as VersionCreateReviewInput['baseCommitId'],
    headCommitId: headCommitId as VersionCreateReviewInput['headCommitId'],
    createdBy: REVIEW_AUTHOR,
    redactionPolicy: REDACTION_POLICY,
  };
}
