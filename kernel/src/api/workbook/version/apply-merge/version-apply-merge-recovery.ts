import type {
  VersionApplyMergeResult,
  VersionMainRefName,
  VersionRefName,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../../../context';
import {
  hasMergeApplyIntentStoreProvider,
  type MergeApplyIntentRecord,
  type MergeApplyIntentStore,
  type MergeApplyIntentStoreProvider,
  type MergeApplyRefCasProof,
} from '../../../../document/version-store/merge-apply-intent-store';
import type { VersionStoreProvider } from '../../../../document/version-store/provider';
import { namespaceForRegistry } from '../../../../document/version-store/registry';
import type { VersionGraphStore } from '../../../../document/version-store/provider-graph-store';
import {
  intentStoreDiagnostics,
  isRecord,
  mapProviderDiagnostics,
  providerErrorDiagnostic,
  publicDiagnostic,
  recoveryNotReadyDiagnostic,
} from './version-apply-merge-recovery-diagnostics';
import {
  alreadyAppliedResult,
  blockedApplyMergeResult,
  resultFromTerminalIntent,
  staleTargetHeadBlockedResult,
} from './version-apply-merge-recovery-results';
import {
  readAndValidateRefCasProof,
  recoveryIntentIdentityFromInput,
  validateMergeCommitIdentity,
  validateRecoveryInput,
  type RecoverPersistedMergeApplyPostCasInput,
} from './version-apply-merge-recovery-validation';

export type { RecoverPersistedMergeApplyPostCasInput } from './version-apply-merge-recovery-validation';

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
  const identity = recoveryIntentIdentityFromInput(input);
  if (!identity.ok) {
    return blockedApplyMergeResult(null, null, null, identity.diagnostics);
  }

  const opened = await openRecoveryStore(ctx);
  if (!opened.ok) return blockedApplyMergeResult(null, null, null, opened.diagnostics);

  const read = await opened.store.readByIntentId(identity.intentId);
  if (read.status !== 'found') {
    return blockedApplyMergeResult(null, null, null, intentStoreDiagnostics(read.diagnostics));
  }

  const record = read.record;
  const validationDiagnostics = validateRecoveryInput(record, input, identity.intentId);
  if (validationDiagnostics.length > 0) {
    return blockedApplyMergeResult(record.base, record.ours, record.theirs, validationDiagnostics);
  }
  if (record.terminal) return resultFromTerminalIntent(opened.graph, record, readCurrentTargetHead);

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
      : staleTargetHeadBlockedResult(record);
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
  const completed = await completeRecoveredIntent(
    store,
    record,
    'fastForwarded',
    record.theirs,
    proof.proof,
  );
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
  if (!identity.ok) {
    return blockedApplyMergeResult(
      record.base,
      record.ours,
      record.theirs,
      identity.diagnostics,
      identity.staleTargetHead ? 'ref-not-mutated' : 'no-write-attempted',
    );
  }

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
  const completed = await completeRecoveredIntent(
    store,
    record,
    'applied',
    current.commitId,
    proof.proof,
  );
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
  for (const candidate of [
    services.provider,
    services.versionStoreProvider,
    services.storeProvider,
    services,
  ]) {
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
