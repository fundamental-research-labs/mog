import type {
  VersionCommitPage,
  VersionDiagnosticPublicPayload,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import {
  VERSION_HEAD_REF,
  VERSION_LIST_COMMITS_PAGE_ORDER,
  VERSION_MAIN_REF,
} from './version-list-commits-constants';
import { isRecord } from './version-list-commits-utils';

type DiagnosticPayloadRecord = Record<string, string | number | boolean | null>;

const DIAGNOSTIC_METADATA_BOOLEAN_FIELDS = [
  'accessFiltered',
  'cursorMalformed',
  'cursorRootMismatch',
  'cursorRevisionMismatch',
  'deterministicOrder',
  'indexManifestCorrupt',
  'indexManifestMissing',
  'indexManifestStale',
  'indexRebuildRequired',
  'manifestCorrupt',
  'manifestMissing',
  'manifestStale',
  'pageTokenUnsupported',
  'refMissing',
  'rootMissing',
  'rootMismatch',
  'rootTraversal',
] as const;

const DIAGNOSTIC_METADATA_NUMBER_FIELDS = [
  'commitCount',
  'duplicateOfItemIndex',
  'itemIndex',
  'max',
  'min',
  'orderedCommitCount',
  'pageSize',
  'parentItemIndex',
  'reachableCommitCount',
  'receivedCursorBytes',
  'receivedPageSize',
] as const;

export function mapGraphDiagnostics(value: unknown): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [graphUninitializedDiagnostic()];
  }

  return value.map(mapGraphDiagnostic);
}

export function mapGraphDiagnostic(value: unknown): VersionStoreDiagnostic {
  if (!isRecord(value)) {
    return providerErrorDiagnostic();
  }

  const issueCode =
    safeIssueCode(value.issueCode) ?? safeIssueCode(value.code) ?? 'VERSION_PROVIDER_ERROR';
  const severity = value.severity === 'corruption' ? 'error' : value.severity;

  return publicDiagnostic(issueCode, safeMessageForIssue(issueCode), {
    severity:
      severity === 'info' || severity === 'warning' || severity === 'error' || severity === 'fatal'
        ? severity
        : 'error',
    recoverability: recoverabilityForIssue(issueCode),
    payload: sanitizeDiagnosticPayload(value),
  });
}

export function serviceUnavailableDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_GRAPH_UNINITIALIZED',
    'No document-scoped version graph read service is attached; no commit history is fabricated.',
    {
      severity: 'warning',
      recoverability: 'unsupported',
    },
  );
}

export function providerErrorDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PROVIDER_ERROR',
    'The version graph read service failed before returning a usable public result.',
    {
      severity: 'error',
      recoverability: 'retry',
    },
  );
}

export function publicDiagnostic(
  issueCode: string,
  safeMessage: string,
  options: {
    readonly severity?: VersionStoreDiagnostic['severity'];
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly payload?: VersionDiagnosticPublicPayload;
  } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: options.severity ?? 'error',
    recoverability: options.recoverability ?? recoverabilityForIssue(issueCode),
    messageTemplateId: `version.listCommits.${issueCode}`,
    safeMessage,
    ...(options.payload ? { payload: options.payload } : {}),
    redacted: true,
  };
}

export function degradedCommitPage(
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionCommitPage {
  return {
    status: 'degraded',
    items: [],
    order: VERSION_LIST_COMMITS_PAGE_ORDER,
    diagnostics,
  };
}

function sanitizeDiagnosticPayload(
  value: Readonly<Record<string, unknown>>,
): VersionDiagnosticPublicPayload {
  const payload: DiagnosticPayloadRecord = { operation: 'listCommits' };

  projectSelectorPayload(payload, value);
  projectDiagnosticObjectKindPayload(payload, value);

  const details = isRecord(value.details) ? value.details : null;
  if (details) {
    projectSelectorPayload(payload, details);
    projectDiagnosticMetadataPayload(payload, details);
  }

  return payload;
}

function projectSelectorPayload(
  payload: DiagnosticPayloadRecord,
  value: Readonly<Record<string, unknown>>,
): void {
  if (isPublicListCommitsOption(value.option)) payload.option = value.option;

  const refName = value.refName;
  if (refName === VERSION_HEAD_REF || refName === VERSION_MAIN_REF) {
    payload.refName = refName;
  }
}

function projectDiagnosticObjectKindPayload(
  payload: DiagnosticPayloadRecord,
  value: Readonly<Record<string, unknown>>,
): void {
  const objectKind = safeObjectKind(value.objectKind);
  if (objectKind) payload.objectKind = objectKind;
}

function projectDiagnosticMetadataPayload(
  payload: DiagnosticPayloadRecord,
  details: Readonly<Record<string, unknown>>,
): void {
  copyBooleanPayloadFields(payload, details, DIAGNOSTIC_METADATA_BOOLEAN_FIELDS);
  copyNumberPayloadFields(payload, details, DIAGNOSTIC_METADATA_NUMBER_FIELDS);

  const category =
    safeCursorCategory(details.category) ?? safeCursorCategory(details.cursorCategory);
  if (category) payload.category = category;

  const completenessMarker = safeCompletenessMarker(details.completenessMarker);
  if (completenessMarker) payload.completenessMarker = completenessMarker;
  const completenessScope = safeCompletenessScope(details.completenessScope);
  if (completenessScope) payload.completenessScope = completenessScope;
  const completenessCondition = safeCompletenessCondition(details.completenessCondition);
  if (completenessCondition) payload.completenessCondition = completenessCondition;

  const missingCommitRole = safeMissingCommitRole(details.missingCommitRole);
  if (missingCommitRole) payload.missingCommitRole = missingCommitRole;
  const corruptTraversalCondition = safeCorruptTraversalCondition(
    details.corruptTraversalCondition,
  );
  if (corruptTraversalCondition) {
    payload.corruptTraversalCondition = corruptTraversalCondition;
  }

  const rootKind = safeObjectKind(details.rootKind);
  if (rootKind) payload.rootKind = rootKind;
  const detailObjectKind = safeObjectKind(details.objectKind);
  if (!payload.objectKind && detailObjectKind) payload.objectKind = detailObjectKind;
}

function copyBooleanPayloadFields(
  payload: DiagnosticPayloadRecord,
  source: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): void {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'boolean') payload[key] = value;
  }
}

