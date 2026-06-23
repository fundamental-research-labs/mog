import type {
  VersionBranchName,
  VersionBranchRefReadResult,
  VersionCreateBranchOptions,
  VersionDeleteRefOptions,
  VersionDiagnosticPublicPayload,
  VersionFastForwardBranchOptions,
  VersionListRefsOptions,
  VersionMainRefName,
  VersionRecordRevision,
  VersionRef,
  VersionRefListResult,
  VersionRefMutationResult,
  VersionRefName,
  VersionRefReadResult,
  VersionRefSelector,
  VersionStoreDiagnostic,
  VersionSymbolicRef,
  VersionSymbolicRefReadResult,
  VersionUpdateBranchOptions,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';
import type { VersionAuthor } from '@mog-sdk/contracts/versioning';

import type { DocumentContext } from '../../context';
import {
  REF_NAMESPACES,
  validateRefName,
  type RefNamespace,
} from '../../document/version-store/ref-name';
import { validateVersionOperationGate } from './version-operation-gate';
import { deleteWorkbookVersionBranchRef } from './version-refs-delete';
import {
  branchDiagnosticMutationGuarantee,
  issueCodeForBranchDiagnostic,
  recoverabilityForBranchIssue,
  safeBranchDiagnosticToken,
  safeMessageForBranchIssue,
} from './version-ref-diagnostics';

const VERSION_HEAD_REF = 'HEAD';
const VERSION_MAIN_REF = 'refs/heads/main' satisfies VersionMainRefName;
const VERSION_BRANCH_REF_PREFIX = 'refs/heads/';
const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const REF_NAMESPACE_SET = new Set<string>(REF_NAMESPACES);
const VERSION_REF_OPERATION_AUTHOR: VersionAuthor = Object.freeze({
  authorId: 'public-version-ref-facade',
  actorKind: 'system',
  displayName: 'Public version ref facade',
});

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;
type VersionRefOperation =
  | 'createBranch'
  | 'deleteBranch'
  | 'deleteRef'
  | 'fastForwardBranch'
  | 'getRef'
  | 'listRefs'
  | 'readRef'
  | 'updateBranch';

type AttachedVersionRefLifecycleService = {
  createBranch?: (input: Readonly<Record<string, unknown>>) => MaybePromise<unknown>;
  getHead?: () => MaybePromise<unknown>;
  readBranch?: (input: Readonly<Record<string, unknown>> | string) => MaybePromise<unknown>;
  listBranches?: (input?: Readonly<Record<string, unknown>>) => MaybePromise<unknown>;
  fastForwardBranch?: (input: Readonly<Record<string, unknown>>) => MaybePromise<unknown>;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

type ParsedBranchName =
  | {
      readonly ok: true;
      readonly branchName: string;
      readonly refName: VersionMainRefName | VersionRefName;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

type ParsedRefPrefix =
  | {
      readonly ok: true;
      readonly namespace?: RefNamespace;
      readonly includeMain: boolean;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export function hasAttachedVersionRefLifecycleService(ctx: DocumentContext): boolean {
  return Boolean(getAttachedVersionRefLifecycleService(ctx));
}

export async function createWorkbookVersionBranch(
  ctx: DocumentContext,
  options: VersionCreateBranchOptions,
): Promise<VersionRefMutationResult> {
  const validated = validateCreateBranchOptions(options);
  if (!validated.ok) return degradedMutation(null, validated.diagnostics);

  if (validated.branchName === 'main') {
    return degradedMutation(null, [protectedMainDiagnostic('createBranch')]);
  }

  const operationGateDiagnostics = validateVersionOperationGate(
    ctx,
    'createBranch',
    'version:branch',
    { mutates: true },
  );
  if (operationGateDiagnostics.length > 0) {
    return degradedMutation(null, operationGateDiagnostics);
  }

  const service = getAttachedVersionRefLifecycleService(ctx);
  if (!service?.createBranch) {
    return degradedMutation(null, [writeUnavailableDiagnostic('createBranch')]);
  }

  try {
    return mapBranchMutationResult(
      await service.createBranch({
        name: validated.branchName,
        targetCommitId: validated.targetCommitId,
        expectedAbsent: true,
        ...(validated.baseCommitId ? { baseCommitId: validated.baseCommitId } : {}),
        createdBy: VERSION_REF_OPERATION_AUTHOR,
      }),
      'createBranch',
    );
  } catch {
    return degradedMutation(null, [providerErrorDiagnostic('createBranch')]);
  }
}

export async function listWorkbookVersionRefs(
  ctx: DocumentContext,
  options: VersionListRefsOptions = {},
): Promise<VersionRefListResult> {
  const prefix = validateRefListPrefix(options.prefix);
  if (!prefix.ok) return degradedList([], prefix.diagnostics);

  const service = getAttachedVersionRefLifecycleService(ctx);
  if (!service?.listBranches) {
    return degradedList([], [serviceUnavailableDiagnostic('listRefs')]);
  }

  try {
    const result = await service.listBranches(
      prefix.namespace === undefined ? {} : { prefix: prefix.namespace },
    );
    return mapBranchListResult(result, prefix);
  } catch {
    return degradedList([], [providerErrorDiagnostic('listRefs')]);
  }
}

export async function getWorkbookVersionRef(
  ctx: DocumentContext,
  name: 'HEAD',
): Promise<VersionSymbolicRefReadResult>;
export async function getWorkbookVersionRef(
  ctx: DocumentContext,
  name: VersionMainRefName | VersionRefName | VersionBranchName,
): Promise<VersionBranchRefReadResult>;
export async function getWorkbookVersionRef(
  ctx: DocumentContext,
  name: VersionRefSelector | VersionBranchName,
): Promise<VersionRefReadResult>;
export async function getWorkbookVersionRef(
  ctx: DocumentContext,
  name: VersionRefSelector | VersionBranchName,
): Promise<VersionRefReadResult> {
  if (name === VERSION_HEAD_REF) {
    return getSymbolicHead(ctx);
  }

  const parsed = parsePublicBranchName(name, 'getRef');
  if (!parsed.ok) return degradedRef(null, parsed.diagnostics);

  const service = getAttachedVersionRefLifecycleService(ctx);
  if (!service?.readBranch) {
    return degradedRef(null, [serviceUnavailableDiagnostic('getRef')]);
  }

  try {
    return mapBranchReadResult(await service.readBranch({ name: parsed.branchName }), 'getRef');
  } catch {
    return degradedRef(null, [providerErrorDiagnostic('getRef')]);
  }
}

export async function readWorkbookVersionRef(
  ctx: DocumentContext,
  name: 'HEAD',
): Promise<VersionSymbolicRefReadResult>;
export async function readWorkbookVersionRef(
  ctx: DocumentContext,
  name: VersionMainRefName | VersionRefName | VersionBranchName,
): Promise<VersionBranchRefReadResult>;
export async function readWorkbookVersionRef(
  ctx: DocumentContext,
  name: VersionRefSelector | VersionBranchName,
): Promise<VersionRefReadResult>;
export async function readWorkbookVersionRef(
  ctx: DocumentContext,
  name: VersionRefSelector | VersionBranchName,
): Promise<VersionRefReadResult> {
  return getWorkbookVersionRef(ctx, name);
}

export async function fastForwardWorkbookVersionBranch(
  ctx: DocumentContext,
  options: VersionFastForwardBranchOptions,
): Promise<VersionRefMutationResult> {
  const validated = validateFastForwardOptions(options, 'fastForwardBranch');
  if (!validated.ok) return degradedMutation(null, validated.diagnostics);

  if (validated.branchName === 'main') {
    return degradedMutation(null, [protectedMainDiagnostic('fastForwardBranch')]);
  }

  const operationGateDiagnostics = validateVersionOperationGate(
    ctx,
    'fastForwardBranch',
    'version:branch',
    { mutates: true },
  );
  if (operationGateDiagnostics.length > 0) {
    return degradedMutation(null, operationGateDiagnostics);
  }

  const service = getAttachedVersionRefLifecycleService(ctx);
  if (!service?.fastForwardBranch) {
    return degradedMutation(null, [writeUnavailableDiagnostic('fastForwardBranch')]);
  }

  try {
    return mapBranchMutationResult(
      await service.fastForwardBranch({
        name: validated.branchName,
        nextCommitId: validated.nextCommitId,
        expectedOldCommitId: validated.expectedHead,
        expectedRefVersion: validated.expectedRefVersion,
        updatedBy: VERSION_REF_OPERATION_AUTHOR,
      }),
      'fastForwardBranch',
    );
  } catch {
    return degradedMutation(null, [providerErrorDiagnostic('fastForwardBranch')]);
  }
}

export async function updateWorkbookVersionBranch(
  ctx: DocumentContext,
  options: VersionUpdateBranchOptions,
): Promise<VersionRefMutationResult> {
  return fastForwardWorkbookVersionBranch(ctx, options);
}

export async function deleteWorkbookVersionBranch(
  ctx: DocumentContext,
  options: VersionDeleteRefOptions,
): Promise<VersionRefMutationResult> {
  const operationGateDiagnostics = validateVersionOperationGate(
    ctx,
    'deleteBranch',
    'version:branch',
    { mutates: true },
  );
  if (operationGateDiagnostics.length > 0) {
    return degradedMutation(null, operationGateDiagnostics);
  }

  return deleteWorkbookVersionBranchRef({
    ctx,
    options,
    operation: 'deleteBranch',
    author: VERSION_REF_OPERATION_AUTHOR,
  });
}

export async function deleteWorkbookVersionRef(
  ctx: DocumentContext,
  options: VersionDeleteRefOptions,
): Promise<VersionRefMutationResult> {
  const operationGateDiagnostics = validateVersionOperationGate(
    ctx,
    'deleteRef',
    'version:branch',
    { mutates: true },
  );
  if (operationGateDiagnostics.length > 0) {
    return degradedMutation(null, operationGateDiagnostics);
  }

  return deleteWorkbookVersionBranchRef({
    ctx,
    options,
    operation: 'deleteRef',
    author: VERSION_REF_OPERATION_AUTHOR,
  });
}

function getAttachedVersionRefLifecycleService(
  ctx: DocumentContext,
): AttachedVersionRefLifecycleService | null {
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
    const refService = toRefLifecycleService(candidate);
    if (refService) return refService;
  }

  return null;
}

function toRefLifecycleService(value: unknown): AttachedVersionRefLifecycleService | null {
  const createBranch = bindMethod(value, 'createBranch');
  const getHead = bindMethod(value, 'getHead');
  const readBranch = bindMethod(value, 'readBranch');
  const listBranches = bindMethod(value, 'listBranches');
  const fastForwardBranch =
    bindMethod(value, 'fastForwardBranch') ?? bindMethod(value, 'updateBranch');

  if (!createBranch && !getHead && !readBranch && !listBranches && !fastForwardBranch) {
    return null;
  }

  const service: AttachedVersionRefLifecycleService = {};
  if (createBranch) service.createBranch = (input) => createBranch(input);
  if (getHead) service.getHead = () => getHead();
  if (readBranch) service.readBranch = (input) => readBranch(input);
  if (listBranches) service.listBranches = (input) => listBranches(input);
  if (fastForwardBranch) service.fastForwardBranch = (input) => fastForwardBranch(input);
  return service;
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

async function getSymbolicHead(ctx: DocumentContext): Promise<VersionSymbolicRefReadResult> {
  const service = getAttachedVersionRefLifecycleService(ctx);
  if (!service?.getHead && !service?.readBranch) {
    return degradedRef(null, [
      serviceUnavailableDiagnostic('readRef'),
    ]) as VersionSymbolicRefReadResult;
  }
  if (service.getHead) {
    try {
      const result = await service.getHead();
      const mapped = mapSymbolicHeadResult(result);
      if (mapped) return mapped;
      return degradedRef(null, [
        invalidPayloadDiagnostic('readRef'),
      ]) as VersionSymbolicRefReadResult;
    } catch {
      return degradedRef(null, [
        providerErrorDiagnostic('readRef'),
      ]) as VersionSymbolicRefReadResult;
    }
  }
  try {
    const main = await service.readBranch?.({ name: 'main' });
    const ref = mapBranchReadResult(main, 'readRef');
    if (ref.status === 'success') {
      return {
        status: 'success',
        ref: { name: VERSION_HEAD_REF, target: VERSION_MAIN_REF, revision: ref.ref.revision },
        diagnostics: [],
      };
    }
    return degradedRef(null, ref.diagnostics) as VersionSymbolicRefReadResult;
  } catch {
    return degradedRef(null, [providerErrorDiagnostic('readRef')]) as VersionSymbolicRefReadResult;
  }
}

function mapSymbolicHeadResult(value: unknown): VersionSymbolicRefReadResult | null {
  if (!isRecord(value)) return null;
  if (value.ok === false) {
    return degradedRef(
      null,
      mapBranchFailureDiagnostics(value.diagnostics, 'readRef'),
    ) as VersionSymbolicRefReadResult;
  }
  const ref = mapSymbolicHeadRecord('head' in value ? value.head : value);
  if (!ref) return null;
  const diagnostics = mapOptionalBranchDiagnostics(value.diagnostics, 'readRef');
  return diagnostics.length > 0
    ? ({ status: 'degraded', ref, diagnostics } as VersionSymbolicRefReadResult)
    : { status: 'success', ref, diagnostics: [] };
}

function mapSymbolicHeadRecord(value: unknown): VersionSymbolicRef | null {
  if (!isRecord(value)) return null;
  const targetName =
    typeof value.branchName === 'string'
      ? value.branchName
      : typeof value.refName === 'string'
        ? value.refName
        : typeof value.target === 'string'
          ? value.target
          : undefined;
  const parsed = parsePublicBranchName(targetName, 'readRef');
  const revision = toRevision(value.refVersion) ?? toRevision(value.revision);
  if (!parsed.ok || !revision) return null;
  return { name: VERSION_HEAD_REF, target: parsed.refName, revision };
}

function validateCreateBranchOptions(options: VersionCreateBranchOptions):
  | {
      readonly ok: true;
      readonly branchName: string;
      readonly targetCommitId: WorkbookCommitId;
      readonly baseCommitId?: WorkbookCommitId;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  if (!isRecord(options) || Array.isArray(options)) {
    return {
      ok: false,
      diagnostics: [invalidOptionsDiagnostic('createBranch', 'options')],
    };
  }

  const diagnostics: VersionStoreDiagnostic[] = [];
  rejectUnknownKeys(
    options,
    new Set(['name', 'targetCommitId', 'baseCommitId', 'expectedAbsent']),
    'createBranch',
    diagnostics,
  );
  const parsedName = parsePublicBranchName(options.name, 'createBranch');
  if (!parsedName.ok) diagnostics.push(...parsedName.diagnostics);
  if (options.expectedAbsent !== undefined && options.expectedAbsent !== true) {
    diagnostics.push(invalidOptionsDiagnostic('createBranch', 'expectedAbsent'));
  }
  const targetCommitId = toCommitId(options.targetCommitId);
  if (!targetCommitId) diagnostics.push(invalidCommitDiagnostic('createBranch', 'targetCommitId'));
  const baseCommitId =
    options.baseCommitId === undefined ? undefined : toCommitId(options.baseCommitId);
  if (options.baseCommitId !== undefined && !baseCommitId) {
    diagnostics.push(invalidCommitDiagnostic('createBranch', 'baseCommitId'));
  }

  if (diagnostics.length > 0 || !parsedName.ok || !targetCommitId) {
    return { ok: false, diagnostics };
  }

  return {
    ok: true,
    branchName: parsedName.branchName,
    targetCommitId,
    ...(baseCommitId ? { baseCommitId } : {}),
  };
}

function validateFastForwardOptions(
  options: VersionFastForwardBranchOptions,
  operation: VersionRefOperation,
):
  | {
      readonly ok: true;
      readonly branchName: string;
      readonly nextCommitId: WorkbookCommitId;
      readonly expectedHead: WorkbookCommitId;
      readonly expectedRefVersion: VersionRecordRevision;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] } {
  if (!isRecord(options) || Array.isArray(options)) {
    return { ok: false, diagnostics: [invalidOptionsDiagnostic(operation, 'options')] };
  }

  const diagnostics: VersionStoreDiagnostic[] = [];
  rejectUnknownKeys(
    options,
    new Set(['name', 'nextCommitId', 'expectedHead', 'expectedRefRevision']),
    operation,
    diagnostics,
  );
  const parsedName = parsePublicBranchName(options.name, operation);
  if (!parsedName.ok) diagnostics.push(...parsedName.diagnostics);
  const nextCommitId = toCommitId(options.nextCommitId);
  if (!nextCommitId) diagnostics.push(invalidCommitDiagnostic(operation, 'nextCommitId'));
  const expectedHead = toCommitId(options.expectedHead);
  if (!expectedHead) diagnostics.push(invalidCommitDiagnostic(operation, 'expectedHead'));
  const expectedRefVersion = toCounterRevision(options.expectedRefRevision);
  if (!expectedRefVersion)
    diagnostics.push(invalidOptionsDiagnostic(operation, 'expectedRefRevision'));

  if (
    diagnostics.length > 0 ||
    !parsedName.ok ||
    !nextCommitId ||
    !expectedHead ||
    !expectedRefVersion
  ) {
    return { ok: false, diagnostics };
  }

  return {
    ok: true,
    branchName: parsedName.branchName,
    nextCommitId,
    expectedHead,
    expectedRefVersion,
  };
}

function parsePublicBranchName(value: unknown, operation: VersionRefOperation): ParsedBranchName {
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
            ...noWriteAttemptedForMutation(operation),
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
            payload: { refName: 'redacted', issue: item.issue },
            ...noWriteAttemptedForMutation(operation),
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

function validateRefListPrefix(value: VersionListRefsOptions['prefix']): ParsedRefPrefix {
  if (value === undefined) return { ok: true, includeMain: true };
  if (typeof value !== 'string') {
    return { ok: false, diagnostics: [invalidRefNameDiagnostic('listRefs')] };
  }

  const prefix = value.startsWith(VERSION_BRANCH_REF_PREFIX)
    ? value.slice(VERSION_BRANCH_REF_PREFIX.length)
    : value;
  if (REF_NAMESPACE_SET.has(prefix)) {
    return { ok: true, namespace: prefix as RefNamespace, includeMain: false };
  }

  return {
    ok: false,
    diagnostics: [invalidRefPrefixDiagnostic('listRefs')],
  };
}

function mapBranchReadResult(
  value: unknown,
  operation: VersionRefOperation,
): VersionBranchRefReadResult {
  if (!isRecord(value)) {
    return degradedRef(null, [providerErrorDiagnostic(operation)]) as VersionBranchRefReadResult;
  }
  if (value.ok === true) {
    if (value.branch === null) {
      return degradedRef(null, [danglingRefDiagnostic(operation)]) as VersionBranchRefReadResult;
    }
    const ref = mapBranchRecord(value.branch);
    if (ref) return { status: 'success', ref, diagnostics: [] };
    return degradedRef(null, [invalidPayloadDiagnostic(operation)]) as VersionBranchRefReadResult;
  }
  if (value.ok === false) {
    return degradedRef(
      null,
      mapBranchFailureDiagnostics(value.diagnostics, operation),
    ) as VersionBranchRefReadResult;
  }
  const publicRef = mapVersionRef(value.ref ?? value);
  if (publicRef) return { status: 'success', ref: publicRef, diagnostics: [] };
  return degradedRef(null, [providerErrorDiagnostic(operation)]) as VersionBranchRefReadResult;
}

function mapBranchListResult(
  value: unknown,
  prefix: Extract<ParsedRefPrefix, { readonly ok: true }>,
): VersionRefListResult {
  if (!isRecord(value)) return degradedList([], [providerErrorDiagnostic('listRefs')]);
  if (value.ok === false) {
    return degradedList([], mapBranchFailureDiagnostics(value.diagnostics, 'listRefs'));
  }

  const rawItems = Array.isArray(value.branches)
    ? value.branches
    : Array.isArray(value.items)
      ? value.items
      : Array.isArray(value.refs)
        ? value.refs
        : null;
  if (!rawItems) return degradedList([], [invalidPayloadDiagnostic('listRefs')]);

  const diagnostics = mapOptionalBranchDiagnostics(value.diagnostics, 'listRefs');
  const items = rawItems
    .map(mapBranchRecord)
    .filter((ref): ref is VersionRef => Boolean(ref))
    .filter((ref) => refMatchesPrefix(ref, prefix))
    .sort((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  if (diagnostics.length > 0) return degradedList(items, diagnostics);
  return { status: 'success', items, diagnostics: [] };
}

function mapBranchMutationResult(
  value: unknown,
  operation: VersionRefOperation,
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
  const liveRef = isRecord(value.ref) ? value.ref : value;
  const branchName =
    typeof value.name === 'string'
      ? value.name
      : typeof liveRef.name === 'string'
        ? liveRef.name
        : undefined;
  const commitId = toCommitId(liveRef.targetCommitId) ?? toCommitId(liveRef.commitId);
  const revision = toCounterRevision(liveRef.refVersion) ?? toRevision(liveRef.revision);
  if (!branchName || !commitId || !revision) return mapVersionRef(value);
  const parsed = parsePublicBranchName(branchName, 'readRef');
  if (!parsed.ok) return null;
  return {
    name: parsed.refName,
    commitId,
    revision,
    ...(typeof liveRef.updatedAt === 'string' ? { updatedAt: liveRef.updatedAt } : {}),
  };
}

function mapVersionRef(value: unknown): VersionRef | null {
  if (!isRecord(value)) return null;
  const parsed = parsePublicBranchName(value.name, 'readRef');
  const commitId = toCommitId(value.commitId);
  const revision = toRevision(value.revision);
  if (!parsed.ok || !commitId || !revision) return null;
  return {
    name: parsed.refName,
    commitId,
    revision,
    ...(typeof value.updatedAt === 'string' ? { updatedAt: value.updatedAt } : {}),
  };
}

function refMatchesPrefix(
  ref: VersionRef,
  prefix: Extract<ParsedRefPrefix, { readonly ok: true }>,
): boolean {
  const branchName = ref.name.slice(VERSION_BRANCH_REF_PREFIX.length);
  if (branchName === 'main') return prefix.includeMain && prefix.namespace === undefined;
  if (prefix.namespace === undefined) return true;
  return branchName.startsWith(`${prefix.namespace}/`);
}

function mapBranchFailureDiagnostics(
  value: unknown,
  operation: VersionRefOperation,
): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(value) || value.length === 0) {
    return [providerErrorDiagnostic(operation)];
  }
  return value.map((item) => mapBranchDiagnostic(item, operation));
}

function mapOptionalBranchDiagnostics(
  value: unknown,
  operation: VersionRefOperation,
): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(value)) return [];
  return value.map((item) => mapBranchDiagnostic(item, operation));
}

function mapBranchDiagnostic(
  value: unknown,
  operation: VersionRefOperation,
): VersionStoreDiagnostic {
  if (!isRecord(value)) return providerErrorDiagnostic(operation);
  const code = typeof value.code === 'string' ? value.code : 'versionCapabilityDisabled';
  const issueCode = issueCodeForBranchDiagnostic(code);
  return publicDiagnostic(issueCode, operation, safeMessageForBranchIssue(issueCode, operation), {
    severity: value.severity === 'warning' || value.severity === 'info' ? value.severity : 'error',
    recoverability: recoverabilityForBranchIssue(issueCode),
    payload: sanitizeBranchDiagnosticPayload(value, operation),
    ...(isRefMutationOperation(operation)
      ? { mutationGuarantee: branchDiagnosticMutationGuarantee(code, value.details) }
      : {}),
  });
}

function sanitizeBranchDiagnosticPayload(
  value: Readonly<Record<string, unknown>>,
  operation: VersionRefOperation,
): VersionDiagnosticPublicPayload {
  const payload: Record<string, string | number | boolean | null> = { operation };
  const details = isRecord(value.details) ? value.details : null;
  if (details && typeof details.issue === 'string')
    payload.issue = safeBranchDiagnosticToken('issue', details.issue);
  if (details && typeof details.missingField === 'string') {
    payload.option = safeBranchDiagnosticToken('option', details.missingField);
  }
  if (details && typeof details.cause === 'string') {
    payload.conflict = safeBranchDiagnosticToken('conflict', details.cause);
  }
  const actualHead = toCommitId(value.commitId);
  const actualRevision = toCounterRevision(value.refVersion);
  if (actualHead) payload.actualHead = actualHead;
  if (actualRevision) payload.actualRefRevision = `rv:n:${actualRevision.value}`;
  if (value.refName === 'main' || value.refName === VERSION_MAIN_REF) {
    payload.refName = VERSION_MAIN_REF;
  }
  return payload;
}

function rejectUnknownKeys(
  input: Readonly<Record<string, unknown>>,
  allowed: ReadonlySet<string>,
  operation: VersionRefOperation,
  diagnostics: VersionStoreDiagnostic[],
): void {
  for (const key of Object.keys(input)) {
    if (allowed.has(key)) continue;
    diagnostics.push(invalidOptionsDiagnostic(operation, key));
  }
}

function toCommitId(value: unknown): WorkbookCommitId | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : null;
}

function toRevision(value: unknown): VersionRecordRevision | undefined {
  if (isRecord(value) && value.kind === 'counter' && typeof value.value === 'string') {
    return { kind: 'counter', value: value.value };
  }
  if (isRecord(value) && value.kind === 'opaque' && typeof value.value === 'string') {
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

function serviceUnavailableDiagnostic(operation: VersionRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_GRAPH_UNINITIALIZED',
    operation,
    'No document-scoped version ref lifecycle service is attached; no ref state is fabricated.',
    { severity: 'warning', recoverability: 'unsupported' },
  );
}

function writeUnavailableDiagnostic(operation: VersionRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_REF_WRITE_UNAVAILABLE',
    operation,
    'No document-scoped public ref mutation service is attached; no ref was mutated.',
    {
      severity: 'warning',
      recoverability: 'unsupported',
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

function protectedMainDiagnostic(operation: VersionRefOperation): VersionStoreDiagnostic {
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

function invalidRefNameDiagnostic(operation: VersionRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_INVALID_OPTIONS',
    operation,
    'The supplied VC-05 ref name is not public-safe.',
    {
      severity: 'error',
      recoverability: 'none',
      payload: { refName: 'redacted' },
      ...noWriteAttemptedForMutation(operation),
    },
  );
}

function invalidRefPrefixDiagnostic(operation: VersionRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_INVALID_OPTIONS',
    operation,
    'The version ref lifecycle options are invalid for this method.',
    {
      severity: 'error',
      recoverability: 'none',
      payload: { option: 'prefix' },
    },
  );
}

function invalidCommitDiagnostic(
  operation: VersionRefOperation,
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
      ...noWriteAttemptedForMutation(operation),
    },
  );
}

function invalidOptionsDiagnostic(
  operation: VersionRefOperation,
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
      ...noWriteAttemptedForMutation(operation),
    },
  );
}

