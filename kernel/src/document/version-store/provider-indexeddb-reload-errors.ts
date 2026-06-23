export type GraphSnapshotLoadIssue =
  | 'corrupt'
  | 'unsupported'
  | 'wrong-namespace'
  | 'missing-dependency';

export type GraphSnapshotLoadDetails = Readonly<Record<string, string | number | boolean | null>>;

export class IndexedDbGraphSnapshotLoadError extends Error {
  readonly issue: GraphSnapshotLoadIssue;
  readonly details: GraphSnapshotLoadDetails;

  constructor(issue: GraphSnapshotLoadIssue, message: string, details: GraphSnapshotLoadDetails) {
    super(message);
    this.name = 'IndexedDbGraphSnapshotLoadError';
    this.issue = issue;
    this.details = details;
  }
}

export function sanitizeLoadDetails(details: GraphSnapshotLoadDetails): GraphSnapshotLoadDetails {
  const sanitized: Record<string, string | number | boolean | null> = {};
  for (const [key, value] of Object.entries(details)) {
    sanitized[key] = shouldRedactLoadDetail(key) ? 'redacted' : value;
  }
  return Object.freeze(sanitized);
}

export function throwLoadError(
  issue: GraphSnapshotLoadIssue,
  message: string,
  details: GraphSnapshotLoadDetails,
): never {
  throw new IndexedDbGraphSnapshotLoadError(issue, message, details);
}

function shouldRedactLoadDetail(key: string): boolean {
  return (
    key === 'expectedKey' ||
    key === 'actualKey' ||
    key === 'expectedNamespaceKey' ||
    key === 'actualNamespaceKey' ||
    key === 'expectedDocumentScopeKey' ||
    key === 'actualDocumentScopeKey' ||
    key === 'namespaceKey' ||
    key === 'documentScopeKey' ||
    key === 'expectedDocumentId' ||
    key === 'actualDocumentId'
  );
}
