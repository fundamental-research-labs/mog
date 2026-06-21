import type {
  ObjectDigest,
  VersionApplyMergeOptions,
  VersionApplyMergeResolution,
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
  hasMergeApplyIntentStoreProvider,
  intentIdForMergeResultId,
  type MergeApplyIntentRecord,
  type MergeApplyIntentStore,
  type MergeApplyIntentStoreDiagnostic,
  type MergeApplyIntentStoreProvider,
} from '../../document/version-store/merge-apply-intent-store';
import type { VersionStoreProvider } from '../../document/version-store/provider';
import { namespaceForRegistry } from '../../document/version-store/registry';
import {
  applyPersistedMergePreviewArtifact,
  isPersistedMergePreviewArtifactInput,
} from './version-apply-merge-persisted-artifact';
import {
  isApplyMergeWriteSuccessResult,
  isNonFastForwardWriteResult,
  mapApplyMergeWriteResult,
} from './version-apply-merge-write-result';
import {
  mapPublicExpectedTargetHead,
  mapPublicObjectDigest,
  mapPublicTargetRef,
} from './version-attempt-metadata';

const VERSION_APPLY_MERGE_PERSISTED_INPUT_KEYS = new Set([
  'resultId',
  'previewArtifactDigest',
  'resultDigest',
  'resolutionSetDigest',
  'resolvedAttemptDigest',
  'resolutions',
]);
const VERSION_APPLY_MERGE_OPTION_KEYS = new Set([
  'mode',
  'targetRef',
  'expectedTargetHead',
  'includeDiagnostics',
]);

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

type AttachedVersionApplyMergeService = {
  readonly fastForwardMerge?: (input: {
    readonly base: WorkbookCommitId;
    readonly ours: WorkbookCommitId;
    readonly theirs: WorkbookCommitId;
    readonly targetRef: VersionMainRefName | VersionRefName;
    readonly expectedTargetHead: VersionCommitExpectedHead;
  }) => MaybePromise<unknown>;
};

type AttachedVersionServices = {
  readonly provider?: unknown;
  readonly versionStoreProvider?: unknown;
  readonly storeProvider?: unknown;
  readonly writeService?: unknown;
  readonly versionWriteService?: unknown;
  readonly applyMergeService?: unknown;
  readonly versionApplyMergeService?: unknown;
  readonly publicService?: unknown;
};

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

export type NormalizedPersistedApplyMergeInput = {
  readonly resultId: VersionMergeResultId;
  readonly previewArtifactDigest?: ObjectDigest;
  readonly resultDigest: ObjectDigest;
  readonly resolutionSetDigest?: ObjectDigest;
  readonly resolvedAttemptDigest?: ObjectDigest;
  readonly resolutions: readonly VersionApplyMergeResolution[];
};

export type NormalizedPersistedApplyMergeOptions = {
  readonly mode: 'preview';
} | {
  readonly mode: 'apply';
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead: VersionCommitExpectedHead;
};

