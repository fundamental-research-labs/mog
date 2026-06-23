import type {
  RedactedVersionAuthor,
  RedactionPolicy,
  VersionAnnotationText,
  VersionCommitOptions,
  VersionDiagnosticPublicPayload,
  VersionResult,
  VersionMainRefName,
  VersionRecordRevision,
  VersionRefName,
  VersionStoreDiagnostic,
  WorkbookCommitId,
  WorkbookCommitAnnotationSummary,
  WorkbookCommitSummary,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { validateRefName } from '../../document/version-store/ref-name';
import { validateVersionDomainSupportManifestGate } from './version-domain-support-gate';
import { validateVersionOperationGate } from './version-operation-gate';
import { versionFailureFromStoreDiagnostics } from './version-result';

const VERSION_HEAD_REF = 'HEAD';
const VERSION_MAIN_REF = 'refs/heads/main' satisfies VersionMainRefName;
const VERSION_BRANCH_REF_PREFIX = 'refs/heads/';
const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;

const VERSION_COMMIT_OPTION_KEYS = new Set(['message', 'targetRef', 'redactionPolicy', 'expectedHead', 'mode']);
const VERSION_COMMIT_EXPECTED_HEAD_KEYS = new Set(['commitId', 'revision', 'symbolicHeadRevision']);
const VERSION_COMMIT_MODE_KEYS = new Set(['kind']);
const REDACTION_POLICY_KEYS = new Set(['mode', 'redactSecrets', 'redactExternalLinks', 'redactAgentTrace']);
const REDACTION_POLICY_MODES = new Set(['default', 'strict', 'clean']);
const REF_MUTATION_FIELDS = new Set(['ref', 'branch']);
const AUTHOR_SPOOFING_FIELDS = new Set(['author', 'committer', 'principal', 'principalScope', 'updatedBy']);
const PARENT_OVERRIDE_FIELDS = new Set(['parents', 'parentCommitIds', 'parentIds', 'baseCommitId']);
const DIRECT_SEGMENT_FIELDS = new Set(['segmentIds', 'segments', 'mutationSegments', 'changeSet', 'semanticChangeSet', 'semanticChanges', 'operations', 'captureFrontier', 'frontier']);
const ROOT_IMPORT_PROVENANCE_FIELDS = new Set(['expectedRegistryRevision', 'root', 'rootEvidence', 'importRootEvidence', 'provenance', 'trustRoots']);
const ANNOTATION_BINDING_FIELDS = new Set(['annotation', 'annotationDigest', 'annotationRecord', 'annotationRevision', 'tags', 'title']);
const OBJECT_BINDING_FIELDS = new Set(['authorizationSnapshot', 'authorizationSnapshotDigest', 'commitId', 'commitRecord', 'objectRecords', 'redactionPolicyDigest', 'redactionSummary', 'redactionSummaryDigest', 'semanticChangeSetDigest', 'snapshotRoot', 'snapshotRootDigest', 'snapshotRootRecord', 'verificationSummary', 'verificationSummaryDigest']);
const OBJECT_KIND_BY_TYPE: Record<string, string> = { 'workbook.snapshotRoot.v1': 'snapshot-root', 'workbook.semanticChangeSet.v1': 'semantic-change-set', 'workbook.mutationSegment.v1': 'mutation-segment', 'workbook.redactionSummary.v1': 'redaction-summary', 'workbook.verificationSummary.v1': 'verification-summary', 'workbook.authorizationSnapshot.v1': 'authorization-snapshot' };
const SAFE_MESSAGES: Record<string, string> = { VERSION_GRAPH_UNINITIALIZED: 'The workbook version graph is not initialized for this document.', VERSION_INVALID_OPTIONS: 'The version commit options are invalid for this method.', VERSION_PERMISSION_DENIED: 'The requested version commit option is not authorized in this public slice.', VERSION_REF_WRITE_UNAVAILABLE: 'Public version commits cannot target or mutate arbitrary refs in this slice.', VERSION_STORE_READ_ONLY: 'The attached version store is read-only for this document.', VERSION_REF_CONFLICT: 'The version ref changed while the commit was in progress.', VERSION_MISSING_CHANGE_SET: 'The version commit has no eligible captured change set.', VERSION_MISSING_SNAPSHOT_ROOT: 'The version commit is missing its materializable snapshot root.', VERSION_MISSING_MUTATION_SEGMENT: 'The version commit is missing a captured mutation segment.', VERSION_DIGEST_MISMATCH: 'A version commit object digest does not match its canonical bytes.', VERSION_WRONG_OBJECT_KIND: 'A version commit dependency has the wrong object kind.', VERSION_UNSUPPORTED_SCHEMA: 'A version commit dependency uses an unsupported schema.', VERSION_REDACTION_VIOLATION: 'The version commit could not prove required redaction before storage.', VERSION_ANNOTATION_WRITE_FAILED: 'The version commit annotation could not be written durably.', VERSION_UNMATERIALIZABLE_COMMIT: 'The version commit is not materializable by the attached service.', VERSION_INVALID_COMMIT_PAYLOAD: 'The version write service returned an invalid public commit payload.' };
const REPAIR_ISSUES = new Set(['VERSION_DANGLING_REF', 'VERSION_MISSING_OBJECT', 'VERSION_MISSING_SNAPSHOT_ROOT', 'VERSION_MISSING_CHANGE_SET', 'VERSION_MISSING_MUTATION_SEGMENT', 'VERSION_DIGEST_MISMATCH', 'VERSION_WRONG_OBJECT_KIND', 'VERSION_OBJECT_STORE_FAILURE', 'VERSION_INVALID_COMMIT_PAYLOAD', 'VERSION_UNMATERIALIZABLE_COMMIT']);
const UNSUPPORTED_ISSUES = new Set(['VERSION_GRAPH_UNINITIALIZED', 'VERSION_PERMISSION_DENIED', 'VERSION_REF_WRITE_UNAVAILABLE', 'VERSION_STORE_READ_ONLY']);

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

type AttachedVersionWriteService = { commit?: (options?: VersionCommitOptions) => MaybePromise<unknown> };
type NormalCommitCaptureAdmissionState = { readonly pendingCapturedNormalMutationCount: number; readonly pendingUncapturedNormalMutationCount: number };
type VersionSurfaceDirtyAdmissionState = { readonly hasUncommittedLocalChanges: boolean };

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown; readonly versionStore?: unknown; readonly version?: unknown;
};

