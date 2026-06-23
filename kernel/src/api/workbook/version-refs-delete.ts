import type {
  VersionDeleteRefOptions,
  VersionRecordRevision,
  VersionRef,
  VersionRefMutationResult,
  VersionRefName,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { DocumentContext } from '../../context';
import { validateRefName } from '../../document/version-store/ref-name';
import {
  mapVersionRefLifecycleDiagnostic,
  mapVersionRefProviderExceptionDiagnostics,
  toVersionRefRecordRevision,
} from './version-refs-diagnostics';
import {
  recoverabilityForBranchIssue,
  safeBranchDiagnosticToken,
  safeMessageForBranchIssue,
} from './version-ref-diagnostics';

const VERSION_HEAD_REF = 'HEAD';
const VERSION_MAIN_REF = 'refs/heads/main';
const VERSION_BRANCH_REF_PREFIX = 'refs/heads/';
const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const REF_COUNTER_REVISION_VALUE_RE = /^(0|[1-9][0-9]*)$/;

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;
type DeleteRefOperation = 'deleteBranch' | 'deleteRef';

type DeleteCapableVersionRefLifecycleService = {
  deleteBranch?: (input: Readonly<Record<string, unknown>>) => MaybePromise<unknown>;
  readBranch?: (input: Readonly<Record<string, unknown>>) => MaybePromise<unknown>;
  listBranches?: (input?: Readonly<Record<string, unknown>>) => MaybePromise<unknown>;
  readRef?: (name: string) => MaybePromise<unknown>;
  getHead?: () => MaybePromise<unknown>;
  readHead?: () => MaybePromise<unknown>;
  readActiveCheckoutSession?: () => MaybePromise<unknown>;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

type ParsedDeleteRefOptions =
  | {
      readonly ok: true;
      readonly branchName: string;
      readonly expectedHead?: WorkbookCommitId;
      readonly expectedRefVersion: VersionRecordRevision;
      readonly refName: VersionRef['name'];
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

type DeletePreflightRef =
  | {
      readonly status: 'checked';
      readonly commitId: WorkbookCommitId;
      readonly revision: VersionRecordRevision;
      readonly protected: boolean;
    }
  | { readonly status: 'missing'; readonly diagnostics: readonly VersionStoreDiagnostic[] }
  | { readonly status: 'unchecked' };

export async function deleteWorkbookVersionBranchRef(input: {
  readonly ctx: DocumentContext;
  readonly options: VersionDeleteRefOptions;
  readonly operation: DeleteRefOperation;
  readonly author: VersionAuthor;
}): Promise<VersionRefMutationResult> {
  const validated = validateDeleteRefOptions(input.options, input.operation);
  if (!validated.ok) return degradedMutation(null, validated.diagnostics);

  if (validated.branchName === 'main') {
    return degradedMutation(null, [protectedMainDiagnostic(input.operation)]);
  }

  const service = getDeleteCapableVersionRefLifecycleService(input.ctx);
  if (!service?.deleteBranch) {
    return degradedMutation(null, [deleteUnsupportedDiagnostic(input.operation)]);
  }

  const preflightDiagnostics = await preflightDeleteRef(
    input.ctx,
    service,
    validated,
    input.operation,
  );
  if (preflightDiagnostics.length > 0) {
    return degradedMutation(null, preflightDiagnostics);
  }

  try {
    return mapBranchMutationResult(
      await service.deleteBranch({
        name: validated.branchName,
        ...(validated.expectedHead ? { expectedHead: validated.expectedHead } : {}),
        expectedRefVersion: validated.expectedRefVersion,
        deletedBy: input.author,
      }),
      input.operation,
    );
  } catch (error) {
    return degradedMutation(null, providerExceptionDiagnostics(error, input.operation));
  }
}

function getDeleteCapableVersionRefLifecycleService(
  ctx: DocumentContext,
): DeleteCapableVersionRefLifecycleService | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return null;

  for (const candidate of [
    services.refLifecycleService,
    services.branchService,
    services.branchRefService,
    services.versionRefService,
    services.publicRefService,
    services.refService,
    services,
  ]) {
    const refService = toDeleteCapableVersionRefLifecycleService(candidate);
    if (refService) return refService;
  }

  return null;
}

function toDeleteCapableVersionRefLifecycleService(
  value: unknown,
): DeleteCapableVersionRefLifecycleService | null {
  const deleteBranch = bindMethod(value, 'deleteBranch') ?? bindMethod(value, 'deleteRef');
  if (!deleteBranch) return null;
  const readBranch = bindMethod(value, 'readBranch');
  const listBranches = bindMethod(value, 'listBranches');
  const readRef = bindMethod(value, 'readRef');
  const getHead = bindMethod(value, 'getHead');
  const readHead = bindMethod(value, 'readHead');
  const readActiveCheckoutSession = bindMethod(value, 'readActiveCheckoutSession');
  return {
    deleteBranch: (input) => deleteBranch(input),
    ...(readBranch ? { readBranch: (input) => readBranch(input) } : {}),
    ...(listBranches ? { listBranches: (input) => listBranches(input) } : {}),
    ...(readRef ? { readRef: (name) => readRef(name) } : {}),
    ...(getHead ? { getHead: () => getHead() } : {}),
    ...(readHead ? { readHead: () => readHead() } : {}),
    ...(readActiveCheckoutSession
      ? { readActiveCheckoutSession: () => readActiveCheckoutSession() }
      : {}),
  };
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function validateDeleteRefOptions(
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

async function preflightDeleteRef(
  ctx: DocumentContext,
  service: DeleteCapableVersionRefLifecycleService,
  input: Extract<ParsedDeleteRefOptions, { readonly ok: true }>,
  operation: DeleteRefOperation,
): Promise<readonly VersionStoreDiagnostic[]> {
  const activeDiagnostics = await activeRefDeleteDiagnostics(ctx, service, input, operation);
  if (activeDiagnostics.length > 0) return activeDiagnostics;

  const ref = await readDeletePreflightRef(service, input, operation);
  if (ref.status === 'missing') return ref.diagnostics;
  if (ref.status !== 'checked') return [];

  if (ref.protected) return [protectedRefDiagnostic(operation)];

  if (input.expectedHead && input.expectedHead !== ref.commitId) {
    return [
      staleDeleteRefDiagnostic(operation, 'expectedHeadMismatch', {
        commitId: ref.commitId,
        revision: ref.revision,
      }),
    ];
  }
  if (!revisionsEqual(input.expectedRefVersion, ref.revision)) {
    return [
      staleDeleteRefDiagnostic(operation, 'expectedRefVersionMismatch', {
        commitId: ref.commitId,
        revision: ref.revision,
      }),
    ];
  }
  return lastLiveRefDeleteDiagnostics(service, input, operation);
}

async function lastLiveRefDeleteDiagnostics(
  service: DeleteCapableVersionRefLifecycleService,
  input: Extract<ParsedDeleteRefOptions, { readonly ok: true }>,
  operation: DeleteRefOperation,
): Promise<readonly VersionStoreDiagnostic[]> {
  if (!service.listBranches) return [];
  let value: unknown;
  try {
    value = await service.listBranches({});
  } catch {
    return [preflightReadFailedDiagnostic(operation, 'liveRefList')];
  }
  if (!isRecord(value)) return [preflightInvalidPayloadDiagnostic(operation)];
  if (value.ok === false) return mapPreflightBranchFailureDiagnostics(value.diagnostics, operation);
  const rawItems = Array.isArray(value.branches)
    ? value.branches
    : Array.isArray(value.items)
      ? value.items
      : Array.isArray(value.refs)
        ? value.refs
        : null;
  if (!rawItems) return [preflightInvalidPayloadDiagnostic(operation)];
  const liveRefs = rawItems.map(mapBranchRecord).filter((ref): ref is VersionRef => Boolean(ref));
  return liveRefs.length <= 1 && liveRefs.some((ref) => ref.name === input.refName)
    ? [lastLiveRefDiagnostic(operation)]
    : [];
}

async function activeRefDeleteDiagnostics(
  ctx: DocumentContext,
  service: DeleteCapableVersionRefLifecycleService,
  input: Extract<ParsedDeleteRefOptions, { readonly ok: true }>,
  operation: DeleteRefOperation,
): Promise<readonly VersionStoreDiagnostic[]> {
  const activeSessionReader = getActiveCheckoutSessionReader(ctx, service);
  if (activeSessionReader) {
    try {
      const activeRef = activeCheckoutSessionRefName(await activeSessionReader(), operation);
      if (activeRef.status === 'blocked') return activeRef.diagnostics;
      const activeRefName = activeRef.refName;
      if (activeRefName && activeRefName === input.refName) {
        return [activeRefDeleteDiagnostic(operation)];
      }
    } catch {
      return [preflightReadFailedDiagnostic(operation, 'activeCheckoutSession')];
    }
  }

  const headReader = service.getHead ?? service.readHead;
  if (!headReader) return [];
  try {
    const head = currentHeadRefName(await headReader(), operation);
    if (head.status === 'blocked') return head.diagnostics;
    const headRefName = head.refName;
    return headRefName === input.refName ? [activeRefDeleteDiagnostic(operation)] : [];
  } catch {
    return [preflightReadFailedDiagnostic(operation, 'currentHead')];
  }
}

async function readDeletePreflightRef(
  service: DeleteCapableVersionRefLifecycleService,
  input: Extract<ParsedDeleteRefOptions, { readonly ok: true }>,
  operation: DeleteRefOperation,
): Promise<DeletePreflightRef> {
  if (service.readBranch) {
    try {
      return projectBranchRead(await service.readBranch({ name: input.branchName }), operation);
    } catch {
      return { status: 'missing', diagnostics: [preflightReadFailedDiagnostic(operation, 'ref')] };
    }
  }
  if (service.readRef) {
    try {
      return projectRefRead(await service.readRef(input.refName), operation);
    } catch {
      return { status: 'missing', diagnostics: [preflightReadFailedDiagnostic(operation, 'ref')] };
    }
  }
  return { status: 'unchecked' };
}

function projectBranchRead(value: unknown, operation: DeleteRefOperation): DeletePreflightRef {
  if (!isRecord(value)) {
    return { status: 'missing', diagnostics: [preflightInvalidPayloadDiagnostic(operation)] };
  }
  if (value.ok === false) {
    return {
      status: 'missing',
      diagnostics: mapPreflightBranchFailureDiagnostics(value.diagnostics, operation),
    };
  }
  if (value.ok !== true) return projectRefRead(value, operation);
  if (value.branch === null) {
    return { status: 'missing', diagnostics: [danglingRefDiagnostic(operation)] };
  }
  const ref =
    isRecord(value.branch) && isRecord(value.branch.ref) ? value.branch.ref : value.branch;
  return projectLiveRefRecord(ref, operation);
}

function projectRefRead(value: unknown, operation: DeleteRefOperation): DeletePreflightRef {
  if (!isRecord(value)) {
    return { status: 'missing', diagnostics: [preflightInvalidPayloadDiagnostic(operation)] };
  }
  if (value.status === 'degraded' || value.status === 'failed') {
    return {
      status: 'missing',
      diagnostics: mapGraphFailureDiagnostics(value.diagnostics, operation),
    };
  }
  const ref =
    value.status === 'success' && isRecord(value.ref)
      ? value.ref
      : isRecord(value.ref)
        ? value.ref
        : value;
  return projectLiveRefRecord(ref, operation);
}

function projectLiveRefRecord(value: unknown, operation: DeleteRefOperation): DeletePreflightRef {
  if (!isRecord(value) || value.name === VERSION_HEAD_REF) {
    return { status: 'missing', diagnostics: [preflightInvalidPayloadDiagnostic(operation)] };
  }
  const commitId =
    toCommitId(value.targetCommitId) ??
    toCommitId(value.commitId) ??
    toCommitId(value.previousTargetCommitId);
  const revision = toVersionRefRecordRevision(value.refVersion, value.revision);
  if (!commitId || !revision) {
    return { status: 'missing', diagnostics: [preflightInvalidPayloadDiagnostic(operation)] };
  }
  return { status: 'checked', commitId, revision, protected: value.protected === true };
}

function getActiveCheckoutSessionReader(
  ctx: DocumentContext,
  service: DeleteCapableVersionRefLifecycleService,
): (() => MaybePromise<unknown>) | null {
  if (service.readActiveCheckoutSession) return service.readActiveCheckoutSession;
  const services = getAttachedVersionServices(ctx);
  if (!services) return null;
  for (const candidate of [
    services.surfaceStatusService,
    services.versionSurfaceStatusService,
    services.statusService,
    services,
  ]) {
    const reader = bindMethod(candidate, 'readActiveCheckoutSession');
    if (reader) return () => reader();
  }
  return null;
}

function getAttachedVersionServices(
  ctx: DocumentContext,
): Readonly<Record<string, unknown>> | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  return isRecord(services) ? services : null;
}

type ActiveRefProjection =
  | { readonly status: 'ok'; readonly refName: VersionRef['name'] | null }
  | { readonly status: 'blocked'; readonly diagnostics: readonly VersionStoreDiagnostic[] };
type ProviderReadProjection =
  | { readonly status: 'read'; readonly value: unknown }
  | { readonly status: 'blocked'; readonly diagnostics: readonly VersionStoreDiagnostic[] };

function activeCheckoutSessionRefName(
  value: unknown,
  operation: DeleteRefOperation,
): ActiveRefProjection {
  const session = unwrapProviderReadValue(value, operation, 'activeCheckoutSession');
  if (session.status === 'blocked') return session;
  if (
    !isRecord(session.value) ||
    session.value.detached === true ||
    typeof session.value.branchName !== 'string'
  ) {
    return { status: 'ok', refName: null };
  }
  const parsed = parsePublicBranchName(session.value.branchName, 'readRef');
  return { status: 'ok', refName: parsed.ok ? parsed.refName : null };
}

function currentHeadRefName(value: unknown, operation: DeleteRefOperation): ActiveRefProjection {
  const read = unwrapProviderReadValue(value, operation, 'currentHead');
  if (read.status === 'blocked') return read;
  if (!isRecord(read.value)) return { status: 'ok', refName: null };
  const head = isRecord(read.value.head)
    ? read.value.head
    : isRecord(read.value.ref)
      ? read.value.ref
      : read.value;
  if (head.mode === 'detached') return { status: 'ok', refName: null };
  const candidate =
    typeof head.refName === 'string'
      ? head.refName
      : typeof head.branchName === 'string'
        ? head.branchName
        : typeof head.target === 'string'
          ? head.target
          : undefined;
  if (!candidate) return { status: 'ok', refName: null };
  const parsed = parsePublicBranchName(candidate, 'readRef');
  return { status: 'ok', refName: parsed.ok ? parsed.refName : null };
}

function unwrapProviderReadValue(
  value: unknown,
  operation: DeleteRefOperation,
  phase: 'activeCheckoutSession' | 'currentHead',
): ProviderReadProjection {
  if (!isRecord(value)) return { status: 'read', value };
  if (value.status === 'pending') {
    return {
      status: 'blocked',
      diagnostics: [preflightReadFailedDiagnostic(operation, `${phase}Pending`)],
    };
  }
  if (value.status === 'failed' || value.status === 'degraded') {
    return {
      status: 'blocked',
      diagnostics: [preflightReadFailedDiagnostic(operation, `${phase}Failed`)],
    };
  }
  if (value.status === 'success') {
    return {
      status: 'read',
      value: isRecord(value.session)
        ? value.session
        : isRecord(value.current)
          ? value.current
          : isRecord(value.value)
            ? value.value
            : value,
    };
  }
  return { status: 'read', value };
}

function parsePublicBranchName(
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
      branchName === 'main' ? VERSION_MAIN_REF : (`refs/heads/${branchName}` as VersionRefName),
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

function mapBranchMutationResult(
  value: unknown,
  operation: DeleteRefOperation,
): VersionRefMutationResult {
  if (!isRecord(value)) return degradedMutation(null, [providerErrorDiagnostic(operation)]);
  if (value.ok === false) {
    return degradedMutation(null, mapBranchFailureDiagnostics(value.diagnostics, operation));
  }
  const ref = mapBranchRecord(value.branch ?? value.ref ?? value);
  if (!ref) return degradedMutation(null, [invalidPayloadDiagnostic(operation)]);
  return { status: 'success', ref, diagnostics: [] };
}

function mapBranchRecord(value: unknown): VersionRef | null {
  if (!isRecord(value)) return null;
  const ref = isRecord(value.ref) ? value.ref : value;
  const branchName =
    typeof value.name === 'string'
      ? value.name
      : typeof ref.name === 'string'
        ? ref.name
        : undefined;
  const commitId =
    toCommitId(ref.targetCommitId) ??
    toCommitId(ref.commitId) ??
    toCommitId(ref.previousTargetCommitId);
  const revision = toVersionRefRecordRevision(ref.refVersion, ref.revision);
  if (!branchName || !commitId || !revision) return null;
  const parsed = parsePublicBranchName(branchName, 'readRef');
  if (!parsed.ok) return null;
  return {
    name: parsed.refName,
    commitId,
    revision,
    ...(typeof ref.deletedAt === 'string'
      ? { updatedAt: ref.deletedAt }
      : typeof ref.updatedAt === 'string'
        ? { updatedAt: ref.updatedAt }
        : {}),
  };
}

function mapBranchFailureDiagnostics(
  value: unknown,
  operation: DeleteRefOperation,
): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [providerErrorDiagnostic(operation)];
  }
  return value.map((item) => mapBranchDiagnostic(item, operation));
}

function providerExceptionDiagnostics(
  error: unknown,
  operation: DeleteRefOperation,
): readonly VersionStoreDiagnostic[] {
  return (
    mapVersionRefProviderExceptionDiagnostics(
      error,
      operation,
      providerErrorDiagnostic(operation),
    ) ?? [providerErrorDiagnostic(operation)]
  );
}

function mapPreflightBranchFailureDiagnostics(
  value: unknown,
  operation: DeleteRefOperation,
): readonly VersionStoreDiagnostic[] {
  return mapBranchFailureDiagnostics(value, operation).map((diagnostic) =>
    diagnostic.mutationGuarantee
      ? diagnostic
      : { ...diagnostic, mutationGuarantee: 'no-write-attempted' as const },
  );
}

function mapGraphFailureDiagnostics(
  value: unknown,
  operation: DeleteRefOperation,
): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [preflightReadFailedDiagnostic(operation, 'ref')];
  }
  return value.map((item) => mapGraphDiagnostic(item, operation));
}

