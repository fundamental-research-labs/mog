import {
  REF_NAMESPACES,
  validateRefName,
  type RefName,
  type RefNameDiagnostic,
  type RefNamespace,
} from './ref-name';
import { redactedDiagnostic } from './ref-store-diagnostics';
import type { VersionDiagnostic } from './ref-store-types';

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
  return diagnostics.map((item) => {
    const details: Record<string, string | boolean> = {
      issue: item.issue,
    };
    if (item.byteLength !== undefined) {
      details.byteLength = String(item.byteLength);
    }
    if (item.maxByteLength !== undefined) {
      details.maxByteLength = String(item.maxByteLength);
    }
    return redactedDiagnostic(item.code, item.message, details);
  });
}
