import type {
  VersionApplyMergeInput,
  VersionApplyMergeOptions,
  VersionApplyMergeResolution,
  VersionApplyMergeResult,
  VersionCommitExpectedHead,
  VersionMainRefName,
  VersionMergeChange,
  VersionMergeConflict,
  VersionMergeInput,
  VersionMergeOptions,
  VersionRecordRevision,
  VersionRefName,
  VersionStoreDiagnostic,
  WorkbookCommitId,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { validateRefName } from '../../document/version-store/ref-name';
import {
  alreadyMergedApplyMergeResult,
  plannedAncestryApplyMergeResult,
} from './version-apply-merge-ancestry';
import {
  isApplyMergeWriteSuccessResult,
  isNonFastForwardWriteResult,
  mapApplyMergeWriteResult,
} from './version-apply-merge-write-result';
import { applyPersistedMergeResult } from './version-apply-merge-persisted';
import {
  VERSION_BRANCH_REF_PREFIX,
  VERSION_MAIN_REF,
  validateApplyMergeTargetRefCasProof,
  type ApplyMergeTargetRefCasValidationResult,
  isApplyTargetRefName,
} from './version-apply-merge-target-ref';
import { mergeWorkbookVersion } from './version-merge';
import {
  getVersionMergeCapabilityDecision,
  versionMergeCapabilityDisabledDiagnostic,
} from './version-merge-capability';
import { materializableMergePlanDiagnostics } from './version-merge-materializer-support';
import { validateVersionDomainSupportManifestGate } from './version-domain-support-gate';
import { normalizeVersionApplyMergeResolutions } from './version-merge-resolution-normalization';

const WORKBOOK_COMMIT_ID_RE = /^commit:sha256:[0-9a-f]{64}$/;
const VERSION_APPLY_MERGE_INPUT_KEYS = new Set(['base', 'ours', 'theirs', 'resolutions']);
const VERSION_APPLY_MERGE_OPTION_KEYS = new Set([
  'mode',
  'targetRef',
  'expectedTargetHead',
  'includeDiagnostics',
]);
const VERSION_APPLY_MERGE_EXPECTED_HEAD_KEYS = new Set([
  'commitId',
  'revision',
  'symbolicHeadRevision',
]);
const VERSION_HEAD_REF = 'HEAD';

type MaybePromise<T> = T | Promise<T>;
type BoundMethod = (...args: readonly unknown[]) => MaybePromise<unknown>;

type AttachedVersionApplyMergeService = {
  readonly mergeCommit?: (input: VersionApplyMergeWriteInput) => MaybePromise<unknown>;
  readonly fastForwardMerge?: (input: VersionApplyMergeFastForwardInput) => MaybePromise<unknown>;
};

type VersionApplyMergeWriteInput = {
  readonly base: WorkbookCommitId;
  readonly ours: WorkbookCommitId;
  readonly theirs: WorkbookCommitId;
  readonly targetRef: VersionMainRefName | VersionRefName;
  readonly expectedTargetHead: VersionCommitExpectedHead;
  readonly changes: readonly VersionMergeChange[];
  readonly resolutionCount: number;
};

type VersionApplyMergeFastForwardInput = Omit<
  VersionApplyMergeWriteInput,
  'changes' | 'resolutionCount'
>;

type MaybeVersionRuntimeContext = DocumentContext & {
  readonly versioning?: unknown;
  readonly versionStore?: unknown;
  readonly version?: unknown;
};

type ApplyMergeValidationResult =
  | {
      readonly ok: true;
      readonly mergeInput: VersionMergeInput;
      readonly resolutions: readonly VersionApplyMergeResolution[];
      readonly previewOptions: VersionMergeOptions;
      readonly applyOptions: NormalizedApplyMergeOptions;
    }
  | {
      readonly ok: false;
      readonly base: WorkbookCommitId | null;
      readonly ours: WorkbookCommitId | null;
      readonly theirs: WorkbookCommitId | null;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

type ResolutionPlanResult =
  | {
      readonly ok: true;
      readonly changes: readonly VersionMergeChange[];
    }
  | {
      readonly ok: false;
      readonly diagnostics: readonly VersionStoreDiagnostic[];
    };

type NormalizedApplyMergeOptions =
  | {
      readonly mode: 'preview';
      readonly includeDiagnostics?: boolean;
    }
  | {
      readonly mode: 'apply';
      readonly includeDiagnostics?: boolean;
      readonly targetRef: VersionMainRefName | VersionRefName;
      readonly expectedTargetHead: VersionCommitExpectedHead;
    };

export async function applyMergeWorkbookVersion(
  ctx: DocumentContext,
  input: VersionApplyMergeInput,
  options: VersionApplyMergeOptions = {},
): Promise<VersionApplyMergeResult> {
  const capability = getVersionMergeCapabilityDecision(ctx, 'version:mergeApply');
  if (!capability.enabled) {
    return blockedApplyMergeResult(null, null, null, [
      versionMergeCapabilityDisabledDiagnostic('applyMerge', capability),
    ]);
  }

  if (isRecord(input) && 'resultId' in input) {
    const gateDiagnostics = await validateVersionDomainSupportManifestGate(ctx, 'applyMerge');
    if (gateDiagnostics.length > 0) {
      return blockedApplyMergeResult(null, null, null, gateDiagnostics);
    }
    return applyPersistedMergeResult(ctx, input, options);
  }

  const validated = validateApplyMergeRequest(input, options);
  if (!validated.ok) {
    return blockedApplyMergeResult(
      validated.base,
      validated.ours,
      validated.theirs,
      validated.diagnostics,
    );
  }

  const gateDiagnostics = await validateVersionDomainSupportManifestGate(ctx, 'applyMerge');
  if (gateDiagnostics.length > 0) {
    return blockedApplyMergeResult(
      validated.mergeInput.base,
      validated.mergeInput.ours,
      validated.mergeInput.theirs,
      gateDiagnostics,
    );
  }

  if (validated.applyOptions.mode === 'apply' && validated.resolutions.length === 0) {
    const fastForward = await tryApplyFastForwardMerge(
      ctx,
      validated.mergeInput,
      validated.applyOptions,
    );
    if (fastForward.kind !== 'not-fast-forward') return fastForward.result;
  }

  const preview = await mergeWorkbookVersion(ctx, validated.mergeInput, validated.previewOptions);
  if (preview.status === 'blocked') {
    return blockedApplyMergeResult(preview.base, preview.ours, preview.theirs, preview.diagnostics);
  }

  if (preview.status === 'clean') {
    if (validated.resolutions.length > 0) {
      return blockedApplyMergeResult(preview.base, preview.ours, preview.theirs, [
        resolutionMismatchDiagnostic('clean merge previews do not accept conflict resolutions.'),
      ]);
    }
    return finalizeApplyMergePlan(ctx, validated.applyOptions, {
      base: preview.base,
      ours: preview.ours,
      theirs: preview.theirs,
      changes: preview.changes,
      resolutionCount: 0,
    });
  }

  if (preview.status === 'fastForward' || preview.status === 'alreadyMerged') {
    if (validated.resolutions.length > 0) {
      return blockedApplyMergeResult(preview.base, preview.ours, preview.theirs, [
        resolutionMismatchDiagnostic('ancestry merge previews do not accept conflict resolutions.'),
      ]);
    }
    if (validated.applyOptions.mode === 'preview') {
      return plannedAncestryApplyMergeResult(preview);
    }
    if (preview.status === 'alreadyMerged') {
      const cas = await validateApplyModeTargetRefCasProof(ctx, validated.applyOptions);
      if (!cas.ok) {
        return resultFromTargetRefCasFailure(preview.base, preview.ours, preview.theirs, cas);
      }
      return alreadyMergedApplyMergeResult({ ...preview, ...validated.applyOptions });
    }
    return blockedApplyMergeResult(preview.base, preview.ours, preview.theirs, [
      applyMergeServiceUnavailableDiagnostic(),
    ]);
  }

  if (validated.resolutions.length === 0) {
    const supportDiagnostics = materializableMergePlanDiagnostics(
      { changes: preview.changes, conflicts: preview.conflicts },
      'applyMerge',
    );
    if (supportDiagnostics.length > 0) {
      return blockedApplyMergeResult(
        preview.base,
        preview.ours,
        preview.theirs,
        supportDiagnostics,
      );
    }
    if (validated.applyOptions.mode === 'apply') {
      return blockedApplyMergeResult(preview.base, preview.ours, preview.theirs, [
        resolutionMismatchDiagnostic(
          'applyMerge apply mode requires resolutions for conflicted previews.',
        ),
      ]);
    }

    return {
      status: 'conflicted',
      base: preview.base,
      ours: preview.ours,
      theirs: preview.theirs,
      changes: preview.changes,
      conflicts: preview.conflicts,
      diagnostics: [],
      requiredResolutionCount: preview.conflicts.length,
      mutationGuarantee: 'preview-only',
    };
  }

  if (validated.resolutions.some((resolution) => resolution.sealedPayloadRef)) {
    return blockedApplyMergeResult(preview.base, preview.ours, preview.theirs, [
      resolutionMismatchDiagnostic(
        'sealed resolution payload refs require a persisted merge preview artifact.',
      ),
    ]);
  }

  const plan = planResolvedConflicts(preview.conflicts, validated.resolutions);
  if (!plan.ok) {
    return blockedApplyMergeResult(preview.base, preview.ours, preview.theirs, plan.diagnostics);
  }

  return finalizeApplyMergePlan(ctx, validated.applyOptions, {
    base: preview.base,
    ours: preview.ours,
    theirs: preview.theirs,
    changes: [...preview.changes, ...plan.changes],
    resolutionCount: validated.resolutions.length,
  });
}

async function finalizeApplyMergePlan(
  ctx: DocumentContext,
  options: NormalizedApplyMergeOptions,
  plan: {
    readonly base: WorkbookCommitId;
    readonly ours: WorkbookCommitId;
    readonly theirs: WorkbookCommitId;
    readonly changes: readonly VersionMergeChange[];
    readonly resolutionCount: number;
  },
): Promise<VersionApplyMergeResult> {
  const supportDiagnostics = materializableMergePlanDiagnostics(
    { changes: plan.changes },
    'applyMerge',
  );
  if (supportDiagnostics.length > 0) {
    return blockedApplyMergeResult(plan.base, plan.ours, plan.theirs, supportDiagnostics);
  }

  if (options.mode === 'preview') {
    return {
      status: 'planned',
      base: plan.base,
      ours: plan.ours,
      theirs: plan.theirs,
      changes: plan.changes,
      conflicts: [],
      diagnostics: [],
      resolutionCount: plan.resolutionCount,
      mutationGuarantee: 'preview-only',
    };
  }

  if (options.expectedTargetHead.commitId !== plan.ours) {
    return blockedApplyMergeResult(plan.base, plan.ours, plan.theirs, [
      resolutionMismatchDiagnostic('applyMerge expectedTargetHead must match the ours commit.'),
    ]);
  }

  const cas = await validateApplyModeTargetRefCasProof(ctx, options);
  if (!cas.ok) return resultFromTargetRefCasFailure(plan.base, plan.ours, plan.theirs, cas);

  const service = getAttachedVersionApplyMergeService(ctx);
  if (!service?.mergeCommit) {
    return blockedApplyMergeResult(plan.base, plan.ours, plan.theirs, [
      applyMergeServiceUnavailableDiagnostic(),
    ]);
  }

  try {
    const result = await service.mergeCommit({
      ...plan,
      targetRef: options.targetRef,
      expectedTargetHead: options.expectedTargetHead,
    });
    return mapApplyMergeWriteResult(result, plan, 'merge-commit-created');
  } catch {
    return blockedApplyMergeResult(plan.base, plan.ours, plan.theirs, [providerErrorDiagnostic()]);
  }
}

async function tryApplyFastForwardMerge(
  ctx: DocumentContext,
  input: VersionMergeInput,
  options: Extract<NormalizedApplyMergeOptions, { readonly mode: 'apply' }>,
): Promise<
  | { readonly kind: 'applied'; readonly result: VersionApplyMergeResult }
  | { readonly kind: 'blocked'; readonly result: VersionApplyMergeResult }
  | { readonly kind: 'not-fast-forward' }
> {
  if (options.expectedTargetHead.commitId !== input.ours) {
    return {
      kind: 'blocked',
      result: blockedApplyMergeResult(input.base, input.ours, input.theirs, [
        resolutionMismatchDiagnostic('applyMerge expectedTargetHead must match the ours commit.'),
      ]),
    };
  }

  const cas = await validateApplyModeTargetRefCasProof(ctx, options);
  if (!cas.ok) {
    return {
      kind: 'blocked',
      result: resultFromTargetRefCasFailure(input.base, input.ours, input.theirs, cas),
    };
  }

  const service = getAttachedVersionApplyMergeService(ctx);
  if (!service?.fastForwardMerge) return { kind: 'not-fast-forward' };

  try {
    const result = await service.fastForwardMerge({
      base: input.base,
      ours: input.ours,
      theirs: input.theirs,
      targetRef: options.targetRef,
      expectedTargetHead: options.expectedTargetHead,
    });
    if (isNonFastForwardWriteResult(result)) return { kind: 'not-fast-forward' };
    const mapped = mapApplyMergeWriteResult(
      result,
      {
        base: input.base,
        ours: input.ours,
        theirs: input.theirs,
        changes: [],
        resolutionCount: 0,
      },
      'ref-fast-forwarded',
    );
    return isApplyMergeWriteSuccessResult(mapped)
      ? { kind: 'applied', result: mapped }
      : { kind: 'blocked', result: mapped };
  } catch {
    return {
      kind: 'blocked',
      result: blockedApplyMergeResult(input.base, input.ours, input.theirs, [
        providerErrorDiagnostic(),
      ]),
    };
  }
}

function validateApplyModeTargetRefCasProof(
  ctx: DocumentContext,
  options: Extract<NormalizedApplyMergeOptions, { readonly mode: 'apply' }>,
): Promise<ApplyMergeTargetRefCasValidationResult> {
  return validateApplyMergeTargetRefCasProof(ctx, {
    targetRef: options.targetRef,
    expectedTargetHead: options.expectedTargetHead,
  });
}

function resultFromTargetRefCasFailure(
  base: WorkbookCommitId,
  ours: WorkbookCommitId,
  theirs: WorkbookCommitId,
  failure: Extract<ApplyMergeTargetRefCasValidationResult, { readonly ok: false }>,
): VersionApplyMergeResult {
  return failure.kind === 'staleTargetHead'
    ? staleTargetHeadApplyMergeResult(base, ours, theirs, failure.diagnostics)
    : blockedApplyMergeResult(base, ours, theirs, failure.diagnostics);
}

function validateApplyMergeRequest(
  input: VersionApplyMergeInput,
  options: VersionApplyMergeOptions,
): ApplyMergeValidationResult {
  const diagnostics: VersionStoreDiagnostic[] = [];
  const normalizedInput = normalizeApplyMergeInput(input, diagnostics);
  const normalizedOptions = normalizeApplyMergeOptions(options, diagnostics);

  if (!normalizedInput || !normalizedOptions || diagnostics.length > 0) {
    const inputRecord = isRecord(input) ? (input as Readonly<Record<string, unknown>>) : null;
    return {
      ok: false,
      base: normalizedInput?.mergeInput.base ?? toCommitId(inputRecord?.base),
      ours: normalizedInput?.mergeInput.ours ?? toCommitId(inputRecord?.ours),
      theirs: normalizedInput?.mergeInput.theirs ?? toCommitId(inputRecord?.theirs),
      diagnostics,
    };
  }

  return {
    ok: true,
    mergeInput: normalizedInput.mergeInput,
    resolutions: normalizedInput.resolutions,
    previewOptions: {
      mode: 'preview',
      ...(normalizedOptions.includeDiagnostics === undefined
        ? {}
        : { includeDiagnostics: normalizedOptions.includeDiagnostics }),
    },
    applyOptions: normalizedOptions,
  };
}

function normalizeApplyMergeInput(
  input: VersionApplyMergeInput,
  diagnostics: VersionStoreDiagnostic[],
): Pick<
  Extract<ApplyMergeValidationResult, { readonly ok: true }>,
  'mergeInput' | 'resolutions'
> | null {
  if (!isRecord(input) || Array.isArray(input)) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic('input', 'applyMerge input must be an object.'),
    );
    return null;
  }
  const inputRecord = input as Readonly<Record<string, unknown>>;

  for (const key of Object.keys(inputRecord)) {
    if (VERSION_APPLY_MERGE_INPUT_KEYS.has(key)) continue;
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(`input.${key}`, `Unknown applyMerge input "${key}".`),
    );
  }

  const base = toCommitId(inputRecord.base);
  const ours = toCommitId(inputRecord.ours);
  const theirs = toCommitId(inputRecord.theirs);
  if (!base)
    diagnostics.push(invalidApplyMergeOptionDiagnostic('base', 'base must be a commit id.'));
  if (!ours)
    diagnostics.push(invalidApplyMergeOptionDiagnostic('ours', 'ours must be a commit id.'));
  if (!theirs) {
    diagnostics.push(invalidApplyMergeOptionDiagnostic('theirs', 'theirs must be a commit id.'));
  }

  const resolutions = normalizeResolutions(inputRecord.resolutions, diagnostics);
  return base && ours && theirs && resolutions
    ? { mergeInput: { base, ours, theirs }, resolutions }
    : null;
}

