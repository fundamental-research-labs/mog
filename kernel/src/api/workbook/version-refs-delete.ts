import type {
  VersionDeleteRefOptions,
  VersionDiagnosticPublicPayload,
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
import { branchDiagnosticMutationGuarantee } from './version-ref-diagnostics';

const VERSION_HEAD_REF = 'HEAD';
const VERSION_MAIN_REF = 'refs/heads/main';
const VERSION_BRANCH_REF_PREFIX = 'refs/heads/';
const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;
type DeleteRefOperation = 'deleteBranch' | 'deleteRef';

type DeleteCapableVersionRefLifecycleService = {
  deleteBranch?: (input: Readonly<Record<string, unknown>>) => MaybePromise<unknown>;
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
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

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
  } catch {
    return degradedMutation(null, [providerErrorDiagnostic(input.operation)]);
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
  return { deleteBranch: (input) => deleteBranch(input) };
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
  };
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
            payload: { refName: 'redacted', issue: item.issue },
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
  const revision = toCounterRevision(ref.refVersion) ?? toRevision(ref.revision);
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

function mapBranchDiagnostic(
  value: unknown,
  operation: DeleteRefOperation,
): VersionStoreDiagnostic {
  if (!isRecord(value)) return providerErrorDiagnostic(operation);
  const code = typeof value.code === 'string' ? value.code : 'versionCapabilityDisabled';
  const issueCode = issueCodeForBranchDiagnostic(code);
  const mutationGuarantee = branchDiagnosticMutationGuarantee(code, value.details);
  return publicDiagnostic(issueCode, operation, safeMessageForIssue(issueCode, operation), {
    severity: value.severity === 'warning' || value.severity === 'info' ? value.severity : 'error',
    recoverability: recoverabilityForIssue(issueCode),
    payload: sanitizeBranchDiagnosticPayload(value, operation),
    ...(mutationGuarantee ? { mutationGuarantee } : {}),
  });
}

function sanitizeBranchDiagnosticPayload(
  value: Readonly<Record<string, unknown>>,
  operation: DeleteRefOperation,
): VersionDiagnosticPublicPayload {
  const payload: Record<string, string | number | boolean | null> = { operation };
  const details = isRecord(value.details) ? value.details : null;
  if (details && typeof details.issue === 'string') payload.issue = details.issue;
  if (details && typeof details.missingField === 'string') payload.option = details.missingField;
  if (details && typeof details.cause === 'string') payload.conflict = details.cause;
  const actualHead = toCommitId(value.commitId);
  const actualRevision = toCounterRevision(value.refVersion);
  if (actualHead) payload.actualHead = actualHead;
  if (actualRevision) payload.actualRefRevision = `rv:n:${actualRevision.value}`;
  if (value.refName === 'main' || value.refName === VERSION_MAIN_REF) {
    payload.refName = VERSION_MAIN_REF;
  }
  return payload;
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
    readonly payload?: VersionDiagnosticPublicPayload;
    readonly mutationGuarantee?: VersionStoreDiagnostic['mutationGuarantee'];
  } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: options.severity ?? 'error',
    recoverability: options.recoverability ?? recoverabilityForIssue(issueCode),
    messageTemplateId: `version.${operation}.${issueCode}`,
    safeMessage,
    ...(options.payload ? { payload: options.payload } : {}),
    redacted: true,
    ...(options.mutationGuarantee ? { mutationGuarantee: options.mutationGuarantee } : {}),
  };
}

function issueCodeForBranchDiagnostic(code: string): string {
  switch (code) {
    case 'casConflict':
    case 'expectedHeadMismatch':
    case 'expectedRefVersionMismatch':
    case 'refAlreadyExists':
      return 'VERSION_REF_CONFLICT';
    case 'refNotFound':
    case 'refTombstoned':
      return 'VERSION_DANGLING_REF';
    case 'invalidCommitId':
      return 'VERSION_INVALID_COMMIT_ID';
    case 'protectedRef':
    case 'reservedNamespace':
    case 'unsupportedDetachedHead':
      return 'VERSION_PERMISSION_DENIED';
    case 'unsupportedRefOption':
    case 'unsupportedRefMetadataMutation':
    case 'versionCapabilityDisabled':
    case 'lastLiveRef':
      return 'VERSION_REF_WRITE_UNAVAILABLE';
    default:
      return 'VERSION_INVALID_OPTIONS';
  }
}

function safeMessageForIssue(issueCode: string, operation: DeleteRefOperation): string {
  switch (issueCode) {
    case 'VERSION_REF_CONFLICT':
      return 'The public ref changed while the lifecycle operation was in progress.';
    case 'VERSION_DANGLING_REF':
      return 'The requested public ref does not resolve to a live branch.';
    case 'VERSION_INVALID_OPTIONS':
      return 'The version ref lifecycle options are invalid for this method.';
    case 'VERSION_INVALID_COMMIT_ID':
      return 'The supplied commit id is invalid.';
    case 'VERSION_PERMISSION_DENIED':
      return 'The requested ref lifecycle operation is not authorized in this public slice.';
    case 'VERSION_REF_WRITE_UNAVAILABLE':
      return 'The requested ref lifecycle mutation is not supported by the attached public service.';
    default:
      return `The version ref lifecycle service could not complete ${operation}.`;
  }
}

function recoverabilityForIssue(issueCode: string): VersionStoreDiagnostic['recoverability'] {
  switch (issueCode) {
    case 'VERSION_REF_CONFLICT':
      return 'retry';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_PERMISSION_DENIED':
    case 'VERSION_REF_WRITE_UNAVAILABLE':
      return 'unsupported';
    default:
      return 'none';
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
