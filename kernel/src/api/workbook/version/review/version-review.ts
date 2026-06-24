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

import type { DocumentContext } from '../../../../context';
import { validateVersionOperationGate } from '../../version-operation-gate';
import type { VersionReviewPublicOperation } from './version-review-operation';
import {
  mapReviewServiceResult,
  methodUnavailableDiagnostic,
  providerErrorDiagnostic,
  reviewFailure,
  serviceUnavailableDiagnostic,
} from './version-review-results';
import {
  normalizeAppendReviewDecisionInput,
  normalizeCreateReviewInput,
  normalizeGetReviewDiffInput,
  normalizeGetReviewInput,
  normalizeListReviewsInput,
  normalizeUpdateReviewStatusInput,
  validateExplicitSubjectHeads,
  validateReviewDiffTarget,
} from './version-review-validation';

export type { VersionReviewPublicOperation } from './version-review-operation';

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

type AttachedVersionReviewService = {
  listReviews?: (input: VersionListReviewsInput) => MaybePromise<unknown>;
  getReview?: (input: VersionGetReviewInput) => MaybePromise<unknown>;
  createReview?: (input: VersionCreateReviewInput) => MaybePromise<unknown>;
  appendReviewDecision?: (input: VersionAppendReviewDecisionInput) => MaybePromise<unknown>;
  updateReviewStatus?: (input: VersionUpdateReviewStatusInput) => MaybePromise<unknown>;
  getReviewDiff?: (input: VersionGetReviewDiffInput) => MaybePromise<unknown>;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

export async function listWorkbookVersionReviews(
  ctx: DocumentContext,
  input: VersionListReviewsInput = {},
): Promise<VersionResult<Paged<WorkbookVersionReviewRecordSummary>>> {
  const normalized = normalizeListReviewsInput(input);
  if (!normalized.ok) return reviewFailure('listReviews', normalized.diagnostics);
  return callReviewService(ctx, 'listReviews', normalized.input);
}

export async function getWorkbookVersionReview(
  ctx: DocumentContext,
  input: VersionGetReviewInput,
): Promise<VersionResult<WorkbookVersionReviewRecord>> {
  const normalized = normalizeGetReviewInput(input);
  if (!normalized.ok) return reviewFailure('getReview', normalized.diagnostics);
  return callReviewService(ctx, 'getReview', normalized.input);
}

export async function createWorkbookVersionReview(
  ctx: DocumentContext,
  input: VersionCreateReviewInput,
): Promise<VersionResult<WorkbookVersionReviewRecord>> {
  const normalized = normalizeCreateReviewInput(input);
  if (!normalized.ok) return reviewFailure('createReview', normalized.diagnostics);
  const operationGateDiagnostics = validateVersionOperationGate(
    ctx,
    'createReview',
    'version:reviewWrite',
    { mutates: true },
  );
  if (operationGateDiagnostics.length > 0) {
    return reviewFailure('createReview', operationGateDiagnostics);
  }
  const subjectMatch = validateExplicitSubjectHeads(normalized.input);
  if (!subjectMatch.ok) return subjectMatch.result;
  return callReviewService(ctx, 'createReview', normalized.input);
}

export async function appendWorkbookVersionReviewDecision(
  ctx: DocumentContext,
  input: VersionAppendReviewDecisionInput,
): Promise<VersionResult<WorkbookVersionReviewRecord>> {
  const normalized = normalizeAppendReviewDecisionInput(input);
  if (!normalized.ok) return reviewFailure('appendReviewDecision', normalized.diagnostics);
  const operationGateDiagnostics = validateVersionOperationGate(
    ctx,
    'appendReviewDecision',
    'version:reviewWrite',
    { mutates: true },
  );
  if (operationGateDiagnostics.length > 0) {
    return reviewFailure('appendReviewDecision', operationGateDiagnostics);
  }
  return callReviewService(ctx, 'appendReviewDecision', normalized.input);
}

export async function updateWorkbookVersionReviewStatus(
  ctx: DocumentContext,
  input: VersionUpdateReviewStatusInput,
): Promise<VersionResult<WorkbookVersionReviewRecord>> {
  const normalized = normalizeUpdateReviewStatusInput(input);
  if (!normalized.ok) return reviewFailure('updateReviewStatus', normalized.diagnostics);
  const operationGateDiagnostics = validateVersionOperationGate(
    ctx,
    'updateReviewStatus',
    'version:reviewWrite',
    { mutates: true },
  );
  if (operationGateDiagnostics.length > 0) {
    return reviewFailure('updateReviewStatus', operationGateDiagnostics);
  }
  return callReviewService(ctx, 'updateReviewStatus', normalized.input);
}

export async function getWorkbookVersionReviewDiff(
  ctx: DocumentContext,
  input: VersionGetReviewDiffInput,
): Promise<VersionResult<WorkbookVersionReviewDiffPage>> {
  const normalized = normalizeGetReviewDiffInput(input);
  if (!normalized.ok) return reviewFailure('getReviewDiff', normalized.diagnostics);
  const diffTarget = validateReviewDiffTarget(normalized.input);
  if (!diffTarget.ok) return diffTarget.result;
  return callReviewService(ctx, 'getReviewDiff', normalized.input);
}

async function callReviewService<TInput, TResult>(
  ctx: DocumentContext,
  operation: VersionReviewPublicOperation,
  input: TInput,
): Promise<VersionResult<TResult>> {
  const reviewService = getAttachedVersionReviewService(ctx);
  if (!reviewService) return reviewFailure(operation, [serviceUnavailableDiagnostic(operation)]);

  const method = reviewService[operation] as ((input: TInput) => MaybePromise<unknown>) | undefined;
  if (!method) return reviewFailure(operation, [methodUnavailableDiagnostic(operation)]);

  try {
    return mapReviewServiceResult(operation, await method(input));
  } catch {
    return reviewFailure(operation, [providerErrorDiagnostic(operation)]);
  }
}

export function hasAttachedVersionReviewService(ctx: DocumentContext): boolean {
  return Boolean(getAttachedVersionReviewService(ctx));
}

function getAttachedVersionReviewService(
  ctx: DocumentContext,
): AttachedVersionReviewService | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return null;

  for (const candidate of [
    services.reviewService,
    services.reviewRecordService,
    services.reviewMetadataStore,
    services.publicService,
    services,
  ]) {
    const reviewService = toReviewService(candidate);
    if (reviewService) return reviewService;
  }

  return null;
}

function toReviewService(value: unknown): AttachedVersionReviewService | null {
  const service: AttachedVersionReviewService = {};
  const listReviews = bindMethod(value, 'listReviews');
  const getReview = bindMethod(value, 'getReview');
  const createReview = bindMethod(value, 'createReview');
  const appendReviewDecision = bindMethod(value, 'appendReviewDecision');
  const updateReviewStatus = bindMethod(value, 'updateReviewStatus');
  const getReviewDiff = bindMethod(value, 'getReviewDiff');

  if (listReviews) service.listReviews = (input) => listReviews(input);
  if (getReview) service.getReview = (input) => getReview(input);
  if (createReview) service.createReview = (input) => createReview(input);
  if (appendReviewDecision) {
    service.appendReviewDecision = (input) => appendReviewDecision(input);
  }
  if (updateReviewStatus) service.updateReviewStatus = (input) => updateReviewStatus(input);
  if (getReviewDiff) service.getReviewDiff = (input) => getReviewDiff(input);

  return Object.keys(service).length > 0 ? service : null;
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