function normalizeResolutions(
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): readonly VersionApplyMergeResolution[] | null {
  return normalizeVersionApplyMergeResolutions(value, diagnostics, {
    allowUndefined: true,
    invalidDiagnostic: invalidApplyMergeOptionDiagnostic,
  });
}

function normalizeApplyMergeOptions(
  input: VersionApplyMergeOptions,
  diagnostics: VersionStoreDiagnostic[],
): NormalizedApplyMergeOptions | null {
  if (!isRecord(input) || Array.isArray(input)) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic('options', 'applyMerge options must be an object.'),
    );
    return null;
  }

  for (const key of Object.keys(input)) {
    if (VERSION_APPLY_MERGE_OPTION_KEYS.has(key)) continue;
    diagnostics.push(invalidApplyMergeOptionDiagnostic(key, `Unknown applyMerge option "${key}".`));
  }

  let mode: 'preview' | 'apply' = 'apply';
  if (input.mode !== undefined) {
    if (input.mode === 'preview' || input.mode === 'apply') {
      mode = input.mode;
    } else {
      diagnostics.push(
        invalidApplyMergeOptionDiagnostic('mode', 'applyMerge mode must be "preview" or "apply".'),
      );
    }
  }
  const baseOptions: { mode: 'preview' | 'apply'; includeDiagnostics?: boolean } = { mode };

  if (input.includeDiagnostics !== undefined) {
    if (typeof input.includeDiagnostics !== 'boolean') {
      diagnostics.push(
        invalidApplyMergeOptionDiagnostic(
          'includeDiagnostics',
          'includeDiagnostics must be a boolean.',
        ),
      );
    } else {
      baseOptions.includeDiagnostics = input.includeDiagnostics;
    }
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
    return diagnostics.length === 0 ? { ...baseOptions, mode: 'preview' } : null;
  }

  const targetRef = validateTargetRef(input.targetRef, diagnostics);
  const expectedTargetHead = validateExpectedTargetHead(input.expectedTargetHead, diagnostics);
  return diagnostics.length === 0 && targetRef && expectedTargetHead
    ? { ...baseOptions, mode: 'apply', targetRef, expectedTargetHead }
    : null;
}