type CommitValidationResult = { readonly ok: true; readonly options: VersionCommitOptions } | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };
type NormalizedCommitOptions = { message?: string; targetRef?: VersionMainRefName | VersionRefName; redactionPolicy?: RedactionPolicy; expectedHead?: VersionCommitOptions['expectedHead']; mode?: { kind: 'normal' } };

export function hasAttachedVersionWriteService(ctx: DocumentContext): boolean {
  return Boolean(getAttachedVersionWriteService(ctx)?.commit);
}

export async function commitWorkbookVersion(
  ctx: DocumentContext,
  options: VersionCommitOptions = {},
): Promise<VersionResult<WorkbookCommitSummary>> {
  const validated = validateCommitOptions(options);
  if (!validated.ok) {
    return versionFailureFromStoreDiagnostics('commit', validated.diagnostics);
  }

  const operationGateDiagnostics = validateVersionOperationGate(ctx, 'commit', 'version:commit', {
    mutates: true,
  });
  if (operationGateDiagnostics.length > 0) {
    return versionFailureFromStoreDiagnostics('commit', operationGateDiagnostics);
  }

  const gateDiagnostics = await validateVersionDomainSupportManifestGate(ctx, 'commit');
  if (gateDiagnostics.length > 0) {
    return versionFailureFromStoreDiagnostics('commit', gateDiagnostics);
  }

  const writeService = getAttachedVersionWriteService(ctx);
  if (!writeService?.commit) return versionFailureFromStoreDiagnostics('commit', [serviceUnavailableDiagnostic()]);

  const admissionDiagnostics = await normalCommitCaptureAdmissionDiagnostics(ctx);
  if (admissionDiagnostics.length > 0) return versionFailureFromStoreDiagnostics('commit', admissionDiagnostics);

  let result: unknown;
  try {
    result = await writeService.commit(validated.options);
  } catch (error) {
    return versionFailureFromStoreDiagnostics('commit', diagnosticsFromThrownError(error));
  }

  return mapCommitWriteResult(result);
}

