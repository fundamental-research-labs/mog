import type {
  ObjectDigest,
  VersionApplyMergeResult,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeChange,
  VersionMergeResultId,
  VersionRefName,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import {
  MERGE_PREVIEW_OBJECT_TYPE,
  mergePreviewArtifactRef,
  type MergePreviewArtifactPayload,
} from '../../document/version-store/merge-attempt-artifacts';
import type { ObjectDigest as InternalObjectDigest } from '../../document/version-store/object-digest';
import { VersionObjectStoreError } from '../../document/version-store/object-store';
import type { VersionStoreProvider } from '../../document/version-store/provider';
import { namespaceForRegistry } from '../../document/version-store/registry';
import type { VersionGraphStore } from '../../document/version-store/provider-graph-store';
import {
  isApplyMergeWriteSuccessResult,
  mapApplyMergeWriteResult,
} from './version-apply-merge-write-result';
import type {
  NormalizedPersistedApplyMergeInput,
  NormalizedPersistedApplyMergeOptions,
} from './version-apply-merge-persisted';

const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

type AttachedVersionApplyMergeService = {
  readonly mergeCommit?: (input: {
    readonly base: WorkbookCommitId;
    readonly ours: WorkbookCommitId;
    readonly theirs: WorkbookCommitId;
    readonly targetRef: VersionMainRefName | VersionRefName;
    readonly expectedTargetHead: VersionCommitExpectedHead;
    readonly changes: readonly VersionMergeChange[];
    readonly resolutionCount: number;
  }) => MaybePromise<unknown>;
};

type AttachedVersionServices = {
  readonly provider?: unknown;
  readonly versionStoreProvider?: unknown;
  readonly storeProvider?: unknown;
  readonly writeService?: unknown;
  readonly versionWriteService?: unknown;
  readonly commitService?: unknown;
  readonly applyMergeService?: unknown;
  readonly versionApplyMergeService?: unknown;
  readonly publicService?: unknown;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

export function isPersistedMergePreviewArtifactInput(
  input: NormalizedPersistedApplyMergeInput,
): boolean {
  return (
    input.resultId === `merge-result:${(input.previewArtifactDigest ?? input.resultDigest).digest}`
  );
}

export async function applyPersistedMergePreviewArtifact(
  ctx: DocumentContext,
  input: NormalizedPersistedApplyMergeInput,
  options: NormalizedPersistedApplyMergeOptions,
): Promise<VersionApplyMergeResult> {
  const digestDiagnostics = validatePreviewDigestInput(input);
  if (digestDiagnostics.length > 0) {
    return blockedApplyMergeResult(null, null, null, digestDiagnostics);
  }

  const opened = await openPersistedMergeGraph(ctx);
  if (!opened.ok) {
    return blockedApplyMergeResult(null, null, null, opened.diagnostics);
  }

  const artifact = await readPreviewArtifact(opened.graph, input.resultDigest);
  if (!artifact.ok) {
    return blockedApplyMergeResult(null, null, null, artifact.diagnostics);
  }

  if (options.mode === 'preview') {
    return replayPreviewArtifact(input, artifact.payload);
  }

  const validationDiagnostics = validatePreviewArtifactForApply(artifact.payload, options);
  if (validationDiagnostics.length > 0) {
    return blockedApplyMergeResult(
      artifact.payload.base,
      artifact.payload.ours,
      artifact.payload.theirs,
      validationDiagnostics,
    );
  }

  const service = getAttachedVersionApplyMergeService(ctx);
  if (!service?.mergeCommit) {
    return blockedApplyMergeResult(
      artifact.payload.base,
      artifact.payload.ours,
      artifact.payload.theirs,
      [applyMergeServiceUnavailableDiagnostic()],
    );
  }

  const plan = {
    base: artifact.payload.base,
    ours: artifact.payload.ours,
    theirs: artifact.payload.theirs,
    changes: artifact.payload.changes,
    resolutionCount: 0,
  };

  try {
    const raw = await service.mergeCommit({
      ...plan,
      targetRef: options.targetRef,
      expectedTargetHead: options.expectedTargetHead,
    });
    const mapped = mapApplyMergeWriteResult(raw, plan, 'merge-commit-created');
    if (!isApplyMergeWriteSuccessResult(mapped)) return mapped;
    return {
      ...mapped,
      resultId: input.resultId,
      previewArtifactDigest: input.resultDigest,
      resultDigest: input.resultDigest,
      targetRef: options.targetRef,
      headBefore: artifact.payload.ours,
      ...('commitRef' in mapped ? { headAfter: mapped.commitRef.id } : {}),
    };
  } catch {
    return blockedApplyMergeResult(
      artifact.payload.base,
      artifact.payload.ours,
      artifact.payload.theirs,
      [providerErrorDiagnostic()],
    );
  }
}

function validatePreviewDigestInput(
  input: NormalizedPersistedApplyMergeInput,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (input.previewArtifactDigest && !digestsEqual(input.previewArtifactDigest, input.resultDigest)) {
    diagnostics.push(
      resolutionMismatchDiagnostic(
        'persisted merge previewArtifactDigest does not match resultDigest.',
      ),
    );
  }
  if (input.resolutionSetDigest || input.resolvedAttemptDigest) {
    diagnostics.push(
      resolutionMismatchDiagnostic(
        'review-only persisted merge previews do not accept resolved-attempt digests.',
      ),
    );
  }
  if (!isInternalSha256Digest(input.resultDigest)) {
    diagnostics.push(
      resolutionMismatchDiagnostic('persisted merge resultDigest is not a merge-preview digest.'),
    );
  }
  if (input.previewArtifactDigest && !isInternalSha256Digest(input.previewArtifactDigest)) {
    diagnostics.push(
      resolutionMismatchDiagnostic(
        'persisted merge previewArtifactDigest is not a merge-preview digest.',
      ),
    );
  }
  return diagnostics;
}

function replayPreviewArtifact(
  input: NormalizedPersistedApplyMergeInput,
  payload: MergePreviewArtifactPayload,
): VersionApplyMergeResult {
  if (payload.status === 'clean') {
    return {
      ...previewArtifactMetadata(input),
      status: 'planned',
      base: payload.base,
      ours: payload.ours,
      theirs: payload.theirs,
      changes: payload.changes,
      conflicts: [],
      diagnostics: [],
      resolutionCount: 0,
      mutationGuarantee: 'preview-only',
    };
  }
  if (payload.status === 'conflicted') {
    return {
      ...previewArtifactMetadata(input),
      status: 'conflicted',
      base: payload.base,
      ours: payload.ours,
      theirs: payload.theirs,
      changes: payload.changes,
      conflicts: payload.conflicts,
      diagnostics: [],
      requiredResolutionCount: payload.conflicts.length,
      mutationGuarantee: 'preview-only',
    };
  }
  return blockedApplyMergeResult(payload.base, payload.ours, payload.theirs, [
    resolutionMismatchDiagnostic(
      'persisted merge preview artifact is not a review-only merge result.',
    ),
  ]);
}

function previewArtifactMetadata(input: NormalizedPersistedApplyMergeInput) {
  return {
    resultId: input.resultId,
    previewArtifactDigest: input.resultDigest,
    resultDigest: input.resultDigest,
  };
}

async function openPersistedMergeGraph(
  ctx: DocumentContext,
): Promise<
  | { readonly ok: true; readonly graph: VersionGraphStore }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  const provider = getAttachedVersionStoreProvider(ctx);
  if (!provider) {
    return {
      ok: false,
      diagnostics: [
        publicDiagnostic(
          'VERSION_STORE_UNAVAILABLE',
          'No version graph provider is attached for persisted applyMerge.',
          { recoverability: 'unsupported' },
        ),
      ],
    };
  }

  try {
    const registry = await provider.readGraphRegistry();
    if (registry.status !== 'ok') {
      return { ok: false, diagnostics: mapProviderDiagnostics(registry.diagnostics) };
    }
    return {
      ok: true,
      graph: await provider.openGraph(
        namespaceForRegistry(registry.registry),
        provider.accessContext,
      ),
    };
  } catch {
    return { ok: false, diagnostics: [providerErrorDiagnostic()] };
  }
}

async function readPreviewArtifact(
  graph: VersionGraphStore,
  digest: ObjectDigest,
): Promise<
  | { readonly ok: true; readonly payload: MergePreviewArtifactPayload }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  try {
    const internalDigest = toInternalSha256Digest(digest);
    if (!internalDigest) return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic()] };
    const record = await graph.getObjectRecord<unknown>(mergePreviewArtifactRef(internalDigest));
    if (record.preimage.objectType !== MERGE_PREVIEW_OBJECT_TYPE) {
      return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic()] };
    }
    const payload = toMergePreviewArtifactPayload(record.preimage.payload);
    if (!payload) return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic()] };
    return { ok: true, payload };
  } catch (error) {
    return {
      ok: false,
      diagnostics: [
        publicDiagnostic(
          error instanceof VersionObjectStoreError &&
            error.diagnostic.code === 'VERSION_OBJECT_NOT_FOUND'
            ? 'VERSION_MISSING_OBJECT'
            : 'VERSION_PROVIDER_FAILED',
          'Persisted merge preview artifact could not be read.',
          { recoverability: error instanceof VersionObjectStoreError ? 'repair' : 'retry' },
        ),
      ],
    };
  }
}

