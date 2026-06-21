import type {
  RedactionPolicy,
  VersionCommitOptions,
  VersionDiagnosticPublicPayload,
  VersionMainRefName,
  VersionRecordRevision,
  VersionRef,
  VersionRefName,
  VersionStoreDiagnostic,
  VersionSymbolicRef,
  WorkbookCommitId,
  WorkbookCommitRef,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { MogSdkError } from '../../errors';

const VERSION_HEAD_REF = 'HEAD';
const VERSION_MAIN_REF = 'refs/heads/main' satisfies VersionMainRefName;
const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const VERSION_COMMIT_OPERATION = 'workbook.version.commit';

const VERSION_COMMIT_OPTION_KEYS = new Set(['message', 'redactionPolicy', 'expectedHead', 'mode']);
const VERSION_COMMIT_EXPECTED_HEAD_KEYS = new Set(['commitId', 'revision', 'symbolicHeadRevision']);
const VERSION_COMMIT_MODE_KEYS = new Set(['kind']);
const REDACTION_POLICY_KEYS = new Set([
  'mode',
  'redactSecrets',
  'redactExternalLinks',
  'redactAgentTrace',
]);
const REDACTION_POLICY_MODES = new Set(['default', 'strict', 'clean']);
const REF_MUTATION_FIELDS = new Set(['targetRef', 'ref', 'branch']);
const AUTHOR_SPOOFING_FIELDS = new Set([
  'author',
  'committer',
  'principal',
  'principalScope',
  'updatedBy',
]);
const PARENT_OVERRIDE_FIELDS = new Set(['parents', 'parentCommitIds', 'parentIds', 'baseCommitId']);
const DIRECT_SEGMENT_FIELDS = new Set([
  'segmentIds',
  'segments',
  'mutationSegments',
  'changeSet',
  'semanticChangeSet',
  'semanticChanges',
  'operations',
  'captureFrontier',
  'frontier',
]);
const ROOT_IMPORT_PROVENANCE_FIELDS = new Set([
  'expectedRegistryRevision',
  'root',
  'rootEvidence',
  'importRootEvidence',
  'provenance',
  'trustRoots',
]);

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

type AttachedVersionWriteService = {
  commit?: (options?: VersionCommitOptions) => MaybePromise<unknown>;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

type CommitValidationResult =
  | {
      readonly ok: true;
      readonly options: VersionCommitOptions;
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

type NormalizedCommitOptions = {
  message?: string;
  redactionPolicy?: RedactionPolicy;
  expectedHead?: VersionCommitOptions['expectedHead'];
  mode?: { kind: 'normal' };
};

export function hasAttachedVersionWriteService(ctx: DocumentContext): boolean {
  return Boolean(getAttachedVersionWriteService(ctx)?.commit);
}

export async function commitWorkbookVersion(
  ctx: DocumentContext,
  options: VersionCommitOptions = {},
): Promise<WorkbookCommitRef> {
  const validated = validateCommitOptions(options);
  if (!validated.ok) {
    throwVersionError(validated.diagnostics);
  }

  const writeService = getAttachedVersionWriteService(ctx);
  if (!writeService?.commit) {
    throwVersionError([serviceUnavailableDiagnostic()]);
  }

  let result: unknown;
  try {
    result = await writeService.commit(validated.options);
  } catch (error) {
    throwVersionError(diagnosticsFromThrownError(error), error);
  }

  return mapCommitWriteResult(result);
}

function getAttachedVersionWriteService(ctx: DocumentContext): AttachedVersionWriteService | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return null;

  for (const candidate of [
    services.writeService,
    services.commitService,
    services.versionWriteService,
    services.publicService,
    services.graphService,
    services,
  ]) {
    const writeService = toWriteService(candidate);
    if (writeService) return writeService;
  }

  return null;
}

function toWriteService(value: unknown): AttachedVersionWriteService | null {
  if (isRawGraphStore(value)) return null;

  const commit = bindMethod(value, 'commit') ?? bindMethod(value, 'commitVersion');
  if (!commit) return null;

  return {
    commit: (options) => commit(options),
  };
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function isRawGraphStore(value: unknown): boolean {
  return (
    isRecord(value) &&
    typeof value.commit === 'function' &&
    typeof value.initializeGraph === 'function' &&
    typeof value.readCommitClosure === 'function'
  );
}

function validateCommitOptions(input: VersionCommitOptions): CommitValidationResult {
  if (input === undefined) return { ok: true, options: {} };
  if (!isRecord(input) || Array.isArray(input)) {
    return {
      ok: false,
      diagnostics: [
        invalidCommitOptionDiagnostic('options', 'commit options must be an object when supplied.'),
      ],
    };
  }

  const diagnostics: VersionStoreDiagnostic[] = [];
  const options: NormalizedCommitOptions = {};

  for (const key of Object.keys(input)) {
    if (VERSION_COMMIT_OPTION_KEYS.has(key)) continue;
    diagnostics.push(diagnosticForRejectedCommitField(key));
  }

  if ('message' in input) {
    if (typeof input.message !== 'string') {
      diagnostics.push(
        invalidCommitOptionDiagnostic('message', 'commit message must be a string.'),
      );
    } else {
      options.message = input.message;
    }
  }

  if ('redactionPolicy' in input) {
    const redactionPolicy = validateRedactionPolicy(input.redactionPolicy, diagnostics);
    if (redactionPolicy) options.redactionPolicy = redactionPolicy;
  }

  let modeKind: unknown;
  if ('mode' in input) {
    const mode = input.mode;
    if (!isRecord(mode) || Array.isArray(mode)) {
      diagnostics.push(invalidCommitOptionDiagnostic('mode', 'commit mode must be an object.'));
    } else {
      rejectUnknownNestedKeys(mode, VERSION_COMMIT_MODE_KEYS, 'mode', diagnostics);
      modeKind = mode.kind;
      if (modeKind === 'normal') {
        options.mode = { kind: 'normal' };
      } else if (modeKind === 'root' || modeKind === 'import-root') {
        diagnostics.push(
          invalidCommitOptionDiagnostic(
            'mode',
            'root and import-root commit modes are not exposed by this public commit slice.',
          ),
        );
      } else {
        diagnostics.push(invalidCommitOptionDiagnostic('mode.kind', 'commit mode is unsupported.'));
      }
    }
  }

  if ('expectedHead' in input) {
    const expectedHead = validateExpectedHead(input.expectedHead, diagnostics);
    if (expectedHead) options.expectedHead = expectedHead;
    if (modeKind === 'root' || modeKind === 'import-root') {
      diagnostics.push(
        invalidCommitOptionDiagnostic(
          'expectedHead',
          'expectedHead is valid only for normal version commits.',
        ),
      );
    }
  }

  return diagnostics.length > 0 ? { ok: false, diagnostics } : { ok: true, options };
}

function validateExpectedHead(
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): VersionCommitOptions['expectedHead'] | undefined {
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(
      invalidCommitOptionDiagnostic('expectedHead', 'expectedHead must be an object.'),
    );
    return undefined;
  }

  rejectUnknownNestedKeys(value, VERSION_COMMIT_EXPECTED_HEAD_KEYS, 'expectedHead', diagnostics);
  const commitId = toCommitId(value.commitId);
  const revision = toPublicRevision(value.revision);
  const symbolicHeadRevision =
    value.symbolicHeadRevision === undefined
      ? undefined
      : toPublicRevision(value.symbolicHeadRevision);

  if (!commitId) {
    diagnostics.push(
      invalidCommitOptionDiagnostic('expectedHead.commitId', 'expectedHead.commitId is invalid.'),
    );
  }
  if (!revision) {
    diagnostics.push(
      invalidCommitOptionDiagnostic('expectedHead.revision', 'expectedHead.revision is invalid.'),
    );
  }
  if ('symbolicHeadRevision' in value && !symbolicHeadRevision) {
    diagnostics.push(
      invalidCommitOptionDiagnostic(
        'expectedHead.symbolicHeadRevision',
        'expectedHead.symbolicHeadRevision is invalid.',
      ),
    );
  }
  if (!commitId || !revision || ('symbolicHeadRevision' in value && !symbolicHeadRevision)) {
    return undefined;
  }

  return {
    commitId,
    revision,
    ...(symbolicHeadRevision ? { symbolicHeadRevision } : {}),
  };
}

function validateRedactionPolicy(
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): RedactionPolicy | undefined {
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(
      invalidCommitOptionDiagnostic('redactionPolicy', 'redactionPolicy must be an object.'),
    );
    return undefined;
  }

  rejectUnknownNestedKeys(value, REDACTION_POLICY_KEYS, 'redactionPolicy', diagnostics);
  if (!REDACTION_POLICY_MODES.has(String(value.mode))) {
    diagnostics.push(
      invalidCommitOptionDiagnostic('redactionPolicy.mode', 'redactionPolicy.mode is unsupported.'),
    );
  }

  for (const key of ['redactSecrets', 'redactExternalLinks', 'redactAgentTrace'] as const) {
    if (typeof value[key] !== 'boolean') {
      diagnostics.push(
        invalidCommitOptionDiagnostic(`redactionPolicy.${key}`, `${key} must be a boolean.`),
      );
    }
  }

  if (
    !REDACTION_POLICY_MODES.has(String(value.mode)) ||
    typeof value.redactSecrets !== 'boolean' ||
    typeof value.redactExternalLinks !== 'boolean' ||
    typeof value.redactAgentTrace !== 'boolean'
  ) {
    return undefined;
  }

  return {
    mode: value.mode as RedactionPolicy['mode'],
    redactSecrets: value.redactSecrets,
    redactExternalLinks: value.redactExternalLinks,
    redactAgentTrace: value.redactAgentTrace,
  };
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
      invalidCommitOptionDiagnostic(`${option}.${key}`, `Unknown ${option} option "${key}".`),
    );
  }
}