function getAttachedVersionWriteService(ctx: DocumentContext): AttachedVersionWriteService | null {
  const services = getAttachedVersionServices(ctx);
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

function getAttachedVersionServices(ctx: DocumentContext): unknown {
  const runtime = ctx as MaybeVersionRuntimeContext;
  return runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
}

function toWriteService(value: unknown): AttachedVersionWriteService | null {
  if (isRawGraphStore(value)) return null;
  const commit = bindMethod(value, 'commit') ?? bindMethod(value, 'commitVersion');
  if (!commit) return null;
  return { commit: (options) => commit(options) };
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

async function normalCommitCaptureAdmissionDiagnostics(
  ctx: DocumentContext,
): Promise<readonly VersionStoreDiagnostic[]> {
  const captureState = readNormalCommitCaptureAdmissionState(ctx);
  if (!captureState || captureState.pendingCapturedNormalMutationCount > 0) return [];

  const hasUncapturedNormalMutations = captureState.pendingUncapturedNormalMutationCount > 0;
  const dirtyState = await readSurfaceDirtyAdmissionState(ctx);
  if (!hasUncapturedNormalMutations && dirtyState?.hasUncommittedLocalChanges !== true) return [];

  return [missingChangeSetDiagnostic(captureState, dirtyState)];
}

function readNormalCommitCaptureAdmissionState(
  ctx: DocumentContext,
): NormalCommitCaptureAdmissionState | null {
  const services = getAttachedVersionServices(ctx);
  if (!isRecord(services)) return null;

  for (const candidate of [services.semanticMutationCapture, services.mutationCapture, services]) {
    const stateReader = readNormalCaptureStateMethod(candidate);
    if (stateReader) return stateReader();
  }

  return null;
}

function readNormalCaptureStateMethod(
  value: unknown,
): (() => NormalCommitCaptureAdmissionState | null) | null {
  if (!isRecord(value)) return null;
  const method = value.readNormalCommitCaptureState;
  if (typeof method !== 'function') return null;
  return () => {
    try {
      const state = Reflect.apply(method, value, []) as unknown;
      return isNormalCommitCaptureAdmissionState(state) ? state : null;
    } catch {
      return null;
    }
  };
}

function isNormalCommitCaptureAdmissionState(
  value: unknown,
): value is NormalCommitCaptureAdmissionState {
  return (
    isRecord(value) &&
    typeof value.pendingCapturedNormalMutationCount === 'number' &&
    typeof value.pendingUncapturedNormalMutationCount === 'number'
  );
}

async function readSurfaceDirtyAdmissionState(
  ctx: DocumentContext,
): Promise<VersionSurfaceDirtyAdmissionState | null> {
  const services = getAttachedVersionServices(ctx);
  if (!isRecord(services)) return null;

  for (const candidate of [
    services.surfaceStatusService,
    services.versionSurfaceStatusService,
    services.statusService,
    services.dirtyStatusService,
    services,
  ]) {
    const dirtyState = await readDirtyStateFromCandidate(candidate);
    if (dirtyState) return dirtyState;
  }

  return null;
}

async function readDirtyStateFromCandidate(
  value: unknown,
): Promise<VersionSurfaceDirtyAdmissionState | null> {
  if (!isRecord(value)) return null;
  const method = value.readDirtyStatus;
  if (typeof method !== 'function') return null;
  try {
    const dirtyStatus = await Reflect.apply(method, value, []);
    return isVersionSurfaceDirtyAdmissionState(dirtyStatus) ? dirtyStatus : null;
  } catch {
    return null;
  }
}

function isVersionSurfaceDirtyAdmissionState(
  value: unknown,
): value is VersionSurfaceDirtyAdmissionState {
  return isRecord(value) && typeof value.hasUncommittedLocalChanges === 'boolean';
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
    const message = validateCommitMessage(input.message, diagnostics);
    if (message !== undefined) options.message = message;
  }

  if ('redactionPolicy' in input) {
    const redactionPolicy = validateRedactionPolicy(input.redactionPolicy, diagnostics);
    if (redactionPolicy) options.redactionPolicy = redactionPolicy;
  }

  const hasExplicitTargetRef = 'targetRef' in input;
  if (hasExplicitTargetRef) {
    const targetRef = validateTargetRef(input.targetRef, diagnostics);
    if (targetRef) options.targetRef = targetRef;
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
    if (hasExplicitTargetRef && expectedHead?.symbolicHeadRevision !== undefined) {
      diagnostics.push(
        invalidCommitOptionDiagnostic(
          'expectedHead.symbolicHeadRevision',
          'symbolicHeadRevision is valid only for implicit HEAD commits.',
        ),
      );
    }
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

function validateTargetRef(
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): VersionMainRefName | VersionRefName | undefined {
  if (typeof value !== 'string') {
    diagnostics.push(invalidCommitOptionDiagnostic('targetRef', 'targetRef must be a string.'));
    return undefined;
  }
  if (value === VERSION_HEAD_REF) {
    diagnostics.push(
      invalidCommitOptionDiagnostic('targetRef', 'targetRef must be a concrete refs/heads/* ref.'),
    );
    return undefined;
  }

  const branchName = value.startsWith(VERSION_BRANCH_REF_PREFIX)
    ? value.slice(VERSION_BRANCH_REF_PREFIX.length)
    : value;
  const parsed = validateRefName(branchName, 'targetRef');
  if (!parsed.ok) {
    diagnostics.push(
      ...parsed.diagnostics.map((item) =>
        publicDiagnostic(
          'VERSION_INVALID_OPTIONS',
          'targetRef must name a public-safe version branch.',
          {
            severity: 'error',
            recoverability: 'none',
            payload: { option: 'targetRef', issue: item.issue, refName: 'redacted' },
            mutationGuarantee: 'no-write-attempted',
          },
        ),
      ),
    );
    return undefined;
  }

  return parsed.name === 'main'
    ? VERSION_MAIN_REF
    : (`${VERSION_BRANCH_REF_PREFIX}${parsed.name}` as VersionRefName);
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
      diagnostics.push(invalidCommitOptionDiagnostic('redactionPolicy.mode', 'redactionPolicy.mode is unsupported.'));
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

  return { mode: value.mode as RedactionPolicy['mode'], redactSecrets: value.redactSecrets, redactExternalLinks: value.redactExternalLinks, redactAgentTrace: value.redactAgentTrace };
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
  if (ANNOTATION_BINDING_FIELDS.has(field)) {
    return publicDiagnostic(
      'VERSION_INVALID_OPTIONS',
      'Public version commits bind annotations through sanitized message text only.',
      rejectedCommitFieldOptions(field),
    );
  }
  if (OBJECT_BINDING_FIELDS.has(field)) {
    return publicDiagnostic(
      'VERSION_INVALID_OPTIONS',
      'Public version commits derive immutable object digests from captured materializable state.',
      rejectedCommitFieldOptions(field),
    );
  }
  return invalidCommitOptionDiagnostic(field, `Unknown commit option "${field}".`);
}

function rejectedCommitFieldOptions(field: string): Parameters<typeof publicDiagnostic>[2] {
  return { severity: 'error', recoverability: 'unsupported', payload: { option: field }, mutationGuarantee: 'no-write-attempted' };
}

function invalidCommitOptionDiagnostic(
  option: string,
  safeMessage: string,
): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_INVALID_OPTIONS', safeMessage, { severity: 'error', recoverability: 'none', payload: { option }, mutationGuarantee: 'no-write-attempted' });
}

function validateCommitMessage(
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): string | undefined {
  if (typeof value !== 'string') {
    diagnostics.push(invalidCommitOptionDiagnostic('message', 'commit message must be a string.'));
    return undefined;
  }
  const message = value.normalize('NFC').replace(/[ \t\n]+$/u, '');
  if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(message)) {
    diagnostics.push(
      invalidCommitOptionDiagnostic('message', 'commit message contains unsupported control characters.'),
    );
    return undefined;
  }
  if ([...message].length > 4096) {
    diagnostics.push(invalidCommitOptionDiagnostic('message', 'commit message is too long.'));
    return undefined;
  }
  return message;
}

function mapCommitWriteResult(value: unknown): VersionResult<WorkbookCommitSummary> {
  const directSummary = mapCommitSummary(value);
  if (directSummary) return commitSummaryResult(directSummary);

  if (!isRecord(value)) {
    return versionFailureFromStoreDiagnostics('commit', [providerErrorDiagnostic()]);
  }

  if (value.status === 'failed' || value.status === 'degraded') {
    return versionFailureFromStoreDiagnostics('commit', mapServiceDiagnostics(value.diagnostics));
  }
  if (value.status !== 'success') {
    return versionFailureFromStoreDiagnostics('commit', [providerErrorDiagnostic()]);
  }

  const summary =
    mapCommitSummary(value.summary) ??
    mapCommitSummary(value.commitSummary) ??
    mapCommitSummary(value.commit) ??
    mapCommitSummary(value.rootCommit);

  if (summary) {
    return commitSummaryResult(withResultDiagnostics(summary, mapOptionalServiceDiagnostics(value.diagnostics)));
  }

  return versionFailureFromStoreDiagnostics('commit', [
    publicDiagnostic('VERSION_INVALID_COMMIT_PAYLOAD', safeMessageForIssue('VERSION_INVALID_COMMIT_PAYLOAD'), { severity: 'error', recoverability: 'repair', mutationGuarantee: 'unknown-after-crash' }),
  ]);
}

function commitSummaryResult(summary: WorkbookCommitSummary): VersionResult<WorkbookCommitSummary> {
  if (summary.parents.length > 0) return { ok: true, value: summary };
  return versionFailureFromStoreDiagnostics('commit', [
    publicDiagnostic('VERSION_MISSING_CHANGE_SET', safeMessageForIssue('VERSION_MISSING_CHANGE_SET'), {
      payload: { operation: 'commitGraphWrite', reason: 'empty-normal-commit' },
      mutationGuarantee: 'unknown-after-crash',
    }),
  ]);
}

function mapCommitSummary(value: unknown): WorkbookCommitSummary | null {
  if (!isRecord(value)) return null;
  const payload = isRecord(value.payload) ? value.payload : null;
  const id = toCommitId(value.id);
  const parentsValue = Array.isArray(value.parents)
    ? value.parents
    : Array.isArray(value.parentCommitIds)
      ? value.parentCommitIds
      : Array.isArray(payload?.parentCommitIds)
        ? payload.parentCommitIds
        : null;
  const createdAt = typeof value.createdAt === 'string'
    ? value.createdAt
    : typeof payload?.createdAt === 'string'
      ? payload.createdAt
      : null;
  const author = mapRedactedAuthor(value.author ?? payload?.author);

  if (!id || !parentsValue || !createdAt || !author) return null;
  const parents = parentsValue.map(toCommitId);
  if (parents.some((parent): parent is null => parent === null)) return null;

  const annotation = mapCommitAnnotation(value.annotation);
  const diagnostics = [
    ...mapOptionalServiceDiagnostics(value.diagnostics),
    ...mapCommitCompletenessDiagnostics(payload?.completenessDiagnostics),
  ];

  return { id, parents: parents as WorkbookCommitId[], createdAt, author, ...(annotation ? { annotation } : {}), ...(diagnostics.length > 0 ? { diagnostics } : {}) };
}

function withResultDiagnostics(
  summary: WorkbookCommitSummary,
  diagnostics: readonly VersionStoreDiagnostic[],
): WorkbookCommitSummary {
  if (diagnostics.length === 0) return summary;
  return { ...summary, diagnostics: [...(summary.diagnostics ?? []), ...diagnostics] };
}

function mapRedactedAuthor(value: unknown): RedactedVersionAuthor | null {
  if (!isRecord(value)) return null;
  return {
    ...(typeof value.actorKind === 'string' ? { actorKind: value.actorKind } : {}),
    ...(typeof value.displayName === 'string' ? { displayName: value.displayName } : {}),
    redacted: true,
  };
}

function mapCommitAnnotation(value: unknown): WorkbookCommitAnnotationSummary | undefined {
  if (!isRecord(value)) return undefined;
  const message = mapAnnotationText(value.message);
  const title = mapAnnotationText(value.title);
  const tags = Array.isArray(value.tags)
    ? value.tags.map(mapAnnotationText).filter((tag): tag is VersionAnnotationText => Boolean(tag))
    : undefined;
  if (!message && !title && (!tags || tags.length === 0)) return undefined;
  return { ...(message ? { message } : {}), ...(title ? { title } : {}), ...(tags && tags.length > 0 ? { tags } : {}) };
}

function mapAnnotationText(value: unknown): VersionAnnotationText | undefined {
  if (!isRecord(value)) return undefined;
  if (value.kind === 'text' && typeof value.value === 'string') {
    return { kind: 'text', value: value.value };
  }
  if (
    value.kind === 'redacted' &&
    (value.reason === 'permission-denied' ||
      value.reason === 'redaction-policy' ||
      value.reason === 'historical-acl-unavailable')
  ) {
    return { kind: 'redacted', reason: value.reason };
  }
  return undefined;
}

function serviceUnavailableDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_GRAPH_UNINITIALIZED',
    'No document-scoped version write service is attached; no commit was fabricated.',
    { severity: 'error', recoverability: 'unsupported', mutationGuarantee: 'no-write-attempted' },
  );
}

