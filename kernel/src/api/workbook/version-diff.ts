import type {
  VersionCommitish,
  VersionDiagnosticPublicPayload,
  VersionDiffDisplay,
  VersionDiffDisplayValue,
  VersionDiffEntry,
  VersionDiffOptions,
  VersionDiffStructuralMetadata,
  VersionDiffValue,
  VersionMainRefName,
  VersionPageToken,
  VersionRecordRevision,
  VersionRedactedValue,
  VersionRefName,
  VersionRefSelector,
  VersionSemanticValue,
  VersionStoreDiagnostic,
  WorkbookCommitId,
  WorkbookDiffPage,
} from '@mog-sdk/contracts/api';
import {
  VERSION_DIFF_DEFAULT_PAGE_LIMIT,
  VERSION_DIFF_MAX_PAGE_LIMIT,
  VERSION_DIFF_PAGE_ORDER,
  VERSION_DIFF_PUBLIC_CURSOR_MAX_LENGTH,
  isPublicVersionDiffCursor,
} from '@mog-sdk/contracts/versioning';
import type { DocumentContext } from '../../context';
import { projectReviewAccessDiffValue } from '../../document/version-store/review-access-projection';
import { validateRefName } from '../../document/version-store/ref-name';
import {
  normalizeVersionObjectReadDiagnosticCode,
  recoverabilityForVersionObjectRead,
} from './version-object-read-diagnostics';
const VERSION_HEAD_REF = 'HEAD';
const VERSION_MAIN_REF = 'refs/heads/main' satisfies VersionMainRefName;
const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const VERSION_DIFF_OPTION_KEYS = new Set(['pageSize', 'pageToken', 'includeDerivedImpact', 'includeDiagnostics']);
const VERSION_COMMIT_SELECTOR_KEYS = new Set(['kind', 'id']);
const VERSION_REF_SELECTOR_KEYS = new Set(['kind', 'name']);
const RAW_PUBLIC_DIFF_DOMAINS = new Set(['cell', 'sheet', 'cells.formats.direct', 'rows-columns']);
const REDACTED_VALUE_REASONS = new Set(['permission-denied', 'redaction-policy', 'historical-acl-unavailable']);
type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;
type NormalizedDiffCommitish =
  | {
      readonly kind: 'commit';
      readonly id: WorkbookCommitId;
    }
  | {
      readonly kind: 'ref';
      readonly name: VersionRefSelector;
    };
type NormalizedDiffOptions = {
  readonly pageSize?: number;
  readonly pageToken?: VersionPageToken;
  readonly includeDerivedImpact?: boolean;
  readonly includeDiagnostics?: boolean;
};
type DiffValidationResult =
  | {
      readonly ok: true;
      readonly base: NormalizedDiffCommitish;
      readonly target: NormalizedDiffCommitish;
      readonly options: NormalizedDiffOptions;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };
