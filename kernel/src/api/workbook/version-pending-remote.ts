import type {
  VersionCapability,
  VersionDiagnosticPublicPayload,
  VersionPromotePendingRemoteDiagnostic,
  VersionPromotePendingRemoteOptions,
  VersionPromotePendingRemoteResult,
  VersionPromotePendingRemoteSkipReason,
  VersionPromotePendingRemoteSkippedSegment,
  VersionPromotePendingRemoteStatus,
  VersionResult,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { getVersionHostCapabilityDecisions } from './version-merge-capability';
import { validateVersionOperationGate } from './version-operation-gate';
import { versionFailureFromStoreDiagnostics } from './version-result';

const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const PENDING_REMOTE_SEGMENT_ID_RE = /^pending-remote-segment:sha256:[0-9a-f]{64}$/;
const SYNC_BATCH_STATUS_ID_RE = /^sync-batch-status:sha256:[0-9a-f]{64}$/;
const OPTION_KEYS = new Set(['includeDiagnostics']);
const REQUIRED_PROMOTION_CAPABILITIES = [
  'version:remotePromote',
  'version:provenance',
] as const satisfies readonly VersionCapability[];
const SKIP_REASONS = new Set<VersionPromotePendingRemoteSkipReason>([
  'batch-status-read-failed',
  'batch-status-terminal',
  'completion-failed',
  'graph-ref-unavailable',
  'graph-write-failed',
  'inconsistent-group',
  'ineligible-operation-context',
  'ineligible-state',
  'invalid-required-object',
  'missing-required-object',
  'missing-semantic-change-set',
  'missing-snapshot-root',
  'provider-authority-stale',
  'provider-authority-unknown',
  'provider-read-failed',
]);

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

type PendingRemotePromotionServiceLike = {
  promotePendingRemoteSegments(): MaybePromise<unknown>;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

export function hasAttachedPendingRemotePromotionService(ctx: DocumentContext): boolean {
  return getAttachedPendingRemotePromotionService(ctx) !== null;
}

export async function promotePendingRemoteWorkbookVersion(
  ctx: DocumentContext,
  options: VersionPromotePendingRemoteOptions = {},
): Promise<VersionResult<VersionPromotePendingRemoteResult>> {
  const optionDiagnostics = validateOptions(options);
  if (optionDiagnostics.length > 0) {
    return versionFailureFromStoreDiagnostics('promotePendingRemote', optionDiagnostics);
  }

  const gateDiagnostics = validatePendingRemotePromotionApiGate(ctx);
  if (gateDiagnostics.length > 0) {
    return versionFailureFromStoreDiagnostics('promotePendingRemote', gateDiagnostics);
  }

  const service = getAttachedPendingRemotePromotionService(ctx);
  if (!service) {
    return versionFailureFromStoreDiagnostics('promotePendingRemote', [
      publicDiagnostic(
        'VERSION_PENDING_REMOTE_PROMOTION_SERVICE_UNAVAILABLE',
        'No document-scoped pending remote promotion service is attached.',
        'warning',
        'unsupported',
      ),
    ]);
  }

  try {
    return mapPromotionResult(await service.promotePendingRemoteSegments(), options);
  } catch {
    return versionFailureFromStoreDiagnostics('promotePendingRemote', [
      publicDiagnostic(
        'VERSION_PENDING_REMOTE_PROMOTION_PROVIDER_ERROR',
        'The pending remote promotion service failed before returning a result.',
        'error',
        'retry',
      ),
    ]);
  }
}

function validatePendingRemotePromotionApiGate(
  ctx: DocumentContext,
): readonly VersionStoreDiagnostic[] {
  const operationGateDiagnostics = validateVersionOperationGate(
    ctx,
    'promotePendingRemote',
    'version:remotePromote',
    { mutates: true },
  );
  if (operationGateDiagnostics.length > 0) return operationGateDiagnostics;

  const hostDecisions = getVersionHostCapabilityDecisions(ctx);
  const diagnostics: VersionStoreDiagnostic[] = [];
  for (const capability of REQUIRED_PROMOTION_CAPABILITIES) {
    if (hostDecisions[capability] !== 'allowed') {
      diagnostics.push(requiredCapabilityDiagnostic(capability));
    }
  }
  if (!hasCompleteVc09ProvenanceTruth(ctx)) {
    diagnostics.push(
      noWriteDiagnostic(
        'VERSION_PENDING_REMOTE_PROMOTION_PROVENANCE_UNAVAILABLE',
        'Pending remote promotion requires complete VC-09 provenance truth.',
        'none',
        {
          operation: 'promotePendingRemote',
          capability: 'version:remotePromote',
          requiredCapability: 'version:provenance',
          reason: 'provenanceUnavailable',
        },
      ),
    );
  }
  return diagnostics;
}

function hasCompleteVc09ProvenanceTruth(ctx: DocumentContext): boolean {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return false;
  return [
    services.provenanceAdmissionService,
    services.provenanceTruthService,
    services.provenanceStatusService,
    services,
  ].some(hasExplicitCompleteVc09ProvenanceTruth);
}

function hasExplicitCompleteVc09ProvenanceTruth(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    value.vc09ProvenanceTruthComplete === true ||
    value.completeVc09ProvenanceAdmission === true ||
    hasExplicitCompleteVc09ProvenanceTruth(value.vc09ProvenanceTruth) ||
    hasExplicitCompleteVc09ProvenanceTruth(value.provenanceAdmissionTruth)
  );
}

function requiredCapabilityDiagnostic(capability: VersionCapability): VersionStoreDiagnostic {
  return noWriteDiagnostic(
    'VERSION_CAPABILITY_DISABLED',
    `Pending remote promotion requires host policy to explicitly allow ${capability}.`,
    'none',
    {
      operation: 'promotePendingRemote',
      capability: 'version:remotePromote',
      requiredCapability: capability,
      reason: 'hostCapabilityExplicitGrantRequired',
    },
  );
}

function getAttachedPendingRemotePromotionService(
  ctx: DocumentContext,
): PendingRemotePromotionServiceLike | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return null;

  for (const candidate of [services.pendingRemotePromotionService, services]) {
    const service = toPendingRemotePromotionService(candidate);
    if (service) return service;
  }
  return null;
}

