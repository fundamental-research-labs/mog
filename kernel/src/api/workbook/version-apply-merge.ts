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
  WorkbookCommitRef,
} from '@mog-sdk/contracts/api';

import type { DocumentContext } from '../../context';
import { validateRefName } from '../../document/version-store/ref-name';
import { mergeWorkbookVersion } from './version-merge';

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
const VERSION_MAIN_REF = 'refs/heads/main' satisfies VersionMainRefName;
const VERSION_BRANCH_REF_PREFIX = 'refs/heads/';

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
  const validated = validateApplyMergeRequest(input, options);
  if (!validated.ok) {
    return blockedApplyMergeResult(
      validated.base,
      validated.ours,
      validated.theirs,
      validated.diagnostics,
    );
  }

  if (validated.applyOptions.mode === 'apply' && validated.resolutions.length === 0) {
    const fastForward = await tryApplyFastForwardMerge(
      ctx,
      validated.mergeInput,
      validated.applyOptions,
    );
    if (fastForward.kind === 'applied' || fastForward.kind === 'blocked') {
      return fastForward.result;
    }
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

  if (validated.resolutions.length === 0) {
    if (validated.applyOptions.mode === 'apply') {
      return blockedApplyMergeResult(preview.base, preview.ours, preview.theirs, [
        resolutionMismatchDiagnostic('applyMerge apply mode requires resolutions for conflicted previews.'),
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
    return mapped.status === 'applied'
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

function validateApplyMergeRequest(
  input: VersionApplyMergeInput,
  options: VersionApplyMergeOptions,
): ApplyMergeValidationResult {
  const diagnostics: VersionStoreDiagnostic[] = [];
  const normalizedInput = normalizeApplyMergeInput(input, diagnostics);
  const normalizedOptions = normalizeApplyMergeOptions(options, diagnostics);

  if (!normalizedInput || !normalizedOptions || diagnostics.length > 0) {
    return {
      ok: false,
      base: normalizedInput?.mergeInput.base ?? toCommitId(isRecord(input) ? input.base : undefined),
      ours: normalizedInput?.mergeInput.ours ?? toCommitId(isRecord(input) ? input.ours : undefined),
      theirs:
        normalizedInput?.mergeInput.theirs ?? toCommitId(isRecord(input) ? input.theirs : undefined),
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
): Pick<Extract<ApplyMergeValidationResult, { readonly ok: true }>, 'mergeInput' | 'resolutions'> | null {
  if (!isRecord(input) || Array.isArray(input)) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic('input', 'applyMerge input must be an object.'),
    );
    return null;
  }

  for (const key of Object.keys(input)) {
    if (VERSION_APPLY_MERGE_INPUT_KEYS.has(key)) continue;
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(`input.${key}`, `Unknown applyMerge input "${key}".`),
    );
  }

  const base = toCommitId(input.base);
  const ours = toCommitId(input.ours);
  const theirs = toCommitId(input.theirs);
  if (!base) diagnostics.push(invalidApplyMergeOptionDiagnostic('base', 'base must be a commit id.'));
  if (!ours) diagnostics.push(invalidApplyMergeOptionDiagnostic('ours', 'ours must be a commit id.'));
  if (!theirs) {
    diagnostics.push(invalidApplyMergeOptionDiagnostic('theirs', 'theirs must be a commit id.'));
  }

  const resolutions = normalizeResolutions(input.resolutions, diagnostics);
  return base && ours && theirs && resolutions
    ? { mergeInput: { base, ours, theirs }, resolutions }
    : null;
}

function normalizeResolutions(
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

  const resolutions: VersionApplyMergeResolution[] = [];
  for (let index = 0; index < value.length; index++) {
    const item = value[index];
    const resolution = normalizeResolution(item, index, diagnostics);
    if (resolution) resolutions.push(resolution);
  }
  return diagnostics.length === 0 ? resolutions : null;
}

function normalizeResolution(
  value: unknown,
  index: number,
  diagnostics: VersionStoreDiagnostic[],
): VersionApplyMergeResolution | null {
  if (!isRecord(value) || Array.isArray(value)) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        `resolutions[${index}]`,
        'resolution entries must be objects.',
      ),
    );
    return null;
  }

  const keys = new Set(['conflictId', 'expectedConflictDigest', 'optionId', 'kind']);
  for (const key of Object.keys(value)) {
    if (keys.has(key)) continue;
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        `resolutions[${index}].${key}`,
        `Unknown resolution field "${key}".`,
      ),
    );
  }

  const conflictId = typeof value.conflictId === 'string' ? value.conflictId : null;
  const expectedConflictDigest =
    typeof value.expectedConflictDigest === 'string' ? value.expectedConflictDigest : null;
  const optionId = typeof value.optionId === 'string' ? value.optionId : null;
  const kind =
    value.kind === 'acceptOurs' || value.kind === 'acceptTheirs' || value.kind === 'acceptBase'
      ? value.kind
      : null;

  if (!conflictId) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(`resolutions[${index}].conflictId`, 'conflictId is required.'),
    );
  }
  if (!expectedConflictDigest) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        `resolutions[${index}].expectedConflictDigest`,
        'expectedConflictDigest is required.',
      ),
    );
  }
  if (!optionId) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(`resolutions[${index}].optionId`, 'optionId is required.'),
    );
  }
  if (!kind) {
    diagnostics.push(
      invalidApplyMergeOptionDiagnostic(
        `resolutions[${index}].kind`,
        'resolution kind must be acceptOurs, acceptTheirs, or acceptBase.',
      ),
    );
  }

  return conflictId && expectedConflictDigest && optionId && kind
    ? { conflictId, expectedConflictDigest, optionId, kind }
    : null;
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
        invalidApplyMergeOptionDiagnostic('includeDiagnostics', 'includeDiagnostics must be a boolean.'),
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
      invalidApplyMergeOptionDiagnostic('targetRef', 'targetRef must be a concrete refs/heads/* ref.'),
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
        publicDiagnostic('VERSION_INVALID_OPTIONS', 'targetRef must name a public-safe version branch.', {
          recoverability: 'none',
          payload: { option: 'targetRef', issue: item.issue, refName: 'redacted' },
        }),
      ),
    );
    return undefined;
  }

  return parsed.name === 'main'
    ? VERSION_MAIN_REF
    : (`${VERSION_BRANCH_REF_PREFIX}${parsed.name}` as VersionRefName);
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

