import type {
  ObjectDigest,
  VersionApplyMergeResult,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeResultId,
  VersionRefName,
  VersionStoreDiagnostic,
  WorkbookCommitId,
  WorkbookCommitRef,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import {
  computeMergeApplyRefCasProof,
  hasMergeApplyIntentStoreProvider,
  intentIdForMergeResultId,
  intentIdForResolvedAttemptDigest,
  type MergeApplyIntentApplyKind,
  type MergeApplyIntentId,
  type MergeApplyIntentRecord,
  type MergeApplyIntentStore,
  type MergeApplyIntentStoreDiagnostic,
  type MergeApplyIntentStoreProvider,
  type MergeApplyRefCasProof,
} from '../../document/version-store/merge-apply-intent-store';
import type { ObjectDigest as StoreObjectDigest } from '../../document/version-store/object-digest';
import type { VersionStoreProvider } from '../../document/version-store/provider';
import { namespaceForRegistry } from '../../document/version-store/registry';
import type { VersionGraphStore } from '../../document/version-store/provider-graph-store';

export type RecoverPersistedMergeApplyPostCasInput = {
  readonly resultId?: VersionMergeResultId;
  readonly resolvedAttemptDigest?: ObjectDigest;
  readonly resultDigest?: ObjectDigest;
  readonly resolutionSetDigest?: ObjectDigest;
  readonly targetRef?: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead?: VersionCommitExpectedHead;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

type AttachedVersionServices = {
  readonly provider?: unknown;
  readonly versionStoreProvider?: unknown;
  readonly storeProvider?: unknown;
};

type OpenRecoveryStoreResult =
  | {
      readonly ok: true;
      readonly provider: VersionStoreProvider & MergeApplyIntentStoreProvider;
      readonly graph: VersionGraphStore;
      readonly store: MergeApplyIntentStore;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

type TargetHeadReadResult =
  | { readonly ok: true; readonly commitId: WorkbookCommitId }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] };

export async function recoverPersistedMergeApplyPostCas(
  ctx: DocumentContext,
  input: RecoverPersistedMergeApplyPostCasInput,
): Promise<VersionApplyMergeResult> {
  const intentId = intentIdFromRecoveryInput(input);
  if (!intentId) {
    return blockedApplyMergeResult(null, null, null, [
      invalidRecoveryInputDiagnostic('Recovery input must identify an existing merge apply intent.'),
    ]);
  }

  const opened = await openRecoveryStore(ctx);
  if (!opened.ok) return blockedApplyMergeResult(null, null, null, opened.diagnostics);

  const read = await opened.store.readByIntentId(intentId);
  if (read.status !== 'found') {
    return blockedApplyMergeResult(null, null, null, intentStoreDiagnostics(read.diagnostics));
  }

  const record = read.record;
  const validationDiagnostics = validateRecoveryInput(record, input);
  if (validationDiagnostics.length > 0) {
    return blockedApplyMergeResult(record.base, record.ours, record.theirs, validationDiagnostics);
  }
  if (record.terminal) return resultFromTerminalIntent(opened.graph, record);

  if (record.applyKind === 'fastForward') {
    return recoverFastForwardPostCas(opened.graph, opened.store, record);
  }
  if (record.applyKind === 'mergeCommit') {
    return recoverMergeCommitPostCas(opened.graph, opened.store, record);
  }
  return blockedApplyMergeResult(record.base, record.ours, record.theirs, [
    recoveryNotReadyDiagnostic('Merge apply intent does not require post-CAS recovery.'),
  ]);
}

async function recoverFastForwardPostCas(
  graph: VersionGraphStore,
  store: MergeApplyIntentStore,
  record: MergeApplyIntentRecord,
): Promise<VersionApplyMergeResult> {
  const current = await readCurrentTargetHead(graph, record.targetRef);
  if (!current.ok) {
    return blockedApplyMergeResult(record.base, record.ours, record.theirs, current.diagnostics);
  }
  if (current.commitId !== record.theirs) {
    return current.commitId === record.ours
      ? blockedApplyMergeResult(record.base, record.ours, record.theirs, [
          recoveryNotReadyDiagnostic('Fast-forward ref CAS is not visible yet.'),
        ])
      : staleTargetHeadResult(record, current.commitId);
  }

  const proof = await readAndValidateRefCasProof(store, record, 'fastForward', record.theirs);
  if (!proof.ok) {
    return blockedApplyMergeResult(
      record.base,
      record.ours,
      record.theirs,
      proof.diagnostics,
      'ref-not-mutated',
    );
  }
  const completed = await completeRecoveredIntent(store, record, 'fastForwarded', record.theirs, proof.proof);
  if (completed.status !== 'completed') {
    return blockedApplyMergeResult(
      record.base,
      record.ours,
      record.theirs,
      intentStoreDiagnostics(completed.diagnostics),
      'ref-not-mutated',
    );
  }
  return alreadyAppliedResult(completed.record, record.theirs);
}

async function recoverMergeCommitPostCas(
  graph: VersionGraphStore,
  store: MergeApplyIntentStore,
  record: MergeApplyIntentRecord,
): Promise<VersionApplyMergeResult> {
  const current = await readCurrentTargetHead(graph, record.targetRef);
  if (!current.ok) {
    return blockedApplyMergeResult(record.base, record.ours, record.theirs, current.diagnostics);
  }
  if (current.commitId === record.ours) {
    return blockedApplyMergeResult(record.base, record.ours, record.theirs, [
      recoveryNotReadyDiagnostic('Merge commit ref CAS is not visible yet.'),
    ]);
  }

  const identity = await validateMergeCommitIdentity(graph, record, current.commitId);
  if (identity.length > 0) return staleTargetHeadResult(record, current.commitId);

  const proof = await readAndValidateRefCasProof(store, record, 'mergeCommit', current.commitId);
  if (!proof.ok) {
    return blockedApplyMergeResult(
      record.base,
      record.ours,
      record.theirs,
      proof.diagnostics,
      'ref-not-mutated',
    );
  }
  const completed = await completeRecoveredIntent(store, record, 'applied', current.commitId, proof.proof);
  if (completed.status !== 'completed') {
    return blockedApplyMergeResult(
      record.base,
      record.ours,
      record.theirs,
      intentStoreDiagnostics(completed.diagnostics),
      'ref-not-mutated',
    );
  }
  return alreadyAppliedResult(completed.record, current.commitId);
}

async function readAndValidateRefCasProof(
  store: MergeApplyIntentStore,
  record: MergeApplyIntentRecord,
  applyKind: Extract<MergeApplyIntentApplyKind, 'fastForward' | 'mergeCommit'>,
  headAfter: WorkbookCommitId,
): Promise<
  | { readonly ok: true; readonly proof: MergeApplyRefCasProof }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  const read = await store.readRefCasProof({
    applyKind,
    targetRef: record.targetRef,
    headBefore: record.ours,
    headAfter,
  });
  if (read.status !== 'found') {
    return { ok: false, diagnostics: intentStoreDiagnostics(read.diagnostics) };
  }
  const expected = await computeMergeApplyRefCasProof({
    applyKind,
    targetRef: record.targetRef,
    headBefore: record.ours,
    headAfter,
  });
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (read.proof.applyKind !== applyKind) {
    diagnostics.push(refCasProofMismatchDiagnostic('ref CAS proof apply kind does not match.'));
  }
  if (!digestsEqual(read.proof.commitMetadataDigest, expected.commitMetadataDigest)) {
    diagnostics.push(refCasProofMismatchDiagnostic('ref CAS proof commit metadata does not match.'));
  }
  if (!digestsEqual(read.proof.refUpdateMetadataDigest, expected.refUpdateMetadataDigest)) {
    diagnostics.push(refCasProofMismatchDiagnostic('ref CAS proof ref update does not match.'));
  }
  if (!digestsEqual(read.proof.refLogEventDigest, expected.refLogEventDigest)) {
    diagnostics.push(refCasProofMismatchDiagnostic('ref CAS proof event log does not match.'));
  }
  return diagnostics.length === 0
    ? { ok: true, proof: read.proof }
    : { ok: false, diagnostics };
}

