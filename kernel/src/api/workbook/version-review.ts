import type {
  Paged,
  VersionAppendReviewDecisionInput,
  VersionCreateReviewInput,
  VersionDiagnosticPublicPayload,
  VersionGetReviewDiffInput,
  VersionGetReviewInput,
  VersionListReviewsInput,
  VersionResult,
  WorkbookVersionReviewDiffPage,
  WorkbookVersionReviewRecord,
  WorkbookVersionReviewRecordSummary,
  WorkbookVersionReviewStatus,
  WorkbookVersionReviewSubject,
  VersionStoreDiagnostic,
  VersionUpdateReviewStatusInput,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { versionFailureFromStoreDiagnostics } from './version-result';

const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const LIST_REVIEWS_KEYS = new Set([
  'subjectKind',
  'proposalId',
  'commitId',
  'mergePreviewId',
  'conflictId',
  'status',
  'cursor',
  'limit',
]);
const GET_REVIEW_KEYS = new Set(['reviewId']);
const CREATE_REVIEW_KEYS = new Set([
  'clientRequestId',
  'subject',
  'title',
  'createdBy',
  'baseCommitId',
  'headCommitId',
  'redactionPolicy',
]);
const APPEND_REVIEW_DECISION_KEYS = new Set([
  'reviewId',
  'expectedRevision',
  'clientRequestId',
  'decision',
]);
const UPDATE_REVIEW_STATUS_KEYS = new Set([
  'reviewId',
  'expectedRevision',
  'clientRequestId',
  'status',
  'actor',
  'reason',
]);
const GET_REVIEW_DIFF_KEYS = new Set([
  'reviewId',
  'baseCommitId',
  'headCommitId',
  'cursor',
  'limit',
  'includeDerivedImpact',
]);
const REVIEW_SUBJECT_KINDS = new Set(['commit', 'commitRange', 'proposal', 'merge', 'conflict']);
const REVIEW_STATUSES = new Set<WorkbookVersionReviewStatus>([
  'open',
  'approved',
  'changes_requested',
  'rejected',
  'applied',
  'superseded',
  'stale',
]);
const USER_MUTABLE_REVIEW_STATUSES = new Set<WorkbookVersionReviewStatus>([
  'open',
  'approved',
  'changes_requested',
  'rejected',
]);

export type VersionReviewPublicOperation =
  | 'listReviews'
  | 'getReview'
  | 'createReview'
  | 'appendReviewDecision'
  | 'updateReviewStatus'
  | 'getReviewDiff';

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

type ValidationResult<T> =
  | { readonly ok: true; readonly input: T }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

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
  return callReviewService(ctx, 'appendReviewDecision', normalized.input);
}