function mapApplyMergeWriteResult(
  value: unknown,
  plan: {
    readonly base: WorkbookCommitId;
    readonly ours: WorkbookCommitId;
    readonly theirs: WorkbookCommitId;
    readonly changes: readonly VersionMergeChange[];
    readonly resolutionCount: number;
  },
  successMutationGuarantee: VersionApplyMergeResult['mutationGuarantee'],
): VersionApplyMergeResult {
  if (!isRecord(value)) {
    return blockedApplyMergeResult(plan.base, plan.ours, plan.theirs, [providerErrorDiagnostic()]);
  }

  if (value.status !== 'success' && value.status !== 'applied') {
    return blockedApplyMergeResult(
      plan.base,
      plan.ours,
      plan.theirs,
      mapWriteDiagnostics(value.diagnostics),
      toApplyMergeMutationGuarantee(value.mutationGuarantee),
    );
  }

  const commit = mapWorkbookCommitRef(value.commitRef ?? value.commit);
  const diagnostics = Array.isArray(value.diagnostics) ? mapWriteDiagnostics(value.diagnostics) : [];
  if (!commit || diagnostics.length > 0) {
    return blockedApplyMergeResult(plan.base, plan.ours, plan.theirs, [
      ...diagnostics,
      providerErrorDiagnostic(),
    ]);
  }

  return {
    status: 'applied',
    base: plan.base,
    ours: plan.ours,
    theirs: plan.theirs,
    commitRef: commit,
    changes: plan.changes,
    conflicts: [],
    diagnostics: [],
    resolutionCount: plan.resolutionCount,
    mutationGuarantee: successMutationGuarantee,
  };
}

function isNonFastForwardWriteResult(value: unknown): boolean {
  if (!isRecord(value) || value.status === 'success' || value.status === 'applied') return false;
  if (!Array.isArray(value.diagnostics)) return false;
  return value.diagnostics.some((diagnostic) => {
    if (!isRecord(diagnostic)) return false;
    return (
      diagnostic.code === 'VERSION_UNSUPPORTED_PARENT_COMMIT' ||
      diagnostic.issueCode === 'VERSION_UNSUPPORTED_PARENT_COMMIT'
    );
  });
}

function mapWorkbookCommitRef(value: unknown): WorkbookCommitRef | null {
  if (!isRecord(value)) return null;
  const id = toCommitId(value.id);
  if (!id) return null;

  const refName = value.refName === undefined ? undefined : validatePublicRefNameValue(value.refName);
  const resolvedFrom =
    value.resolvedFrom === undefined ? undefined : validatePublicRefSelectorValue(value.resolvedFrom);
  const refRevision = value.refRevision === undefined ? undefined : toPublicRevision(value.refRevision);
  if (
    (value.refName !== undefined && !refName) ||
    (value.resolvedFrom !== undefined && !resolvedFrom) ||
    (value.refRevision !== undefined && !refRevision)
  ) {
    return null;
  }

  return {
    id,
    ...(refName ? { refName } : {}),
    ...(resolvedFrom ? { resolvedFrom } : {}),
    ...(refRevision ? { refRevision } : {}),
  };
}

function mapWriteDiagnostics(value: unknown): readonly VersionStoreDiagnostic[] {
  if (!Array.isArray(value)) return [providerErrorDiagnostic()];
  return value.map(mapWriteDiagnostic);
}