export async function applyPersistedMergeResult(
  ctx: DocumentContext,
  input: Readonly<Record<string, unknown>>,
  options: VersionApplyMergeOptions,
): Promise<VersionApplyMergeResult> {
  const diagnostics: VersionStoreDiagnostic[] = [];
  const normalizedInput = normalizePersistedApplyMergeInput(input, diagnostics);
  const normalizedOptions = normalizePersistedApplyMergeOptions(options, diagnostics);
  if (!normalizedInput || !normalizedOptions || diagnostics.length > 0) {
    return blockedApplyMergeResult(null, null, null, diagnostics);
  }
  if (isPersistedMergePreviewArtifactInput(normalizedInput)) {
    return applyPersistedMergePreviewArtifact(ctx, normalizedInput, normalizedOptions);
  }
  if (normalizedInput.resolutions.length > 0) {
    return blockedApplyMergeResult(null, null, null, [
      resolutionMismatchDiagnostic(
        'persisted applyMerge result inputs currently support only empty resolution sets.',
      ),
    ]);
  }
  if (normalizedOptions.mode === 'preview') {
    return blockedApplyMergeResult(null, null, null, [
      invalidApplyMergeOptionDiagnostic(
        'mode',
        'persisted applyMerge result inputs are valid only in apply mode.',
      ),
    ]);
  }

  const opened = await openPersistedMergeIntentStore(ctx);
  if (!opened.ok) return blockedApplyMergeResult(null, null, null, opened.diagnostics);

  const intentId = intentIdForMergeResultId(normalizedInput.resultId);
  if (!intentId) {
    return blockedApplyMergeResult(null, null, null, [
      invalidApplyMergeOptionDiagnostic('resultId', 'resultId is invalid.'),
    ]);
  }
  const read = await opened.store.readByIntentId(intentId);
  if (read.status !== 'found') {
    return blockedApplyMergeResult(null, null, null, intentStoreDiagnostics(read.diagnostics));
  }

  const record = read.record;
  const validationDiagnostics = validatePersistedIntentRecord(
    record,
    normalizedInput,
    normalizedOptions,
  );
  if (validationDiagnostics.length > 0) {
    return blockedApplyMergeResult(record.base, record.ours, record.theirs, validationDiagnostics);
  }
  if (record.terminal) return resultFromTerminalIntent(opened.provider, record);
  if (record.applyKind === 'alreadyMerged') {
    return completeAlreadyMergedIntent(
      opened.provider,
      opened.store,
      record,
      normalizedInput.resultId,
    );
  }
  if (record.applyKind !== 'fastForward') {
    return blockedApplyMergeResult(record.base, record.ours, record.theirs, [
      publicDiagnostic(
        'VERSION_UNSUPPORTED_MERGE_ATTEMPT',
        'Persisted merge-commit result application is not wired yet.',
        { recoverability: 'unsupported' },
      ),
    ]);
  }

  return applyPersistedFastForwardIntent(
    ctx,
    opened.provider,
    opened.store,
    record,
    normalizedInput.resultId,
  );
}

function normalizePersistedApplyMergeInput(
  input: Readonly<Record<string, unknown>>,
  diagnostics: VersionStoreDiagnostic[],
): NormalizedPersistedApplyMergeInput | null {
  for (const key of Object.keys(input)) {
    if (VERSION_APPLY_MERGE_PERSISTED_INPUT_KEYS.has(key)) continue;
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(`input.${key}`, `Unknown applyMerge input "${key}".`),
    );
  }

  const resultId =
    typeof input.resultId === 'string' && input.resultId.startsWith('merge-result:')
      ? (input.resultId as VersionMergeResultId)
      : undefined;
  if (!resultId || !intentIdForMergeResultId(resultId)) {
    diagnostics.push(invalidApplyMergeOptionDiagnostic('resultId', 'resultId is invalid.'));
  }

  const resultDigest = mapPublicObjectDigest(input.resultDigest);
  if (!resultDigest) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic('resultDigest', 'resultDigest is required and must be valid.'),
    );
  }

  const previewArtifactDigest =
    input.previewArtifactDigest === undefined
      ? undefined
      : mapPublicObjectDigest(input.previewArtifactDigest);
  if (input.previewArtifactDigest !== undefined && !previewArtifactDigest) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic('previewArtifactDigest', 'previewArtifactDigest is invalid.'),
    );
  }

  const resolutionSetDigest =
    input.resolutionSetDigest === undefined
      ? undefined
      : mapPublicObjectDigest(input.resolutionSetDigest);
  if (input.resolutionSetDigest !== undefined && !resolutionSetDigest) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic('resolutionSetDigest', 'resolutionSetDigest is invalid.'),
    );
  }

  const resolvedAttemptDigest =
    input.resolvedAttemptDigest === undefined
      ? undefined
      : mapPublicObjectDigest(input.resolvedAttemptDigest);
  if (input.resolvedAttemptDigest !== undefined && !resolvedAttemptDigest) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic('resolvedAttemptDigest', 'resolvedAttemptDigest is invalid.'),
    );
  }

  const resolutions = normalizePersistedResolutions(input.resolutions, diagnostics);
  return resultId && resultDigest && resolutions
    ? {
        resultId,
        previewArtifactDigest,
        resultDigest,
        resolutionSetDigest,
        resolvedAttemptDigest,
        resolutions,
      }
    : null;
}