export async function updateWorkbookVersionReviewStatus(
  ctx: DocumentContext,
  input: VersionUpdateReviewStatusInput,
): Promise<VersionResult<WorkbookVersionReviewRecord>> {
  const normalized = normalizeUpdateReviewStatusInput(input);
  if (!normalized.ok) return reviewFailure('updateReviewStatus', normalized.diagnostics);
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

function normalizeListReviewsInput(
  input: VersionListReviewsInput,
): ValidationResult<VersionListReviewsInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'listReviews', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, LIST_REVIEWS_KEYS, 'listReviews', diagnostics);
  if ('subjectKind' in input && !REVIEW_SUBJECT_KINDS.has(String(input.subjectKind))) {
    diagnostics.push(
      invalidOptionDiagnostic('listReviews', 'subjectKind', 'unknown review subject kind.'),
    );
  }
  validateOptionalString(input, 'proposalId', 'listReviews', diagnostics);
  validateOptionalCommitId(input, 'commitId', 'listReviews', diagnostics);
  validateOptionalString(input, 'mergePreviewId', 'listReviews', diagnostics);
  validateOptionalString(input, 'conflictId', 'listReviews', diagnostics);
  validateOptionalReviewStatus(input, 'status', 'listReviews', diagnostics);
  validateOptionalString(input, 'cursor', 'listReviews', diagnostics);
  validateOptionalLimit(input, 'limit', 'listReviews', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

function normalizeGetReviewInput(
  input: VersionGetReviewInput,
): ValidationResult<VersionGetReviewInput> {
  return normalizeReviewIdInput(input, GET_REVIEW_KEYS, 'getReview');
}

function normalizeCreateReviewInput(
  input: VersionCreateReviewInput,
): ValidationResult<VersionCreateReviewInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'createReview', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, CREATE_REVIEW_KEYS, 'createReview', diagnostics);
  validateRequiredString(input, 'clientRequestId', 'createReview', diagnostics);
  validateOptionalString(input, 'title', 'createReview', diagnostics);
  validateRequiredRecord(input, 'createdBy', 'createReview', diagnostics);
  validateRequiredRecord(input, 'redactionPolicy', 'createReview', diagnostics);
  validateOptionalCommitId(input, 'baseCommitId', 'createReview', diagnostics);
  validateOptionalCommitId(input, 'headCommitId', 'createReview', diagnostics);
  validateReviewSubject(input.subject, 'createReview', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

function normalizeAppendReviewDecisionInput(
  input: VersionAppendReviewDecisionInput,
): ValidationResult<VersionAppendReviewDecisionInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'appendReviewDecision', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, APPEND_REVIEW_DECISION_KEYS, 'appendReviewDecision', diagnostics);
  validateRequiredString(input, 'reviewId', 'appendReviewDecision', diagnostics);
  validateRequiredRevision(input, 'expectedRevision', 'appendReviewDecision', diagnostics);
  validateRequiredString(input, 'clientRequestId', 'appendReviewDecision', diagnostics);
  validateRequiredRecord(input, 'decision', 'appendReviewDecision', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

function normalizeUpdateReviewStatusInput(
  input: VersionUpdateReviewStatusInput,
): ValidationResult<VersionUpdateReviewStatusInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'updateReviewStatus', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, UPDATE_REVIEW_STATUS_KEYS, 'updateReviewStatus', diagnostics);
  validateRequiredString(input, 'reviewId', 'updateReviewStatus', diagnostics);
  validateRequiredRevision(input, 'expectedRevision', 'updateReviewStatus', diagnostics);
  validateRequiredString(input, 'clientRequestId', 'updateReviewStatus', diagnostics);
  validateRequiredUserMutableReviewStatus(input, 'status', 'updateReviewStatus', diagnostics);
  validateRequiredRecord(input, 'actor', 'updateReviewStatus', diagnostics);
  validateOptionalString(input, 'reason', 'updateReviewStatus', diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

function normalizeGetReviewDiffInput(
  input: VersionGetReviewDiffInput,
): ValidationResult<VersionGetReviewDiffInput> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, 'getReviewDiff', diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, GET_REVIEW_DIFF_KEYS, 'getReviewDiff', diagnostics);
  validateOptionalString(input, 'reviewId', 'getReviewDiff', diagnostics);
  validateOptionalCommitId(input, 'baseCommitId', 'getReviewDiff', diagnostics);
  validateOptionalCommitId(input, 'headCommitId', 'getReviewDiff', diagnostics);
  validateOptionalString(input, 'cursor', 'getReviewDiff', diagnostics);
  validateOptionalLimit(input, 'limit', 'getReviewDiff', diagnostics);
  if ('includeDerivedImpact' in input && typeof input.includeDerivedImpact !== 'boolean') {
    diagnostics.push(
      invalidOptionDiagnostic(
        'getReviewDiff',
        'includeDerivedImpact',
        'includeDerivedImpact must be a boolean.',
      ),
    );
  }
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

function normalizeReviewIdInput<T extends VersionGetReviewInput>(
  input: T,
  allowedKeys: ReadonlySet<string>,
  operation: VersionReviewPublicOperation,
): ValidationResult<T> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isPlainInput(input, operation, diagnostics)) return { ok: false, diagnostics };
  validateKnownKeys(input, allowedKeys, operation, diagnostics);
  validateRequiredString(input, 'reviewId', operation, diagnostics);
  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, input };
}

function validateExplicitSubjectHeads(
  input: VersionCreateReviewInput,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly result: VersionResult<WorkbookVersionReviewRecord> } {
  const subjectBase = subjectBaseCommitId(input.subject);
  const subjectHead = subjectHeadCommitId(input.subject);
  if (input.baseCommitId && subjectBase && input.baseCommitId !== subjectBase) {
    return {
      ok: false,
      result: invalidStateResult(
        'createReview',
        'review_subject_base_mismatch',
        'baseCommitId must match the base commit implied by the review subject.',
      ),
    };
  }
  if (input.headCommitId && subjectHead && input.headCommitId !== subjectHead) {
    return {
      ok: false,
      result: invalidStateResult(
        'createReview',
        'review_subject_head_mismatch',
        'headCommitId must match the head commit implied by the review subject.',
      ),
    };
  }
  return { ok: true };
}