function completeRecoveredIntent(
  store: MergeApplyIntentStore,
  record: MergeApplyIntentRecord,
  status: 'fastForwarded' | 'applied',
  commitId: WorkbookCommitId,
  refCasProof: MergeApplyRefCasProof,
) {
  return store.completeIntent({
    intentId: record.intentId,
    resolvedAttemptDigest: record.resolvedAttemptDigest,
    completedAt: new Date().toISOString(),
    terminal: {
      status,
      headBefore: record.ours,
      headAfter: commitId,
      commitId,
      refCasProof,
    },
  });
}

async function resultFromTerminalIntent(
  graph: VersionGraphStore,
  record: MergeApplyIntentRecord,
): Promise<VersionApplyMergeResult> {
  const commitId = record.terminal?.commitId ?? record.terminal?.headAfter;
  if (!commitId) return staleTargetHeadResult(record, record.ours);
  const current = await readCurrentTargetHead(graph, record.targetRef);
  if (!current.ok) {
    return blockedApplyMergeResult(record.base, record.ours, record.theirs, current.diagnostics);
  }
  return current.commitId === commitId
    ? alreadyAppliedResult(record, commitId)
    : staleTargetHeadResult(record, current.commitId);
}

async function validateMergeCommitIdentity(
  graph: VersionGraphStore,
  record: MergeApplyIntentRecord,
  commitId: WorkbookCommitId,
): Promise<readonly VersionStoreDiagnostic[]> {
  try {
    const read = await graph.readCommit(commitId);
    if (read.status !== 'success') return mapProviderDiagnostics(read.diagnostics);
    const payload = read.commit.payload;
    if (
      payload.parentCommitIds.length !== 2 ||
      payload.parentCommitIds[0] !== record.ours ||
      payload.parentCommitIds[1] !== record.theirs
    ) {
      return [recoveryNotReadyDiagnostic('Current target head is not the recorded merge commit.')];
    }
    if (
      payload.resolvedMergeAttemptDigest &&
      !digestsEqual(payload.resolvedMergeAttemptDigest, record.resolvedAttemptDigest)
    ) {
      return [recoveryNotReadyDiagnostic('Current target head is bound to another merge attempt.')];
    }
    return [];
  } catch {
    return [providerErrorDiagnostic()];
  }
}

