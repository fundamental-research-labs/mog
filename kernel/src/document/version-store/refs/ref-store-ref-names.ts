import {
  REF_NAME_STORAGE_PREFIX,
  validateRefNamePrefix,
  validateRefName,
  type RefName,
  type RefNameDiagnostic,
  type RefNamePrefix,
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

export type ParsedRefPrefixResult =
  | { readonly ok: true; readonly prefix: RefNamePrefix }
  | { readonly ok: false; readonly diagnostics: readonly VersionDiagnostic[] };

export function parseCanonicalRefPrefix(value: string): ParsedRefPrefixResult {
  const prefix = value.startsWith(REF_NAME_STORAGE_PREFIX)
    ? value.slice(REF_NAME_STORAGE_PREFIX.length)
    : value;
  const parsed = validateRefNamePrefix(prefix, 'prefix');
  if (parsed.ok) {
    return { ok: true, prefix: parsed.prefix };
  }

  return {
    ok: false,
    diagnostics: refNameDiagnosticsToVersionDiagnostics(parsed.diagnostics),
  };
}

export function matchesRefNamePrefix(name: RefName, prefix: RefNamePrefix | undefined): boolean {
  if (prefix === undefined) {
    return true;
  }
  const prefixValue = prefix as string;
  if (prefixValue.endsWith('/')) {
    return name.startsWith(prefixValue);
  }
  return name === prefixValue || name.startsWith(`${prefixValue}/`);
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
