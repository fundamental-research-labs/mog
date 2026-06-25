import type { WorkbookCommitStoreDiagnostic, WorkbookCommitStoreDiagnosticCode } from './types';

export function diagnostic(
  code: WorkbookCommitStoreDiagnosticCode,
  message: string,
  options: Omit<WorkbookCommitStoreDiagnostic, 'code' | 'severity' | 'message'> = {},
): WorkbookCommitStoreDiagnostic {
  return {
    code,
    severity: code === 'VERSION_OBJECT_STORE_FAILURE' ? 'corruption' : 'error',
    message,
    ...options,
  };
}

export function invalidPayloadDiagnostic(
  path: string,
  message: string,
): WorkbookCommitStoreDiagnostic {
  return diagnostic('VERSION_INVALID_COMMIT_PAYLOAD', message, { details: { path } });
}
