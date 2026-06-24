import type {
  VersionDegradedHeadResult,
  VersionDiagnosticPublicPayload,
  VersionMainRefName,
  VersionRecordRevision,
  VersionRef,
  VersionRefName,
  VersionRefReadResult,
  VersionRefSelector,
  VersionStoreDiagnostic,
  VersionSymbolicRef,
  WorkbookCommitId,
  WorkbookCommitRef,
} from '@mog-sdk/contracts/api';

export const VERSION_HEAD_REF = 'HEAD';
export const VERSION_MAIN_REF = 'refs/heads/main' satisfies VersionMainRefName;

const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;

type VersionPublicOperation = 'getHead' | 'getRef' | 'readRef';

export function mapHeadResult(value: unknown): WorkbookCommitRef | VersionDegradedHeadResult {
  if (!isRecord(value)) {
    return degradedHead([providerErrorDiagnostic('getHead')]);
  }

  if (value.status === 'success') {
    const head = mapCommitRef(value.head);
    if (head) return head;
    return degradedHead([
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_PAYLOAD',
        'getHead',
        'The version graph head result did not contain a valid public commit ref.',
        { severity: 'error', recoverability: 'repair' },
      ),
    ]);
  }

  if (value.status === 'degraded' || value.status === 'failed') {
    const ref = mapRef(value.ref) ?? mapRef(value.main);
    return degradedHead(mapGraphDiagnostics(value.diagnostics, 'getHead'), ref ?? undefined);
  }

  return mapLegacyHeadResult(value);
}

export function mapLegacyHeadResult(value: unknown): WorkbookCommitRef | VersionDegradedHeadResult {
  if (value === null) {
    return degradedHead([graphUninitializedDiagnostic('getHead')]);
  }

  if (!isRecord(value)) {
    return degradedHead([providerErrorDiagnostic('getHead')]);
  }

  if ('head' in value) {
    const head = mapLegacyHead(value.head);
    if (head) return head;
    return degradedHead(mapGraphDiagnostics(value.diagnostics, 'getHead'));
  }

  const head = mapLegacyHead(value);
  if (head) return head;
  return degradedHead([providerErrorDiagnostic('getHead')]);
}

export function mapRefResult(
  value: unknown,
  requestedName: VersionRefSelector,
): VersionRefReadResult {
  if (!isRecord(value)) {
    return degradedRef(null, [providerErrorDiagnostic('readRef', { refName: requestedName })]);
  }

  if (value.status === 'success') {
    const ref = mapRef(value.ref);
    if (ref) {
      return { status: 'success', ref, diagnostics: [] } as VersionRefReadResult;
    }
    return degradedRef(null, [
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_PAYLOAD',
        'readRef',
        'The version graph ref result did not contain a valid public ref.',
        {
          severity: 'error',
          recoverability: 'repair',
          payload: { refName: requestedName },
        },
      ),
    ]);
  }

  if (value.status === 'degraded' || value.status === 'failed') {
    return degradedRef(
      mapRef(value.ref),
      mapGraphDiagnostics(value.diagnostics, 'readRef', { refName: requestedName }),
    );
  }

  return degradedRef(null, [providerErrorDiagnostic('readRef', { refName: requestedName })]);
}

export function serviceUnavailableDiagnostic(
  operation: VersionPublicOperation,
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_GRAPH_UNINITIALIZED',
    operation,
    'No document-scoped version graph read service is attached; no commit history is fabricated.',
    {
      severity: 'warning',
      recoverability: 'unsupported',
      payload,
    },
  );
}

export function providerErrorDiagnostic(
  operation: VersionPublicOperation,
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PROVIDER_ERROR',
    operation,
    'The version graph read service failed before returning a usable public result.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload,
    },
  );
}

export function degradedHead(
  diagnostics: readonly VersionStoreDiagnostic[],
  ref?: VersionRef | VersionSymbolicRef,
): VersionDegradedHeadResult {
  return {
    status: 'degraded',
    ...(ref ? { ref } : {}),
    diagnostics,
  };
}

