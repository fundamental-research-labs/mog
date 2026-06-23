import type { VersionStoreDiagnostic as PublicVersionStoreDiagnostic } from '@mog-sdk/contracts/api';

export type MergeDiagnostic = PublicVersionStoreDiagnostic;

export function graphDiagnostics(
  diagnostics: readonly unknown[],
  payload: Readonly<Record<string, string | number | boolean | null>> = {},
): readonly MergeDiagnostic[] {
  if (diagnostics.length === 0) {
    return [
      diagnostic(
        'VERSION_GRAPH_UNINITIALIZED',
        'The workbook version graph is not initialized for this document.',
        { recoverability: 'unsupported', payload },
      ),
    ];
  }
  return diagnostics.map((item) => {
    if (!isRecord(item)) {
      return diagnostic('VERSION_PROVIDER_ERROR', 'Version graph read failed.', {
        severity: 'fatal',
        recoverability: 'retry',
        payload,
      });
    }
    const issueCode = item.issueCode ?? item.code ?? 'VERSION_PROVIDER_ERROR';
    const severity = item.severity;
    return diagnostic(
      typeof issueCode === 'string' ? issueCode : 'VERSION_PROVIDER_ERROR',
      typeof item.safeMessage === 'string'
        ? item.safeMessage
        : typeof item.message === 'string'
          ? item.message
          : 'Version graph read failed.',
      {
        severity: severity === 'fatal' ? 'fatal' : severity === 'warning' ? 'warning' : 'error',
        recoverability: recoverabilityForIssue(
          typeof issueCode === 'string' ? issueCode : 'VERSION_PROVIDER_ERROR',
        ),
        payload,
      },
    );
  });
}

export function diagnostic(
  issueCode: string,
  safeMessage: string,
  options: {
    readonly severity?: MergeDiagnostic['severity'];
    readonly recoverability?: MergeDiagnostic['recoverability'];
    readonly payload?: Readonly<Record<string, string | number | boolean | null>>;
  } = {},
): MergeDiagnostic {
  return {
    issueCode,
    severity: options.severity ?? (issueCode === 'VERSION_PROVIDER_ERROR' ? 'fatal' : 'error'),
    recoverability: options.recoverability ?? recoverabilityForIssue(issueCode),
    messageTemplateId: `version.merge.${issueCode}` as MergeDiagnostic['messageTemplateId'],
    safeMessage,
    ...(options.payload ? { payload: { operation: 'merge', ...options.payload } } : {}),
    redacted: true,
  };
}

function recoverabilityForIssue(issueCode: string): MergeDiagnostic['recoverability'] {
  switch (issueCode) {
    case 'VERSION_PROVIDER_ERROR':
    case 'VERSION_REF_CONFLICT':
    case 'VERSION_STALE_PAGE_CURSOR':
      return 'retry';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_INVALID_COMMIT_PAYLOAD':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_MISSING_PARENT':
    case 'VERSION_OBJECT_STORE_FAILURE':
      return 'repair';
    case 'VERSION_GRAPH_UNINITIALIZED':
    case 'VERSION_MERGE_UNSUPPORTED_ANCESTRY':
    case 'VERSION_MERGE_UNSUPPORTED_DOMAIN':
    case 'VERSION_PERMISSION_DENIED':
    case 'VERSION_REDACTION_VIOLATION':
    case 'VERSION_UNMATERIALIZABLE_COMMIT':
    case 'VERSION_UNSUPPORTED_SCHEMA':
      return 'unsupported';
    default:
      return 'none';
  }
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
