import { parseObjectDigest, type ObjectDigest } from '../object-digest';
import type { WorkbookCommitStoreDiagnostic } from './types';
import { diagnostic } from './payload-diagnostics';

export function parsePayloadDigest(
  value: unknown,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): ObjectDigest | undefined {
  const digest = parseOptionalDigest(value, path, diagnostics);
  if (digest === undefined) {
    diagnostics.push(
      diagnostic('VERSION_MISSING_DEPENDENCY', 'Commit payload digest reference is missing.', {
        details: { path },
      }),
    );
  }
  return digest;
}

export function parseOptionalDigest(
  value: unknown,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): ObjectDigest | undefined {
  if (value === undefined) {
    return undefined;
  }
  try {
    return parseObjectDigest(value, path);
  } catch {
    diagnostics.push(
      diagnostic('VERSION_MISSING_DEPENDENCY', 'Commit payload digest reference is invalid.', {
        details: { path },
      }),
    );
    return undefined;
  }
}

export function parseOptionalDigestArray(
  value: unknown,
  path: string,
  diagnostics: WorkbookCommitStoreDiagnostic[],
): readonly ObjectDigest[] {
  if (value === undefined) {
    return [];
  }
  if (!Array.isArray(value)) {
    diagnostics.push(
      diagnostic('VERSION_MISSING_DEPENDENCY', 'Commit payload digest list is invalid.', {
        details: { path },
      }),
    );
    return [];
  }
  return value.flatMap((entry, index) => {
    const digest = parseOptionalDigest(entry, `${path}[${index}]`, diagnostics);
    return digest === undefined ? [] : [digest];
  });
}
