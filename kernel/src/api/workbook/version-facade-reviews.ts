import type {
  Paged,
  VersionAppendReviewDecisionInput,
  VersionCreateReviewInput,
  VersionGetReviewDiffInput,
  VersionGetReviewInput,
  VersionListReviewsInput,
  VersionResult,
  VersionUpdateReviewStatusInput,
  WorkbookVersionReviewDiffPage,
  WorkbookVersionReviewRecord,
  WorkbookVersionReviewRecordSummary,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { readWorkbookVersionFacadeGate } from './version-facade-gate';
import { versionFailureFromStoreDiagnostics } from './version-result';
import {
  appendWorkbookVersionReviewDecision,
  createWorkbookVersionReview,
  getWorkbookVersionReview,
  getWorkbookVersionReviewDiff,
  listWorkbookVersionReviews,
  updateWorkbookVersionReviewStatus,
} from './version/review/version-review';

export async function listWorkbookVersionFacadeReviews(
  ctx: DocumentContext,
  input: VersionListReviewsInput = {},
): Promise<VersionResult<Paged<WorkbookVersionReviewRecordSummary>>> {
  const gateDiagnostics = readWorkbookVersionFacadeGate(ctx, 'listReviews', 'version:reviewRead');
  if (gateDiagnostics) return versionFailureFromStoreDiagnostics('listReviews', gateDiagnostics);
  return listWorkbookVersionReviews(ctx, input);
}

export async function getWorkbookVersionFacadeReview(
  ctx: DocumentContext,
  input: VersionGetReviewInput,
): Promise<VersionResult<WorkbookVersionReviewRecord>> {
  const gateDiagnostics = readWorkbookVersionFacadeGate(ctx, 'getReview', 'version:reviewRead');
  if (gateDiagnostics) return versionFailureFromStoreDiagnostics('getReview', gateDiagnostics);
  return getWorkbookVersionReview(ctx, input);
}

export async function createWorkbookVersionFacadeReview(
  ctx: DocumentContext,
  input: VersionCreateReviewInput,
): Promise<VersionResult<WorkbookVersionReviewRecord>> {
  return createWorkbookVersionReview(ctx, input);
}

export async function appendWorkbookVersionFacadeReviewDecision(
  ctx: DocumentContext,
  input: VersionAppendReviewDecisionInput,
): Promise<VersionResult<WorkbookVersionReviewRecord>> {
  return appendWorkbookVersionReviewDecision(ctx, input);
}

export async function updateWorkbookVersionFacadeReviewStatus(
  ctx: DocumentContext,
  input: VersionUpdateReviewStatusInput,
): Promise<VersionResult<WorkbookVersionReviewRecord>> {
  return updateWorkbookVersionReviewStatus(ctx, input);
}

export async function getWorkbookVersionFacadeReviewDiff(
  ctx: DocumentContext,
  input: VersionGetReviewDiffInput,
): Promise<VersionResult<WorkbookVersionReviewDiffPage>> {
  const gateDiagnostics = readWorkbookVersionFacadeGate(ctx, 'getReviewDiff', 'version:reviewRead');
  if (gateDiagnostics) return versionFailureFromStoreDiagnostics('getReviewDiff', gateDiagnostics);
  return getWorkbookVersionReviewDiff(ctx, input);
}