function mapBranchDiagnostic(
  value: unknown,
  operation: DeleteRefOperation,
): VersionStoreDiagnostic {
  return mapVersionRefLifecycleDiagnostic(value, operation, providerErrorDiagnostic(operation));
}

function mapGraphDiagnostic(value: unknown, operation: DeleteRefOperation): VersionStoreDiagnostic {
  if (!isRecord(value)) return preflightReadFailedDiagnostic(operation, 'ref');
  const rawCode =
    typeof value.issueCode === 'string'
      ? value.issueCode
      : typeof value.code === 'string'
        ? value.code
        : 'VERSION_PROVIDER_ERROR';
  const issueCode =
    rawCode === 'VERSION_PERMISSION_DENIED'
      ? 'VERSION_PERMISSION_DENIED'
      : rawCode === 'VERSION_REF_CONFLICT'
        ? 'VERSION_REF_CONFLICT'
        : rawCode === 'VERSION_INVALID_COMMIT_ID'
          ? 'VERSION_INVALID_COMMIT_ID'
          : rawCode === 'VERSION_INVALID_OPTIONS' || rawCode === 'VERSION_DANGLING_REF'
            ? 'VERSION_DANGLING_REF'
            : 'VERSION_PROVIDER_ERROR';
  return publicDiagnostic(issueCode, operation, safeMessageForBranchIssue(issueCode, operation), {
    severity: value.severity === 'warning' || value.severity === 'info' ? value.severity : 'error',
    recoverability: recoverabilityForBranchIssue(issueCode),
    payload: { operation },
    mutationGuarantee: 'no-write-attempted',
  });
}

