import type {
  JsonValue,
  ObjectDigest,
  VersionStoreDiagnostic,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import {
  MERGE_PREVIEW_OBJECT_TYPE,
  mergePreviewArtifactRef,
  mergeResultIdForPreviewDigest,
  type MergePreviewArtifactPayload,
} from '../../document/version-store/merge-attempt-artifacts';
import type { ObjectDigest as InternalObjectDigest } from '../../document/version-store/object-digest';
import { VersionObjectStoreError, createVersionObjectRecord, type VersionGraphNamespace, type VersionObjectRecord } from '../../document/version-store/object-store';
import type { VersionStoreProvider } from '../../document/version-store/provider';
import type { VersionGraphStore } from '../../document/version-store/provider-graph-store';
import { namespaceForRegistry } from '../../document/version-store/registry';
import type { VersionMergePublicOperation } from './version-merge-capability';

const SHA256_HEX_RE = /^[0-9a-f]{64}$/;
const REVIEW_EXTENSION_OBJECT_TYPE = 'workbook.reviewExtension.v1' as const;

type AttachedVersionServices = {
  readonly provider?: unknown;
  readonly versionStoreProvider?: unknown;
  readonly storeProvider?: unknown;
  readonly publicService?: unknown;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

export type MergeReviewGraphOpenResult =
  | {
      readonly ok: true;
      readonly namespace: VersionGraphNamespace;
      readonly graph: VersionGraphStore;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export type MergeReviewPreviewReadResult =
  | { readonly ok: true; readonly payload: MergePreviewArtifactPayload }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export async function openMergeReviewGraph(
  ctx: DocumentContext,
  operation: VersionMergePublicOperation,
): Promise<MergeReviewGraphOpenResult> {
  const provider = getAttachedVersionStoreProvider(ctx);
  if (!provider) {
    return {
      ok: false,
      diagnostics: [
        mergeReviewDiagnostic(
          operation,
          'VERSION_STORE_UNAVAILABLE',
          'No version graph provider is attached for persisted merge review.',
          { recoverability: 'unsupported' },
        ),
      ],
    };
  }

  try {
    const registry = await provider.readGraphRegistry();
    if (registry.status !== 'ok') {
      return {
        ok: false,
        diagnostics: mapMergeReviewProviderDiagnostics(operation, registry.diagnostics),
      };
    }
    const namespace = namespaceForRegistry(registry.registry);
    return {
      ok: true,
      namespace,
      graph: await provider.openGraph(namespace, provider.accessContext),
    };
  } catch {
    return { ok: false, diagnostics: [mergeReviewProviderErrorDiagnostic(operation)] };
  }
}

export async function readMergePreviewArtifact(
  graph: VersionGraphStore,
  operation: VersionMergePublicOperation,
  digest: ObjectDigest,
): Promise<MergeReviewPreviewReadResult> {
  const internalDigest = toInternalSha256Digest(digest);
  if (!internalDigest) {
    return {
      ok: false,
      diagnostics: [
        mergeReviewDiagnostic(
          operation,
          'VERSION_INVALID_OPTIONS',
          'resultDigest must be a sha256 merge preview digest.',
          { payload: { option: 'resultDigest' } },
        ),
      ],
    };
  }

  try {
    const record = await graph.getObjectRecord<unknown>(mergePreviewArtifactRef(internalDigest));
    if (record.preimage.objectType !== MERGE_PREVIEW_OBJECT_TYPE) {
      return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
    }
    const payload = toMergePreviewArtifactPayload(record.preimage.payload);
    if (!payload) {
      return { ok: false, diagnostics: [invalidPreviewArtifactDiagnostic(operation)] };
    }
    return { ok: true, payload };
  } catch (error) {
    if (
      error instanceof VersionObjectStoreError &&
      error.diagnostic.code === 'VERSION_OBJECT_NOT_FOUND'
    ) {
      return {
        ok: false,
        diagnostics: [
          mergeReviewDiagnostic(
            operation,
            'VERSION_MISSING_OBJECT',
            'Persisted merge preview artifact could not be found.',
            { recoverability: 'repair' },
          ),
        ],
      };
    }
    return { ok: false, diagnostics: [mergeReviewProviderErrorDiagnostic(operation)] };
  }
}

export async function createMergeReviewPayloadRecord(
  namespace: VersionGraphNamespace,
  input: {
    readonly resultId: string;
    readonly resultDigest: InternalObjectDigest;
    readonly redactionPolicyDigest: ObjectDigest;
    readonly conflictId: string;
    readonly expectedConflictDigest: string;
    readonly optionId: string;
    readonly kind: string;
    readonly targetRef: string;
    readonly expectedTargetHead: JsonValue;
    readonly purpose: string;
    readonly domainPayloadSchema?: string;
    readonly value: JsonValue;
  },
): Promise<VersionObjectRecord<unknown>> {
  return createVersionObjectRecord(namespace, {
    objectType: REVIEW_EXTENSION_OBJECT_TYPE,
    schemaVersion: 1,
    payloadEncoding: 'mog-canonical-json-v1',
    dependencies: [mergePreviewArtifactRef(input.resultDigest)],
    payload: {
      schemaVersion: 1,
      recordKind: 'mergeResolutionPayload',
      resultId: input.resultId,
      resultDigest: input.resultDigest,
      redactionPolicyDigest: input.redactionPolicyDigest,
      conflictId: input.conflictId,
      expectedConflictDigest: input.expectedConflictDigest,
      optionId: input.optionId,
      kind: input.kind,
      targetRef: input.targetRef,
      expectedTargetHead: input.expectedTargetHead,
      purpose: input.purpose,
      ...(input.domainPayloadSchema === undefined
        ? {}
        : { domainPayloadSchema: input.domainPayloadSchema }),
      value: input.value,
    },
  });
}

export function validateMergePreviewIdentity(
  operation: VersionMergePublicOperation,
  resultId: string,
  resultDigest: ObjectDigest,
): readonly VersionStoreDiagnostic[] {
  const internalDigest = toInternalSha256Digest(resultDigest);
  if (!internalDigest) {
    return [
      mergeReviewDiagnostic(
        operation,
        'VERSION_INVALID_OPTIONS',
        'resultDigest must be a sha256 merge preview digest.',
        { payload: { option: 'resultDigest' } },
      ),
    ];
  }
  if (resultId !== mergeResultIdForPreviewDigest(internalDigest)) {
    return [
      mergeReviewDiagnostic(
        operation,
        'VERSION_MERGE_RESOLUTION_MISMATCH',
        'resultId does not match the merge preview digest.',
        { recoverability: 'none' },
      ),
    ];
  }
  return [];
}

export function toInternalSha256Digest(value: ObjectDigest): InternalObjectDigest | null {
  return value.algorithm === 'sha256' && SHA256_HEX_RE.test(value.digest)
    ? (value as InternalObjectDigest)
    : null;
}

export function mergeReviewProviderErrorDiagnostic(
  operation: VersionMergePublicOperation,
): VersionStoreDiagnostic {
  return mergeReviewDiagnostic(
    operation,
    'VERSION_PROVIDER_FAILED',
    'Version merge review provider failed.',
    { recoverability: 'retry' },
  );
}

export function invalidPreviewArtifactDiagnostic(
  operation: VersionMergePublicOperation,
): VersionStoreDiagnostic {
  return mergeReviewDiagnostic(
    operation,
    'VERSION_INVALID_COMMIT_PAYLOAD',
    'Persisted merge preview artifact payload is invalid or unsupported.',
    { recoverability: 'repair' },
  );
}

export function mapMergeReviewProviderDiagnostics(
  operation: VersionMergePublicOperation,
  diagnostics: readonly unknown[],
): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(diagnostics) || diagnostics.length === 0) {
    return [mergeReviewProviderErrorDiagnostic(operation)];
  }
  return diagnostics.map((diagnostic) => {
    if (!isRecord(diagnostic)) return mergeReviewProviderErrorDiagnostic(operation);
    const issueCode =
      typeof diagnostic.issueCode === 'string'
        ? diagnostic.issueCode
        : typeof diagnostic.code === 'string'
          ? diagnostic.code
          : 'VERSION_PROVIDER_FAILED';
    return mergeReviewDiagnostic(
      operation,
      issueCode,
      typeof diagnostic.safeMessage === 'string'
        ? diagnostic.safeMessage
        : typeof diagnostic.message === 'string'
          ? diagnostic.message
          : 'Version merge review provider failed.',
      {
        recoverability: isRecoverability(diagnostic.recoverability)
          ? diagnostic.recoverability
          : recoverabilityForIssue(issueCode),
      },
    );
  });
}

export function mergeReviewDiagnostic(
  operation: VersionMergePublicOperation,
  issueCode: string,
  safeMessage: string,
  options: {
    readonly severity?: VersionStoreDiagnostic['severity'];
    readonly recoverability?: VersionStoreDiagnostic['recoverability'];
    readonly payload?: VersionStoreDiagnostic['payload'];
    readonly mutationGuarantee?: VersionStoreDiagnostic['mutationGuarantee'];
  } = {},
): VersionStoreDiagnostic {
  return {
    issueCode,
    severity: options.severity ?? 'error',
    recoverability: options.recoverability ?? recoverabilityForIssue(issueCode),
    messageTemplateId: `version.${operation}.${issueCode}`,
    safeMessage,
    payload: { operation, ...(options.payload ?? {}) },
    redacted: true,
    mutationGuarantee: options.mutationGuarantee ?? 'no-write-attempted',
  };
}

function getAttachedVersionStoreProvider(ctx: DocumentContext): VersionStoreProvider | null {
  const services = getAttachedVersionServices(ctx);
  if (!services) return null;
  for (const candidate of [
    services.provider,
    services.versionStoreProvider,
    services.storeProvider,
    services.publicService,
    services,
  ]) {
    if (hasVersionStoreProviderReads(candidate)) return candidate as VersionStoreProvider;
  }
  return null;
}

function getAttachedVersionServices(ctx: DocumentContext): AttachedVersionServices | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  return isRecord(services) ? (services as AttachedVersionServices) : null;
}