function validatePreviewArtifactForApply(
  payload: MergePreviewArtifactPayload,
  options: Extract<NormalizedPersistedApplyMergeOptions, { readonly mode: 'apply' }>,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (payload.status !== 'clean') {
    diagnostics.push(
      resolutionMismatchDiagnostic(
        'persisted merge preview artifact is not a clean applyable review result.',
      ),
    );
  }
  if (payload.conflicts.length > 0) {
    diagnostics.push(
      resolutionMismatchDiagnostic('clean merge preview artifacts must not contain conflicts.'),
    );
  }
  if (options.expectedTargetHead.commitId !== payload.ours) {
    diagnostics.push(
      resolutionMismatchDiagnostic('applyMerge expectedTargetHead must match the ours commit.'),
    );
  }
  return diagnostics;
}

function toMergePreviewArtifactPayload(value: unknown): MergePreviewArtifactPayload | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.recordKind !== 'mergePreview') {
    return null;
  }
  if (
    value.status !== 'clean' &&
    value.status !== 'conflicted' &&
    value.status !== 'fastForward' &&
    value.status !== 'alreadyMerged'
  ) {
    return null;
  }
  if (
    !isWorkbookCommitId(value.base) ||
    !isWorkbookCommitId(value.ours) ||
    !isWorkbookCommitId(value.theirs) ||
    !Array.isArray(value.changes) ||
    !Array.isArray(value.conflicts)
  ) {
    return null;
  }
  return value as unknown as MergePreviewArtifactPayload;
}