function validateReviewDiffTarget(
  input: VersionGetReviewDiffInput,
):
  | { readonly ok: true }
  | { readonly ok: false; readonly result: VersionResult<WorkbookVersionReviewDiffPage> } {
  if (input.reviewId || (input.baseCommitId && input.headCommitId)) return { ok: true };
  return {
    ok: false,
    result: invalidStateResult(
      'getReviewDiff',
      'missing_review_diff_target',
      'getReviewDiff requires reviewId or both baseCommitId and headCommitId.',
    ),
  };
}

function validateReviewSubject(
  value: unknown,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): value is WorkbookVersionReviewSubject {
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(invalidOptionDiagnostic(operation, 'subject', 'subject must be an object.'));
    return false;
  }
  if (!REVIEW_SUBJECT_KINDS.has(String(value.kind))) {
    diagnostics.push(
      invalidOptionDiagnostic(operation, 'subject.kind', 'unknown review subject kind.'),
    );
    return false;
  }

  switch (value.kind) {
    case 'commit':
      return validateCommitId(value.commitId, operation, 'subject.commitId', diagnostics);
    case 'commitRange':
      return (
        validateCommitId(value.baseCommitId, operation, 'subject.baseCommitId', diagnostics) &&
        validateCommitId(value.headCommitId, operation, 'subject.headCommitId', diagnostics)
      );
    case 'proposal':
      validateRequiredString(value, 'proposalId', operation, diagnostics);
      return (
        validateCommitId(value.baseCommitId, operation, 'subject.baseCommitId', diagnostics) &&
        validateCommitId(value.headCommitId, operation, 'subject.headCommitId', diagnostics)
      );
    case 'merge':
      validateRequiredString(value, 'mergePreviewId', operation, diagnostics);
      return true;
    case 'conflict':
      validateRequiredString(value, 'mergePreviewId', operation, diagnostics);
      validateRequiredString(value, 'conflictId', operation, diagnostics);
      return true;
    default:
      return false;
  }
}

function subjectBaseCommitId(subject: WorkbookVersionReviewSubject): WorkbookCommitId | undefined {
  return 'baseCommitId' in subject ? subject.baseCommitId : undefined;
}

function subjectHeadCommitId(subject: WorkbookVersionReviewSubject): WorkbookCommitId | undefined {
  if ('headCommitId' in subject) return subject.headCommitId;
  if (subject.kind === 'commit') return subject.commitId;
  return undefined;
}

function isPlainInput(
  input: unknown,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): input is Readonly<Record<string, unknown>> {
  if (isRecord(input) && !Array.isArray(input)) return true;
  diagnostics.push(invalidOptionDiagnostic(operation, 'input', 'review input must be an object.'));
  return false;
}

function validateKnownKeys(
  input: Readonly<Record<string, unknown>>,
  allowedKeys: ReadonlySet<string>,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  for (const key of Object.keys(input)) {
    if (allowedKeys.has(key)) continue;
    diagnostics.push(invalidOptionDiagnostic(operation, key, `Unknown review option "${key}".`));
  }
}

function validateRequiredString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  const value = input[key];
  if (typeof value === 'string' && value.length > 0) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a non-empty string.`));
}

function validateOptionalString(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input) || typeof input[key] === 'string') return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a string.`));
}

function validateRequiredRecord(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (isRecord(input[key]) && !Array.isArray(input[key])) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be an object.`));
}

function validateOptionalReviewStatus(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input) || REVIEW_STATUSES.has(input[key] as WorkbookVersionReviewStatus)) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a review status.`));
}

function validateRequiredReviewStatus(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (REVIEW_STATUSES.has(input[key] as WorkbookVersionReviewStatus)) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a review status.`));
}

function validateRequiredUserMutableReviewStatus(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (USER_MUTABLE_REVIEW_STATUSES.has(input[key] as WorkbookVersionReviewStatus)) return;
  diagnostics.push(
    invalidOptionDiagnostic(operation, key, `${key} must be a user-mutable review status.`),
  );
}

function validateOptionalCommitId(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input)) return;
  validateCommitId(input[key], operation, key, diagnostics);
}

function validateCommitId(
  value: unknown,
  operation: VersionReviewPublicOperation,
  key: string,
  diagnostics: VersionStoreDiagnostic[],
): value is WorkbookCommitId {
  if (typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)) return true;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a commit id.`));
  return false;
}