function mapWriteDiagnostic(value: unknown): VersionStoreDiagnostic {
  if (isRecord(value) && typeof value.issueCode === 'string') {
    return {
      issueCode: value.issueCode,
      severity: isSeverity(value.severity) ? value.severity : 'error',
      recoverability: isRecoverability(value.recoverability) ? value.recoverability : 'none',
      messageTemplateId:
        typeof value.messageTemplateId === 'string'
          ? value.messageTemplateId
          : `version.applyMerge.${value.issueCode}`,
      safeMessage:
        typeof value.safeMessage === 'string'
          ? value.safeMessage
          : typeof value.message === 'string'
            ? value.message
            : 'Version applyMerge failed.',
      ...(isRecord(value.payload) ? { payload: mapPayload(value.payload) } : {}),
      redacted: value.redacted === true,
      ...(toDiagnosticMutationGuarantee(value.mutationGuarantee)
        ? { mutationGuarantee: toDiagnosticMutationGuarantee(value.mutationGuarantee) }
        : {}),
    };
  }
  if (isRecord(value) && typeof value.code === 'string') {
    return publicDiagnostic(value.code, typeof value.message === 'string' ? value.message : 'Version applyMerge failed.', {
      recoverability: value.code === 'VERSION_REF_CONFLICT' ? 'retry' : 'none',
      mutationGuarantee: toDiagnosticMutationGuarantee(value.mutationGuarantee),
    });
  }
  return providerErrorDiagnostic();
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

function validatePublicRefNameValue(value: unknown): VersionMainRefName | VersionRefName | undefined {
  if (value === VERSION_MAIN_REF) return VERSION_MAIN_REF;
  if (typeof value === 'string' && value.startsWith(VERSION_BRANCH_REF_PREFIX)) {
    return value as VersionRefName;
  }
  return undefined;
}

function validatePublicRefSelectorValue(
  value: unknown,
): typeof VERSION_HEAD_REF | VersionMainRefName | VersionRefName | undefined {
  if (value === VERSION_HEAD_REF) return VERSION_HEAD_REF;
  return validatePublicRefNameValue(value);
}

function toApplyMergeMutationGuarantee(
  value: unknown,
): VersionApplyMergeResult['mutationGuarantee'] | undefined {
  return value === 'preview-only' ||
    value === 'merge-commit-created' ||
    value === 'ref-fast-forwarded' ||
    value === 'no-write-attempted' ||
    value === 'ref-not-mutated' ||
    value === 'unknown-after-crash'
    ? value
    : undefined;
}

function toDiagnosticMutationGuarantee(
  value: unknown,
): VersionStoreDiagnostic['mutationGuarantee'] | undefined {
  return value === 'no-write-attempted' ||
    value === 'ref-not-mutated' ||
    value === 'registry-not-visible' ||
    value === 'unknown-after-crash'
    ? value
    : undefined;
}

function planResolvedConflicts(
  conflicts: readonly VersionMergeConflict[],
  resolutions: readonly VersionApplyMergeResolution[],
): ResolutionPlanResult {
  if (resolutions.length !== conflicts.length) {
    return {
      ok: false,
      diagnostics: [
        resolutionMismatchDiagnostic('applyMerge preview requires exactly one resolution per conflict.'),
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
        diagnostics: [resolutionMismatchDiagnostic('resolution does not match the merge conflict.')],
      };
    }

    const option = conflict.resolutionOptions.find(
      (candidate) => candidate.optionId === resolution.optionId && candidate.kind === resolution.kind,
    );
    if (!option) {
      return {
        ok: false,
        diagnostics: [resolutionMismatchDiagnostic('resolution option does not match the conflict.')],
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

function mapPayload(value: Readonly<Record<string, unknown>>): VersionStoreDiagnostic['payload'] {
  const payload: Record<string, string | number | boolean | null> = {};
  for (const [key, item] of Object.entries(value)) {
    payload[key] = isPayloadPrimitive(item) ? item : String(item);
  }
  return payload;
}

function isSeverity(value: unknown): value is VersionStoreDiagnostic['severity'] {
  return value === 'info' || value === 'warning' || value === 'error' || value === 'fatal';
}

function isRecoverability(value: unknown): value is VersionStoreDiagnostic['recoverability'] {
  return value === 'retry' || value === 'repair' || value === 'unsupported' || value === 'none';
}

function isPayloadPrimitive(value: unknown): value is string | number | boolean | null {
  return value === null || ['string', 'number', 'boolean'].includes(typeof value);
}

function toCommitId(value: unknown): WorkbookCommitId | null {
  return typeof value === 'string' && WORKBOOK_COMMIT_ID_RE.test(value)
    ? (value as WorkbookCommitId)
    : null;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === 'object' && value !== null;
}
