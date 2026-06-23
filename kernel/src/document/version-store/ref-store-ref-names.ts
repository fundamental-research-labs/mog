import {
  REF_NAMESPACES,
  validateRefName,
  type RefName,
  type RefNameDiagnostic,
  type RefNamespace,
} from './ref-name';
import type { VersionDiagnostic } from './ref-store';

export type ParsedRefNameResult =
  | { readonly ok: true; readonly name: RefName }
  | { readonly ok: false; readonly diagnostics: readonly VersionDiagnostic[] };

export function parseCanonicalRefName(value: RefName | string): ParsedRefNameResult {
  const parsed = validateRefName(value);
  if (parsed.ok) {
    return { ok: true, name: parsed.name };
  }

  return {
    ok: false,
    diagnostics: refNameDiagnosticsToVersionDiagnostics(parsed.diagnostics),
  };
}

export function matchesRefNamespacePrefix(
  name: RefName,
  prefix: RefNamespace | undefined,
): boolean {
  if (prefix === undefined) {
    return true;
  }
  return name.startsWith(`${prefix}/`);
}

export function isCanonicalRefNamespace(value: unknown): value is RefNamespace {
  return typeof value === 'string' && (REF_NAMESPACES as readonly string[]).includes(value);
}

function refNameDiagnosticsToVersionDiagnostics(
  diagnostics: readonly RefNameDiagnostic[],
): readonly VersionDiagnostic[] {
  return diagnostics.map((item) =>
    diagnostic(item.code, item.message, item.value, {
      issue: item.issue,
    }),
  );
}

function diagnostic(
  code: string,
  message: string,
  refName?: string,
  details?: Record<string, string | boolean>,
): VersionDiagnostic {
  return Object.freeze({
    code,
    severity: 'error',
    message,
    refName,
    details: details === undefined ? undefined : Object.freeze({ ...details }),
  });
}
