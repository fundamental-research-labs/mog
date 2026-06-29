import type {
  VersionDiffDisplayValue,
  VersionDiffEntry,
  VersionDiffValue,
  VersionSemanticDiffPage,
  VersionSemanticValue,
} from '@mog-sdk/contracts/api';
import { wallClockNow } from '@mog/platform';

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

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

const RELATIVE_COMMIT_TIME_UNITS = [
  { singular: 'year', plural: 'years', ms: 365 * DAY_MS },
  { singular: 'month', plural: 'months', ms: 30 * DAY_MS },
  { singular: 'week', plural: 'weeks', ms: 7 * DAY_MS },
  { singular: 'day', plural: 'days', ms: DAY_MS },
  { singular: 'hour', plural: 'hours', ms: HOUR_MS },
  { singular: 'minute', plural: 'minutes', ms: MINUTE_MS },
] as const;

export function formatRelativeCommitTime(value: string, nowMs = wallClockNow()): string {
  const timestampMs = Date.parse(value);
  if (Number.isNaN(timestampMs)) return value;

  const diffMs = nowMs - timestampMs;
  const absDiffMs = Math.abs(diffMs);
  if (absDiffMs < MINUTE_MS) return 'just now';

  const unit =
    RELATIVE_COMMIT_TIME_UNITS.find((candidate) => absDiffMs >= candidate.ms) ??
    RELATIVE_COMMIT_TIME_UNITS[RELATIVE_COMMIT_TIME_UNITS.length - 1];
  const amount = Math.max(1, Math.floor(absDiffMs / unit.ms));
  const label = amount === 1 ? unit.singular : unit.plural;

  return diffMs >= 0 ? `${amount} ${label} ago` : `in ${amount} ${label}`;
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
  const rowColumnSummary = versionRowColumnDiffSummary(entry);
  if (rowColumnSummary) {
    const label = `${capitalizeWord(rowColumnSummary.axis)} structure`;
    return isConflictDiffEntry(entry) ? `Conflict ${label}` : label;
  }
  const path = entry.structural.propertyPath.join('.');
  const label = path ? `${entry.structural.domain} ${path}` : entry.structural.domain;
  return isConflictDiffEntry(entry) ? `Conflict ${label}` : label;
}

export type VersionRowColumnDiffAction = 'inserted' | 'deleted' | 'changed';

export type VersionRowColumnDiffSummary = {
  readonly action: VersionRowColumnDiffAction;
  readonly axis: 'row' | 'column';
  readonly index: number;
  readonly position: string;
  readonly displayName: string;
};

type RowColumnTarget = {
  readonly axis: 'row' | 'column';
  readonly index: number;
  readonly displayRef?: string;
};

export function versionRowColumnDiffSummary(
  entry: VersionDiffEntry,
): VersionRowColumnDiffSummary | undefined {
  if (
    entry.structural.kind !== 'metadata' ||
    entry.structural.domain !== 'rows-columns' ||
    entry.structural.propertyPath.length !== 1 ||
    entry.structural.propertyPath[0] !== 'order'
  ) {
    return undefined;
  }

  const before = rowColumnTargetFromDiffValue(entry.before);
  const after = rowColumnTargetFromDiffValue(entry.after);
  const target = after ?? before ?? rowColumnTargetFromEntry(entry);
  if (!target) return undefined;

  const action: VersionRowColumnDiffAction =
    before === null && after ? 'inserted' : before && after === null ? 'deleted' : 'changed';
  const position = rowColumnPosition(target);

  return {
    action,
    axis: target.axis,
    index: target.index,
    position,
    displayName: `${target.axis} ${position}`,
  };
}

export function versionRowColumnDiffTitle(summary: VersionRowColumnDiffSummary): string {
  switch (summary.action) {
    case 'inserted':
      return `Inserted ${summary.displayName}`;
    case 'deleted':
      return `Deleted ${summary.displayName}`;
    case 'changed':
      return `Changed ${summary.displayName}`;
  }
}