function danglingRefDiagnostic(operation: VersionRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_DANGLING_REF',
    operation,
    'The requested public ref does not resolve to a live branch.',
    { severity: 'warning', recoverability: 'unsupported' },
  );
}

function invalidPayloadDiagnostic(operation: VersionRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_INVALID_COMMIT_PAYLOAD',
    operation,
    'The version ref lifecycle service returned an invalid public ref payload.',
    { severity: 'error', recoverability: 'repair' },
  );
}

function providerErrorDiagnostic(operation: VersionRefOperation): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PROVIDER_ERROR',
    operation,
    'The version ref lifecycle service failed before returning a usable public result.',
    { severity: 'error', recoverability: 'retry' },
  );
}

function publicDiagnostic(
  issueCode: string,
  operation: VersionRefOperation,
  safeMessage: string,
  options: {
    readonly severity?: VersionStoreDiagnostic['severity'];
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly payload?: VersionDiagnosticPublicPayload;
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

function isRefMutationOperation(operation: VersionRefOperation): boolean {
  return (
    operation === 'createBranch' ||
    operation === 'fastForwardBranch' ||
    operation === 'updateBranch' ||
    operation === 'deleteBranch' ||
    operation === 'deleteRef'
  );
}

function noWriteAttemptedForMutation(
  operation: VersionRefOperation,
): { readonly mutationGuarantee: 'no-write-attempted' } | Record<string, never> {
  return isRefMutationOperation(operation) ? { mutationGuarantee: 'no-write-attempted' } : {};
}

function degradedList(
  items: readonly VersionRef[],
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionRefListResult {
  return { status: 'degraded', items, diagnostics };
}

function degradedMutation(
  ref: VersionRef | null,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionRefMutationResult {
  return { status: 'degraded', ref, diagnostics };
}

function degradedRef(
  ref: VersionRef | null,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionRefReadResult {
  return { status: 'degraded', ref, diagnostics };
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