function diagnosticForRejectedCommitField(field: string): VersionStoreDiagnostic {
  if (REF_MUTATION_FIELDS.has(field)) {
    return publicDiagnostic(
      'VERSION_REF_WRITE_UNAVAILABLE',
      'Public version commits always target the current HEAD; ref mutation fields are not accepted.',
      rejectedCommitFieldOptions(field),
    );
  }
  if (AUTHOR_SPOOFING_FIELDS.has(field)) {
    return publicDiagnostic(
      'VERSION_PERMISSION_DENIED',
      'Public version commits derive author identity from authenticated operation context.',
      rejectedCommitFieldOptions(field),
    );
  }
  if (PARENT_OVERRIDE_FIELDS.has(field)) {
    return publicDiagnostic(
      'VERSION_PERMISSION_DENIED',
      'Public version commits derive parents from the current graph head.',
      rejectedCommitFieldOptions(field),
    );
  }
  if (DIRECT_SEGMENT_FIELDS.has(field) || ROOT_IMPORT_PROVENANCE_FIELDS.has(field)) {
    return publicDiagnostic(
      'VERSION_INVALID_OPTIONS',
      'Public version commits do not accept direct segment or provenance inputs in this slice.',
      rejectedCommitFieldOptions(field),
    );
  }
  return invalidCommitOptionDiagnostic(field, `Unknown commit option "${field}".`);
}