function providerErrorDiagnostic(
  payload: VersionDiagnosticPublicPayload = {},
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_PROVIDER_ERROR',
    'The version write service failed before returning a usable public commit ref.',
    { severity: 'error', recoverability: 'retry', payload, mutationGuarantee: 'unknown-after-crash' },
  );
}

function missingChangeSetDiagnostic(
  captureState: NormalCommitCaptureAdmissionState,
  dirtyState: VersionSurfaceDirtyAdmissionState | null,
): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_MISSING_CHANGE_SET',
    safeMessageForIssue('VERSION_MISSING_CHANGE_SET'),
    {
      severity: 'error',
      recoverability: 'repair',
      payload: {
        operation: 'commitGraphWrite',
        reason:
          captureState.pendingUncapturedNormalMutationCount > 0
            ? 'uncaptured-normal-mutations'
            : 'empty-normal-capture',
        dirtyWorkingState: dirtyState?.hasUncommittedLocalChanges === true,
        pendingCapturedNormalMutationCount: captureState.pendingCapturedNormalMutationCount,
        pendingUncapturedNormalMutationCount: captureState.pendingUncapturedNormalMutationCount,
      },
      mutationGuarantee: 'no-write-attempted',
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

function mapOptionalServiceDiagnostics(value: unknown): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  return value.map(mapServiceDiagnostic);
}

