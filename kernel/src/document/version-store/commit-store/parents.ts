import {
  objectDigestFromWorkbookCommitId,
  parseWorkbookCommitId,
  type VersionDependencyRef,
  type WorkbookCommitId,
} from '../object-digest';
import { VersionObjectStoreError, type InMemoryVersionObjectStore } from '../object-store';
import type { WorkbookCommitPayload, WorkbookCommitStoreDiagnostic } from './types';

type ParentCommitIdsResult =
  | { readonly ok: true; readonly parentCommitIds: readonly WorkbookCommitId[] }
  | { readonly ok: false; readonly diagnostics: readonly WorkbookCommitStoreDiagnostic[] };

export function parseWorkbookCommitParentIds(value: unknown): ParentCommitIdsResult {
  if (!Array.isArray(value)) {
    return failed([
      diagnostic('VERSION_INVALID_COMMIT_ID', 'Commit parentCommitIds must be an array.'),
    ]);
  }
  if (value.length > 2) {
    return failed([
      diagnostic(
        'VERSION_UNSUPPORTED_PARENT_COMMIT',
        'Workbook commits support root, single-parent, and two-parent merge commits only.',
        { details: { parentCommitCount: value.length } },
      ),
    ]);
  }
  if (value.length === 0) {
    return { ok: true, parentCommitIds: [] };
  }

  const parentCommitIds: WorkbookCommitId[] = [];
  for (let index = 0; index < value.length; index += 1) {
    try {
      parentCommitIds.push(parseWorkbookCommitId(value[index], `parentCommitIds[${index}]`));
    } catch {
      return failed([
        diagnostic('VERSION_INVALID_COMMIT_ID', 'Parent commit id must be commit:sha256:<64 hex>.'),
      ]);
    }
  }
  if (parentCommitIds.length === 2 && parentCommitIds[0] === parentCommitIds[1]) {
    return failed([
      diagnostic(
        'VERSION_UNSUPPORTED_PARENT_COMMIT',
        'Two-parent merge commits require distinct parent commit ids.',
        { details: { duplicateParentCommitId: parentCommitIds[0] } },
      ),
    ]);
  }
  return { ok: true, parentCommitIds };
}

export function parseVc04ParentCommitIds(value: unknown): ParentCommitIdsResult {
  const parsed = parseWorkbookCommitParentIds(value);
  if (!parsed.ok) return parsed;
  if (parsed.parentCommitIds.length > 1) {
    return failed([
      diagnostic(
        'VERSION_UNSUPPORTED_PARENT_COMMIT',
        'VC-04 supports root commits and single-parent forward commits only.',
        { details: { parentCommitCount: parsed.parentCommitIds.length } },
      ),
    ]);
  }
  return parsed;
}

export function parseWorkbookMergeParentCommitId(value: unknown): ParentCommitIdsResult {
  try {
    return {
      ok: true,
      parentCommitIds: [parseWorkbookCommitId(value, 'mergeParentCommitId')],
    };
  } catch {
    return failed([
      diagnostic(
        'VERSION_INVALID_COMMIT_ID',
        'Merge parent commit id must be commit:sha256:<64 hex>.',
      ),
    ]);
  }
}

export async function validateWorkbookParentCommitClosureForCreate(
  objectStore: InMemoryVersionObjectStore,
  value: readonly (WorkbookCommitId | string)[],
): Promise<ParentCommitIdsResult> {
  const parsed = parseWorkbookCommitParentIds(value);
  if (!parsed.ok || parsed.parentCommitIds.length === 0) {
    return parsed;
  }

  for (const parentCommitId of parsed.parentCommitIds) {
    const parentDependency = commitDependency(parentCommitId);
    try {
      const parentRecord =
        await objectStore.getObjectRecord<WorkbookCommitPayload>(parentDependency);
      const dependencyDiagnostics: WorkbookCommitStoreDiagnostic[] = [];
      for (const dependency of parentRecord.preimage.dependencies) {
        if (!(await objectStore.hasObject(dependency))) {
          dependencyDiagnostics.push(missingDependencyDiagnostic(dependency));
        }
      }
      if (dependencyDiagnostics.length > 0) {
        return failed(dependencyDiagnostics);
      }
    } catch (error) {
      if (
        error instanceof VersionObjectStoreError &&
        error.diagnostic.code === 'VERSION_OBJECT_NOT_FOUND'
      ) {
        return failed([
          diagnostic('VERSION_MISSING_PARENT', 'Parent commit object is missing.', {
            commitId: parentCommitId,
            dependency: parentDependency,
          }),
        ]);
      }
      return failed([
        diagnostic('VERSION_OBJECT_STORE_FAILURE', 'Parent commit validation failed.', {
          commitId: parentCommitId,
          sourceDiagnostics:
            error instanceof VersionObjectStoreError ? [error.diagnostic] : undefined,
        }),
      ]);
    }
  }

  return parsed;
}

function missingDependencyDiagnostic(
  dependency: VersionDependencyRef,
): WorkbookCommitStoreDiagnostic {
  return diagnostic(
    dependency.kind === 'commit' ? 'VERSION_MISSING_PARENT' : 'VERSION_MISSING_DEPENDENCY',
    dependency.kind === 'commit'
      ? 'Parent commit closure has a missing parent.'
      : 'Parent commit closure has a missing dependency.',
    { dependency },
  );
}

function commitDependency(commitId: WorkbookCommitId): VersionDependencyRef {
  return {
    kind: 'commit',
    commitId,
    digest: objectDigestFromWorkbookCommitId(commitId),
  };
}

function failed(diagnostics: readonly WorkbookCommitStoreDiagnostic[]): ParentCommitIdsResult {
  return { ok: false, diagnostics };
}

function diagnostic(
  code: WorkbookCommitStoreDiagnostic['code'],
  message: string,
  options: Omit<WorkbookCommitStoreDiagnostic, 'code' | 'severity' | 'message'> = {},
): WorkbookCommitStoreDiagnostic {
  return {
    code,
    severity: code === 'VERSION_OBJECT_STORE_FAILURE' ? 'corruption' : 'error',
    message,
    ...options,
  };
}
