import type { VersionDiffEntry, VersionSemanticDiffPage } from '@mog-sdk/contracts/api';

export { displayBranchName } from './version-branch-name';

export type VersionDiffPreviewStateKind =
  | 'changes'
  | 'empty'
  | 'unsupported'
  | 'stale'
  | 'conflict-only'
  | 'redacted';

export type VersionDiffPreviewState = {
  readonly kind: VersionDiffPreviewStateKind;
  readonly label: string;
  readonly title: string;
  readonly message: string;
};

type DiffDiagnostic = {
  readonly issueCode?: string;
  readonly code?: string;
  readonly recoverability?: string;
  readonly data?: Readonly<Record<string, unknown>>;
};

const UNSUPPORTED_DIFF_CODES = new Set([
  'VERSION_UNSUPPORTED_AUTHORED_DOMAIN',
  'VERSION_UNSUPPORTED_OBJECT_TYPE',
  'VERSION_UNSUPPORTED_PAYLOAD_ENCODING',
  'VERSION_UNSUPPORTED_SCHEMA',
  'unsupportedDomain',
  'unsupportedFormat',
  'externalReferenceUnsupported',
  'opaqueDomain',
  'opaqueDomainDigestUnavailable',
  'opaqueFormatPointer',
  'indexKeyedVisibility',
  'indexKeyedRowVisibility',
  'indexKeyedColumnVisibility',
  'inconsistentVisibilityCache',
]);

const STALE_DIFF_CODES = new Set([
  'VERSION_REF_CONFLICT',
  'VERSION_STALE_PAGE_CURSOR',
  'derivedImpactStale',
  'staleDiffCursor',
]);

export function shortCommitId(id: string): string {
  return id.startsWith('commit:sha256:')
    ? id.slice('commit:sha256:'.length, 'commit:sha256:'.length + 12)
    : id;
}

export function versionDiffPreviewState(page: VersionSemanticDiffPage): VersionDiffPreviewState {
  if (page.items.length > 0 && page.items.every((entry) => entry.structural.kind !== 'metadata')) {
    return {
      kind: 'redacted',
      label: 'Restricted entries',
      title: 'Restricted diff entries',
      message: 'Some diff records are hidden by access policy.',
    };
  }

  const diagnostics = page.items.flatMap((entry) => entry.diagnostics ?? []);
  if (diagnostics.some(isStaleDiffDiagnostic)) {
    return {
      kind: 'stale',
      label: 'Stale reference',
      title: 'Stale diff reference',
      message: 'Refresh version history before using this preview.',
    };
  }
  if (diagnostics.some(isUnsupportedDiffDiagnostic)) {
    return {
      kind: 'unsupported',
      label: 'Unsupported state',
      title: 'Unsupported semantic state',
      message: 'This preview excludes state outside the supported diff slice.',
    };
  }
  if (page.items.length === 0) {
    return {
      kind: 'empty',
      label: 'Empty preview',
      title: 'Diff returned no entries',
      message: 'No supported changes are listed for this diff page.',
    };
  }
  if (page.items.every(isConflictDiffEntry)) {
    return {
      kind: 'conflict-only',
      label: 'Conflicts only',
      title: 'Conflicts only',
      message: 'This preview contains conflict records, not an applied clean diff.',
    };
  }
  return {
    kind: 'changes',
    label: 'Changes',
    title: 'Semantic changes',
    message: 'Supported semantic changes are listed below.',
  };
}

export function versionDiffEntryLabel(entry: VersionDiffEntry): string {
  if (entry.structural.kind !== 'metadata') return 'Redacted change';
  const path = entry.structural.propertyPath.join('.');
  const label = path ? `${entry.structural.domain} ${path}` : entry.structural.domain;
  return isConflictDiffEntry(entry) ? `Conflict ${label}` : label;
}

function isStaleDiffDiagnostic(diagnostic: DiffDiagnostic): boolean {
  const code = diffDiagnosticCode(diagnostic);
  return STALE_DIFF_CODES.has(code) || code.toLowerCase().includes('stale');
}

function isUnsupportedDiffDiagnostic(diagnostic: DiffDiagnostic): boolean {
  const code = diffDiagnosticCode(diagnostic);
  return (
    diagnostic.recoverability === 'unsupported' ||
    UNSUPPORTED_DIFF_CODES.has(code) ||
    code.toLowerCase().includes('unsupported') ||
    code.toLowerCase().includes('opaque')
  );
}

function diffDiagnosticCode(diagnostic: DiffDiagnostic): string {
  const payload = diagnostic.data?.payload;
  const completenessCode =
    payload && typeof payload === 'object' && 'completenessCode' in payload
      ? payload.completenessCode
      : undefined;
  return diagnostic.issueCode ?? diagnostic.code ?? String(completenessCode ?? '');
}

function isConflictDiffEntry(entry: VersionDiffEntry): boolean {
  if (entry.structural.kind !== 'metadata') return false;
  return (
    entry.structural.changeId.startsWith('merge-conflict:') ||
    entry.structural.domain.toLowerCase().includes('conflict')
  );
}
