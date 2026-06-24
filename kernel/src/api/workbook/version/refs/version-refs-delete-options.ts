import type {
  VersionDeleteRefOptions,
  VersionRef,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import { validateRefName } from '../../../../document/version-store/refs/ref-name';
import {
  invalidCommitDiagnostic,
  invalidOptionsDiagnostic,
  invalidRefNameDiagnostic,
  publicDiagnostic,
  safeBranchDiagnosticToken,
} from './version-refs-delete-diagnostics';
import {
  isDeleteOperation,
  isRecord,
  toCommitId,
  toCounterRevision,
  VERSION_BRANCH_REF_PREFIX,
  VERSION_HEAD_REF,
  VERSION_MAIN_REF,
  type DeleteRefOperation,
  type ParsedDeleteRefOptions,
} from './version-refs-delete-types';

export function validateDeleteRefOptions(
  options: VersionDeleteRefOptions,
  operation: DeleteRefOperation,
): ParsedDeleteRefOptions {
  if (!isRecord(options) || Array.isArray(options)) {
    return { ok: false, diagnostics: [invalidOptionsDiagnostic(operation, 'options')] };
  }

  const diagnostics: VersionStoreDiagnostic[] = [];
  rejectUnknownKeys(
    options,
    new Set(['name', 'expectedHead', 'expectedRefRevision']),
    operation,
    diagnostics,
  );
  const parsedName = parsePublicBranchName(options.name, operation);
  if (!parsedName.ok) diagnostics.push(...parsedName.diagnostics);
  const expectedHead =
    options.expectedHead === undefined ? undefined : toCommitId(options.expectedHead);
  if (options.expectedHead !== undefined && !expectedHead) {
    diagnostics.push(invalidCommitDiagnostic(operation, 'expectedHead'));
  }
  const expectedRefVersion = toCounterRevision(options.expectedRefRevision);
  if (!expectedRefVersion) {
    diagnostics.push(invalidOptionsDiagnostic(operation, 'expectedRefRevision'));
  }

  if (diagnostics.length > 0 || !parsedName.ok || !expectedRefVersion) {
    return { ok: false, diagnostics };
  }

  return {
    ok: true,
    branchName: parsedName.branchName,
    ...(expectedHead ? { expectedHead } : {}),
    expectedRefVersion,
    refName: parsedName.refName,
  };
}

export function parsePublicBranchName(
  value: unknown,
  operation: DeleteRefOperation | 'readRef',
):
  | {
      readonly ok: true;
      readonly branchName: string;
      readonly refName: VersionRef['name'];
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
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
            payload: {
              issue: safeBranchDiagnosticToken('issue', 'reservedSymbolicHead'),
              refName: 'redacted',
            },
            ...(isDeleteOperation(operation)
              ? { mutationGuarantee: 'no-write-attempted' as const }
              : {}),
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
            payload: {
              refName: 'redacted',
              issue: safeBranchDiagnosticToken('issue', item.issue),
            },
            ...(isDeleteOperation(operation)
              ? { mutationGuarantee: 'no-write-attempted' as const }
              : {}),
          },
        ),
      ),
    };
  }

  return {
    ok: true,
    branchName: parsed.name,
    refName:
      branchName === 'main' ? VERSION_MAIN_REF : (`refs/heads/${branchName}` as VersionRef['name']),
  };
}

function rejectUnknownKeys(
  input: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  operation: DeleteRefOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  for (const key of Object.keys(input)) {
    if (allowed.has(key)) continue;
    diagnostics.push(invalidOptionsDiagnostic(operation, key));
  }
}