function rejectedCommitFieldOptions(field: string): Parameters<typeof publicDiagnostic>[2] {
  return {
    severity: 'error',
    recoverability: 'unsupported',
    payload: { option: field },
    mutationGuarantee: 'no-write-attempted',
  };
}

function invalidCommitOptionDiagnostic(
  option: string,
  safeMessage: string,
): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_INVALID_OPTIONS', safeMessage, {
    severity: 'error',
    recoverability: 'none',
    payload: { option },
    mutationGuarantee: 'no-write-attempted',
  });
}

function mapCommitWriteResult(value: unknown): WorkbookCommitRef {
  const directRef = mapCommitRef(value);
  if (directRef) return directRef;

  if (!isRecord(value)) {
    throwVersionError([providerErrorDiagnostic()]);
  }

  if (value.status === 'failed' || value.status === 'degraded') {
    throwVersionError(mapServiceDiagnostics(value.diagnostics));
  }
  if (value.status !== 'success') {
    throwVersionError([providerErrorDiagnostic()]);
  }

  const commitRef =
    mapCommitRef(value.commitRef) ??
    mapCommitRef(value.head) ??
    mapCommitRef(value.commit) ??
    mapCommitRefFromCommitAndRef(value.commit, value.main) ??
    mapCommitRefFromCommitAndRef(value.rootCommit, value.initialHead);

  if (commitRef) return commitRef;

  throwVersionError([
    publicDiagnostic(
      'VERSION_INVALID_COMMIT_PAYLOAD',
      'The version write service did not return a valid public commit ref.',
      {
        severity: 'error',
        recoverability: 'repair',
        mutationGuarantee: 'unknown-after-crash',
      },
    ),
  ]);
}

function mapCommitRefFromCommitAndRef(commit: unknown, ref: unknown): WorkbookCommitRef | null {
  if (!isRecord(commit)) return null;
  const id = toCommitId(commit.id);
  if (!id) return null;
  const mappedRef = mapRef(ref);

  if (mappedRef && mappedRef.name !== VERSION_HEAD_REF) {
    return {
      id,
      refName: mappedRef.name,
      resolvedFrom: VERSION_HEAD_REF,
      refRevision: mappedRef.revision,
    };
  }

  return { id };
}

