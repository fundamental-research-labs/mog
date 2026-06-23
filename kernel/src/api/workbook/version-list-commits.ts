import type {
  Paged,
  RedactedVersionAuthor,
  VersionCommitPage,
  VersionDiagnosticPublicPayload,
  VersionListCommitsOptions,
  VersionMainRefName,
  VersionPageToken,
  VersionRecordRevision,
  VersionRefSelector,
  VersionResult,
  VersionStoreDiagnostic,
  WorkbookCommitId,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { validateRefName } from '../../document/version-store/ref-name';
import { versionResultFromCommitPage } from './version-result';

const VERSION_HEAD_REF = 'HEAD';
const VERSION_MAIN_REF = 'refs/heads/main' satisfies VersionMainRefName;
const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const VERSION_LIST_COMMITS_PAGE_TOKEN_PREFIX = 'vpt_';
const VERSION_LIST_COMMITS_PAGE_TOKEN_RE = /^[A-Za-z0-9_-][A-Za-z0-9_.:-]*$/;
const VERSION_LIST_COMMITS_MAX_PAGE_TOKEN_BYTES = 2048;
const VERSION_OPERATION_PAGE_TOKEN_RE = /^mog-v[a-z0-9-]+-v[0-9]+\.[A-Za-z0-9_.:-]+$/;
const VERSION_LIST_COMMITS_DEFAULT_PAGE_SIZE = 50;
const VERSION_LIST_COMMITS_MAX_PAGE_SIZE = 500;
const VERSION_LIST_COMMITS_OPTION_KEYS = new Set([
  'ref',
  'from',
  'pageSize',
  'pageToken',
  'includeOrphans',
  'includeDiagnostics',
]);

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

type AttachedListCommitsOptions = {
  readonly ref?: VersionRefSelector;
  readonly from?: WorkbookCommitId;
  readonly pageSize?: number;
  readonly pageToken?: VersionPageToken;
};

type AttachedVersionListCommitsService = {
  listCommits?: (options?: AttachedListCommitsOptions) => MaybePromise<unknown>;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

export async function listWorkbookVersionCommits(
  ctx: DocumentContext,
  options: VersionListCommitsOptions = {},
): Promise<VersionResult<Paged<WorkbookCommitSummary>>> {
  const optionDiagnostics = validateListCommitsOptions(options);
  const limit = normalizedLimit(options);
  if (optionDiagnostics.length > 0) {
    return versionResultFromCommitPage(degradedCommitPage(optionDiagnostics), limit);
  }

  const readService = getAttachedListCommitsService(ctx);
  if (!readService?.listCommits) {
    return versionResultFromCommitPage(degradedCommitPage([serviceUnavailableDiagnostic()]), limit);
  }

  const pageToken = options.pageToken === undefined ? undefined : toPageToken(options.pageToken);
  try {
    const result = await readService.listCommits({
      ...(options.ref === undefined ? {} : { ref: options.ref }),
      ...(options.from === undefined ? {} : { from: options.from }),
      ...(options.pageSize === undefined ? {} : { pageSize: options.pageSize }),
      ...(pageToken === undefined ? {} : { pageToken }),
    });
    return versionResultFromCommitPage(
      mapCommitPageResult(result, {
        requestedRootCommitId: options.from,
        isFollowUpPage: pageToken !== undefined,
      }),
      limit,
    );
  } catch {
    return versionResultFromCommitPage(degradedCommitPage([providerErrorDiagnostic()]), limit);
  }
}

function getAttachedListCommitsService(
  ctx: DocumentContext,
): AttachedVersionListCommitsService | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return null;

  for (const candidate of [
    services.graphStore,
    services.graphService,
    services.graph,
    services.readService,
    services.headService,
    services,
  ]) {
    const readService = toListCommitsService(candidate);
    if (readService) return readService;
  }

  return null;
}

function toListCommitsService(value: unknown): AttachedVersionListCommitsService | null {
  const listCommits = bindMethod(value, 'listCommits');
  return listCommits ? { listCommits: (options) => listCommits(options) } : null;
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function validateListCommitsOptions(
  options: VersionListCommitsOptions,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!isRecord(options) || Array.isArray(options)) {
    return [
      publicDiagnostic(
        'VERSION_INVALID_OPTIONS',
        'listCommits options must be an object when supplied.',
        { severity: 'error', recoverability: 'none', payload: { option: 'options' } },
      ),
    ];
  }

  for (const key of Object.keys(options)) {
    if (!VERSION_LIST_COMMITS_OPTION_KEYS.has(key)) {
      diagnostics.push(
        publicDiagnostic('VERSION_INVALID_OPTIONS', 'listCommits received an unsupported option.', {
          severity: 'error',
          recoverability: 'none',
          payload: { option: key },
        }),
      );
    }
  }

  const pageSizeValue: unknown = options.pageSize ?? VERSION_LIST_COMMITS_DEFAULT_PAGE_SIZE;
  if (
    typeof pageSizeValue !== 'number' ||
    !Number.isInteger(pageSizeValue) ||
    pageSizeValue < 1 ||
    pageSizeValue > VERSION_LIST_COMMITS_MAX_PAGE_SIZE
  ) {
    diagnostics.push(
      publicDiagnostic(
        'VERSION_INVALID_OPTIONS',
        'listCommits pageSize must be an integer from 1 through 500.',
        {
          severity: 'error',
          recoverability: 'none',
          payload: {
            option: 'pageSize',
            min: 1,
            max: VERSION_LIST_COMMITS_MAX_PAGE_SIZE,
            receivedPageSize: formatPrimitiveForPayload(pageSizeValue),
          },
        },
      ),
    );
  }

  if (options.pageToken !== undefined) {
    const pageToken = classifyPageToken(options.pageToken);
    if (pageToken.kind !== 'valid') {
      diagnostics.push(
        publicDiagnostic(
          pageToken.kind === 'stale' ? 'VERSION_STALE_PAGE_CURSOR' : 'VERSION_INVALID_OPTIONS',
          pageToken.safeMessage,
          {
            severity: 'error',
            recoverability: pageToken.kind === 'stale' ? 'retry' : 'none',
            payload: { option: 'pageToken', ...pageToken.payload },
          },
        ),
      );
    }
  }

  if (options.ref !== undefined && options.from !== undefined) {
    diagnostics.push(
      publicDiagnostic(
        'VERSION_INVALID_OPTIONS',
        'listCommits accepts either ref or from, not both.',
        { severity: 'error', recoverability: 'none', payload: { option: 'ref' } },
      ),
    );
  }

  if (options.ref !== undefined) diagnostics.push(...validateListCommitsRef(options.ref));

  if (options.from !== undefined && !toCommitId(options.from)) {
    diagnostics.push(
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_ID',
        'listCommits from must be commit:sha256:<64 lowercase hex>.',
        { severity: 'error', recoverability: 'none', payload: { option: 'from' } },
      ),
    );
  }

  if (options.includeOrphans !== undefined && typeof options.includeOrphans !== 'boolean') {
    diagnostics.push(
      publicDiagnostic(
        'VERSION_INVALID_OPTIONS',
        'listCommits includeOrphans must be a boolean when supplied.',
        { severity: 'error', recoverability: 'none', payload: { option: 'includeOrphans' } },
      ),
    );
  } else if (options.includeOrphans === true) {
    diagnostics.push(
      publicDiagnostic(
        'VERSION_PERMISSION_DENIED',
        'Orphan commit listing requires diagnostics support that is not exposed by this slice.',
        {
          severity: 'error',
          recoverability: 'unsupported',
          payload: { option: 'includeOrphans' },
        },
      ),
    );
  }

  if (options.includeDiagnostics !== undefined && typeof options.includeDiagnostics !== 'boolean') {
    diagnostics.push(
      publicDiagnostic(
        'VERSION_INVALID_OPTIONS',
        'listCommits includeDiagnostics must be a boolean when supplied.',
        {
          severity: 'error',
          recoverability: 'none',
          payload: { option: 'includeDiagnostics' },
        },
      ),
    );
  }

  return diagnostics;
}