function mapServiceDiagnostic(value: unknown): VersionStoreDiagnostic {
  if (!isRecord(value)) return providerErrorDiagnostic();

  const issueCode = publicIssueCodeFromDiagnostic(value);
  const severity = value.severity === 'corruption' ? 'error' : value.severity;

  return publicDiagnostic(issueCode, safeMessageForIssue(issueCode), {
    severity:
      severity === 'info' || severity === 'warning' || severity === 'error' || severity === 'fatal' ? severity : 'error',
    recoverability: recoverabilityForIssue(issueCode),
    payload: sanitizeDiagnosticPayload(value, issueCode),
    mutationGuarantee: toMutationGuarantee(value.mutationGuarantee),
  });
}

function publicIssueCodeFromDiagnostic(value: Readonly<Record<string, unknown>>): string {
  const issueCode =
    typeof value.issueCode === 'string'
      ? value.issueCode
      : typeof value.code === 'string'
        ? value.code
        : 'VERSION_PROVIDER_ERROR';
  if (issueCode !== 'VERSION_MISSING_DEPENDENCY') return issueCode;
  switch (objectKindFromDiagnostic(value)) {
    case 'snapshot-root':
      return 'VERSION_MISSING_SNAPSHOT_ROOT';
    case 'semantic-change-set':
      return 'VERSION_MISSING_CHANGE_SET';
    case 'mutation-segment':
      return 'VERSION_MISSING_MUTATION_SEGMENT';
    default:
      return issueCode;
  }
}