function mapCommitRef(value: unknown): WorkbookCommitRef | null {
  if (!isRecord(value)) return null;
  const id = toCommitId(value.id);
  if (!id) return null;

  const refName = toRefName(value.refName);
  const resolvedFrom =
    value.resolvedFrom === VERSION_HEAD_REF ? VERSION_HEAD_REF : toRefName(value.resolvedFrom);
  const refRevision = toRevision(value.refRevision);

  return {
    id,
    ...(refName ? { refName } : {}),
    ...(resolvedFrom ? { resolvedFrom } : {}),
    ...(refRevision ? { refRevision } : {}),
  };
}

function mapRef(value: unknown): VersionRef | VersionSymbolicRef | null {
  if (!isRecord(value)) return null;

  if (value.name === VERSION_HEAD_REF) {
    const target = toRefName(value.target);
    const revision = toRevision(value.revision);
    if (!target || !revision) return null;
    return { name: VERSION_HEAD_REF, target, revision };
  }

  const name = toRefName(value.name);
  const commitId = toCommitId(value.commitId);
  const revision = toRevision(value.revision);
  if (!name || !commitId || !revision) return null;

  return { name, commitId, revision };
}

function serviceUnavailableDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_GRAPH_UNINITIALIZED',
    'No document-scoped version write service is attached; no commit was fabricated.',
    {
      severity: 'error',
      recoverability: 'unsupported',
      mutationGuarantee: 'no-write-attempted',
    },
  );
}

function providerErrorDiagnostic(
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PROVIDER_ERROR',
    'The version write service failed before returning a usable public commit ref.',
    {
      severity: 'error',
      recoverability: 'retry',
      payload,
      mutationGuarantee: 'unknown-after-crash',
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
    readonly mutationGuarantee?: VersionStoreDiagnostic['mutationGuarantee'];
  } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: options.severity ?? 'error',
    recoverability: options.recoverability ?? recoverabilityForIssue(issueCode),
    messageTemplateId: `version.commit.${issueCode}`,
    safeMessage,
    ...(options.payload ? { payload: options.payload } : {}),
    ...(options.mutationGuarantee ? { mutationGuarantee: options.mutationGuarantee } : {}),
    redacted: true,
  };
}

function mapServiceDiagnostics(value: unknown): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(value) || value.length === 0) return [providerErrorDiagnostic()];
  return value.map(mapServiceDiagnostic);
}

function mapServiceDiagnostic(value: unknown): VersionStoreDiagnostic {
  if (!isRecord(value)) return providerErrorDiagnostic();

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
    mutationGuarantee: toMutationGuarantee(value.mutationGuarantee),
  });
}

function sanitizeDiagnosticPayload(
  value: Readonly<Record<string, unknown>>,
): VersionDiagnosticPublicPayload {
  const payload: Record<string, string | number | boolean | null> = {
    operation: 'commit',
  };

  if (typeof value.operation === 'string') payload.operation = value.operation;
  if (typeof value.option === 'string') payload.option = value.option;
  const refName = value.refName;
  if (refName === VERSION_HEAD_REF || refName === VERSION_MAIN_REF) {
    payload.refName = refName;
  }

  const details = isRecord(value.details) ? value.details : null;
  if (details) {
    for (const key of ['option', 'mode', 'mutationGuarantee'] as const) {
      const detailValue = details[key];
      if (isPayloadPrimitive(detailValue)) payload[key] = detailValue;
    }
  }

  return payload;
}

function safeMessageForIssue(issueCode: string): string {
  switch (issueCode) {
    case 'VERSION_GRAPH_UNINITIALIZED':
      return 'The workbook version graph is not initialized for this document.';
    case 'VERSION_INVALID_OPTIONS':
      return 'The version commit options are invalid for this method.';
    case 'VERSION_PERMISSION_DENIED':
      return 'The requested version commit option is not authorized in this public slice.';
    case 'VERSION_REF_WRITE_UNAVAILABLE':
      return 'Public version commits cannot target or mutate arbitrary refs in this slice.';
    case 'VERSION_STORE_READ_ONLY':
      return 'The attached version store is read-only for this document.';
    case 'VERSION_REF_CONFLICT':
      return 'The version ref changed while the commit was in progress.';
    case 'VERSION_INVALID_COMMIT_PAYLOAD':
      return 'The version write service returned an invalid public commit payload.';
    default:
      return 'The version graph could not complete commit.';
  }
}

function recoverabilityForIssue(issueCode: string): VersionStoreDiagnostic['recoverability'] {
  switch (issueCode) {
    case 'VERSION_REF_CONFLICT':
      return 'retry';
    case 'VERSION_DANGLING_REF':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_OBJECT_STORE_FAILURE':
    case 'VERSION_INVALID_COMMIT_PAYLOAD':
      return 'repair';
    case 'VERSION_GRAPH_UNINITIALIZED':
    case 'VERSION_PERMISSION_DENIED':
    case 'VERSION_REF_WRITE_UNAVAILABLE':
    case 'VERSION_STORE_READ_ONLY':
      return 'unsupported';
    default:
      return 'none';
  }
}

