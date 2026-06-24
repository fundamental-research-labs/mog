import type { WorkbookCommitStoreDiagnostic } from '../commit-store';
import type {
  VersionGraphRef,
  VersionGraphStoreDiagnostic,
  VersionGraphStoreDiagnosticCode,
} from './graph-store-types';
import type { VersionGraphStoreOperation } from './graph-store-operation';
import { VERSION_GRAPH_MAIN_REF, graphRefNameFromRefName } from './graph-store-refs';
import { objectDigestFromWorkbookCommitId, type WorkbookCommitId } from '../object-digest';
import type { LiveRefRecord, VersionDiagnostic } from '../refs/ref-store';

export function mapCommitDiagnostics(
  diagnostics: readonly WorkbookCommitStoreDiagnostic[],
  operation?: VersionGraphStoreOperation,
): readonly VersionGraphStoreDiagnostic[] {
  return diagnostics.map((item) => {
    const sourceItem = sanitizeCommitDiagnostic(item);
    const wrongNamespace = sourceItem.sourceDiagnostics?.find(
      (source) => source.code === 'VERSION_WRONG_NAMESPACE',
    );
    if (wrongNamespace) {
      return diagnostic(
        'VERSION_WRONG_NAMESPACE',
        'Object record namespace is outside this graph.',
        {
          operation,
          sourceDiagnostics: [wrongNamespace],
        },
      );
    }

    const missingObject = sourceItem.sourceDiagnostics?.find(
      (source) => source.code === 'VERSION_OBJECT_NOT_FOUND',
    );
    if (missingObject && sourceItem.code === 'VERSION_OBJECT_STORE_FAILURE') {
      return missingCommitDiagnostic(
        sourceItem.commitId,
        operation,
        [sourceItem],
        'Commit object is missing from the graph store.',
      );
    }

    const code = graphDiagnosticCodeFromCommit(sourceItem.code);
    return diagnostic(code, sourceItem.message, {
      commitId: sourceItem.commitId,
      objectDigest: sourceItem.objectDigest,
      dependency: sourceItem.dependency,
      operation,
      sourceDiagnostics: [sourceItem],
      details: sourceItem.details,
    });
  });
}

function graphDiagnosticCodeFromCommit(
  code: WorkbookCommitStoreDiagnostic['code'],
): VersionGraphStoreDiagnosticCode {
  if (code === 'VERSION_OBJECT_STORE_FAILURE') return 'VERSION_OBJECT_STORE_FAILURE';
  if (code === 'VERSION_MISSING_PARENT') return 'VERSION_MISSING_PARENT';
  if (code === 'VERSION_UNSUPPORTED_PARENT_COMMIT') return 'VERSION_UNSUPPORTED_PARENT_COMMIT';
  if (code === 'VERSION_INVALID_COMMIT_ID') return 'VERSION_INVALID_COMMIT_ID';
  if (code === 'VERSION_INVALID_COMMIT_PAYLOAD') return 'VERSION_INVALID_COMMIT_PAYLOAD';
  if (code === 'VERSION_WRONG_DOCUMENT') return 'VERSION_WRONG_DOCUMENT';
  return 'VERSION_MISSING_DEPENDENCY';
}

export function missingCommitDiagnostics(
  commitId: WorkbookCommitId,
  operation: VersionGraphStoreOperation,
  sourceDiagnostics: readonly WorkbookCommitStoreDiagnostic[],
): readonly VersionGraphStoreDiagnostic[] {
  const mapped = mapCommitDiagnostics(sourceDiagnostics, operation);
  if (mapped.length === 0) {
    return [
      missingCommitDiagnostic(commitId, operation, sourceDiagnostics, 'Commit object is missing.'),
    ];
  }
  return mapped.map((item) =>
    item.commitId === undefined
      ? {
          ...item,
          commitId,
          objectKind: item.objectKind ?? 'commit',
        }
      : item,
  );
}

function missingCommitDiagnostic(
  commitId: WorkbookCommitId | undefined,
  operation: VersionGraphStoreOperation | undefined,
  sourceDiagnostics: readonly WorkbookCommitStoreDiagnostic[],
  message: string,
): VersionGraphStoreDiagnostic {
  return diagnostic('VERSION_MISSING_OBJECT', message, {
    commitId,
    objectKind: 'commit',
    operation,
    sourceDiagnostics: sourceDiagnostics.map(sanitizeCommitDiagnostic),
  });
}

export function danglingRefDiagnostic(
  ref: VersionGraphRef,
  operation: VersionGraphStoreOperation,
  sourceDiagnostics: readonly WorkbookCommitStoreDiagnostic[],
): VersionGraphStoreDiagnostic {
  return diagnostic('VERSION_DANGLING_REF', 'Graph ref points at a missing or unreadable commit.', {
    refName: ref.name,
    commitId: ref.commitId,
    objectKind: 'commit',
    operation,
    sourceDiagnostics: sourceDiagnostics.map(sanitizeCommitDiagnostic),
  });
}

function sanitizeCommitDiagnostic(
  diagnostic: WorkbookCommitStoreDiagnostic,
): WorkbookCommitStoreDiagnostic {
  if (diagnostic.sourceDiagnostics === undefined) return diagnostic;
  return {
    ...diagnostic,
    sourceDiagnostics: diagnostic.sourceDiagnostics.map(
      ({ namespace: _namespace, path: _path, ...source }) => source,
    ),
  };
}

export function refConflictDiagnostic(
  currentRef: LiveRefRecord,
  expectedHead: WorkbookCommitId,
  sourceDiagnostics: readonly VersionDiagnostic[] = [],
): VersionGraphStoreDiagnostic {
  return diagnostic('VERSION_REF_CONFLICT', 'Graph ref no longer matches expected head.', {
    refName: graphRefNameFromRefName(currentRef.name),
    commitId: currentRef.targetCommitId,
    details: {
      expectedHead,
      actualHead: currentRef.targetCommitId,
      expectedDigest: objectDigestFromWorkbookCommitId(expectedHead).digest,
      actualDigest: objectDigestFromWorkbookCommitId(currentRef.targetCommitId).digest,
    },
    sourceDiagnostics,
  });
}

export function refStoreDiagnostic(
  sourceDiagnostics: readonly VersionDiagnostic[],
  operation?: VersionGraphStoreOperation,
): VersionGraphStoreDiagnostic {
  return diagnostic('VERSION_REF_CONFLICT', 'Graph ref store rejected the operation.', {
    refName: VERSION_GRAPH_MAIN_REF,
    operation,
    sourceDiagnostics,
  });
}

export function diagnostic(
  code: VersionGraphStoreDiagnosticCode,
  message: string,
  options: Omit<VersionGraphStoreDiagnostic, 'code' | 'severity' | 'message'> = {},
): VersionGraphStoreDiagnostic {
  return {
    code,
    severity:
      code === 'VERSION_OBJECT_STORE_FAILURE' ||
      code === 'VERSION_DANGLING_REF' ||
      code === 'VERSION_MISSING_OBJECT'
        ? 'corruption'
        : 'error',
    message,
    ...options,
  };
}