function validateTargetRef(
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): VersionMainRefName | VersionRefName | undefined {
  if (typeof value !== 'string') {
    diagnostics.push(invalidApplyMergeOptionDiagnostic('targetRef', 'targetRef is required.'));
    return undefined;
  }
  if (value === VERSION_HEAD_REF) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        'targetRef',
        'targetRef must be a concrete refs/heads/* ref.',
      ),
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
            recoverability: 'none',
            payload: { option: 'targetRef', issue: item.issue, refName: 'redacted' },
          },
        ),
      ),
    );
    return undefined;
  }

  const targetRef =
    parsed.name === 'main'
      ? VERSION_MAIN_REF
      : (`${VERSION_BRANCH_REF_PREFIX}${parsed.name}` as VersionRefName);
  if (!isApplyTargetRefName(targetRef)) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        'targetRef',
        'targetRef must name main, scenario/*, or agent/*.',
      ),
    );
    return undefined;
  }
  return targetRef;
}

function validateExpectedTargetHead(
  value: unknown,
  diagnostics: VersionStoreDiagnostic[],
): VersionCommitExpectedHead | undefined {
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        'expectedTargetHead',
        'expectedTargetHead is required in apply mode.',
      ),
    );
    return undefined;
  }

  for (const key of Object.keys(value)) {
    if (VERSION_APPLY_MERGE_EXPECTED_HEAD_KEYS.has(key)) continue;
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        `expectedTargetHead.${key}`,
        `Unknown expectedTargetHead field "${key}".`,
      ),
    );
  }

  const commitId = toCommitId(value.commitId);
  const revision = toPublicRevision(value.revision);
  const symbolicHeadRevision =
    value.symbolicHeadRevision === undefined
      ? undefined
      : toPublicRevision(value.symbolicHeadRevision);

  if (!commitId) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        'expectedTargetHead.commitId',
        'expectedTargetHead.commitId is invalid.',
      ),
    );
  }
  if (!revision) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        'expectedTargetHead.revision',
        'expectedTargetHead.revision is invalid.',
      ),
    );
  }
  if ('symbolicHeadRevision' in value && !symbolicHeadRevision) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        'expectedTargetHead.symbolicHeadRevision',
        'expectedTargetHead.symbolicHeadRevision is invalid.',
      ),
    );
  }
  return commitId && revision && (!('symbolicHeadRevision' in value) || symbolicHeadRevision)
    ? {
        commitId,
        revision,
        ...(symbolicHeadRevision ? { symbolicHeadRevision } : {}),
      }
    : undefined;
}

