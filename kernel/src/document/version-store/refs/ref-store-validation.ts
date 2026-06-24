import { parseWorkbookCommitId, type WorkbookCommitId } from '../object-digest';
import { diagnostic, failure } from './ref-store-diagnostics';
import { parseCanonicalRefName } from './ref-store-ref-names';
import { RefStoreValidationError, parseRefVersion } from './ref-store-revisions';
import type { RefFailureResult, RefVersion } from './ref-store-types';
import type { RefName } from './ref-name';

export function parseRefNameForResult(
  value: RefName | string,
):
  | { readonly ok: true; readonly name: RefName }
  | { readonly ok: false; readonly result: RefFailureResult } {
  const parsed = parseCanonicalRefName(value);
  if (parsed.ok) {
    return { ok: true, name: parsed.name };
  }

  return {
    ok: false,
    result: failure('invalidRefName', 'Invalid ref name.', parsed.diagnostics),
  };
}

export function parseCommitForResult(
  value: WorkbookCommitId | string,
  paramName: string,
):
  | { readonly ok: true; readonly commitId: WorkbookCommitId }
  | { readonly ok: false; readonly result: RefFailureResult } {
  try {
    return { ok: true, commitId: parseWorkbookCommitId(value, paramName) };
  } catch {
    const diagnostics = [
      diagnostic(
        'invalidCommitId',
        `${paramName} must be commit:sha256:<64 lowercase hex>.`,
        undefined,
      ),
    ];
    return {
      ok: false,
      result: failure('invalidCommitId', `Invalid ${paramName}.`, diagnostics),
    };
  }
}

export function parseRefVersionForResult(
  value: unknown,
  paramName = 'refVersion',
):
  | { readonly ok: true; readonly refVersion: RefVersion }
  | { readonly ok: false; readonly result: RefFailureResult } {
  try {
    return { ok: true, refVersion: parseRefVersion(value, paramName) };
  } catch (error) {
    const diagnostics =
      error instanceof RefStoreValidationError
        ? error.diagnostics
        : [diagnostic('invalidRefVersion', 'Invalid RefVersion.')];
    return {
      ok: false,
      result: failure('invalidRefVersion', 'Invalid RefVersion.', diagnostics),
    };
  }
}