function hasVersionStoreProviderReads(value: unknown): value is VersionStoreProvider {
  return (
    isRecord(value) &&
    typeof value.readGraphRegistry === 'function' &&
    typeof value.openGraph === 'function'
  );
}

function toMergePreviewArtifactPayload(value: unknown): MergePreviewArtifactPayload | null {
  if (!isRecord(value) || value.schemaVersion !== 1 || value.recordKind !== 'mergePreview') {
    return null;
  }
  if (value.status !== 'clean' && value.status !== 'conflicted') return null;
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

function recoverabilityForIssue(issueCode: string): VersionStoreDiagnostic['recoverability'] {
  switch (issueCode) {
    case 'VERSION_PROVIDER_FAILED':
    case 'VERSION_REF_CONFLICT':
    case 'VERSION_STALE_PAGE_CURSOR':
      return 'retry';
    case 'VERSION_INVALID_COMMIT_PAYLOAD':
    case 'VERSION_MISSING_DEPENDENCY':
    case 'VERSION_MISSING_OBJECT':
    case 'VERSION_OBJECT_STORE_FAILURE':
      return 'repair';
    case 'VERSION_GRAPH_UNINITIALIZED':
    case 'VERSION_PERMISSION_DENIED':
    case 'VERSION_STORE_UNAVAILABLE':
    case 'VERSION_UNSUPPORTED_SCHEMA':
      return 'unsupported';
    default:
      return 'none';
  }
}

function isRecoverability(value: unknown): value is VersionStoreDiagnostic['recoverability'] {
  return value === 'retry' || value === 'repair' || value === 'unsupported' || value === 'none';
}

function isWorkbookCommitId(value: unknown): boolean {
  return typeof value === 'string' && /^commit:sha256:[0-9a-f]{64}$/.test(value);
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