async function readCurrentTargetHead(
  graph: VersionGraphStore,
  targetRef: VersionMainRefName | VersionRefName,
): Promise<TargetHeadReadResult> {
  try {
    const read = await graph.readRef(targetRef);
    if (read.status !== 'success' || !('commitId' in read.ref)) {
      return { ok: false, diagnostics: mapProviderDiagnostics(read.diagnostics) };
    }
    return { ok: true, commitId: read.ref.commitId };
  } catch {
    return { ok: false, diagnostics: [providerErrorDiagnostic()] };
  }
}

async function openRecoveryStore(ctx: DocumentContext): Promise<OpenRecoveryStoreResult> {
  const provider = getAttachedMergeApplyIntentStoreProvider(ctx);
  if (!provider) {
    return {
      ok: false,
      diagnostics: [
        publicDiagnostic(
          'VERSION_STORE_UNAVAILABLE',
          'No merge apply intent store is attached for recovery.',
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
    const namespace = namespaceForRegistry(registry.registry);
    return {
      ok: true,
      provider,
      graph: await provider.openGraph(namespace, provider.accessContext),
      store: await provider.openMergeApplyIntentStore(namespace),
    };
  } catch {
    return { ok: false, diagnostics: [providerErrorDiagnostic()] };
  }
}

function intentIdFromRecoveryInput(
  input: RecoverPersistedMergeApplyPostCasInput,
): MergeApplyIntentId | null {
  if (input.resolvedAttemptDigest) {
    return isObjectDigest(input.resolvedAttemptDigest)
      ? intentIdForResolvedAttemptDigest(input.resolvedAttemptDigest as StoreObjectDigest)
      : null;
  }
  return input.resultId ? intentIdForMergeResultId(input.resultId) : null;
}

function validateRecoveryInput(
  record: MergeApplyIntentRecord,
  input: RecoverPersistedMergeApplyPostCasInput,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (input.resultDigest && !digestsEqual(record.resultDigest, input.resultDigest)) {
    diagnostics.push(refCasProofMismatchDiagnostic('recovery resultDigest does not match.'));
  }
  if (input.resolutionSetDigest && !digestsEqual(record.resolutionSetDigest, input.resolutionSetDigest)) {
    diagnostics.push(refCasProofMismatchDiagnostic('recovery resolutionSetDigest does not match.'));
  }
  if (
    input.resolvedAttemptDigest &&
    !digestsEqual(record.resolvedAttemptDigest, input.resolvedAttemptDigest)
  ) {
    diagnostics.push(refCasProofMismatchDiagnostic('recovery resolvedAttemptDigest does not match.'));
  }
  if (input.targetRef && record.targetRef !== input.targetRef) {
    diagnostics.push(refCasProofMismatchDiagnostic('recovery targetRef does not match.'));
  }
  if (
    input.expectedTargetHead &&
    JSON.stringify(record.expectedTargetHead) !== JSON.stringify(input.expectedTargetHead)
  ) {
    diagnostics.push(refCasProofMismatchDiagnostic('recovery expectedTargetHead does not match.'));
  }
  return diagnostics;
}

function alreadyAppliedResult(
  record: MergeApplyIntentRecord,
  commitId: WorkbookCommitId,
): VersionApplyMergeResult {
  return {
    ...recoveryMetadata(record, commitId),
    status: 'alreadyApplied',
    base: record.base,
    ours: record.ours,
    theirs: record.theirs,
    commitRef: commitRefForIntent(record, commitId),
    changes: [],
    conflicts: [],
    diagnostics: [],
    resolutionCount: 0,
    mutationGuarantee: 'ref-not-mutated',
  };
}

function staleTargetHeadResult(
  record: MergeApplyIntentRecord,
  currentHead: WorkbookCommitId,
): VersionApplyMergeResult {
  return {
    ...recoveryMetadata(record, currentHead),
    status: 'staleTargetHead',
    base: record.base,
    ours: record.ours,
    theirs: record.theirs,
    changes: [],
    conflicts: [],
    diagnostics: [],
    mutationGuarantee: 'ref-not-mutated',
  };
}

function blockedApplyMergeResult(
  base: WorkbookCommitId | null,
  ours: WorkbookCommitId | null,
  theirs: WorkbookCommitId | null,
  diagnostics: readonly VersionStoreDiagnostic[],
  mutationGuarantee: VersionApplyMergeResult['mutationGuarantee'] = 'no-write-attempted',
): VersionApplyMergeResult {
  return {
    status: 'blocked',
    base,
    ours,
    theirs,
    changes: [],
    conflicts: [],
    diagnostics,
    mutationGuarantee,
  };
}

function recoveryMetadata(record: MergeApplyIntentRecord, headAfter?: WorkbookCommitId) {
  return {
    resultId: publicResultId(record),
    resultDigest: record.resultDigest,
    resolutionSetDigest: record.resolutionSetDigest,
    resolvedAttemptDigest: record.resolvedAttemptDigest,
    targetRef: record.targetRef,
    headBefore: record.terminal?.headBefore ?? record.ours,
    ...(headAfter ? { headAfter } : {}),
  };
}

function commitRefForIntent(
  record: MergeApplyIntentRecord,
  commitId: WorkbookCommitId,
): WorkbookCommitRef {
  return {
    id: commitId,
    refName: record.targetRef,
    resolvedFrom: record.targetRef,
  };
}

function publicResultId(record: MergeApplyIntentRecord): VersionMergeResultId {
  return `merge-result:${record.resolvedAttemptDigest.digest}` as VersionMergeResultId;
}

function getAttachedVersionServices(ctx: DocumentContext): AttachedVersionServices | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  return isRecord(services) ? (services as AttachedVersionServices) : null;
}

function getAttachedMergeApplyIntentStoreProvider(
  ctx: DocumentContext,
): (VersionStoreProvider & MergeApplyIntentStoreProvider) | null {
  const services = getAttachedVersionServices(ctx);
  if (!services) return null;
  for (const candidate of [services.provider, services.versionStoreProvider, services.storeProvider, services]) {
    if (
      isRecord(candidate) &&
      typeof candidate.readGraphRegistry === 'function' &&
      typeof candidate.openGraph === 'function' &&
      hasMergeApplyIntentStoreProvider(candidate)
    ) {
      return candidate as VersionStoreProvider & MergeApplyIntentStoreProvider;
    }
  }
  return null;
}

function intentStoreDiagnostics(
  diagnostics: readonly MergeApplyIntentStoreDiagnostic[],
): readonly VersionStoreDiagnostic[] {
  return diagnostics.map((item) =>
    publicDiagnostic(item.code, item.message, {
      recoverability: item.recoverability,
      ...(item.details ? { payload: item.details } : {}),
    }),
  );
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
          : 'Version applyMerge recovery provider failed.',
      {
        recoverability: isRecoverability(diagnostic.recoverability)
          ? diagnostic.recoverability
          : 'retry',
      },
    );
  });
}