function normalizePersistedApplyMergeOptions(
  input: VersionApplyMergeOptions,
  diagnostics: VersionStoreDiagnostic[],
): NormalizedPersistedApplyMergeOptions | null {
  if (!isRecord(input) || Array.isArray(input)) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic('options', 'applyMerge options must be an object.'),
    );
    return null;
  }
  for (const key of Object.keys(input)) {
    if (VERSION_APPLY_MERGE_OPTION_KEYS.has(key)) continue;
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(`options.${key}`, `Unknown applyMerge option "${key}".`),
    );
  }
  let mode: 'preview' | 'apply' = 'apply';
  if (input.mode === 'preview' || input.mode === 'apply') {
    mode = input.mode;
  } else if (input.mode !== undefined) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic('mode', 'applyMerge mode must be "preview" or "apply".'),
    );
  }
  if (input.includeDiagnostics !== undefined && typeof input.includeDiagnostics !== 'boolean') {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic('includeDiagnostics', 'includeDiagnostics must be a boolean.'),
    );
  }

  if (mode === 'preview') {
    if (input.targetRef !== undefined) {
      diagnostics.push(
        invalidApplyMergeOptionDiagnostic('targetRef', 'targetRef is valid only in apply mode.'),
      );
    }
    if (input.expectedTargetHead !== undefined) {
      diagnostics.push(
        invalidApplyMergeOptionDiagnostic(
          'expectedTargetHead',
          'expectedTargetHead is valid only in apply mode.',
        ),
      );
    }
    return diagnostics.length === 0 ? { mode: 'preview' } : null;
  }

  const targetRef = mapPublicTargetRef(input.targetRef);
  const expectedTargetHead = mapPublicExpectedTargetHead(input.expectedTargetHead);
  if (!targetRef) {
    diagnostics.push(invalidApplyMergeOptionDiagnostic('targetRef', 'targetRef is required.'));
  }
  if (!expectedTargetHead) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        'expectedTargetHead',
        'expectedTargetHead is required in apply mode.',
      ),
    );
  }

  return targetRef && expectedTargetHead ? { mode: 'apply', targetRef, expectedTargetHead } : null;
}

function normalizePersistedResolutions(
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): readonly VersionApplyMergeResolution[] | null {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic('resolutions', 'resolutions must be an array when supplied.'),
    );
    return null;
  }
  return value as readonly VersionApplyMergeResolution[];
}