function toPendingRemotePromotionService(value: unknown): PendingRemotePromotionServiceLike | null {
  const promotePendingRemoteSegments = bindMethod(value, 'promotePendingRemoteSegments');
  return promotePendingRemoteSegments
    ? { promotePendingRemoteSegments: () => promotePendingRemoteSegments() }
    : null;
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function validateOptions(
  input: VersionPromotePendingRemoteOptions,
): readonly VersionStoreDiagnostic[] {
  if (!isRecord(input) || Array.isArray(input)) {
    return [
      invalidOptionsDiagnostic('promotePendingRemote options must be an object when supplied.'),
    ];
  }

  const diagnostics: VersionStoreDiagnostic[] = [];
  for (const key of Object.keys(input)) {
    if (!OPTION_KEYS.has(key)) {
      diagnostics.push(invalidOptionsDiagnostic('Unsupported promotePendingRemote option.', key));
    }
  }
  if (
    'includeDiagnostics' in input &&
    input.includeDiagnostics !== undefined &&
    typeof input.includeDiagnostics !== 'boolean'
  ) {
    diagnostics.push(
      invalidOptionsDiagnostic(
        'includeDiagnostics must be a boolean when supplied.',
        'includeDiagnostics',
      ),
    );
  }
  return diagnostics;
}

function mapPromotionResult(
  value: unknown,
  options: VersionPromotePendingRemoteOptions,
): VersionResult<VersionPromotePendingRemoteResult> {
  if (!isRecord(value)) return invalidPayloadResult();

  const status = toStatus(value.status);
  const promotedSegmentIds = toStringArray(value.promotedSegmentIds, toSegmentId);
  const commitIds = toStringArray(value.commitIds, toCommitId);
  const skipped = toSkippedSegments(value.skipped);
  if (!status || !promotedSegmentIds || !commitIds || !skipped) return invalidPayloadResult();

  const diagnostics = mapDiagnostics(value.diagnostics);
  return {
    ok: true,
    value: {
      status,
      promotedSegmentIds,
      commitIds,
      skipped,
      diagnostics: options.includeDiagnostics === false && status === 'success' ? [] : diagnostics,
    },
  };
}

function invalidPayloadResult(): VersionResult<VersionPromotePendingRemoteResult> {
  return versionFailureFromStoreDiagnostics('promotePendingRemote', [
    publicDiagnostic(
      'VERSION_INVALID_COMMIT_PAYLOAD',
      'The pending remote promotion service returned an invalid result payload.',
      'error',
      'repair',
    ),
  ]);
}

function toStatus(value: unknown): VersionPromotePendingRemoteStatus | null {
  return value === 'success' || value === 'partial' || value === 'failed' ? value : null;
}

function toStringArray<T extends string>(
  value: unknown,
  map: (value: unknown) => T | null,
): readonly T[] | null {
  if (!Array.isArray(value)) return null;
  const mapped: T[] = [];
  for (const item of value) {
    const result = map(item);
    if (!result) return null;
    mapped.push(result);
  }
  return Object.freeze(mapped);
}

function toSkippedSegments(
  value: unknown,
): readonly VersionPromotePendingRemoteSkippedSegment[] | null {
  if (!Array.isArray(value)) return null;
  const skipped: VersionPromotePendingRemoteSkippedSegment[] = [];
  for (const item of value) {
    if (!isRecord(item)) return null;
    const segmentId = toSegmentId(item.segmentId);
    const reason = toSkipReason(item.reason);
    const message = typeof item.message === 'string' ? item.message : null;
    const commitId = item.commitId === undefined ? undefined : toCommitId(item.commitId);
    if (!segmentId || !reason || !message || (item.commitId !== undefined && !commitId)) {
      return null;
    }
    skipped.push({
      segmentId,
      reason,
      message,
      ...(commitId ? { commitId } : {}),
    });
  }
  return Object.freeze(skipped);
}

function toSegmentId(
  value: unknown,
): VersionPromotePendingRemoteSkippedSegment['segmentId'] | null {
  return typeof value === 'string' && PENDING_REMOTE_SEGMENT_ID_RE.test(value)
    ? (value as VersionPromotePendingRemoteSkippedSegment['segmentId'])
    : null;
}

function toCommitId(value: unknown): WorkbookCommitId | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : null;
}

