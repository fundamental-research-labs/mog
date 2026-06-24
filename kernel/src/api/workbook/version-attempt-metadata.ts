import type {
  ObjectDigest,
  VersionApplyMergeAttemptMetadata,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeAttemptKind,
  VersionMergeAttemptMetadata,
  VersionMergeAttemptPersistence,
  VersionMergeResultId,
  VersionRecordRevision,
  VersionRefName,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import { validateRefName } from '../../document/version-store/refs/ref-name';

const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const OBJECT_DIGEST_RE = /^[0-9a-f]{64}$/;
const VERSION_MAIN_REF = 'refs/heads/main' satisfies VersionMainRefName;
const VERSION_BRANCH_REF_PREFIX = 'refs/heads/';
const VERSION_EXPECTED_HEAD_KEYS = new Set(['commitId', 'revision', 'symbolicHeadRevision']);
const OBJECT_DIGEST_KEYS = new Set(['algorithm', 'digest', 'byteLength']);
const MERGE_RESULT_ID_RE = /^merge-result:[0-9a-f]{64}$/;
const VERSION_MERGE_ATTEMPT_METADATA_KEYS = new Set([
  'previewArtifactDigest',
  'resultDigest',
  'resolutionSetDigest',
  'resolvedAttemptDigest',
  'attemptPersistence',
  'attemptKind',
  'resultId',
  'expiresAt',
  'targetRef',
  'expectedTargetHead',
  'applicationPlanDigest',
  'applyEligibilityDigest',
]);
const VERSION_APPLY_MERGE_ATTEMPT_METADATA_KEYS = new Set([
  'resultId',
  'previewArtifactDigest',
  'resultDigest',
  'resolutionSetDigest',
  'resolvedAttemptDigest',
  'targetRef',
  'headBefore',
  'headAfter',
  'applicationPlanDigest',
]);
const VERSION_MERGE_RESULT_ENVELOPE_KEYS = new Set([
  'status',
  'base',
  'ours',
  'theirs',
  'changes',
  'conflicts',
  'diagnostics',
  'mutationGuarantee',
]);
const VERSION_APPLY_MERGE_RESULT_ENVELOPE_KEYS = new Set([
  'status',
  'base',
  'ours',
  'theirs',
  'commitRef',
  'commit',
  'changes',
  'conflicts',
  'diagnostics',
  'resolutionCount',
  'mutationGuarantee',
]);
const REDACTED_PROVIDER_PAYLOAD_KEYS = new Set([
  'operation',
  'operationContext',
  'operationPayload',
  'source',
  'sourceContext',
  'sourcePayload',
]);
const METADATA_LIKE_KEY_TOKENS = [
  'artifact',
  'attempt',
  'digest',
  'eligibility',
  'expectedhead',
  'expectedtargethead',
  'expires',
  'headafter',
  'headbefore',
  'metadata',
  'persistence',
  'plan',
  'resultid',
  'targethead',
  'targetref',
];

type Mutable<T> = { -readonly [K in keyof T]?: T[K] };

export function mapVersionMergeAttemptMetadata(
  value: Readonly<Record<string, unknown>>,
): VersionMergeAttemptMetadata | null {
  if (
    !hasCanonicalMetadataKeys(
      value,
      VERSION_MERGE_ATTEMPT_METADATA_KEYS,
      VERSION_MERGE_RESULT_ENVELOPE_KEYS,
    )
  ) {
    return null;
  }
  const metadata: Mutable<VersionMergeAttemptMetadata> = {};
  if (!copyDigest(value, metadata, 'previewArtifactDigest')) return null;
  if (!copyDigest(value, metadata, 'resultDigest')) return null;
  if (!copyDigest(value, metadata, 'resolutionSetDigest')) return null;
  if (!copyDigest(value, metadata, 'resolvedAttemptDigest')) return null;
  if (!copyMergeAttemptPersistence(value, metadata)) return null;
  if (!copyMergeAttemptKind(value, metadata)) return null;
  if (!copyMergeResultId(value, metadata)) return null;
  if (!copyString(value, metadata, 'expiresAt')) return null;
  if (!copyTargetRef(value, metadata, 'targetRef')) return null;
  if (!copyExpectedTargetHead(value, metadata, 'expectedTargetHead')) return null;
  if (!copyDigest(value, metadata, 'applicationPlanDigest')) return null;
  if (!copyDigest(value, metadata, 'applyEligibilityDigest')) return null;
  if (!hasDeterministicDigestClosure(metadata)) return null;
  return metadata;
}

export function mapVersionApplyMergeAttemptMetadata(
  value: Readonly<Record<string, unknown>>,
): VersionApplyMergeAttemptMetadata | null {
  if (
    !hasCanonicalMetadataKeys(
      value,
      VERSION_APPLY_MERGE_ATTEMPT_METADATA_KEYS,
      VERSION_APPLY_MERGE_RESULT_ENVELOPE_KEYS,
    )
  ) {
    return null;
  }
  const metadata: Mutable<VersionApplyMergeAttemptMetadata> = {};
  if (!copyMergeResultId(value, metadata)) return null;
  if (!copyDigest(value, metadata, 'previewArtifactDigest')) return null;
  if (!copyDigest(value, metadata, 'resultDigest')) return null;
  if (!copyDigest(value, metadata, 'resolutionSetDigest')) return null;
  if (!copyDigest(value, metadata, 'resolvedAttemptDigest')) return null;
  if (!copyTargetRef(value, metadata, 'targetRef')) return null;
  if (!copyCommitId(value, metadata, 'headBefore')) return null;
  if (!copyCommitId(value, metadata, 'headAfter')) return null;
  if (!copyDigest(value, metadata, 'applicationPlanDigest')) return null;
  if (!hasDeterministicDigestClosure(metadata)) return null;
  return metadata;
}

export function mapPublicExpectedTargetHead(value: unknown): VersionCommitExpectedHead | undefined {
  if (!isRecord(value) || Array.isArray(value)) return undefined;
  for (const key of Object.keys(value)) {
    if (!VERSION_EXPECTED_HEAD_KEYS.has(key)) return undefined;
  }
  const commitId = mapCommitId(value.commitId);
  const revision = mapPublicRevision(value.revision);
  const symbolicHeadRevision =
    value.symbolicHeadRevision === undefined
      ? undefined
      : mapPublicRevision(value.symbolicHeadRevision);
  if (!commitId || !revision || ('symbolicHeadRevision' in value && !symbolicHeadRevision)) {
    return undefined;
  }
  return {
    commitId,
    revision,
    ...(symbolicHeadRevision ? { symbolicHeadRevision } : {}),
  };
}

export function mapPublicTargetRef(
  value: unknown,
): VersionMainRefName | VersionRefName | undefined {
  if (typeof value !== 'string') return undefined;
  const branchName = value.startsWith(VERSION_BRANCH_REF_PREFIX)
    ? value.slice(VERSION_BRANCH_REF_PREFIX.length)
    : value;
  const parsed = validateRefName(branchName, 'targetRef');
  if (!parsed.ok) return undefined;
  return parsed.name === 'main'
    ? VERSION_MAIN_REF
    : (`${VERSION_BRANCH_REF_PREFIX}${parsed.name}` as VersionRefName);
}

export function mapCommitId(value: unknown): WorkbookCommitId | undefined {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : undefined;
}

export function mapPublicObjectDigest(value: unknown): ObjectDigest | undefined {
  return mapObjectDigest(value);
}

function copyDigest(
  source: Readonly<Record<string, unknown>>,
  target: Record<string, unknown>,
  key: string,
): boolean {
  if (source[key] === undefined) return true;
  const digest = mapObjectDigest(source[key]);
  if (!digest) return false;
  target[key] = digest;
  return true;
}

function copyString(
  source: Readonly<Record<string, unknown>>,
  target: Record<string, unknown>,
  key: string,
): boolean {
  if (source[key] === undefined) return true;
  if (typeof source[key] !== 'string' || source[key].length === 0) return false;
  target[key] = source[key];
  return true;
}

function copyTargetRef(
  source: Readonly<Record<string, unknown>>,
  target: Record<string, unknown>,
  key: string,
): boolean {
  if (source[key] === undefined) return true;
  const targetRef = mapPublicTargetRef(source[key]);
  if (!targetRef) return false;
  target[key] = targetRef;
  return true;
}

function copyExpectedTargetHead(
  source: Readonly<Record<string, unknown>>,
  target: Record<string, unknown>,
  key: string,
): boolean {
  if (source[key] === undefined) return true;
  const expectedTargetHead = mapPublicExpectedTargetHead(source[key]);
  if (!expectedTargetHead) return false;
  target[key] = expectedTargetHead;
  return true;
}

function copyCommitId(
  source: Readonly<Record<string, unknown>>,
  target: Record<string, unknown>,
  key: string,
): boolean {
  if (source[key] === undefined) return true;
  const commitId = mapCommitId(source[key]);
  if (!commitId) return false;
  target[key] = commitId;
  return true;
}

function copyMergeResultId(
  source: Readonly<Record<string, unknown>>,
  target: Mutable<{ readonly resultId: VersionMergeResultId }>,
): boolean {
  if (source.resultId === undefined) return true;
  if (typeof source.resultId !== 'string' || !MERGE_RESULT_ID_RE.test(source.resultId))
    return false;
  target.resultId = source.resultId as VersionMergeResultId;
  return true;
}

function copyMergeAttemptPersistence(
  source: Readonly<Record<string, unknown>>,
  target: Mutable<{ readonly attemptPersistence: VersionMergeAttemptPersistence }>,
): boolean {
  if (source.attemptPersistence === undefined) return true;
  if (source.attemptPersistence !== 'ephemeral' && source.attemptPersistence !== 'persisted') {
    return false;
  }
  target.attemptPersistence = source.attemptPersistence;
  return true;
}

function copyMergeAttemptKind(
  source: Readonly<Record<string, unknown>>,
  target: Mutable<{ readonly attemptKind: VersionMergeAttemptKind }>,
): boolean {
  if (source.attemptKind === undefined) return true;
  if (source.attemptKind !== 'applyable' && source.attemptKind !== 'reviewOnly') return false;
  target.attemptKind = source.attemptKind;
  return true;
}

function mapObjectDigest(value: unknown): ObjectDigest | undefined {
  if (!isRecord(value) || Array.isArray(value)) return undefined;
  for (const key of Object.keys(value)) {
    if (!OBJECT_DIGEST_KEYS.has(key)) return undefined;
  }
  if (
    (value.algorithm !== 'sha256' && value.algorithm !== 'blake3') ||
    typeof value.digest !== 'string' ||
    !OBJECT_DIGEST_RE.test(value.digest)
  ) {
    return undefined;
  }
  const byteLength = value.byteLength;
  if (
    byteLength !== undefined &&
    (typeof byteLength !== 'number' || !Number.isInteger(byteLength) || byteLength < 0)
  ) {
    return undefined;
  }
  return {
    algorithm: value.algorithm,
    digest: value.digest,
    ...(byteLength !== undefined ? { byteLength } : {}),
  };
}

export function mapPublicRevision(value: unknown): VersionRecordRevision | undefined {
  if (
    isRecord(value) &&
    (value.kind === 'counter' || value.kind === 'opaque') &&
    typeof value.value === 'string' &&
    value.value.length > 0
  ) {
    return { kind: value.kind, value: value.value };
  }
  if (typeof value === 'string' && value.length > 0) return { kind: 'opaque', value };
  return undefined;
}

function hasCanonicalMetadataKeys(
  source: Readonly<Record<string, unknown>>,
  metadataKeys: ReadonlySet<string>,
  envelopeKeys: ReadonlySet<string>,
): boolean {
  for (const key of Object.keys(source)) {
    if (metadataKeys.has(key) || envelopeKeys.has(key) || REDACTED_PROVIDER_PAYLOAD_KEYS.has(key)) {
      continue;
    }
    if (looksLikeVersionAttemptMetadataKey(key)) return false;
  }
  return true;
}

function looksLikeVersionAttemptMetadataKey(key: string): boolean {
  const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
  return METADATA_LIKE_KEY_TOKENS.some((token) => normalized.includes(token));
}

function hasDeterministicDigestClosure(
  metadata: Readonly<{
    readonly resultId?: VersionMergeResultId;
    readonly previewArtifactDigest?: ObjectDigest;
    readonly resultDigest?: ObjectDigest;
    readonly resolvedAttemptDigest?: ObjectDigest;
  }>,
): boolean {
  if (!metadata.resultId) return true;
  const closingDigest =
    metadata.resolvedAttemptDigest ??
    (metadata.previewArtifactDigest &&
    metadata.resultDigest &&
    digestsEqual(metadata.previewArtifactDigest, metadata.resultDigest)
      ? metadata.resultDigest
      : undefined);
  return (
    closingDigest === undefined || metadata.resultId === `merge-result:${closingDigest.digest}`
  );
}

function digestsEqual(left: ObjectDigest, right: ObjectDigest): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
