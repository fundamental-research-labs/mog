import type { WorkbookCommitCompletenessDiagnostic, WorkbookCommitStoreDiagnostic } from './types';
import { invalidPayloadDiagnostic } from './payload-diagnostics';
import { isPlainRecord } from './payload-guards';
import { parseOptionalString, parseString } from './payload-scalars';

export function parseCompletenessDiagnostics(
  value: unknown,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): readonly WorkbookCommitCompletenessDiagnostic[] | undefined {
  const diagnosticStart = diagnostics.length;
  if (!Array.isArray(value)) {
    diagnostics.push(invalidPayloadDiagnostic(path, 'Completeness diagnostics must be an array.'));
    return undefined;
  }

  const parsed: WorkbookCommitCompletenessDiagnostic[] = [];
  for (let index = 0; index < value.length; index++) {
    const item = parseCompletenessDiagnostic(value[index], `${path}[${index}]`, diagnostics);
    if (item !== undefined) {
      parsed.push(item);
    }
  }
  return diagnostics.length > diagnosticStart ? undefined : parsed;
}

function parseCompletenessDiagnostic(
  value: unknown,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): WorkbookCommitCompletenessDiagnostic | undefined {
  if (!isPlainRecord(value)) {
    diagnostics.push(invalidPayloadDiagnostic(path, 'Completeness diagnostic must be an object.'));
    return undefined;
  }

  const unsupportedKey = Object.keys(value).find(
    (key) => !['code', 'severity', 'message', 'path', 'details'].includes(key),
  );
  if (unsupportedKey !== undefined) {
    diagnostics.push(
      invalidPayloadDiagnostic(
        `${path}.${unsupportedKey}`,
        'Completeness diagnostic has an unsupported field.',
      ),
    );
    return undefined;
  }

  const code = parseString(value.code, `${path}.code`, diagnostics);
  const severity = parseCompletenessSeverity(value.severity, `${path}.severity`, diagnostics);
  const message = parseString(value.message, `${path}.message`, diagnostics);
  const diagnosticPath = parseOptionalString(value.path, `${path}.path`, diagnostics);
  const details = parseOptionalDiagnosticDetails(value.details, `${path}.details`, diagnostics);

  if (code === undefined || severity === undefined || message === undefined) {
    return undefined;
  }

  return {
    code,
    severity,
    message,
    ...(diagnosticPath === undefined ? {} : { path: diagnosticPath }),
    ...(details === undefined ? {} : { details }),
  };
}

function parseCompletenessSeverity(
  value: unknown,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): WorkbookCommitCompletenessDiagnostic['severity'] | undefined {
  if (value === 'info' || value === 'warning' || value === 'error') {
    return value;
  }
  diagnostics.push(invalidPayloadDiagnostic(path, 'Completeness diagnostic severity is invalid.'));
  return undefined;
}

function parseOptionalDiagnosticDetails(
  value: unknown,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): Readonly<Record<string, string | number | boolean | null>> | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!isPlainRecord(value)) {
    diagnostics.push(invalidPayloadDiagnostic(path, 'Diagnostic details must be an object.'));
    return undefined;
  }

  const details: Record<string, string | number | boolean | null> = {};
  for (const [key, detailValue] of Object.entries(value)) {
    if (
      detailValue === null ||
      typeof detailValue === 'string' ||
      typeof detailValue === 'boolean' ||
      (typeof detailValue === 'number' && Number.isFinite(detailValue))
    ) {
      details[key] = detailValue;
      continue;
    }
    diagnostics.push(
      invalidPayloadDiagnostic(
        `${path}.${key}`,
        'Diagnostic detail values must be string, number, boolean, or null.',
      ),
    );
  }
  return details;
}