export function degradedRef(
  ref: VersionRef | VersionSymbolicRef | null,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionRefReadResult {
  return {
    status: 'degraded',
    ref,
    diagnostics,
  };
}

function mapLegacyHead(value: unknown): WorkbookCommitRef | null {
  if (!isRecord(value)) return null;
  const id = toCommitId(value.commitId);
  if (!id) return null;
  const refName = legacyBranchNameToRefName(value.branchName);
  return {
    id,
    ...(refName ? { refName } : {}),
    ...(refName ? { resolvedFrom: VERSION_HEAD_REF } : {}),
  };
}

function mapCommitRef(value: unknown): WorkbookCommitRef | null {
  if (!isRecord(value)) return null;
  const id = toCommitId(value.id);
  if (!id) return null;

  const refName = toRefName(value.refName);
  const resolvedFrom = toRefSelector(value.resolvedFrom);
  const refRevision = toRevision(value.refRevision);

  return {
    id,
    ...(refName ? { refName } : {}),
    ...(resolvedFrom ? { resolvedFrom } : {}),
    ...(refRevision ? { refRevision } : {}),
  };
}

function mapRef(value: unknown): VersionRef | VersionSymbolicRef | null {
  if (!isRecord(value)) return null;

  if (value.name === VERSION_HEAD_REF) {
    const target = toRefName(value.target);
    const revision = toRevision(value.revision);
    if (!target || !revision) return null;
    return { name: VERSION_HEAD_REF, target, revision };
  }

  const name = toRefName(value.name);
  const commitId = toCommitId(value.commitId);
  const revision = toRevision(value.revision);
  if (!name || !commitId || !revision) return null;

  return {
    name,
    commitId,
    revision,
    ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
  };
}

function mapGraphDiagnostics(
  value: unknown,
  operation: VersionPublicOperation,
  fallbackPayload: VersionDiagnosticPublicPayload = {},
): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [graphUninitializedDiagnostic(operation, fallbackPayload)];
  }

  return value.map((diagnosticValue) =>
    mapGraphDiagnostic(diagnosticValue, operation, fallbackPayload),
  );
}

function mapGraphDiagnostic(
  value: unknown,
  operation: VersionPublicOperation,
  fallbackPayload: VersionDiagnosticPublicPayload,
): VersionStoreDiagnostic {
  if (!isRecord(value)) {
    return providerErrorDiagnostic(operation, fallbackPayload);
  }

  const issueCode =
    typeof value.issueCode === 'string'
      ? value.issueCode
      : typeof value.code === 'string'
        ? value.code
        : 'VERSION_PROVIDER_ERROR';
  const severity = value.severity === 'corruption' ? 'error' : value.severity;

  return publicDiagnostic(issueCode, operation, safeMessageForIssue(issueCode, operation), {
    severity:
      severity === 'info' || severity === 'warning' || severity === 'error' || severity === 'fatal'
        ? severity
        : 'error',
    recoverability: recoverabilityForIssue(issueCode),
    payload: sanitizeDiagnosticPayload(value, operation, fallbackPayload),
  });
}

function sanitizeDiagnosticPayload(
  value: Readonly<Record<string, unknown>>,
  operation: VersionPublicOperation,
  fallbackPayload: VersionDiagnosticPublicPayload,
): VersionDiagnosticPublicPayload {
  const payload: Record<string, string | number | boolean | null> = {
    operation,
    ...fallbackPayload,
  };

  if (typeof value.operation === 'string') payload.operation = value.operation;
  if (typeof value.option === 'string') payload.option = value.option;
  const refName = value.refName;
  if (refName === VERSION_HEAD_REF || refName === VERSION_MAIN_REF) {
    payload.refName = refName;
  }

  const details = isRecord(value.details) ? value.details : null;
  if (details) {
    for (const key of [
      'min',
      'max',
      'pageSize',
      'receivedPageSize',
      'pageTokenUnsupported',
    ] as const) {
      const detailValue = details[key];
      if (isPayloadPrimitive(detailValue)) payload[key] = detailValue;
    }
  }

  return payload;
}