function mapCommitCompletenessDiagnostics(value: unknown): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(value) || value.length === 0) return [];
  return value.map(mapCommitCompletenessDiagnostic);
}

function mapCommitCompletenessDiagnostic(value: unknown): VersionStoreDiagnostic {
  if (!isRecord(value)) return providerErrorDiagnostic();
  const issueCode = typeof value.code === 'string' ? value.code : 'VERSION_PROVIDER_ERROR';
  const severity = value.severity;
  return publicDiagnostic(issueCode, typeof value.message === 'string' ? value.message : 'The version commit includes a completeness diagnostic.', {
    severity: severity === 'info' || severity === 'warning' || severity === 'error' ? severity : 'error',
    recoverability: recoverabilityForIssue(issueCode),
    payload: sanitizeCompletenessDiagnosticPayload(value),
  });
}

function sanitizeCompletenessDiagnosticPayload(
  value: Readonly<Record<string, unknown>>,
): VersionDiagnosticPublicPayload {
  const payload: Record<string, string | number | boolean | null> = { operation: 'commit' };
  if (typeof value.path === 'string') payload.path = value.path;
  const details = isRecord(value.details) ? value.details : null;
  if (details) {
    for (const [key, detailValue] of Object.entries(details)) {
      if (isPayloadPrimitive(detailValue)) payload[key] = detailValue;
    }
  }
  return payload;
}