function validateListCommitsRef(ref: unknown): readonly VersionStoreDiagnostic[] {
  if (ref === VERSION_HEAD_REF) return [];
  if (ref === VERSION_MAIN_REF) return [];
  if (typeof ref !== 'string' || !ref.startsWith('refs/heads/')) {
    return [
      publicDiagnostic(
        'VERSION_INVALID_OPTIONS',
        'listCommits ref must be HEAD or refs/heads/<public branch>.',
        {
          severity: 'error',
          recoverability: 'none',
          payload: { option: 'ref', refName: 'redacted' },
        },
      ),
    ];
  }

  const parsed = validateRefName(ref.slice('refs/heads/'.length));
  if (parsed.ok) return [];
  return parsed.diagnostics.map((item) =>
    publicDiagnostic('VERSION_INVALID_OPTIONS', 'listCommits ref must be public-safe.', {
      severity: 'error',
      recoverability: 'none',
      payload: { option: 'ref', refName: 'redacted', issue: item.issue },
    }),
  );
}

function mapCommitPageResult(
  value: unknown,
  context: {
    readonly requestedRootCommitId?: WorkbookCommitId;
    readonly isFollowUpPage: boolean;
  },
): VersionCommitPage {
  if (!isRecord(value)) {
    return degradedCommitPage([providerErrorDiagnostic()]);
  }

  if (value.status === 'failed' || value.status === 'degraded') {
    return degradedCommitPage(mapGraphDiagnostics(value.diagnostics));
  }

  if (value.status !== 'success') {
    return degradedCommitPage([providerErrorDiagnostic()]);
  }

  const readRevision = toRevision(value.readRevision);
  const sourceItems = Array.isArray(value.commits)
    ? value.commits
    : Array.isArray(value.items)
      ? value.items
      : null;

  if (!readRevision || !sourceItems) {
    return degradedCommitPage([
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_PAYLOAD',
        'The version graph commit page did not contain a valid public page shape.',
        { severity: 'error', recoverability: 'repair' },
      ),
    ]);
  }

  const { items, diagnostics } = mapCommitSummaries(sourceItems);
  if (diagnostics.length > 0) {
    return {
      status: 'degraded',
      items,
      readRevision,
      order: 'topological-newest',
      diagnostics,
    };
  }

  const pageDiagnostics = validateCommitPageOrder(items, context);
  if (pageDiagnostics.length > 0) {
    return {
      status: 'degraded',
      items: [],
      readRevision,
      order: 'topological-newest',
      diagnostics: pageDiagnostics,
    };
  }

  const nextPageToken =
    value.nextPageToken === undefined ? undefined : toPageToken(value.nextPageToken);
  if (value.nextPageToken !== undefined && !nextPageToken) {
    return {
      status: 'degraded',
      items: [],
      readRevision,
      order: 'topological-newest',
      diagnostics: [
        publicDiagnostic(
          'VERSION_INVALID_COMMIT_PAYLOAD',
          'The version graph returned a malformed listCommits page cursor.',
          {
            severity: 'error',
            recoverability: 'repair',
            payload: { option: 'pageToken', cursorMalformed: true },
          },
        ),
      ],
    };
  }

  return {
    status: 'success',
    items,
    ...(nextPageToken ? { nextPageToken } : {}),
    readRevision,
    order: 'topological-newest',
    diagnostics: [],
  };
}

