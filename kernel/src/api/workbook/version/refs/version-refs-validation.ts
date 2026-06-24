import type {
  VersionCreateBranchOptions,
  VersionFastForwardBranchOptions,
  VersionListRefsOptions,
  VersionMainRefName,
  VersionRecordRevision,
  VersionRefName,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import {
  validateRefNamePrefix,
  validateRefName,
} from '../../../../document/version-store/refs/ref-name';
import {
  VERSION_BRANCH_REF_PREFIX,
  VERSION_HEAD_REF,
  VERSION_MAIN_REF,
} from './version-refs-constants';
import {
  invalidCommitDiagnostic,
  invalidOptionsDiagnostic,
  invalidRefNameDiagnostic,
  noWriteAttemptedForMutation,
  publicDiagnostic,
  type VersionRefOperation,
} from './version-refs-public-diagnostics';
import { isRecord, toCommitId, toCounterRevision } from './version-refs-values';

export type ParsedBranchName =
  | {
      readonly ok: true;
      readonly branchName: string;
      readonly refName: VersionMainRefName | VersionRefName;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export type ParsedRefPrefix =
  | {
      readonly ok: true;
      readonly prefix?: string;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export function validateCreateBranchOptions(options: VersionCreateBranchOptions):
  | {
      readonly ok: true;
      readonly branchName: string;
      readonly targetCommitId: WorkbookCommitId;
      readonly baseCommitId?: WorkbookCommitId;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  if (!isRecord(options) || Array.isArray(options)) {
    return {
      ok: false,
      diagnostics: [invalidOptionsDiagnostic('createBranch', 'options')],
    };
  }

  const diagnostics: VersionStoreDiagnostic[] = [];
  rejectUnknownKeys(
    options,
    new Set(['name', 'targetCommitId', 'baseCommitId', 'expectedAbsent']),
    'createBranch',
    diagnostics,
  );
  const parsedName = parsePublicBranchName(options.name, 'createBranch');
  if (!parsedName.ok) diagnostics.push(...parsedName.diagnostics);
  if (options.expectedAbsent !== undefined && options.expectedAbsent !== true) {
    diagnostics.push(invalidOptionsDiagnostic('createBranch', 'expectedAbsent'));
  }
  const targetCommitId = toCommitId(options.targetCommitId);
  if (!targetCommitId) diagnostics.push(invalidCommitDiagnostic('createBranch', 'targetCommitId'));
  const baseCommitId =
    options.baseCommitId === undefined ? undefined : toCommitId(options.baseCommitId);
  if (options.baseCommitId !== undefined && !baseCommitId) {
    diagnostics.push(invalidCommitDiagnostic('createBranch', 'baseCommitId'));
  }

  if (diagnostics.length > 0 || !parsedName.ok || !targetCommitId) {
    return { ok: false, diagnostics };
  }

  return {
    ok: true,
    branchName: parsedName.branchName,
    targetCommitId,
    ...(baseCommitId ? { baseCommitId } : {}),
  };
}

export function validateFastForwardOptions(
  options: VersionFastForwardBranchOptions,
  operation: VersionRefOperation,
):
  | {
      readonly ok: true;
      readonly branchName: string;
      readonly refName: VersionMainRefName | VersionRefName;
      readonly nextCommitId: WorkbookCommitId;
      readonly expectedHead: WorkbookCommitId;
      readonly expectedRefVersion: VersionRecordRevision;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  if (!isRecord(options) || Array.isArray(options)) {
    return { ok: false, diagnostics: [invalidOptionsDiagnostic(operation, 'options')] };
  }

  const diagnostics: VersionStoreDiagnostic[] = [];
  rejectUnknownKeys(
    options,
    new Set(['name', 'nextCommitId', 'expectedHead', 'expectedRefRevision']),
    operation,
    diagnostics,
  );
  const parsedName = parsePublicBranchName(options.name, operation);
  if (!parsedName.ok) diagnostics.push(...parsedName.diagnostics);
  const nextCommitId = toCommitId(options.nextCommitId);
  if (!nextCommitId) diagnostics.push(invalidCommitDiagnostic(operation, 'nextCommitId'));
  const expectedHead = toCommitId(options.expectedHead);
  if (!expectedHead) diagnostics.push(invalidCommitDiagnostic(operation, 'expectedHead'));
  const expectedRefVersion = toCounterRevision(options.expectedRefRevision);
  if (!expectedRefVersion) {
    diagnostics.push(invalidOptionsDiagnostic(operation, 'expectedRefRevision'));
  }

  if (
    diagnostics.length > 0 ||
    !parsedName.ok ||
    !nextCommitId ||
    !expectedHead ||
    !expectedRefVersion
  ) {
    return { ok: false, diagnostics };
  }

  return {
    ok: true,
    branchName: parsedName.branchName,
    refName: parsedName.refName,
    nextCommitId,
    expectedHead,
    expectedRefVersion,
  };
}

export function parsePublicBranchName(
  value: unknown,
  operation: VersionRefOperation,
): ParsedBranchName {
  if (typeof value !== 'string') {
    return { ok: false, diagnostics: [invalidRefNameDiagnostic(operation)] };
  }
  if (value === VERSION_HEAD_REF) {
    return {
      ok: false,
      diagnostics: [
        publicDiagnostic(
          'VERSION_PERMISSION_DENIED',
          operation,
          'HEAD is symbolic and cannot be used as a branch ref mutation target.',
          {
            severity: 'error',
            recoverability: 'unsupported',
            ...noWriteAttemptedForMutation(operation),
          },
        ),
      ],
    };
  }

  const branchName = value.startsWith(VERSION_BRANCH_REF_PREFIX)
    ? value.slice(VERSION_BRANCH_REF_PREFIX.length)
    : value;
  const parsed = validateRefName(branchName);
  if (!parsed.ok) {
    return {
      ok: false,
      diagnostics: parsed.diagnostics.map((item) =>
        publicDiagnostic(
          'VERSION_INVALID_OPTIONS',
          operation,
          'The supplied VC-05 ref name is not public-safe.',
          {
            severity: 'error',
            recoverability: 'none',
            payload: { refName: 'redacted', issue: item.issue },
            ...noWriteAttemptedForMutation(operation),
          },
        ),
      ),
    };
  }

  return {
    ok: true,
    branchName: parsed.name,
    refName:
      branchName === 'main' ? VERSION_MAIN_REF : (`refs/heads/${branchName}` as VersionRefName),
  };
}

export function validateRefListPrefix(value: VersionListRefsOptions['prefix']): ParsedRefPrefix {
  if (value === undefined) return { ok: true };

  const prefix =
    typeof value === 'string' && value.startsWith(VERSION_BRANCH_REF_PREFIX)
      ? value.slice(VERSION_BRANCH_REF_PREFIX.length)
      : value;
  const parsed = validateRefNamePrefix(prefix, 'prefix');
  if (parsed.ok) {
    return { ok: true, prefix: parsed.prefix };
  }

  return {
    ok: false,
    diagnostics: parsed.diagnostics.map((item) =>
      publicDiagnostic(
        'VERSION_INVALID_OPTIONS',
        'listRefs',
        'The supplied ref prefix is invalid.',
        {
          severity: 'error',
          recoverability: 'none',
          payload: { option: 'prefix', issue: item.issue, refName: 'redacted' },
        },
      ),
    ),
  };
}

function rejectUnknownKeys(
  input: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  operation: VersionRefOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  for (const key of Object.keys(input)) {
    if (allowed.has(key)) continue;
    diagnostics.push(invalidOptionsDiagnostic(operation, key));
  }
}
