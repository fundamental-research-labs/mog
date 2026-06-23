import type { WorkbookCommitStoreDiagnostic } from './types';
import { invalidPayloadDiagnostic } from './payload-diagnostics';

export function parseString(
  value: unknown,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): string | undefined {
  if (typeof value === 'string') {
    return value;
  }
  diagnostics.push(invalidPayloadDiagnostic(path, 'Commit payload field must be a string.'));
  return undefined;
}

export function parseOptionalString(
  value: unknown,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): string | undefined {
  if (value === undefined) {
    return undefined;
  }
  return parseString(value, path, diagnostics);
}