function validateCommitPageOrder(
  items: readonly WorkbookCommitSummary[],
  context: {
    readonly requestedRootCommitId?: WorkbookCommitId;
    readonly isFollowUpPage: boolean;
  },
): readonly VersionStoreDiagnostic[] {
  if (items.length === 0) return [];

  if (
    context.requestedRootCommitId !== undefined &&
    !context.isFollowUpPage &&
    items[0]?.id !== context.requestedRootCommitId
  ) {
    return [
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_PAYLOAD',
        'The version graph did not start listCommits at the requested commit root.',
        {
          severity: 'error',
          recoverability: 'repair',
          payload: { rootMismatch: true },
        },
      ),
    ];
  }

  const indexByCommitId = new Map<WorkbookCommitId, number>();
  for (const [index, item] of items.entries()) {
    const previousIndex = indexByCommitId.get(item.id);
    if (previousIndex !== undefined) {
      return [
        publicDiagnostic(
          'VERSION_INVALID_COMMIT_PAYLOAD',
          'The version graph returned duplicate commits in one listCommits page.',
          {
            severity: 'error',
            recoverability: 'repair',
            payload: { itemIndex: index, duplicateOfItemIndex: previousIndex },
          },
        ),
      ];
    }
    indexByCommitId.set(item.id, index);
  }

  const reachableFromEarlierItems = new Set<WorkbookCommitId>();
  for (const [index, item] of items.entries()) {
    if (!context.isFollowUpPage && index > 0 && !reachableFromEarlierItems.has(item.id)) {
      return [
        publicDiagnostic(
          'VERSION_INVALID_COMMIT_PAYLOAD',
          'The version graph returned a commit outside the first-page root traversal.',
          {
            severity: 'error',
            recoverability: 'repair',
            payload: { itemIndex: index, rootTraversal: false },
          },
        ),
      ];
    }

    for (const parentId of item.parents) {
      const parentIndex = indexByCommitId.get(parentId);
      if (parentIndex !== undefined && parentIndex <= index) {
        return [
          publicDiagnostic(
            'VERSION_INVALID_COMMIT_PAYLOAD',
            'The version graph returned a parent before its reachable child.',
            {
              severity: 'error',
              recoverability: 'repair',
              payload: { itemIndex: index, parentItemIndex: parentIndex },
            },
          ),
        ];
      }
      reachableFromEarlierItems.add(parentId);
    }
  }

  return [];
}