function mapDiagnostics(value: unknown): readonly VersionPromotePendingRemoteDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return Object.freeze(value.map(mapDiagnostic));
}

function mapDiagnostic(value: unknown): VersionPromotePendingRemoteDiagnostic {
  if (!isRecord(value)) {
    return {
      code: 'VERSION_PENDING_REMOTE_PROMOTION_STORE_UNAVAILABLE',
      severity: 'error',
      message: 'The pending remote promotion service returned an invalid diagnostic.',
    };
  }
  const code =
    typeof value.code === 'string'
      ? value.code
      : 'VERSION_PENDING_REMOTE_PROMOTION_STORE_UNAVAILABLE';
  const severity = value.severity;
  const commitId = toCommitId(value.commitId);
  const reason = toSkipReason(value.reason);
  return {
    code: code as VersionPromotePendingRemoteDiagnostic['code'],
    severity:
      severity === 'info' || severity === 'warning' || severity === 'error' ? severity : 'error',
    message:
      typeof value.message === 'string'
        ? value.message
        : 'Pending remote promotion produced a diagnostic.',
    ...(reason ? { reason } : {}),
    ...(typeof value.segmentId === 'string' && PENDING_REMOTE_SEGMENT_ID_RE.test(value.segmentId)
      ? { segmentId: value.segmentId as VersionPromotePendingRemoteDiagnostic['segmentId'] }
      : {}),
    ...(commitId ? { commitId } : {}),
    ...(isRecord(value.details) ? { data: sanitizeDetails(value.details) } : {}),
  };
}

function toSkipReason(value: unknown): VersionPromotePendingRemoteSkipReason | null {
  return typeof value === 'string' &&
    SKIP_REASONS.has(value as VersionPromotePendingRemoteSkipReason)
    ? (value as VersionPromotePendingRemoteSkipReason)
    : null;
}

function sanitizeDetails(
  details: Readonly<Record<string, unknown>>,
): VersionPromotePendingRemoteDiagnostic['data'] {
  const data: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details)) {
    if (isPublicPayloadValue(value)) data[key] = sanitizeDetailValue(key, value);
  }
  return data;
}

function sanitizeDetailValue(
  key: string,
  value: string | number | boolean | null,
): string | number | boolean | null {
  if (shouldRedactDetailValue(key, value)) return 'redacted';
  return value;
}

function shouldRedactDetailValue(key: string, value: string | number | boolean | null): boolean {
  const normalizedKey = key.toLowerCase();
  if (
    normalizedKey === 'cursor' ||
    normalizedKey === 'pagetoken' ||
    normalizedKey === 'nextpagetoken'
  ) {
    return true;
  }
  if (normalizedKey.endsWith('batchid') || normalizedKey.endsWith('batchstatusid')) {
    return true;
  }
  return typeof value === 'string' && SYNC_BATCH_STATUS_ID_RE.test(value);
}

function invalidOptionsDiagnostic(message: string, option?: string): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_INVALID_OPTIONS', message, 'error', 'none', {
    operation: 'promotePendingRemote',
    ...(option ? { option } : {}),
  });
}

function noWriteDiagnostic(
  issueCode: string,
  safeMessage: string,
  recoverability: VersionStoreDiagnostic['recoverability'],
  payload: VersionDiagnosticPublicPayload,
): VersionStoreDiagnostic {
  return {
    ...publicDiagnostic(issueCode, safeMessage, 'error', recoverability, payload),
    mutationGuarantee: 'no-write-attempted',
  };
}

function publicDiagnostic(
  issueCode: string,
  safeMessage: string,
  severity: VersionStoreDiagnostic['severity'],
  recoverability: VersionStoreDiagnostic['recoverability'],
  payload: VersionDiagnosticPublicPayload = { operation: 'promotePendingRemote' },
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity,
    recoverability,
    messageTemplateId:
      `version.promotePendingRemote.${issueCode}` as VersionStoreDiagnostic['messageTemplateId'],
    safeMessage,
    payload,
    redacted: true,
  };
}

function isPublicPayloadValue(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