function copyNumberPayloadFields(
  payload: DiagnosticPayloadRecord,
  source: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): void {
  for (const key of keys) {
    const value = source[key];
    if (typeof value === 'number' && Number.isFinite(value)) payload[key] = value;
  }
}

function graphUninitializedDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_GRAPH_UNINITIALIZED',
    'The workbook version graph is not initialized for this document.',
    {
      severity: 'warning',
      recoverability: 'unsupported',
    },
  );
}

function safeCursorCategory(value: unknown): string | undefined {
  switch (value) {
    case 'forgedCursor':
    case 'malformedCursor':
    case 'oversizedCursor':
    case 'refScopeMismatch':
    case 'staleCursor':
    case 'unsupportedCursor':
    case 'unsupportedCursorOrder':
    case 'unsupportedCursorVersion':
    case 'wrongOperationCursor':
      return value;
    default:
      return undefined;
  }
}

function safeObjectKind(value: unknown): string | undefined {
  switch (value) {
    case 'commit':
    case 'index':
    case 'mutable-record':
    case 'redaction-summary':
    case 'semantic-change-set':
    case 'snapshot-chunk':
    case 'snapshot-root':
    case 'verification-summary':
      return value;
    default:
      return undefined;
  }
}

function safeCompletenessMarker(value: unknown): string | undefined {
  return value === 'diagnostic-read' ? value : undefined;
}

function safeCompletenessScope(value: unknown): string | undefined {
  return value === 'graph-metadata' ? value : undefined;
}

function safeCompletenessCondition(value: unknown): string | undefined {
  return value === 'stale' || value === 'history-gap' || value === 'corrupt' ? value : undefined;
}

function safeMissingCommitRole(value: unknown): string | undefined {
  return value === 'root' || value === 'parent' ? value : undefined;
}

function safeCorruptTraversalCondition(value: unknown): string | undefined {
  return value === 'parentCycle' || value === 'unreachableCommit' ? value : undefined;
}

function isPublicListCommitsOption(value: unknown): value is string {
  return (
    value === 'from' ||
    value === 'includeDiagnostics' ||
    value === 'includeOrphans' ||
    value === 'pageSize' ||
    value === 'pageToken' ||
    value === 'ref'
  );
}

function safeIssueCode(value: unknown): string | undefined {
  return typeof value === 'string' && /^VERSION_[A-Z0-9_]+$/.test(value) ? value : undefined;
}

function safeMessageForIssue(issueCode: string): string {
  switch (issueCode) {
    case 'VERSION_GRAPH_UNINITIALIZED':
      return 'The workbook version graph is not initialized for this document.';
    case 'VERSION_STALE_PAGE_CURSOR':
      return 'The version page token is stale or unsupported by this read slice.';
    case 'VERSION_INDEX_REBUILD_REQUIRED':
      return 'The version graph index must be rebuilt before commit history can be listed.';
    case 'VERSION_CORRUPT_MANIFEST':
      return 'The version graph index manifest is corrupt or stale.';
    case 'VERSION_UNSUPPORTED_PAGE_TOKEN':
      return 'The version graph cannot serve a follow-up page token in this slice.';
    case 'VERSION_INVALID_OPTIONS':
      return 'The version read options are invalid for this method.';
    case 'VERSION_PERMISSION_DENIED':
      return 'The requested version read is not exposed by this public slice.';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_MISSING_PARENT':
    case 'VERSION_OBJECT_STORE_FAILURE':
    case 'VERSION_WRONG_DOCUMENT':
    case 'VERSION_WRONG_NAMESPACE':
      return 'The version graph could not validate the requested commit closure.';
    case 'VERSION_REF_CONFLICT':
      return 'The version ref changed while the read was in progress.';
    case 'VERSION_STORE_UNAVAILABLE':
      return 'The version store is unavailable for this document.';
    default:
      return 'The version graph could not complete listCommits.';
  }
}

function recoverabilityForIssue(issueCode: string): VersionStoreDiagnostic['recoverability'] {
  switch (issueCode) {
    case 'VERSION_STALE_PAGE_CURSOR':
    case 'VERSION_REF_CONFLICT':
    case 'VERSION_STORE_UNAVAILABLE':
      return 'retry';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_CORRUPT_MANIFEST':
    case 'VERSION_INDEX_REBUILD_REQUIRED':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_MISSING_PARENT':
    case 'VERSION_OBJECT_STORE_FAILURE':
    case 'VERSION_WRONG_DOCUMENT':
    case 'VERSION_WRONG_NAMESPACE':
      return 'repair';
    case 'VERSION_GRAPH_UNINITIALIZED':
    case 'VERSION_UNSUPPORTED_PAGE_TOKEN':
    case 'VERSION_PERMISSION_DENIED':
      return 'unsupported';
    default:
      return 'none';
  }
}