async function openPersistedMergeIntentStore(
  ctx: DocumentContext,
): Promise<
  | {
      readonly ok: true;
      readonly provider: VersionStoreProvider & MergeApplyIntentStoreProvider;
      readonly store: MergeApplyIntentStore;
    }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  const provider = getAttachedMergeApplyIntentStoreProvider(ctx);
  if (!provider) {
    return {
      ok: false,
      diagnostics: [
        publicDiagnostic(
          'VERSION_STORE_UNAVAILABLE',
          'No merge apply intent store is attached for persisted applyMerge.',
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
      provider,
      store: await provider.openMergeApplyIntentStore(namespaceForRegistry(registry.registry)),
    };
  } catch {
    return { ok: false, diagnostics: [providerErrorDiagnostic()] };
  }
}

function validatePersistedIntentRecord(
  record: MergeApplyIntentRecord,
  input: NormalizedPersistedApplyMergeInput,
  options: Extract<NormalizedPersistedApplyMergeOptions, { readonly mode: 'apply' }>,
): readonly VersionStoreDiagnostic[] {
  const diagnostics: VersionStoreDiagnostic[] = [];
  if (!digestsEqual(record.resultDigest, input.resultDigest)) {
    diagnostics.push(
      resolutionMismatchDiagnostic('persisted merge resultDigest does not match the stored attempt.'),
    );
  }
  if (input.resolutionSetDigest && !digestsEqual(record.resolutionSetDigest, input.resolutionSetDigest)) {
    diagnostics.push(
      resolutionMismatchDiagnostic(
        'persisted merge resolutionSetDigest does not match the stored attempt.',
      ),
    );
  }
  if (
    input.resolvedAttemptDigest &&
    !digestsEqual(record.resolvedAttemptDigest, input.resolvedAttemptDigest)
  ) {
    diagnostics.push(
      resolutionMismatchDiagnostic(
        'persisted merge resolvedAttemptDigest does not match the stored attempt.',
      ),
    );
  }
  if (record.targetRef !== options.targetRef) {
    diagnostics.push(resolutionMismatchDiagnostic('persisted merge targetRef does not match.'));
  }
  if (!expectedHeadsEqual(record.expectedTargetHead, options.expectedTargetHead)) {
    diagnostics.push(
      resolutionMismatchDiagnostic('persisted merge expectedTargetHead does not match.'),
    );
  }
  return diagnostics;
}

async function completeAlreadyMergedIntent(
  provider: VersionStoreProvider,
  store: MergeApplyIntentStore,
  record: MergeApplyIntentRecord,
  resultId: VersionMergeResultId,
): Promise<VersionApplyMergeResult> {
  const stale = await resultIfTargetMoved(provider, record, resultId, record.ours);
  if (stale) return stale;

  const completed = await store.completeIntent({
    intentId: record.intentId,
    resolvedAttemptDigest: record.resolvedAttemptDigest,
    completedAt: new Date().toISOString(),
    terminal: {
      status: 'alreadyMerged',
      headBefore: record.ours,
      headAfter: record.ours,
      commitId: record.ours,
    },
  });
  if (completed.status !== 'completed') {
    return blockedApplyMergeResult(
      record.base,
      record.ours,
      record.theirs,
      intentStoreDiagnostics(completed.diagnostics),
      'unknown-after-crash',
    );
  }
  return alreadyMergedPersistedResult(completed.record, resultId);
}

async function applyPersistedFastForwardIntent(
  ctx: DocumentContext,
  provider: VersionStoreProvider,
  store: MergeApplyIntentStore,
  record: MergeApplyIntentRecord,
  resultId: VersionMergeResultId,
): Promise<VersionApplyMergeResult> {
  try {
    const recovered = await completeFastForwardIntentIfAlreadyApplied(
      provider,
      store,
      record,
      resultId,
    );
    if (recovered) return recovered;

    const service = getAttachedVersionApplyMergeService(ctx);
    if (!service?.fastForwardMerge) {
      return blockedApplyMergeResult(record.base, record.ours, record.theirs, [
        applyMergeServiceUnavailableDiagnostic(),
      ]);
    }

    const raw = await service.fastForwardMerge({
      base: record.base,
      ours: record.ours,
      theirs: record.theirs,
      targetRef: record.targetRef,
      expectedTargetHead: record.expectedTargetHead,
    });
    if (isNonFastForwardWriteResult(raw)) {
      return blockedApplyMergeResult(record.base, record.ours, record.theirs, [
        resolutionMismatchDiagnostic('persisted merge attempt is not a fast-forward.'),
      ]);
    }
    const mapped = mapApplyMergeWriteResult(raw, persistedPlan(record), 'ref-fast-forwarded');
    if (!isApplyMergeWriteSuccessResult(mapped)) return mapped;
    const commitRef = 'commitRef' in mapped ? mapped.commitRef : null;
    if (!commitRef) return mapped;

    const completed = await completeFastForwardIntent(store, record, commitRef.id);
    if (completed.status !== 'completed') {
      return blockedApplyMergeResult(
        record.base,
        record.ours,
        record.theirs,
        intentStoreDiagnostics(completed.diagnostics),
        'unknown-after-crash',
      );
    }
    return fastForwardedPersistedResult(completed.record, resultId, commitRef);
  } catch {
    return blockedApplyMergeResult(record.base, record.ours, record.theirs, [providerErrorDiagnostic()]);
  }
}

async function completeFastForwardIntentIfAlreadyApplied(
  provider: VersionStoreProvider,
  store: MergeApplyIntentStore,
  record: MergeApplyIntentRecord,
  resultId: VersionMergeResultId,
): Promise<VersionApplyMergeResult | null> {
  const current = await readCurrentTargetHead(provider, record);
  if (!current.ok || current.commitId !== record.theirs) return null;

  const completed = await completeFastForwardIntent(store, record, record.theirs);
  if (completed.status !== 'completed') {
    return blockedApplyMergeResult(
      record.base,
      record.ours,
      record.theirs,
      intentStoreDiagnostics(completed.diagnostics),
      'ref-not-mutated',
    );
  }

  return resultFromTerminalIntent(provider, completed.record);
}

function completeFastForwardIntent(
  store: MergeApplyIntentStore,
  record: MergeApplyIntentRecord,
  commitId: WorkbookCommitId,
) {
  return store.completeIntent({
    intentId: record.intentId,
    resolvedAttemptDigest: record.resolvedAttemptDigest,
    completedAt: new Date().toISOString(),
    terminal: {
      status: 'fastForwarded',
      headBefore: record.ours,
      headAfter: commitId,
      commitId,
    },
  });
}

async function resultFromTerminalIntent(
  provider: VersionStoreProvider,
  record: MergeApplyIntentRecord,
): Promise<VersionApplyMergeResult> {
  const resultId = publicResultId(record);
  if (record.terminal?.status === 'alreadyMerged') {
    const expectedCommitId = record.terminal.commitId ?? record.terminal.headAfter ?? record.ours;
    const stale = await resultIfTargetMoved(provider, record, resultId, expectedCommitId);
    if (stale) return stale;
    return alreadyMergedPersistedResult(record, resultId);
  }
  if (record.terminal?.status === 'fastForwarded' || record.terminal?.status === 'alreadyApplied') {
    const commitId = record.terminal.commitId ?? record.terminal.headAfter ?? record.theirs;
    const stale = await resultIfTargetMoved(provider, record, resultId, commitId);
    if (stale) return stale;
    return {
      ...persistedMetadata(record, resultId),
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
  return {
    ...persistedMetadata(record, resultId),
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

async function resultIfTargetMoved(
  provider: VersionStoreProvider,
  record: MergeApplyIntentRecord,
  resultId: VersionMergeResultId,
  expectedCommitId: WorkbookCommitId,
): Promise<VersionApplyMergeResult | null> {
  const current = await readCurrentTargetHead(provider, record);
  if (!current.ok) {
    return blockedApplyMergeResult(
      record.base,
      record.ours,
      record.theirs,
      current.diagnostics,
      'no-write-attempted',
    );
  }
  if (current.commitId === expectedCommitId) return null;
  return staleTargetHeadPersistedResult(record, resultId, current.commitId);
}

async function readCurrentTargetHead(
  provider: VersionStoreProvider,
  record: MergeApplyIntentRecord,
): Promise<
  | { readonly ok: true; readonly commitId: WorkbookCommitId }
  | { readonly ok: false; readonly diagnostics: readonly VersionStoreDiagnostic[] }
> {
  try {
    const registry = await provider.readGraphRegistry();
    if (registry.status !== 'ok') {
      return { ok: false, diagnostics: mapProviderDiagnostics(registry.diagnostics) };
    }
    const graph = await provider.openGraph(namespaceForRegistry(registry.registry), provider.accessContext);
    const read = await graph.readRef(record.targetRef);
    if (read.status !== 'success' || !('commitId' in read.ref)) {
      return {
        ok: false,
        diagnostics: mapProviderDiagnostics(read.diagnostics),
      };
    }
    return { ok: true, commitId: read.ref.commitId };
  } catch {
    return { ok: false, diagnostics: [providerErrorDiagnostic()] };
  }
}

function fastForwardedPersistedResult(
  record: MergeApplyIntentRecord,
  resultId: VersionMergeResultId,
  commitRef: WorkbookCommitRef,
): VersionApplyMergeResult {
  return {
    ...persistedMetadata(record, resultId),
    status: 'fastForwarded',
    base: record.base,
    ours: record.ours,
    theirs: record.theirs,
    commitRef,
    changes: [],
    conflicts: [],
    diagnostics: [],
    resolutionCount: 0,
    mutationGuarantee: 'ref-fast-forwarded',
  };
}

function alreadyMergedPersistedResult(
  record: MergeApplyIntentRecord,
  resultId: VersionMergeResultId,
): VersionApplyMergeResult {
  return {
    ...persistedMetadata(record, resultId),
    status: 'alreadyMerged',
    base: record.base,
    ours: record.ours,
    theirs: record.theirs,
    commitRef: commitRefForIntent(record, record.ours),
    changes: [],
    conflicts: [],
    diagnostics: [],
    resolutionCount: 0,
    mutationGuarantee: 'ref-not-mutated',
  };
}

function staleTargetHeadPersistedResult(
  record: MergeApplyIntentRecord,
  resultId: VersionMergeResultId,
  currentHead: WorkbookCommitId,
): VersionApplyMergeResult {
  return {
    ...persistedMetadata(record, resultId),
    headAfter: currentHead,
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

function persistedMetadata(record: MergeApplyIntentRecord, resultId: VersionMergeResultId) {
  return {
    resultId,
    resultDigest: record.resultDigest,
    resolutionSetDigest: record.resolutionSetDigest,
    resolvedAttemptDigest: record.resolvedAttemptDigest,
    targetRef: record.targetRef,
    headBefore: record.terminal?.headBefore ?? record.ours,
    ...(record.terminal?.headAfter ? { headAfter: record.terminal.headAfter } : {}),
  };
}

function persistedPlan(record: MergeApplyIntentRecord) {
  return {
    base: record.base,
    ours: record.ours,
    theirs: record.theirs,
    changes: [],
    resolutionCount: 0,
  };
}

function commitRefForIntent(record: MergeApplyIntentRecord, commitId: WorkbookCommitId): WorkbookCommitRef {
  return {
    id: commitId,
    refName: record.targetRef,
    resolvedFrom: record.targetRef,
  };
}

function publicResultId(record: MergeApplyIntentRecord): VersionMergeResultId {
  return `merge-result:${record.resolvedAttemptDigest.digest}` as VersionMergeResultId;
}

function digestsEqual(
  left: { readonly algorithm: string; readonly digest: string },
  right: { readonly algorithm: string; readonly digest: string },
): boolean {
  return left.algorithm === right.algorithm && left.digest === right.digest;
}

function expectedHeadsEqual(
  left: VersionCommitExpectedHead,
  right: VersionCommitExpectedHead,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

function getAttachedVersionServices(ctx: DocumentContext): AttachedVersionServices | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  return isRecord(services) ? (services as AttachedVersionServices) : null;
}

function getAttachedVersionApplyMergeService(ctx: DocumentContext): AttachedVersionApplyMergeService | null {
  const services = getAttachedVersionServices(ctx);
  if (!services) return null;
  for (const candidate of [
    services.applyMergeService,
    services.versionApplyMergeService,
    services.writeService,
    services.versionWriteService,
    services.publicService,
    services,
  ]) {
    const service = toApplyMergeService(candidate);
    if (service) return service;
  }
  return null;
}

function toApplyMergeService(value: unknown): AttachedVersionApplyMergeService | null {
  const fastForwardMerge =
    bindMethod(value, 'fastForwardMerge') ??
    bindMethod(value, 'fastForward') ??
    bindMethod(value, 'applyFastForwardMerge');
  if (!fastForwardMerge) return null;
  return { fastForwardMerge: (input) => fastForwardMerge(input) };
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function getAttachedMergeApplyIntentStoreProvider(
  ctx: DocumentContext,
): (VersionStoreProvider & MergeApplyIntentStoreProvider) | null {
  const services = getAttachedVersionServices(ctx);
  if (!services) return null;
  for (const candidate of [services.provider, services.versionStoreProvider, services.storeProvider, services]) {
    if (hasMergeApplyIntentStoreProvider(candidate) && hasVersionStoreProviderReads(candidate)) {
      return candidate as VersionStoreProvider & MergeApplyIntentStoreProvider;
    }
  }
  return null;
}

function hasVersionStoreProviderReads(value: unknown): value is VersionStoreProvider {
  return isRecord(value) && typeof value.readGraphRegistry === 'function';
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

function invalidApplyMergeOptionDiagnostic(
  option: string,
  safeMessage: string,
): VersionStoreDiagnostic {
  return publicDiagnostic('VERSION_INVALID_OPTIONS', safeMessage, {
    recoverability: 'none',
    payload: { option },
  });
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
    readonly mutationGuarantee?: VersionStoreDiagnostic['mutationGuarantee'];
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
    mutationGuarantee: options.mutationGuarantee ?? 'no-write-attempted',
  };
}

function isRecoverability(value: unknown): value is VersionStoreDiagnostic['recoverability'] {
  return value === 'retry' || value === 'repair' || value === 'unsupported' || value === 'none';
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