type AttachedVersionDiffService = {
  diff: (
    base: NormalizedDiffCommitish,
    target: NormalizedDiffCommitish,
    options?: NormalizedDiffOptions,
  ) => MaybePromise<unknown>;
};
type AttachedVersionServices = {
  readonly diffService?: unknown;
  readonly versionDiffService?: unknown;
  readonly publicService?: unknown;
  readonly readService?: unknown;
  readonly graphService?: unknown;
  readonly graphStore?: unknown;
  readonly graph?: unknown;
};
type ProjectedDiffEntry = {
  readonly entry: VersionDiffEntry;
  readonly explicitOrderKey: string | null;
  readonly sourceIndex: number;
};
type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};
export async function diffWorkbookVersion(
  ctx: DocumentContext,
  base: VersionCommitish,
  target: VersionCommitish,
  options: VersionDiffOptions = {},
): Promise<WorkbookDiffPage> {
  const validated = validateDiffRequest(base, target, options);
  if (!validated.ok) return degradedDiffPage(validated.diagnostics);
  const services = getAttachedVersionServices(ctx);
  if (!services) {
    return degradedDiffPage([serviceUnavailableDiagnostic()]);
  }
  const diffService = getAttachedVersionDiffService(services);
  if (!diffService) {
    return degradedDiffPage([semanticDiffUnavailableDiagnostic()]);
  }
  try {
    const result = await diffService.diff(validated.base, validated.target, validated.options);
    return mapDiffPageResult(result);
  } catch {
    return degradedDiffPage([providerErrorDiagnostic()]);
  }
}
function validateDiffRequest(
  base: VersionCommitish,
  target: VersionCommitish,
  options: VersionDiffOptions,
): DiffValidationResult {
  const diagnostics: VersionStoreDiagnostic[] = [];
  const normalizedBase = normalizeCommitish(base, 'base', diagnostics);
  const normalizedTarget = normalizeCommitish(target, 'target', diagnostics);
  const normalizedOptions = normalizeDiffOptions(options, diagnostics);
  if (!normalizedBase || !normalizedTarget || !normalizedOptions || diagnostics.length > 0) {
    return { ok: false, diagnostics };
  }
  return {
    ok: true,
    base: normalizedBase,
    target: normalizedTarget,
    options: normalizedOptions,
  };
}
function normalizeCommitish(
  value: unknown,
  selector: 'base' | 'target',
  diagnostics: VersionStoreDiagnostic[],
): NormalizedDiffCommitish | undefined {
  const directCommitId = toCommitId(value);
  if (directCommitId) return { kind: 'commit', id: directCommitId };
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(
      invalidDiffOptionDiagnostic(
        selector,
        `${selector} must be a commit id or a public version commitish selector.`,
      ),
    );
    return undefined;
  }
  if (value.kind === 'commit') {
    rejectUnknownNestedKeys(value, VERSION_COMMIT_SELECTOR_KEYS, selector, diagnostics);
    const id = toCommitId(value.id);
    if (!id) {
      diagnostics.push(
        invalidDiffOptionDiagnostic(`${selector}.id`, `${selector} commit id is invalid.`),
      );
      return undefined;
    }
    return { kind: 'commit', id };
  }
  if (value.kind === 'ref') {
    rejectUnknownNestedKeys(value, VERSION_REF_SELECTOR_KEYS, selector, diagnostics);
    const name = normalizePublicRefSelector(value.name);
    if (!name) {
      diagnostics.push(unsupportedRefDiagnostic(selector));
      return undefined;
    }
    return { kind: 'ref', name };
  }
  diagnostics.push(
    invalidDiffOptionDiagnostic(
      `${selector}.kind`,
      `${selector} selector kind must be "commit" or "ref".`,
    ),
  );
  return undefined;
}
function normalizeDiffOptions(
  input: VersionDiffOptions,
  diagnostics: VersionStoreDiagnostic[],
): NormalizedDiffOptions | undefined {
  if (input === undefined) return {};
  if (!isRecord(input) || Array.isArray(input)) {
    diagnostics.push(
      invalidDiffOptionDiagnostic('options', 'diff options must be an object when supplied.'),
    );
    return undefined;
  }
  const options: {
    pageSize?: number;
    pageToken?: VersionPageToken;
    includeDerivedImpact?: boolean;
    includeDiagnostics?: boolean;
  } = {};
  for (const key of Object.keys(input)) {
    if (VERSION_DIFF_OPTION_KEYS.has(key)) continue;
    diagnostics.push(invalidDiffOptionDiagnostic(key, `Unknown diff option "${key}".`));
  }
  const pageSizeValue = (input as VersionDiffOptions).pageSize;
  const pageSize = pageSizeValue ?? VERSION_DIFF_DEFAULT_PAGE_LIMIT;
  if (
    typeof pageSize !== 'number' ||
    !Number.isInteger(pageSize) ||
    pageSize < 1 ||
    pageSize > VERSION_DIFF_MAX_PAGE_LIMIT
  ) {
    diagnostics.push(
      invalidDiffOptionDiagnostic(
        'pageSize',
        'diff pageSize must be an integer from 1 through 500.',
        {
          min: 1,
          max: VERSION_DIFF_MAX_PAGE_LIMIT,
          receivedPageSize: formatPrimitiveForPayload(pageSize),
        },
      ),
    );
  } else if (pageSizeValue !== undefined) {
    options.pageSize = pageSize;
  }
  const pageTokenValue = (input as VersionDiffOptions).pageToken;
  if (pageTokenValue !== undefined) {
    if (
      typeof pageTokenValue === 'string' &&
      pageTokenValue.length > VERSION_DIFF_PUBLIC_CURSOR_MAX_LENGTH
    ) {
      diagnostics.push(
        invalidDiffOptionDiagnostic(
          'pageToken',
          'diff pageToken exceeds the public cursor size limit.',
          {
            max: VERSION_DIFF_PUBLIC_CURSOR_MAX_LENGTH,
            receivedCursorBytes: pageTokenValue.length,
          },
        ),
      );
    } else {
      const pageToken = toPageToken(pageTokenValue);
      if (!pageToken) {
        diagnostics.push(
          invalidDiffOptionDiagnostic('pageToken', 'diff pageToken is malformed or unsupported.'),
        );
      } else {
        options.pageToken = pageToken;
      }
    }
  }
  const includeDerivedImpact = (input as VersionDiffOptions).includeDerivedImpact;
  if (includeDerivedImpact !== undefined) {
    if (typeof includeDerivedImpact !== 'boolean') {
      diagnostics.push(
        invalidDiffOptionDiagnostic(
          'includeDerivedImpact',
          'includeDerivedImpact must be a boolean.',
        ),
      );
    } else {
      options.includeDerivedImpact = includeDerivedImpact;
    }
  }
  const includeDiagnostics = (input as VersionDiffOptions).includeDiagnostics;
  if (includeDiagnostics !== undefined) {
    if (typeof includeDiagnostics !== 'boolean') {
      diagnostics.push(
        invalidDiffOptionDiagnostic('includeDiagnostics', 'includeDiagnostics must be a boolean.'),
      );
    } else {
      options.includeDiagnostics = includeDiagnostics;
    }
  }
  return options;
}
function rejectUnknownNestedKeys(
  value: Readonly<Record<string, unknown>>,
  allowedKeys: ReadonlySet<string>,
  option: string,
  diagnostics: VersionStoreDiagnostic[],
): void {
  for (const key of Object.keys(value)) {
    if (allowedKeys.has(key)) continue;
    diagnostics.push(
      invalidDiffOptionDiagnostic(
        `${option}.${key}`,
        `Unknown ${option} selector option "${key}".`,
      ),
    );
  }
}
function getAttachedVersionServices(ctx: DocumentContext): AttachedVersionServices | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  return isRecord(services) ? (services as AttachedVersionServices) : null;
}
function getAttachedVersionDiffService(
  services: AttachedVersionServices,
): AttachedVersionDiffService | null {
  for (const candidate of [
    services.diffService,
    services.versionDiffService,
    services.publicService,
    services.readService,
    services.graphService,
    services.graphStore,
    services.graph,
    services,
  ]) {
    const diffService = toDiffService(candidate);
    if (diffService) return diffService;
  }
  return null;
}
function toDiffService(value: unknown): AttachedVersionDiffService | null {
  const diff =
    bindMethod(value, 'diff') ??
    bindMethod(value, 'diffVersions') ??
    bindMethod(value, 'diffCommits');
  if (!diff) return null;
  return {
    diff: (base, target, options) => diff(base, target, options),
  };
}
function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}
function mapDiffPageResult(value: unknown): WorkbookDiffPage {
  if (!isRecord(value)) {
    return degradedDiffPage([providerErrorDiagnostic()]);
  }
  if (value.status === 'failed' || value.status === 'degraded') {
    return degradedDiffPage(mapGraphDiagnostics(value.diagnostics));
  }
  if (value.status !== 'success') {
    return degradedDiffPage([providerErrorDiagnostic()]);
  }
  const readRevision = toRevision(value.readRevision);
  const sourceItems = Array.isArray(value.items)
    ? value.items
    : Array.isArray(value.entries)
      ? value.entries
      : Array.isArray(value.changes)
        ? value.changes
        : null;
  if (!readRevision || !sourceItems) {
    return degradedDiffPage([
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_PAYLOAD',
        'The version diff service did not return a valid public diff page.',
        {
          severity: 'error',
          recoverability: 'repair',
        },
      ),
    ]);
  }
  const { items, diagnostics } = mapDiffEntries(sourceItems);
  const resultDiagnostics = [...diagnostics];
  if (value.order !== VERSION_DIFF_PAGE_ORDER) {
    resultDiagnostics.push(
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_PAYLOAD',
        'The version diff service returned an unsupported diff order.',
        {
          severity: 'error',
          recoverability: 'repair',
        },
      ),
    );
  }
  const nextPageToken =
    value.nextPageToken === undefined ? undefined : toPageToken(value.nextPageToken);
  if (value.nextPageToken !== undefined && !nextPageToken) {
    resultDiagnostics.push(
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_PAYLOAD',
        'The version diff service returned an invalid public page token.',
        {
          severity: 'error',
          recoverability: 'repair',
        },
      ),
    );
  }
  if (Array.isArray(value.diagnostics) && value.diagnostics.length > 0) {
    resultDiagnostics.push(...mapGraphDiagnostics(value.diagnostics));
  }
  if (resultDiagnostics.length > 0) {
    return degradedDiffPage(resultDiagnostics, items, readRevision);
  }
  return {
    status: 'success',
    items,
    ...(nextPageToken ? { nextPageToken } : {}),
    readRevision,
    order: VERSION_DIFF_PAGE_ORDER,
    diagnostics: [],
  };
}
function mapDiffEntries(values: readonly unknown[]): {
  readonly items: readonly VersionDiffEntry[];
  readonly diagnostics: readonly VersionStoreDiagnostic[];
} {
  const items: ProjectedDiffEntry[] = [];
  const diagnostics: VersionStoreDiagnostic[] = [];
  values.forEach((value, index) => {
    const entry = mapDiffEntry(value);
    if (entry) {
      items.push({ entry, explicitOrderKey: explicitDiffOrderKey(value, entry), sourceIndex: index });
      return;
    }
    const unsupportedDomain = unsupportedDiffDomain(value);
    diagnostics.push(
      unsupportedDomain
        ? unsupportedDiffDomainDiagnostic(unsupportedDomain, index)
        : publicDiagnostic(
            'VERSION_INVALID_COMMIT_PAYLOAD',
            'A version diff entry could not be safely projected.',
            {
              severity: 'error',
              recoverability: 'repair',
              payload: { itemIndex: index },
            },
          ),
    );
  });
  return { items: orderDiffEntries(items), diagnostics };
}
function mapDiffEntry(value: unknown): VersionDiffEntry | null {
  if (!isRecord(value)) return null;
  const structural = mapStructuralMetadata(value.structural ?? value);
  const before = structural ? mapReviewAccessDiffValue(structural, value.before) : null;
  const after = structural ? mapReviewAccessDiffValue(structural, value.after) : null;
  if (!structural || !before || !after) return null;
  const display = value.display === undefined ? undefined : mapDiffDisplay(value.display);
  if (value.display !== undefined && !display) return null;
  const diagnostics = Array.isArray(value.diagnostics)
    ? mapGraphDiagnostics(value.diagnostics)
    : undefined;
  return redactCellEntry({
    structural,
    before,
    after,
    ...(display ? { display } : {}),
    ...(diagnostics && diagnostics.length > 0 ? { diagnostics } : {}),
  });
}
function mapReviewAccessDiffValue(
  structural: VersionDiffStructuralMetadata,
  value: unknown,
): VersionDiffValue | null {
  const reviewValue = projectReviewAccessDiffValue(structural, value);
  if (reviewValue !== undefined) return reviewValue;
  if (structural.kind !== 'metadata') return mapDiffValue(value);
  return structural.kind === 'metadata' && RAW_PUBLIC_DIFF_DOMAINS.has(structural.domain)
    ? mapDiffValue(value)
    : null;
}
function orderDiffEntries(items: readonly ProjectedDiffEntry[]): readonly VersionDiffEntry[] {
  if (!items.some((item) => item.explicitOrderKey)) return items.map((item) => item.entry);
  return [...items].sort((a, b) => diffOrderKey(a).localeCompare(diffOrderKey(b))).map((item) => item.entry);
}
function diffOrderKey(item: ProjectedDiffEntry): string {
  return item.explicitOrderKey ?? fallbackDiffOrderKey(item.entry, item.sourceIndex);
}
function explicitDiffOrderKey(source: unknown, entry: VersionDiffEntry): string | null {
  const key = isRecord(source) && isRecord(source.pageCursorOrderKey) ? source.pageCursorOrderKey : null;
  const domainOrder = key ? Number(key.domainOrder) : NaN;
  if (entry.structural.kind !== 'metadata' || !Number.isSafeInteger(domainOrder) || typeof key?.hashPropertyPath !== 'string') return null;
  return semanticDiffOrderKey(domainOrder, key.hashPropertyPath, typeof key.canonicalEventKey === 'string' ? key.canonicalEventKey : undefined, typeof key.hashIdentity === 'string' ? key.hashIdentity : undefined, typeof key.valueClass === 'string' ? key.valueClass : 'authored', entry.structural.changeId);
}
function fallbackDiffOrderKey(entry: VersionDiffEntry, sourceIndex: number): string {
  const structural = entry.structural;
  return structural.kind === 'metadata'
    ? semanticDiffOrderKey(90, structural.propertyPath.join('/'), undefined, structural.entityId, 'authored', structural.changeId)
    : semanticDiffOrderKey(100, '', undefined, undefined, 'diagnosticOnly', sourceIndex.toString());
}
function semanticDiffOrderKey(domainOrder: number, path: string, eventKey: string | undefined, identity: string | undefined, valueClass: string, changeId: string): string {
  return JSON.stringify([domainOrder.toString().padStart(5, '0'), path, eventKey ?? null, identity ?? null, valueClass, changeId]);
}
function redactCellEntry(entry: VersionDiffEntry): VersionDiffEntry {
  if (entry.structural.kind !== 'metadata' || entry.structural.domain !== 'cell') return entry;
  const reason = redactedReason(entry.before) ?? redactedReason(entry.after);
  if (!reason) return entry;
  const structural = redactedValue(reason);
  return { ...entry, structural, ...(entry.display ? { display: redactDisplay(entry.display, reason) } : {}) };
}
function redactDisplay(display: VersionDiffDisplay, reason: VersionRedactedValue['reason']): VersionDiffDisplay {
  const redacted = redactedValue(reason);
  return {
    ...(display.sheetName ? { sheetName: redacted } : {}),
    ...(display.address ? { address: redacted } : {}),
    ...(display.entityLabel ? { entityLabel: redacted } : {}),
  };
}
function redactedReason(value: VersionDiffValue): VersionRedactedValue['reason'] | null {
  return value.kind === 'redacted' ? value.reason : null;
}
function redactedValue(reason: VersionRedactedValue['reason']): VersionRedactedValue {
  return { kind: 'redacted', reason };
}
function mapStructuralMetadata(value: unknown): VersionDiffStructuralMetadata | null {
  const redacted = mapRedactedValue(value);
  if (redacted) return redacted;
  if (!isRecord(value)) return null;
  if (
    typeof value.changeId !== 'string' ||
    typeof value.domain !== 'string' ||
    typeof value.entityId !== 'string' ||
    !Array.isArray(value.propertyPath) ||
    !value.propertyPath.every((segment) => typeof segment === 'string')
  ) {
    return null;
  }
  return {
    kind: 'metadata',
    changeId: value.changeId,
    domain: value.domain,
    entityId: value.entityId,
    propertyPath: [...value.propertyPath],
  };
}
function mapDiffValue(value: unknown): VersionDiffValue | null {
  const redacted = mapRedactedValue(value);
  if (redacted) return redacted;
  if (!isRecord(value) || value.kind !== 'value') return null;
  const semanticValue = mapSemanticValue(value.value);
  if (semanticValue === undefined) return null;
  return { kind: 'value', value: semanticValue };
}
function mapSemanticValue(value: unknown, depth = 0): VersionSemanticValue | undefined {
  if (depth > 16) return undefined;
  if (value === null || typeof value === 'boolean' || typeof value === 'string') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined;
  if (!isRecord(value)) return undefined;
  switch (value.kind) {
    case 'blank':
      return { kind: 'blank' };
    case 'dateTime':
      return typeof value.iso === 'string' ? { kind: 'dateTime', iso: value.iso } : undefined;
    case 'duration':
      return typeof value.iso === 'string' ? { kind: 'duration', iso: value.iso } : undefined;
    case 'error':
      if (typeof value.code !== 'string') return undefined;
      return {
        kind: 'error',
        code: value.code,
        ...(typeof value.message === 'string' ? { message: value.message } : {}),
      };
    case 'formula': {
      if (typeof value.formula !== 'string') return undefined;
      if (!('result' in value)) return { kind: 'formula', formula: value.formula };
      const result = mapSemanticValue(value.result, depth + 1);
      return result === undefined ? undefined : { kind: 'formula', formula: value.formula, result };
    }
    case 'array': {
      if (!Array.isArray(value.values)) return undefined;
      const values = mapSemanticValues(value.values, depth + 1);
      return values ? { kind: 'array', values } : undefined;
    }
    case 'richText': {
      if (!Array.isArray(value.runs)) return undefined;
      const runs = value.runs.map((run) => {
        if (!isRecord(run) || typeof run.text !== 'string') return null;
        return {
          text: run.text,
          ...(typeof run.styleRef === 'string' ? { styleRef: run.styleRef } : {}),
        };
      });
      if (runs.some((run) => run === null)) return undefined;
      return {
        kind: 'richText',
        runs: runs as { readonly text: string; readonly styleRef?: string }[],
      };
    }
    case 'object': {
      if (!Array.isArray(value.fields)) return undefined;
      const fields = value.fields.map((field) => {
        if (!isRecord(field) || typeof field.key !== 'string') return null;
        const mappedValue = mapSemanticValue(field.value, depth + 1);
        return mappedValue === undefined ? null : { key: field.key, value: mappedValue };
      });
      if (fields.some((field) => field === null)) return undefined;
      return {
        kind: 'object',
        fields: fields as { readonly key: string; readonly value: VersionSemanticValue }[],
      };
    }
    default:
      return undefined;
  }
}
function mapSemanticValues(
  values: readonly unknown[],
  depth: number,
): readonly VersionSemanticValue[] | undefined {
  const mapped = values.map((value) => mapSemanticValue(value, depth));
  return mapped.some((value) => value === undefined)
    ? undefined
    : (mapped as readonly VersionSemanticValue[]);
}
function mapDiffDisplay(value: unknown): VersionDiffDisplay | null {
  if (!isRecord(value)) return null;
  const display: {
    sheetName?: VersionDiffDisplayValue;
    address?: VersionDiffDisplayValue;
    entityLabel?: VersionDiffDisplayValue;
  } = {};
  for (const key of ['sheetName', 'address', 'entityLabel'] as const) {
    if (value[key] === undefined) continue;
    const displayValue = mapDiffDisplayValue(value[key]);
    if (!displayValue) return null;
    display[key] = displayValue;
  }
  return display;
}
function mapDiffDisplayValue(value: unknown): VersionDiffDisplayValue | null {
  const redacted = mapRedactedValue(value);
  if (redacted) return redacted;
  if (!isRecord(value) || value.kind !== 'value' || typeof value.value !== 'string') return null;
  return { kind: 'value', value: value.value };
}
function mapRedactedValue(value: unknown): VersionRedactedValue | null {
  if (!isRecord(value) || value.kind !== 'redacted' || typeof value.reason !== 'string') {
    return null;
  }
  if (!REDACTED_VALUE_REASONS.has(value.reason)) return null;
  return {
    kind: 'redacted',
    reason: value.reason as 'permission-denied' | 'redaction-policy' | 'historical-acl-unavailable',
  };
}
function mapGraphDiagnostics(value: unknown): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(value) || value.length === 0) return [providerErrorDiagnostic()];
  return value.map(mapGraphDiagnostic);
}
function mapGraphDiagnostic(value: unknown): VersionStoreDiagnostic {
  if (!isRecord(value)) return providerErrorDiagnostic();
  const rawIssueCode =
    typeof value.issueCode === 'string'
      ? value.issueCode
      : typeof value.code === 'string'
        ? value.code
        : 'VERSION_PROVIDER_ERROR';
  const issueCode = publicDiffIssueCode(rawIssueCode);
  const severity = value.severity === 'corruption' ? 'error' : value.severity;
  return publicDiagnostic(issueCode, safeMessageForIssue(issueCode), {
    severity:
      severity === 'info' || severity === 'warning' || severity === 'error' || severity === 'fatal'
        ? severity
        : 'error',
    recoverability: recoverabilityForVersionObjectRead(
      issueCode,
      isRecoverability(value.recoverability)
        ? value.recoverability
        : recoverabilityForIssue(issueCode),
    ),
    payload: sanitizeDiagnosticPayload(value),
  });
}
function publicDiffIssueCode(issueCode: string): string {
  const objectReadCode = normalizeVersionObjectReadDiagnosticCode(issueCode);
  return objectReadCode === 'VERSION_OBJECT_NOT_FOUND'
    ? 'VERSION_MISSING_OBJECT'
    : (objectReadCode ?? issueCode);
}
function sanitizeDiagnosticPayload(
  value: Readonly<Record<string, unknown>>,
): VersionDiagnosticPublicPayload {
  const payload: Record<string, string | number | boolean | null> = {
    operation: 'diff',
  };
  if (typeof value.option === 'string') payload.option = value.option;
  if (typeof value.selector === 'string') payload.selector = value.selector;
  const refName = value.refName;
  if (refName === VERSION_HEAD_REF || refName === VERSION_MAIN_REF) {
    payload.refName = refName;
  }
  const details = isRecord(value.details) ? value.details : null;
  const providerPayload = isRecord(value.payload) ? value.payload : null;
  const detailRefName = details?.refName;
  if (payload.refName === undefined && (detailRefName === VERSION_HEAD_REF || detailRefName === VERSION_MAIN_REF)) {
    payload.refName = detailRefName;
  }
  for (const source of [providerPayload, details]) {
    if (!source) continue;
    for (const key of [
      'reason',
      'min',
      'max',
      'pageSize',
      'receivedPageSize',
      'includeDerivedImpact',
      'includeDiagnostics',
      'category',
      'completenessCode',
      'completenessSeverity',
      'path',
      'domain',
      'source',
    ] as const) {
      const detailValue = source[key];
      const sanitized = sanitizePayloadPrimitive(detailValue);
      if (sanitized !== undefined) payload[key] = sanitized;
    }
  }
  return payload;
}
function serviceUnavailableDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_GRAPH_UNINITIALIZED',
    'No document-scoped version graph read service is attached; no diff is fabricated.',
    {
      severity: 'warning',
      recoverability: 'unsupported',
    },
  );
}
function semanticDiffUnavailableDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_UNMATERIALIZABLE_COMMIT',
    'No document-scoped semantic version diff service is attached; no diff is fabricated.',
    {
      severity: 'warning',
      recoverability: 'unsupported',
    },
  );
}
function providerErrorDiagnostic(
  payload: VersionDiagnosticPublicPayload = { source: 'provider' },
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PROVIDER_ERROR',
    'The version diff service failed before returning a usable public result.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload,
    },
  );
}
function unsupportedDiffDomain(value: unknown): string | null {
  const structural = mapStructuralMetadata(isRecord(value) ? (value.structural ?? value) : value);
  if (structural?.kind !== 'metadata' || RAW_PUBLIC_DIFF_DOMAINS.has(structural.domain)) return null;
  const redacted = { kind: 'redacted', reason: 'permission-denied' };
  return projectReviewAccessDiffValue(structural, redacted) === undefined ? structural.domain : null;
}
function unsupportedDiffDomainDiagnostic(domain: string, itemIndex: number): VersionStoreDiagnostic {
  return publicDiagnostic('unsupportedDomain', 'The requested version diff includes unsupported semantic state.', { severity: 'error', recoverability: 'unsupported', payload: { category: 'unsupported', domain, itemIndex } });
}
function unsupportedRefDiagnostic(selector: string): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PERMISSION_DENIED',
    'This version diff slice can resolve only HEAD or public refs/heads/<branch> refs.',
    {
      severity: 'error',
      recoverability: 'unsupported',
      payload: { selector, refName: 'redacted' },
    },
  );
}
function invalidDiffOptionDiagnostic(
  option: string,
  safeMessage: string,
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_INVALID_OPTIONS', safeMessage, {
    severity: 'error',
    recoverability: 'none',
    payload: {
      option,
      ...payload,
    },
  });
}
function publicDiagnostic(
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
    messageTemplateId: `version.diff.${issueCode}`,
    safeMessage,
    payload: { operation: 'diff', ...options.payload },
    redacted: true,
  };
}
function safeMessageForIssue(issueCode: string): string {
  switch (issueCode) {
    case 'VERSION_GRAPH_UNINITIALIZED':
      return 'The workbook version graph is not initialized for this document.';
    case 'VERSION_INVALID_OPTIONS':
      return 'The version diff options are invalid for this method.';
    case 'VERSION_PERMISSION_DENIED':
      return 'The requested version diff ref is not exposed by this public slice.';
    case 'VERSION_STALE_PAGE_CURSOR':
      return 'The version diff page token is stale or unsupported by this read slice.';
    case 'VERSION_STALE_SELECTOR':
      return 'The requested version diff selector is stale or unsupported by this read slice.';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_BYTE_LENGTH_MISMATCH':
    case 'VERSION_DIGEST_MISMATCH':
    case 'VERSION_INVALID_PAYLOAD':
    case 'VERSION_INVALID_PREIMAGE':
    case 'VERSION_OBJECT_CORRUPTION':
    case 'VERSION_OBJECT_TYPE_MISMATCH':
    case 'VERSION_OBJECT_STORE_FAILURE':
    case 'VERSION_OBJECT_NOT_FOUND':
    case 'VERSION_UNSUPPORTED_OBJECT_TYPE':
    case 'VERSION_UNSUPPORTED_PAYLOAD_ENCODING':
      return 'The version graph could not validate the requested diff commit closure.';
    case 'VERSION_UNMATERIALIZABLE_COMMIT':
    case 'VERSION_UNSUPPORTED_SCHEMA':
      return 'The requested version diff is not materializable by the attached service.';
    case 'VERSION_PROVIDER_FAILED':
      return 'The version diff provider is temporarily unavailable.';
    case 'VERSION_STORE_UNAVAILABLE':
      return 'The version store is unavailable for this document.';
    case 'VERSION_UNSUPPORTED_AUTHORED_DOMAIN':
    case 'unsupportedDomain':
    case 'unsupportedFormat':
    case 'externalReferenceUnsupported':
      return 'The requested version diff includes unsupported semantic state.';
    case 'opaqueDomain':
    case 'opaqueDomainDigestUnavailable':
    case 'opaqueFormatPointer':
      return 'The requested version diff includes opaque semantic state.';
    case 'derivedImpactStale':
    case 'staleDiffCursor':
      return 'The requested version diff includes stale semantic state evidence.';
    case 'indexKeyedVisibility':
    case 'indexKeyedRowVisibility':
    case 'indexKeyedColumnVisibility':
    case 'inconsistentVisibilityCache':
      return 'The requested version diff includes subset-hidden semantic state.';
    default:
      return 'The version graph could not complete diff.';
  }
}
function recoverabilityForIssue(issueCode: string): VersionStoreDiagnostic['recoverability'] {
  switch (issueCode) {
    case 'VERSION_STALE_PAGE_CURSOR':
    case 'VERSION_STALE_SELECTOR':
    case 'derivedImpactStale':
    case 'staleDiffCursor':
    case 'VERSION_REF_CONFLICT':
      return 'retry';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_BYTE_LENGTH_MISMATCH':
    case 'VERSION_DIGEST_MISMATCH':
    case 'VERSION_INVALID_PAYLOAD':
    case 'VERSION_INVALID_PREIMAGE':
    case 'VERSION_OBJECT_CORRUPTION':
    case 'VERSION_OBJECT_TYPE_MISMATCH':
    case 'VERSION_OBJECT_STORE_FAILURE':
    case 'VERSION_UNSUPPORTED_OBJECT_TYPE':
    case 'VERSION_UNSUPPORTED_PAYLOAD_ENCODING':
      return 'repair';
    case 'VERSION_GRAPH_UNINITIALIZED':
    case 'VERSION_STORE_UNAVAILABLE':
    case 'VERSION_PERMISSION_DENIED':
    case 'VERSION_UNMATERIALIZABLE_COMMIT':
    case 'VERSION_UNSUPPORTED_SCHEMA':
    case 'VERSION_UNSUPPORTED_AUTHORED_DOMAIN':
    case 'unsupportedDomain':
    case 'unsupportedFormat':
    case 'externalReferenceUnsupported':
    case 'opaqueDomain':
    case 'opaqueDomainDigestUnavailable':
    case 'opaqueFormatPointer':
    case 'indexKeyedVisibility':
    case 'indexKeyedRowVisibility':
    case 'indexKeyedColumnVisibility':
    case 'inconsistentVisibilityCache':
      return 'unsupported';
    case 'VERSION_PROVIDER_FAILED':
      return 'retry';
    default:
      return 'none';
  }
}
function degradedDiffPage(
  diagnostics: readonly VersionStoreDiagnostic[],
  items: readonly VersionDiffEntry[] = [],
  readRevision?: VersionRecordRevision,
): WorkbookDiffPage {
  return {
    status: 'degraded',
    items,
    ...(readRevision ? { readRevision } : {}),
    order: VERSION_DIFF_PAGE_ORDER,
    diagnostics,
  };
}
function normalizePublicRefSelector(value: unknown): VersionRefSelector | null {
  if (value === VERSION_HEAD_REF) return VERSION_HEAD_REF;
  if (value === VERSION_MAIN_REF) return VERSION_MAIN_REF;
  if (typeof value === 'string' && value.startsWith('refs/heads/')) {
    const parsed = validateRefName(value.slice('refs/heads/'.length));
    if (parsed.ok) return value as VersionRefName;
  }
  return null;
}
function toCommitId(value: unknown): WorkbookCommitId | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : null;
}
function toPageToken(value: unknown): VersionPageToken | undefined {
  return isPublicVersionDiffCursor(value) ? (value as VersionPageToken) : undefined;
}
function toRevision(value: unknown): VersionRecordRevision | undefined {
  if (isRecord(value) && value.kind === 'counter' && typeof value.value === 'string') {
    return { kind: 'counter', value: value.value };
  }
  if (isRecord(value) && value.kind === 'opaque' && typeof value.value === 'string') {
    return { kind: 'opaque', value: value.value };
  }
  if (typeof value === 'string') return { kind: 'opaque', value };
  return undefined;
}
function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
function isPayloadPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}
function formatPrimitiveForPayload(value: unknown): string | number | boolean | null {
  return isPayloadPrimitive(value) ? value : String(value);
}
function isRecoverability(value: unknown): value is VersionStoreDiagnostic['recoverability'] {
  return value === 'retry' || value === 'repair' || value === 'unsupported' || value === 'none';
}
function sanitizePayloadPrimitive(value: unknown): string | number | boolean | null | undefined {
  if (!isPayloadPrimitive(value)) return undefined;
  if (typeof value !== 'string') return value;
  return /\b(?:preimage|commit:sha256:|merge-result:|sha256:[0-9a-f]{64}|secret|token)\b/i.test(
    value,
  )
    ? 'redacted'
    : value;
}