function getAttachedVersionStoreProvider(ctx: DocumentContext): VersionStoreProvider | null {
  const services = getAttachedVersionServices(ctx);
  if (!services) return null;
  for (const candidate of [services.provider, services.versionStoreProvider, services.storeProvider, services]) {
    if (hasVersionStoreProviderReads(candidate)) return candidate as VersionStoreProvider;
  }
  return null;
}

function getAttachedVersionApplyMergeService(
  ctx: DocumentContext,
): AttachedVersionApplyMergeService | null {
  const services = getAttachedVersionServices(ctx);
  if (!services) return null;
  for (const candidate of [
    services.applyMergeService,
    services.versionApplyMergeService,
    services.writeService,
    services.versionWriteService,
    services.commitService,
    services.publicService,
  ]) {
    const service = toApplyMergeService(candidate);
    if (service) return service;
  }
  return null;
}

function getAttachedVersionServices(ctx: DocumentContext): AttachedVersionServices | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  return isRecord(services) ? (services as AttachedVersionServices) : null;
}

function toApplyMergeService(value: unknown): AttachedVersionApplyMergeService | null {
  const mergeCommit =
    bindMethod(value, 'mergeCommit') ??
    bindMethod(value, 'applyMerge') ??
    bindMethod(value, 'applyMergeVersion') ??
    bindMethod(value, 'applyMergeCommit');
  if (!mergeCommit) return null;
  return { mergeCommit: (input) => mergeCommit(input) };
}