function deleteUnsupportedDiagnostic(operation: DeleteRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_REF_WRITE_UNAVAILABLE',
    operation,
    'Public ref deletion is unsupported until a document-scoped tombstone-safe branch service is attached.',
    {
      severity: 'warning',
      recoverability: 'unsupported',
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

function activeRefDeleteDiagnostic(operation: DeleteRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_REF_WRITE_UNAVAILABLE',
    operation,
    'The active public ref cannot be deleted before switching the workbook to another ref.',
    {
      severity: 'error',
      recoverability: 'unsupported',
      payload: { operation, issue: safeBranchDiagnosticToken('issue', 'activeBranchDelete') },
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

function lastLiveRefDiagnostic(operation: DeleteRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_REF_WRITE_UNAVAILABLE',
    operation,
    'The last live public ref cannot be deleted through this public lifecycle facade.',
    {
      severity: 'error',
      recoverability: 'unsupported',
      payload: { operation, issue: 'lastLiveRef' },
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

function staleDeleteRefDiagnostic(
  operation: DeleteRefOperation,
  conflict: 'expectedHeadMismatch' | 'expectedRefVersionMismatch',
  actual: {
    readonly commitId: WorkbookCommitId;
    readonly revision: VersionRecordRevision;
  },
): VersionStoreDiagnostic {
  const payload: Record<string, string | number | boolean | null> = {
    operation,
    actualHead: actual.commitId,
    conflict: safeBranchDiagnosticToken('conflict', conflict),
  };
  const actualRefRevision = publicRevisionToken(actual.revision);
  if (actualRefRevision) payload.actualRefRevision = actualRefRevision;
  return publicDiagnostic(
    'VERSION_REF_CONFLICT',
    operation,
    safeMessageForBranchIssue('VERSION_REF_CONFLICT', operation),
    {
      severity: 'error',
      recoverability: 'retry',
      payload,
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

function danglingRefDiagnostic(operation: DeleteRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_DANGLING_REF',
    operation,
    safeMessageForBranchIssue('VERSION_DANGLING_REF', operation),
    {
      severity: 'error',
      recoverability: 'unsupported',
      payload: { operation },
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

function preflightReadFailedDiagnostic(
  operation: DeleteRefOperation,
  phase: string,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PROVIDER_ERROR',
    operation,
    'The version ref lifecycle service failed during delete preflight.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload: { operation, phase },
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

function preflightInvalidPayloadDiagnostic(operation: DeleteRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_INVALID_COMMIT_PAYLOAD',
    operation,
    'The version ref lifecycle service returned an invalid public ref payload.',
    {
      severity: 'error',
      recoverability: 'repair',
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

function protectedMainDiagnostic(operation: DeleteRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PERMISSION_DENIED',
    operation,
    'The protected main branch cannot be mutated through this public lifecycle facade.',
    {
      severity: 'error',
      recoverability: 'unsupported',
      payload: { refName: VERSION_MAIN_REF },
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

function protectedRefDiagnostic(operation: DeleteRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PERMISSION_DENIED',
    operation,
    'The requested public ref is protected and cannot be deleted.',
    {
      severity: 'error',
      recoverability: 'unsupported',
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

function invalidRefNameDiagnostic(
  operation: DeleteRefOperation | 'readRef',
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_INVALID_OPTIONS',
    operation,
    'The supplied VC-05 ref name is not public-safe.',
    {
      severity: 'error',
      recoverability: 'none',
      payload: { refName: 'redacted' },
      ...(isDeleteOperation(operation) ? { mutationGuarantee: 'no-write-attempted' as const } : {}),
    },
  );
}

function invalidCommitDiagnostic(
  operation: DeleteRefOperation,
  option: string,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_INVALID_COMMIT_ID',
    operation,
    'The supplied commit id is invalid.',
    {
      severity: 'error',
      recoverability: 'none',
      payload: { option },
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

function invalidOptionsDiagnostic(
  operation: DeleteRefOperation,
  option: string,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_INVALID_OPTIONS',
    operation,
    'The version ref lifecycle options are invalid for this method.',
    {
      severity: 'error',
      recoverability: 'none',
      payload: { option },
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

function invalidPayloadDiagnostic(operation: DeleteRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_INVALID_COMMIT_PAYLOAD',
    operation,
    'The version ref lifecycle service returned an invalid public ref payload.',
    { severity: 'error', recoverability: 'repair' },
  );
}

function providerErrorDiagnostic(operation: DeleteRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PROVIDER_ERROR',
    operation,
    'The version ref lifecycle service failed before returning a usable public result.',
    { severity: 'error', recoverability: 'retry' },
  );
}

function publicDiagnostic(
  issueCode: string,
  operation: DeleteRefOperation | 'readRef',
  safeMessage: string,
  options: {
    readonly severity?: VersionStoreDiagnostic['severity'];
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly payload?: Readonly<Record<string, string | number | boolean | null>>;
    readonly mutationGuarantee?: VersionStoreDiagnostic['mutationGuarantee'];
  } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: options.severity ?? 'error',
    recoverability: options.recoverability ?? recoverabilityForBranchIssue(issueCode),
    messageTemplateId: `version.${operation}.${issueCode}`,
    safeMessage,
    ...(options.payload ? { payload: options.payload } : {}),
    redacted: true,
    ...(options.mutationGuarantee ? { mutationGuarantee: options.mutationGuarantee } : {}),
  };
}

function toCommitId(value: unknown): WorkbookCommitId | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : null;
}

function toRevision(value: unknown): VersionRecordRevision | undefined {
  if (
    isRecord(value) &&
    value.kind === 'counter' &&
    typeof value.value === 'string' &&
    REF_COUNTER_REVISION_VALUE_RE.test(value.value)
  ) {
    return { kind: 'counter', value: value.value };
  }
  if (
    isRecord(value) &&
    value.kind === 'opaque' &&
    typeof value.value === 'string' &&
    value.value.length > 0
  ) {
    return { kind: 'opaque', value: value.value };
  }
  return undefined;
}

function toCounterRevision(
  value: unknown,
): Extract<VersionRecordRevision, { readonly kind: 'counter' }> | undefined {
  const revision = toRevision(value);
  return revision?.kind === 'counter' ? revision : undefined;
}

function publicRevisionToken(value: VersionRecordRevision): string | undefined {
  return value.kind === 'counter' ? `rv:n:${value.value}` : undefined;
}

function revisionsEqual(left: VersionRecordRevision, right: VersionRecordRevision): boolean {
  return left.kind === right.kind && left.value === right.value;
}

function degradedMutation(
  ref: VersionRef | null,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionRefMutationResult {
  return { status: 'degraded', ref, diagnostics };
}

function isDeleteOperation(value: string): value is DeleteRefOperation {
  return value === 'deleteBranch' || value === 'deleteRef';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