function getAttachedVersionApplyMergeService(
  ctx: DocumentContext,
): AttachedVersionApplyMergeService | null {
  const runtime = ctx as MaybeVersionRuntimeContext;
  const services = runtime.versioning ?? runtime.versionStore ?? runtime.version ?? null;
  if (!isRecord(services)) return null;

  for (const candidate of [
    services.applyMergeService,
    services.versionApplyMergeService,
    services.writeService,
    services.commitService,
    services.publicService,
  ]) {
    const service = toApplyMergeService(candidate);
    if (service) return service;
  }

  return null;
}

function toApplyMergeService(value: unknown): AttachedVersionApplyMergeService | null {
  const mergeCommit =
    bindMethod(value, 'mergeCommit') ??
    bindMethod(value, 'applyMerge') ??
    bindMethod(value, 'applyMergeVersion') ??
    bindMethod(value, 'applyMergeCommit');
  const fastForwardMerge =
    bindMethod(value, 'fastForwardMerge') ??
    bindMethod(value, 'fastForwardApplyMerge') ??
    bindMethod(value, 'applyMergeFastForward');
  if (!mergeCommit && !fastForwardMerge) return null;
  return {
    ...(mergeCommit ? { mergeCommit: (input) => mergeCommit(input) } : {}),
    ...(fastForwardMerge ? { fastForwardMerge: (input) => fastForwardMerge(input) } : {}),
  };
}