function graphUninitializedDiagnostic(
  operation: VersionPublicOperation,
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_GRAPH_UNINITIALIZED',
    operation,
    'The workbook version graph is not initialized for this document.',
    {
      severity: 'warning',
      recoverability: 'unsupported',
      payload,
    },
  );
}

function publicDiagnostic(
  issueCode: string,
  operation: VersionPublicOperation,
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
    recoverability: options.recoverability ?? recoverabilityForIssue(issueCode),
    messageTemplateId: `version.${operation}.${issueCode}`,
    safeMessage,
    ...(options.payload ? { payload: options.payload } : {}),
    redacted: true,
  };
}

function safeMessageForIssue(issueCode: string, operation: VersionPublicOperation): string {
  switch (issueCode) {
    case 'VERSION_GRAPH_UNINITIALIZED':
      return 'The workbook version graph is not initialized for this document.';
    case 'VERSION_STALE_PAGE_CURSOR':
      return 'The version page token is stale or unsupported by this read slice.';
    case 'VERSION_UNSUPPORTED_PAGE_TOKEN':
      return 'The version graph cannot serve a follow-up page token in this slice.';
    case 'VERSION_INVALID_OPTIONS':
      return 'The version read options are invalid for this method.';
    case 'VERSION_PERMISSION_DENIED':
      return 'The requested version read is not exposed by this public slice.';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_OBJECT_STORE_FAILURE':
      return 'The version graph could not validate the requested commit closure.';
    case 'VERSION_REF_CONFLICT':
      return 'The version ref changed while the read was in progress.';
    default:
      return `The version graph could not complete ${operation}.`;
  }
}

function recoverabilityForIssue(issueCode: string): VersionStoreDiagnostic['recoverability'] {
  switch (issueCode) {
    case 'VERSION_STALE_PAGE_CURSOR':
    case 'VERSION_REF_CONFLICT':
      return 'retry';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_OBJECT_STORE_FAILURE':
      return 'repair';
    case 'VERSION_GRAPH_UNINITIALIZED':
    case 'VERSION_UNSUPPORTED_PAGE_TOKEN':
    case 'VERSION_PERMISSION_DENIED':
      return 'unsupported';
    default:
      return 'none';
  }
}

function toCommitId(value: unknown): WorkbookCommitId | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : null;
}

function toRevision(value: unknown): VersionRecordRevision | undefined {
  if (isRecord(value) && value.kind === 'counter' && typeof value.value === 'string') {
    return { kind: 'counter', value: value.value };
  }
  if (isRecord(value) && value.kind === 'opaque' && typeof value.value === 'string') {
    return { kind: 'opaque', value: value.value };
  }
  if (typeof value === 'string') return { kind: 'opaque', value };
  return undefined;
}

function toRefSelector(value: unknown): VersionRefSelector | undefined {
  if (value === VERSION_HEAD_REF) return VERSION_HEAD_REF;
  return toRefName(value);
}

function toRefName(value: unknown): VersionMainRefName | VersionRefName | undefined {
  if (value === VERSION_MAIN_REF) return VERSION_MAIN_REF;
  if (typeof value === 'string' && value.startsWith('refs/heads/')) {
    return value as VersionRefName;
  }
  return undefined;
}

function legacyBranchNameToRefName(
  value: unknown,
): VersionMainRefName | VersionRefName | undefined {
  if (value === undefined) return undefined;
  if (value === 'main') return VERSION_MAIN_REF;
  if (typeof value === 'string' && value.startsWith('refs/heads/')) return value as VersionRefName;
  if (typeof value === 'string' && value.length > 0) return `refs/heads/${value}` as VersionRefName;
  return undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isPayloadPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}