function sanitizeDiagnosticPayload(
  value: Readonly<Record<string, unknown>>,
  issueCode?: string,
): VersionDiagnosticPublicPayload {
  const payload: Record<string, string | number | boolean | null> = { operation: 'commit' };

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
  const objectKind = objectKindFromDiagnostic(value);
  if (objectKind) payload.objectKind = objectKind;
  if (issueCode === 'VERSION_MISSING_SNAPSHOT_ROOT') payload.operation = 'validateCommitClosure';

  return payload;
}

function objectKindFromDiagnostic(value: unknown, depth = 0): string | undefined {
  if (!isRecord(value) || depth > 4) return undefined;
  const direct = objectKindForObjectType(value.objectType);
  if (direct) return direct;
  const dependency = isRecord(value.dependency) ? value.dependency : null;
  const dependencyKind = objectKindForObjectType(dependency?.objectType);
  if (dependencyKind) return dependencyKind;
  for (const key of ['sourceDiagnostics', 'diagnostics'] as const) {
    const sources = value[key];
    if (!Array.isArray(sources)) continue;
    for (const source of sources) {
      const nested = objectKindFromDiagnostic(source, depth + 1);
      if (nested) return nested;
    }
  }
  return undefined;
}

function objectKindForObjectType(value: unknown): string | undefined {
  return typeof value === 'string' ? OBJECT_KIND_BY_TYPE[value] : undefined;
}

function safeMessageForIssue(issueCode: string): string {
  return SAFE_MESSAGES[issueCode] ?? 'The version graph could not complete commit.';
}

function recoverabilityForIssue(issueCode: string): VersionStoreDiagnostic['recoverability'] {
  if (issueCode === 'VERSION_REF_CONFLICT') return 'retry';
  if (REPAIR_ISSUES.has(issueCode)) return 'repair';
  if (UNSUPPORTED_ISSUES.has(issueCode)) return 'unsupported';
  return 'none';
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

function toCommitId(value: unknown): WorkbookCommitId | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : null;
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

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}

function isPayloadPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}