function bindMethod(value: unknown, name: string): BoundMethod | null {
  if (!isRecord(value)) return null;
  const method = value[name];
  if (typeof method !== 'function') return null;
  return (...args) => Reflect.apply(method, value, args) as MaybePromise<unknown>;
}

function toPublicRevision(value: unknown): VersionRecordRevision | undefined {
  if (isRecord(value) && value.kind === 'counter' && typeof value.value === 'string') {
    return { kind: 'counter', value: value.value };
  }
  if (isRecord(value) && value.kind === 'opaque' && typeof value.value === 'string') {
    return { kind: 'opaque', value: value.value };
  }
  if (typeof value === 'string') return { kind: 'opaque', value };
  return undefined;
}

function planResolvedConflicts(
  conflicts: readonly VersionMergeConflict[],
  resolutions: readonly VersionApplyMergeResolution[],
): ResolutionPlanResult {
  if (resolutions.length !== conflicts.length) {
    return {
      ok: false,
      diagnostics: [
        resolutionMismatchDiagnostic(
          'applyMerge preview requires exactly one resolution per conflict.',
        ),
      ],
    };
  }

  const conflictsById = new Map(conflicts.map((conflict) => [conflict.conflictId, conflict]));
  const seenConflictIds = new Set<string>();
  const changes: VersionMergeChange[] = [];

  for (const resolution of resolutions) {
    if (seenConflictIds.has(resolution.conflictId)) {
      return {
        ok: false,
        diagnostics: [resolutionMismatchDiagnostic('duplicate conflict resolution supplied.')],
      };
    }
    seenConflictIds.add(resolution.conflictId);

    const conflict = conflictsById.get(resolution.conflictId);
    if (!conflict || resolution.expectedConflictDigest !== conflict.conflictDigest) {
      return {
        ok: false,
        diagnostics: [
          resolutionMismatchDiagnostic('resolution does not match the merge conflict.'),
        ],
      };
    }

    const option = conflict.resolutionOptions.find(
      (candidate) =>
        candidate.optionId === resolution.optionId && candidate.kind === resolution.kind,
    );
    if (!option) {
      return {
        ok: false,
        diagnostics: [
          resolutionMismatchDiagnostic('resolution option does not match the conflict.'),
        ],
      };
    }

    changes.push({
      structural: conflict.structural,
      base: conflict.base,
      ours: conflict.ours,
      theirs: conflict.theirs,
      merged: option.value,
      ...(conflict.display ? { display: conflict.display } : {}),
      ...(option.diagnostics && option.diagnostics.length > 0
        ? { diagnostics: option.diagnostics }
        : {}),
    });
  }

  return { ok: true, changes };
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

function staleTargetHeadApplyMergeResult(
  base: WorkbookCommitId,
  ours: WorkbookCommitId,
  theirs: WorkbookCommitId,
  diagnostics: readonly VersionStoreDiagnostic[],
): VersionApplyMergeResult {
  return {
    status: 'staleTargetHead',
    base,
    ours,
    theirs,
    changes: [],
    conflicts: [],
    diagnostics,
    mutationGuarantee: 'ref-not-mutated',
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

function toCommitId(value: unknown): WorkbookCommitId | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