function invalidRecoveryInputDiagnostic(safeMessage: string): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_INVALID_OPTIONS', safeMessage, { recoverability: 'none' });
}

function recoveryNotReadyDiagnostic(safeMessage: string): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_MERGE_RECOVERY_NOT_READY', safeMessage, {
    recoverability: 'retry',
  });
}

function refCasProofMismatchDiagnostic(safeMessage: string): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_MERGE_RESOLUTION_MISMATCH', safeMessage, {
    recoverability: 'none',
  });
}

function providerErrorDiagnostic(): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_PROVIDER_FAILED', 'Version applyMerge recovery failed.', {
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
    ...(options.payload ? { payload: { operation: 'applyMergeRecovery', ...options.payload } } : {}),
    redacted: true,
    mutationGuarantee: 'no-write-attempted',
  };
}

function isObjectDigest(value: unknown): value is ObjectDigest {
  return (
    isRecord(value) &&
    value.algorithm === 'sha256' &&
    typeof value.digest === 'string' &&
    /^[0-9a-f]{64}$/.test(value.digest)
  );
}

function digestsEqual(
  left: { readonly algorithm: string; readonly digest: string } | undefined,
  right: { readonly algorithm: string; readonly digest: string },
): boolean {
  return left?.algorithm === right.algorithm && left.digest === right.digest;
}

function isRecoverability(value: unknown): value is VersionStoreDiagnostic['recoverability'] {
  return value === 'retry' || value === 'repair' || value === 'unsupported' || value === 'none';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