function throwVersionError(diagnostics: readonly VersionStoreDiagnostic[], cause?: unknown): never {
  const publicDiagnostics = diagnostics.length > 0 ? diagnostics : [providerErrorDiagnostic()];
  const primary = selectPrimaryDiagnostic(publicDiagnostics);

  throw new MogSdkError(sdkCodeForVersionIssue(primary.issueCode), primary.safeMessage, {
    operation: VERSION_COMMIT_OPERATION,
    details: {
      versionIssueCode: primary.issueCode,
      diagnostics: publicDiagnostics,
    },
    diagnostics: {
      domain: 'VERSION',
      issueCode: primary.issueCode,
      severity: sdkSeverity(primary.severity),
    },
    cause,
  });
}

function diagnosticsFromThrownError(error: unknown): readonly VersionStoreDiagnostic[] {
  if (isRecord(error)) {
    const detailsDiagnostics = isRecord(error.details) ? error.details.diagnostics : undefined;
    if (Array.isArray(detailsDiagnostics)) return mapServiceDiagnostics(detailsDiagnostics);
    if (Array.isArray(error.diagnostics)) return mapServiceDiagnostics(error.diagnostics);
    if (isRecord(error.diagnostic)) return [mapServiceDiagnostic(error.diagnostic)];
  }

  return [providerErrorDiagnostic()];
}

function selectPrimaryDiagnostic(
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionStoreDiagnostic {
  return diagnostics.reduce((selected, candidate) =>
    severityRank(candidate.severity) > severityRank(selected.severity) ? candidate : selected,
  );
}

function severityRank(severity: VersionStoreDiagnostic['severity']): number {
  switch (severity) {
    case 'fatal':
      return 4;
    case 'error':
      return 3;
    case 'warning':
      return 2;
    case 'info':
      return 1;
  }
}

function sdkSeverity(severity: VersionStoreDiagnostic['severity']): 'error' | 'warning' | 'info' {
  return severity === 'fatal' ? 'error' : severity;
}

function sdkCodeForVersionIssue(issueCode: string): MogSdkError['code'] {
  switch (issueCode) {
    case 'VERSION_INVALID_OPTIONS':
    case 'VERSION_INVALID_COMMIT_ID':
    case 'VERSION_INVALID_COMMIT_PAYLOAD':
      return 'INVALID_ARGUMENT';
    case 'VERSION_PERMISSION_DENIED':
    case 'VERSION_REF_WRITE_UNAVAILABLE':
      return 'AUTHORIZATION_DENIED';
    case 'VERSION_REF_CONFLICT':
    case 'VERSION_GRAPH_CONFLICT':
    case 'VERSION_STALE_PAGE_CURSOR':
      return 'CONFLICT';
    case 'VERSION_STORE_READ_ONLY':
      return 'READ_ONLY';
    case 'VERSION_PROVIDER_ERROR':
    case 'VERSION_PROVIDER_FAILED':
    case 'VERSION_OBJECT_STORE_FAILURE':
    case 'VERSION_GRAPH_UNINITIALIZED':
    case 'VERSION_STORE_UNAVAILABLE':
      return 'PROVIDER_ERROR';
    default:
      return 'INTERNAL_ERROR';
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
  if (typeof value === 'string') return { kind: 'opaque', value };
  return undefined;
}

function toPublicRevision(value: unknown): VersionRecordRevision | undefined {
  if (
    isRecord(value) &&
    (value.kind === 'counter' || value.kind === 'opaque') &&
    typeof value.value === 'string' &&
    value.value.length > 0
  ) {
    return { kind: value.kind, value: value.value };
  }
  return undefined;
}

function toMutationGuarantee(
  value: unknown,
): VersionStoreDiagnostic['mutationGuarantee'] | undefined {
  return value === 'ref-not-mutated' ||
    value === 'registry-not-visible' ||
    value === 'no-write-attempted' ||
    value === 'unknown-after-crash'
    ? value
    : undefined;
}

function toRefName(value: unknown): VersionMainRefName | VersionRefName | undefined {
  if (value === VERSION_MAIN_REF) return VERSION_MAIN_REF;
  if (typeof value === 'string' && value.startsWith('refs/heads/')) {
    return value as VersionRefName;
  }
  return undefined;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isPayloadPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}
