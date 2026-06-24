import { type VersionGraphStoreDiagnostic } from './graph';
import { type VersionGraphNamespace } from './object-store';
import { errorMessage, graphDiagnostic } from './provider-indexeddb/internal';
import {
  IndexedDbGraphSnapshotLoadError,
  sanitizeLoadDetails,
  type GraphSnapshotLoadIssue,
} from './provider-indexeddb-reload-errors';

export { loadGraphSnapshot } from './provider-indexeddb-reload-build';

export function graphLoadDiagnostic(
  error: unknown,
  namespace: VersionGraphNamespace,
  operation: VersionGraphStoreDiagnostic['operation'],
): VersionGraphStoreDiagnostic {
  void namespace;
  const loadError = error instanceof IndexedDbGraphSnapshotLoadError ? error : null;
  const details = sanitizeLoadDetails({
    cause: errorMessage(error),
    ...(loadError ? { reloadIssue: loadError.issue, ...loadError.details } : {}),
  });
  return graphDiagnostic(
    graphDiagnosticCodeForLoadIssue(loadError?.issue),
    loadError?.message ?? 'IndexedDB graph snapshot could not be loaded.',
    {
      operation,
      details,
    },
  );
}

function graphDiagnosticCodeForLoadIssue(
  issue: GraphSnapshotLoadIssue | undefined,
): VersionGraphStoreDiagnostic['code'] {
  if (issue === 'wrong-namespace') return 'VERSION_WRONG_NAMESPACE';
  if (issue === 'missing-dependency') return 'VERSION_MISSING_DEPENDENCY';
  return 'VERSION_OBJECT_STORE_FAILURE';
}