function mapCommitSummaries(values: readonly unknown[]): {
  readonly items: readonly WorkbookCommitSummary[];
  readonly diagnostics: readonly VersionStoreDiagnostic[];
} {
  const items: WorkbookCommitSummary[] = [];
  const diagnostics: VersionStoreDiagnostic[] = [];

  values.forEach((value, index) => {
    const summary = mapCommitSummary(value);
    if (summary) {
      items.push(summary);
      return;
    }

    diagnostics.push(
      publicDiagnostic(
        'VERSION_INVALID_COMMIT_PAYLOAD',
        'A version graph commit summary could not be safely projected.',
        {
          severity: 'error',
          recoverability: 'repair',
          payload: { itemIndex: index },
        },
      ),
    );
  });

  return { items, diagnostics };
}

function mapCommitSummary(value: unknown): WorkbookCommitSummary | null {
  if (!isRecord(value)) return null;

  const id = toCommitId(value.id);
  if (!id || typeof value.createdAt !== 'string') return null;

  const parents = Array.isArray(value.parents)
    ? value.parents.map(toCommitId).filter((parent): parent is WorkbookCommitId => Boolean(parent))
    : null;
  if (!parents || parents.length !== (value.parents as readonly unknown[]).length) return null;

  return {
    id,
    parents,
    createdAt: value.createdAt,
    author: redactAuthor(value.author),
  };
}

function redactAuthor(value: unknown): RedactedVersionAuthor {
  if (!isRecord(value)) return { redacted: true };
  return {
    ...(typeof value.actorKind === 'string' ? { actorKind: value.actorKind } : {}),
    ...(typeof value.displayName === 'string' ? { displayName: value.displayName } : {}),
    redacted: true,
  };
}

function mapGraphDiagnostics(value: unknown): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [graphUninitializedDiagnostic()];
  }

  return value.map(mapGraphDiagnostic);
}

function mapGraphDiagnostic(value: unknown): VersionStoreDiagnostic {
  if (!isRecord(value)) {
    return providerErrorDiagnostic();
  }

  const issueCode =
    typeof value.issueCode === 'string'
      ? value.issueCode
      : typeof value.code === 'string'
        ? value.code
        : 'VERSION_PROVIDER_ERROR';
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

function sanitizeDiagnosticPayload(
  value: Readonly<Record<string, unknown>>,
): VersionDiagnosticPublicPayload {
  const payload: Record<string, string | number | boolean | null> = { operation: 'listCommits' };

  if (typeof value.operation === 'string') payload.operation = value.operation;
  if (typeof value.option === 'string') payload.option = value.option;
  const refName = value.refName;
  if (refName === VERSION_HEAD_REF || refName === VERSION_MAIN_REF) {
    payload.refName = refName;
  }

  const details = isRecord(value.details) ? value.details : null;
  if (details) {
    for (const key of [
      'category',
      'commitCount',
      'cursorMalformed',
      'cursorRootMismatch',
      'cursorRevisionMismatch',
      'duplicateOfItemIndex',
      'itemIndex',
      'min',
      'max',
      'orderedCommitCount',
      'parentItemIndex',
      'pageSize',
      'receivedPageSize',
      'refMissing',
      'rootKind',
      'rootMissing',
      'rootMismatch',
      'rootTraversal',
      'pageTokenUnsupported',
      'reachableCommitCount',
      'receivedCursorBytes',
    ] as const) {
      const detailValue = details[key];
      if (isPayloadPrimitive(detailValue)) payload[key] = detailValue;
    }
  }

  return payload;
}

function serviceUnavailableDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_GRAPH_UNINITIALIZED',
    'No document-scoped version graph read service is attached; no commit history is fabricated.',
    {
      severity: 'warning',
      recoverability: 'unsupported',
    },
  );
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

function providerErrorDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PROVIDER_ERROR',
    'The version graph read service failed before returning a usable public result.',
    {
      severity: 'error',
      recoverability: 'retry',
    },
  );
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
    messageTemplateId: `version.listCommits.${issueCode}`,
    safeMessage,
    ...(options.payload ? { payload: options.payload } : {}),
    redacted: true,
  };
}

function safeMessageForIssue(issueCode: string): string {
  switch (issueCode) {
    case 'VERSION_GRAPH_UNINITIALIZED':
      return 'The workbook version graph is not initialized for this document.';
    case 'VERSION_STALE_PAGE_CURSOR':
      return 'The version page token is stale or unsupported by this read slice.';
    case 'VERSION_UNSUPPORTED_PAGE_TOKEN':
      return 'The version graph cannot serve a follow-up page token in this slice.';
    case 'VERSION_INVALID_OPTIONS':
      return 'The version read options are invalid for this method.';
    case 'VERSION_PERMISSION_DENIED':
      return 'The requested version read is not exposed by this public slice.';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_OBJECT_STORE_FAILURE':
      return 'The version graph could not validate the requested commit closure.';
    case 'VERSION_REF_CONFLICT':
      return 'The version ref changed while the read was in progress.';
    default:
      return 'The version graph could not complete listCommits.';
  }
}

function recoverabilityForIssue(issueCode: string): VersionStoreDiagnostic['recoverability'] {
  switch (issueCode) {
    case 'VERSION_STALE_PAGE_CURSOR':
    case 'VERSION_REF_CONFLICT':
      return 'retry';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_OBJECT_STORE_FAILURE':
      return 'repair';
    case 'VERSION_GRAPH_UNINITIALIZED':
    case 'VERSION_UNSUPPORTED_PAGE_TOKEN':
    case 'VERSION_PERMISSION_DENIED':
      return 'unsupported';
    default:
      return 'none';
  }
}

function degradedCommitPage(diagnostics: readonly VersionStoreDiagnostic[]): VersionCommitPage {
  return {
    status: 'degraded',
    items: [],
    order: 'topological-newest',
    diagnostics,
  };
}

function normalizedLimit(options: VersionListCommitsOptions): number {
  return isRecord(options) && Number.isInteger(options.pageSize)
    ? (options.pageSize as number)
    : VERSION_LIST_COMMITS_DEFAULT_PAGE_SIZE;
}

function toCommitId(value: unknown): WorkbookCommitId | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : null;
}

function toPageToken(value: unknown): VersionPageToken | undefined {
  return classifyPageToken(value).kind === 'valid' ? (value as VersionPageToken) : undefined;
}

function classifyPageToken(value: unknown):
  | { readonly kind: 'valid' }
  | {
      readonly kind: 'invalid' | 'stale';
      readonly safeMessage: string;
      readonly payload: VersionDiagnosticPublicPayload;
    } {
  if (typeof value !== 'string') {
    return {
      kind: 'invalid',
      safeMessage: 'listCommits pageToken is malformed or unsupported.',
      payload: { category: 'malformedCursor' },
    };
  }

  if (value.length > VERSION_LIST_COMMITS_MAX_PAGE_TOKEN_BYTES) {
    return {
      kind: 'invalid',
      safeMessage: 'listCommits pageToken exceeds the public cursor size limit.',
      payload: {
        category: 'oversizedCursor',
        max: VERSION_LIST_COMMITS_MAX_PAGE_TOKEN_BYTES,
        receivedCursorBytes: value.length,
      },
    };
  }

  if (
    value.length > VERSION_LIST_COMMITS_PAGE_TOKEN_PREFIX.length &&
    value.startsWith(VERSION_LIST_COMMITS_PAGE_TOKEN_PREFIX) &&
    VERSION_LIST_COMMITS_PAGE_TOKEN_RE.test(
      value.slice(VERSION_LIST_COMMITS_PAGE_TOKEN_PREFIX.length),
    )
  ) {
    return { kind: 'valid' };
  }

  if (VERSION_OPERATION_PAGE_TOKEN_RE.test(value)) {
    return {
      kind: 'stale',
      safeMessage: 'listCommits pageToken belongs to a different version read operation.',
      payload: { category: 'wrongOperationCursor' },
    };
  }

  return {
    kind: 'invalid',
    safeMessage: 'listCommits pageToken is malformed or unsupported.',
    payload: { category: 'malformedCursor' },
  };
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