function validateRequiredRevision(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (Number.isInteger(input[key]) && Number(input[key]) >= 1) return;
  diagnostics.push(invalidOptionDiagnostic(operation, key, `${key} must be a positive integer.`));
}

function validateOptionalLimit(
  input: Readonly<Record<string, unknown>>,
  key: string,
  operation: VersionReviewPublicOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  if (!(key in input)) return;
  const value = input[key];
  if (Number.isInteger(value) && Number(value) >= 1 && Number(value) <= 100) return;
  diagnostics.push(
    invalidOptionDiagnostic(operation, key, `${key} must be an integer from 1 to 100.`),
  );
}

function mapReviewServiceResult<T>(
  operation: VersionReviewPublicOperation,
  value: unknown,
): VersionResult<T> {
  if (isVersionResult(value)) return value as VersionResult<T>;
  if (isRecord(value)) return { ok: true, value: value as T };
  return reviewFailure(operation, [providerInvalidPayloadDiagnostic(operation)]);
}

function isVersionResult(value: unknown): boolean {
  if (!isRecord(value) || typeof value.ok !== 'boolean') return false;
  if (value.ok === true) return 'value' in value;
  return value.ok === false && isRecord(value.error);
}

function invalidStateResult<T>(
  operation: VersionReviewPublicOperation,
  state: string,
  reason: string,
): VersionResult<T> {
  return {
    ok: false,
    error: {
      code: 'invalid_state',
      state,
      allowed: ['valid_review_contract'],
      reason,
    },
  };
}

function reviewFailure<T>(
  operation: VersionReviewPublicOperation,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionResult<T> {
  return versionFailureFromStoreDiagnostics(operation, diagnostics);
}

function serviceUnavailableDiagnostic(
  operation: VersionReviewPublicOperation,
): VersionStoreDiagnostic {
  return reviewDiagnostic(
    operation,
    'VERSION_REVIEW_SERVICE_UNAVAILABLE',
    'No document-scoped version review service is attached; no review records are fabricated.',
    { recoverability: 'unsupported' },
  );
}

function methodUnavailableDiagnostic(
  operation: VersionReviewPublicOperation,
): VersionStoreDiagnostic {
  return reviewDiagnostic(
    operation,
    'VERSION_REVIEW_METHOD_UNAVAILABLE',
    `The attached version review service does not implement ${operation}.`,
    { recoverability: 'unsupported' },
  );
}

function providerErrorDiagnostic(operation: VersionReviewPublicOperation): VersionStoreDiagnostic {
  return reviewDiagnostic(
    operation,
    'VERSION_PROVIDER_ERROR',
    'The version review service failed before returning a usable public result.',
    { recoverability: 'retry', severity: 'error' },
  );
}

function providerInvalidPayloadDiagnostic(
  operation: VersionReviewPublicOperation,
): VersionStoreDiagnostic {
  return reviewDiagnostic(
    operation,
    'VERSION_INVALID_COMMIT_PAYLOAD',
    'The version review service did not return a valid public review result.',
    { recoverability: 'repair', severity: 'error' },
  );
}

function invalidOptionDiagnostic(
  operation: VersionReviewPublicOperation,
  option: string,
  safeMessage: string,
): VersionStoreDiagnostic {
  return reviewDiagnostic(operation, 'VERSION_INVALID_OPTIONS', safeMessage, {
    payload: { option },
  });
}

function reviewDiagnostic(
  operation: VersionReviewPublicOperation,
  issueCode: string,
  safeMessage: string,
  options: {
    readonly severity?: VersionStoreDiagnostic['severity'];
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly payload?: VersionDiagnosticPublicPayload;
  } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: options.severity ?? 'error',
    recoverability: options.recoverability ?? 'none',
    messageTemplateId: `version.${operation}.${issueCode}`,
    safeMessage,
    payload: { operation, ...(options.payload ?? {}) },
    redacted: true,
  };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
