import { parseWorkbookCommitId, type WorkbookCommitId } from './object-digest';
import { REF_NAME_STORAGE_PREFIX, validateRefName, type RefName } from './refs/ref-name';
import {
  branchFromLiveRef,
  diagnostic,
  failure,
  refNameDiagnostics,
  unsupportedDetachedHead,
} from './branch-service-results';
import type { BranchFailureResult, BranchRecord, BranchRefName } from './branch-service-types';
import {
  parseRefVersion,
  type LiveRefRecord,
  type RefVersion,
  type VersionDiagnostic,
} from './refs/ref-store';

const RESERVED_REF_PREFIXES = Object.freeze(['refs/system', 'refs/imports', 'refs/hidden']);

export function parseBranchNameForResult(
  value: RefName | BranchRefName | string,
):
  | { readonly ok: true; readonly name: RefName }
  | { readonly ok: false; readonly result: BranchFailureResult } {
  const parsed = parseBranchName(value);
  if (parsed.ok) {
    return parsed;
  }
  return { ok: false, result: parsed.result };
}

export function parseBranchName(
  value: unknown,
):
  | { readonly ok: true; readonly name: RefName }
  | { readonly ok: false; readonly result: BranchFailureResult } {
  if (typeof value === 'string') {
    if (value === 'HEAD' || value === 'detached') {
      return {
        ok: false,
        result: unsupportedDetachedHead(
          'Detached HEAD is not a branch ref and cannot be created through this service.',
          value,
        ),
      };
    }

    const reservedNamespace = getReservedNamespace(value);
    if (reservedNamespace !== null) {
      return {
        ok: false,
        result: failure('reservedNamespace', 'Reserved ref namespace is not visible.', [
          diagnostic(
            'reservedNamespace',
            'Reserved ref namespace is not visible.',
            undefined,
            undefined,
            undefined,
            undefined,
            {
              namespace: reservedNamespace,
            },
          ),
        ]),
      };
    }

    if (value.startsWith(REF_NAME_STORAGE_PREFIX)) {
      return parseBranchRefName(value);
    }
  }

  const parsed = validateRefName(value);
  if (parsed.ok) {
    return { ok: true, name: parsed.name };
  }

  return {
    ok: false,
    result: failure(
      'invalidRefName',
      'Invalid branch ref name.',
      refNameDiagnostics(parsed.diagnostics),
    ),
  };
}

export function visibleBranchFromLiveRef(
  ref: LiveRefRecord,
):
  | { readonly ok: true; readonly branch: BranchRecord }
  | { readonly ok: false; readonly diagnostics: readonly VersionDiagnostic[] } {
  const parsed = parseBranchName(ref.name);
  if (parsed.ok) {
    return { ok: true, branch: branchFromLiveRef({ ...ref, name: parsed.name }) };
  }

  if (parsed.result.error.code === 'reservedNamespace') {
    return { ok: false, diagnostics: parsed.result.diagnostics };
  }

  return { ok: false, diagnostics: parsed.result.diagnostics };
}

export function parseCommitForResult(
  value: WorkbookCommitId | string,
  paramName: string,
):
  | { readonly ok: true; readonly commitId: WorkbookCommitId }
  | { readonly ok: false; readonly result: BranchFailureResult } {
  try {
    return { ok: true, commitId: parseWorkbookCommitId(value, paramName) };
  } catch {
    return {
      ok: false,
      result: failure('invalidCommitId', `Invalid ${paramName}.`, [
        diagnostic('invalidCommitId', `${paramName} must be commit:sha256:<64 lowercase hex>.`),
      ]),
    };
  }
}

export function parseRefVersionForResult(
  value: RefVersion,
):
  | { readonly ok: true; readonly refVersion: RefVersion }
  | { readonly ok: false; readonly result: BranchFailureResult } {
  try {
    return { ok: true, refVersion: parseRefVersion(value) };
  } catch {
    return {
      ok: false,
      result: failure('invalidRefVersion', 'Invalid RefVersion.', [
        diagnostic(
          'invalidRefVersion',
          'expectedRefVersion must be { kind: "counter", value: <non-negative base-10 integer> }.',
        ),
      ]),
    };
  }
}

function parseBranchRefName(
  value: string,
):
  | { readonly ok: true; readonly name: RefName }
  | { readonly ok: false; readonly result: BranchFailureResult } {
  const suffix = value.slice(REF_NAME_STORAGE_PREFIX.length);
  const decoded = decodeBranchRefSuffix(suffix);
  if (!decoded.ok) {
    return {
      ok: false,
      result: failure('invalidRefName', 'Invalid branch ref name.', [
        diagnostic('invalidRefName', decoded.message, value),
      ]),
    };
  }

  const parsed = validateRefName(decoded.value);
  if (parsed.ok) {
    return { ok: true, name: parsed.name };
  }
  return {
    ok: false,
    result: failure(
      'invalidRefName',
      'Invalid branch ref name.',
      refNameDiagnostics(parsed.diagnostics),
    ),
  };
}

function decodeBranchRefSuffix(
  value: string,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly message: string } {
  if (value.length === 0) {
    return { ok: false, message: 'refs/heads/* branch ref must include a branch name.' };
  }
  if (!value.includes('%')) {
    return { ok: true, value };
  }

  try {
    return { ok: true, value: decodeURIComponent(value) };
  } catch {
    return { ok: false, message: 'refs/heads/* branch ref contains invalid percent encoding.' };
  }
}

function getReservedNamespace(value: string): string | null {
  for (const prefix of RESERVED_REF_PREFIXES) {
    if (value === prefix || value.startsWith(`${prefix}/`)) {
      return prefix;
    }
  }
  if (value.startsWith('refs/') && !value.startsWith(REF_NAME_STORAGE_PREFIX)) {
    return 'refs/*';
  }
  return null;
}