export function formatVersionRowColumnDiffValue(
  summary: VersionRowColumnDiffSummary,
  value: VersionDiffValue,
  side: 'before' | 'after',
): string | undefined {
  if (value.kind !== 'value') return undefined;
  if (isEmptySemanticDiffValue(value.value)) return 'Not present';

  const name = capitalizeWord(summary.displayName);
  if (summary.action === 'inserted' && side === 'after') return `Inserted ${summary.displayName}`;
  if (summary.action === 'deleted' && side === 'before') return `${name} existed`;
  return name;
}

export function semanticObjectFields(
  value: VersionSemanticValue,
): readonly { readonly key: string; readonly value: VersionSemanticValue }[] | undefined {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    value.kind !== 'object'
  ) {
    return undefined;
  }
  return value.fields;
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

function rowColumnTargetFromDiffValue(value: VersionDiffValue): RowColumnTarget | null | undefined {
  if (value.kind !== 'value') return undefined;
  if (isEmptySemanticDiffValue(value.value)) return null;

  const fields = semanticObjectFieldMap(value.value);
  if (!fields) return undefined;

  const axis = fields.get('axis');
  const index = fields.get('index');
  if ((axis !== 'row' && axis !== 'column') || !isSafeZeroBasedIndex(index)) return undefined;

  const displayRef = fields.get('displayRef');
  return {
    axis,
    index,
    ...(typeof displayRef === 'string' ? { displayRef } : {}),
  };
}

function rowColumnTargetFromEntry(entry: VersionDiffEntry): RowColumnTarget | undefined {
  if (entry.structural.kind !== 'metadata') return undefined;

  const separator = entry.structural.entityId.lastIndexOf('!');
  if (separator <= 0 || separator === entry.structural.entityId.length - 1) return undefined;
  const axisAndIndex = entry.structural.entityId.slice(separator + 1);
  const axisSeparator = axisAndIndex.lastIndexOf(':');
  if (axisSeparator <= 0 || axisSeparator === axisAndIndex.length - 1) return undefined;

  const rawAxis = axisAndIndex.slice(0, axisSeparator);
  const axis = rawAxis === 'row' || rawAxis === 'column' ? rawAxis : undefined;
  const index = Number(axisAndIndex.slice(axisSeparator + 1));
  if (!axis || !isSafeZeroBasedIndex(index)) return undefined;

  const displayRef = displayValue(entry.display?.address);
  return {
    axis,
    index,
    ...(displayRef ? { displayRef } : {}),
  };
}

function semanticObjectFieldMap(
  value: VersionSemanticValue,
): Map<string, VersionSemanticValue> | null {
  const fields = semanticObjectFields(value);
  if (!fields) return null;
  return new Map(fields.map((field) => [field.key, field.value]));
}

function isEmptySemanticDiffValue(value: VersionSemanticValue): boolean {
  return (
    value === null ||
    (typeof value === 'object' && value !== null && !Array.isArray(value) && value.kind === 'blank')
  );
}

function rowColumnPosition(target: RowColumnTarget): string {
  const fromDisplay = rowColumnPositionFromDisplayRef(target.axis, target.displayRef);
  if (fromDisplay) return fromDisplay;
  if (target.axis === 'row') return String(target.index + 1);
  return columnLabelFromZeroBasedIndex(target.index);
}

function rowColumnPositionFromDisplayRef(
  axis: RowColumnTarget['axis'],
  displayRef: string | undefined,
): string | undefined {
  if (!displayRef) return undefined;
  const [start, end] = displayRef.split(':');
  if (!start || !end || start !== end) return displayRef;
  if (axis === 'row') return /^\d+$/.test(start) ? start : displayRef;
  return /^[A-Z]+$/.test(start) ? start : displayRef;
}

function columnLabelFromZeroBasedIndex(index: number): string {
  let current = index + 1;
  let label = '';
  while (current > 0) {
    const remainder = (current - 1) % 26;
    label = String.fromCharCode(65 + remainder) + label;
    current = Math.floor((current - 1) / 26);
  }
  return label;
}

function isSafeZeroBasedIndex(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function displayValue(value: VersionDiffDisplayValue | undefined): string | undefined {
  if (!value || value.kind === 'redacted') return undefined;
  const trimmed = value.value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function capitalizeWord(value: string): string {
  return value.length === 0 ? value : value[0].toUpperCase() + value.slice(1);
}