function hasVersionStoreProviderReads(value: unknown): value is VersionStoreProvider {
  return isRecord(value) && typeof value.readGraphRegistry === 'function';
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function mapProviderDiagnostics(diagnostics: readonly unknown[]): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) return [providerErrorDiagnostic()];
  return diagnostics.map((diagnostic) => {
    if (!isRecord(diagnostic)) return providerErrorDiagnostic();
    return publicDiagnostic(
      typeof diagnostic.issueCode === 'string'
        ? diagnostic.issueCode
        : typeof diagnostic.code === 'string'
          ? diagnostic.code
          : 'VERSION_PROVIDER_FAILED',
      typeof diagnostic.safeMessage === 'string'
        ? diagnostic.safeMessage
        : typeof diagnostic.message === 'string'
          ? diagnostic.message
          : 'Version applyMerge provider failed.',
      {
        recoverability: isRecoverability(diagnostic.recoverability)
          ? diagnostic.recoverability
          : 'retry',
      },
    );
  });
}

function blockedApplyMergeResult(
  base: WorkbookCommitId | null,
  ours: WorkbookCommitId | null,
  theirs: WorkbookCommitId | null,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionApplyMergeResult {
  return {
    status: 'blocked',
    base,
    ours,
    theirs,
    changes: [],
    conflicts: [],
    diagnostics,
    mutationGuarantee: 'no-write-attempted',
  };
}

function invalidPreviewArtifactDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_INVALID_COMMIT_PAYLOAD',
    'Persisted merge preview artifact payload is invalid.',
    { recoverability: 'repair' },
  );
}

function resolutionMismatchDiagnostic(safeMessage: string): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_MERGE_RESOLUTION_MISMATCH', safeMessage, {
    recoverability: 'none',
  });
}

function applyMergeServiceUnavailableDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic(
    'VERSION_STORE_UNAVAILABLE',
    'No production merge-apply service is attached for version graph writes.',
    { recoverability: 'unsupported' },
  );
}

function providerErrorDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_PROVIDER_FAILED', 'Version applyMerge provider failed.', {
    recoverability: 'retry',
  });
}

function publicDiagnostic(
  issueCode: string,
  safeMessage: string,
  options: {
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly payload?: VersionStoreDiagnostic['payload'];
  } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: 'error',
    recoverability: options.recoverability ?? 'none',
    messageTemplateId: `version.applyMerge.${issueCode}`,
    safeMessage,
    ...(options.payload ? { payload: { operation: 'applyMerge', ...options.payload } } : {}),
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  };
}

function digestsEqual(
  left: { readonly algorithm: string; readonly digest: string },
  right: { readonly algorithm: string; readonly digest: string },
): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

function isInternalSha256Digest(value: ObjectDigest): boolean {
  return Boolean(toInternalSha256Digest(value));
}

function toInternalSha256Digest(value: ObjectDigest): InternalObjectDigest | null {
  return value.algorithm === 'sha256'
    ? (value as InternalObjectDigest)
    : null;
}

function isWorkbookCommitId(value: unknown): value is WorkbookCommitId {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value);
}

function isRecoverability(value: unknown): value is VersionStoreDiagnostic['recoverability'] {
  return value === 'retry' || value === 'repair' || value === 'unsupported' || value === 'none';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
